import {
  type FortUnit,
  type FortWorld,
  decodeTable,
  postgres_db,
  schema,
} from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { desc, eq, sql } from 'drizzle-orm'

import { type ModelConfig, complete, readModelConfig } from '~/lib/ai/model'
import { pronouns } from '~/lib/fortress/insights'
import { getSupabaseServerClient } from '~/lib/utils/supabase/server'
import {
  type ChronicleEvent,
  type DwarfFact,
  type DwarfName,
  type NicknameIdea,
  buildDossiers,
  factIdeas,
} from './-dossier'
import { isLivingCitizen, livingCitizens } from './-utils'

export type { NicknameIdea } from './-dossier'

const SINGLETON_ID = 1
const MAX_BATCH_SIZE = 250
export const MAX_NICKNAME_LENGTH = 40
/** Dwarves per request to the model; the page sends batches this size. */
export const WRITE_BATCH_SIZE = 6
const FACTS_SHOWN = 8
const FACTS_FOR_MODEL = 12
const CACHE_TTL_MS = 60 * 60_000
const CACHE_MAX = 500

export interface NicknameAssignment {
  unitId: number
  nickname: string
}

function validateNickname(value: string): string {
  const nickname = value.trim()
  if (Array.from(nickname).length > MAX_NICKNAME_LENGTH) {
    throw new Error(`Nicknames can be at most ${MAX_NICKNAME_LENGTH} characters`)
  }
  if (
    Array.from(nickname).some((character) => {
      const code = character.charCodeAt(0)
      return code < 32 || code === 127
    })
  ) {
    throw new Error('Nicknames cannot contain control characters')
  }
  return nickname
}

async function requireUser() {
  const {
    data: { user },
  } = await getSupabaseServerClient().auth.getUser()
  if (!user) throw new Error('You must be signed in to nickname citizens')
  return user
}

// ---------------------------------------------------------------------------
// The fortress as the nickname pages see it

interface Fortress {
  capturedAt: string | null
  world: FortWorld | null
  citizens: FortUnit[]
  events: ChronicleEvent[]
}

/** The loaded fortress's announcements up to its present, newest first. */
async function fortressEvents(world: FortWorld | null): Promise<ChronicleEvent[]> {
  if (!world || typeof world.year !== 'number' || typeof world.tick !== 'number') return []
  const E = schema.fort_events
  const prefix = `${world.save_dir}:${world.site_id}:`
  return postgres_db
    .select({ type: E.type, text: E.text })
    .from(E)
    .where(
      sql`starts_with(${E.dedupe_key}, ${prefix}) and not coalesce(${E.game_year} > ${world.year} or (${E.game_year} = ${world.year} and ${E.game_tick} > ${world.tick}), false)`,
    )
    .orderBy(desc(E.game_year), desc(E.game_tick), desc(E.id))
    .limit(5000)
}

async function loadFortress(): Promise<Fortress> {
  const [stateRows, dumpRows] = await Promise.all([
    postgres_db
      .select({ world: schema.fort_state.world })
      .from(schema.fort_state)
      .where(eq(schema.fort_state.id, SINGLETON_ID))
      .limit(1),
    postgres_db
      .select({ captured_at: schema.fort_dump.captured_at, units: schema.fort_dump.units })
      .from(schema.fort_dump)
      .where(eq(schema.fort_dump.id, SINGLETON_ID))
      .limit(1),
  ])
  const world = stateRows[0]?.world ?? null
  return {
    capturedAt: dumpRows[0]?.captured_at ?? null,
    world,
    citizens: livingCitizens(decodeTable<FortUnit>(dumpRows[0]?.units)),
    events: await fortressEvents(world),
  }
}

// ---------------------------------------------------------------------------
// Ideas from the facts alone

export interface DossierFact {
  text: string
  /** No other citizen shares it. */
  only: boolean
}

export interface DwarfIdeas {
  unitId: number
  facts: DossierFact[]
  ideas: NicknameIdea[]
}

export interface NicknameIdeas {
  capturedAt: string | null
  writer: { enabled: boolean; model: string | null }
  dwarves: DwarfIdeas[]
}

export const getNicknameIdeas = createServerFn({ method: 'GET' }).handler(
  async (): Promise<NicknameIdeas> => {
    await requireUser()
    const fort = await loadFortress()
    const dossiers = buildDossiers(fort.citizens, fort.events)
    const ideas = factIdeas(fort.citizens, dossiers)
    const config = readModelConfig()
    return {
      capturedAt: fort.capturedAt,
      writer: { enabled: Boolean(config), model: config?.model ?? null },
      dwarves: fort.citizens.map((unit) => ({
        unitId: unit.id,
        facts: (dossiers.facts.get(unit.id) ?? []).slice(0, FACTS_SHOWN).map((fact) => ({
          text: fact.text,
          only: fact.shared === 1 && fort.citizens.length > 1,
        })),
        ideas: ideas.get(unit.id) ?? [],
      })),
    }
  },
)

// ---------------------------------------------------------------------------
// Ideas from the model

const SYSTEM_PROMPT = [
  "You give nicknames to the dwarves of a Dwarf Fortress fortress. In the game a nickname replaces the dwarf's first name, shown as `Nickname' Surname, and it sticks for life. So it must be short, work as a name, and make anyone who knows the dwarf grin.",
  '',
  'What makes one good:',
  "- It hangs on one concrete fact from that dwarf's dossier, best of all one marked [only them]. Small, specific, slightly undignified facts make the best names: where they sleep, what they drink from, what they are missing, the odd skill they are best at, a habit at odds with their job or rank.",
  '- Contrast beats description. For a legendary miner who tolerates nothing, the intolerance is funnier than the mining. Two facts that clash make the best names of all.',
  "- Say it sideways: understatement, mock grandeur for a petty deed, a dwarvish compound in the style of the game's own names (Mudbed, Cupless, Ninefingers), or what a fortmate would shout across the dining hall.",
  '- A name that would suit most dwarves, or anyone with the same job, is a failure.',
  '',
  'Rules:',
  '- One to three words, at most 24 characters. Plain ASCII letters, spaces, hyphens and apostrophes only.',
  '- No pop-culture references, memes, modern slang or puns on real people.',
  '- None of these tired words: master, lord, king, queen, legend, legendary, slayer, destroyer, wizard, whisperer, enjoyer, menace, chaos, goblin (unless a goblin is in the facts), beard (unless their beard is the fact), "the Great".',
  "- Never repeat the dwarf's own first name, and never use a name listed as taken. Across the whole reply, no two names may share their main word.",
  '- Invent nothing. Every name and every why must rest on the facts given.',
  '',
  'For each dwarf give three options built on three different facts. Give each a "why": one short sentence a fortmate might say to explain the name, stating the fact truthfully.',
  '',
  'Reply with JSON only, with no prose and no code fence:',
  '{"dwarves":[{"id":<number>,"options":[{"nickname":"...","why":"..."}]}]}',
].join('\n')

interface Target {
  unit: FortUnit
  facts: DwarfFact[]
  name: DwarfName
}

function describe({ unit, facts, name }: Target, fortSize: number): string {
  const p = pronouns(unit)
  const { given, surname, meaning } = name
  const current = unit.nickname?.trim()
  const lines = [
    `Dwarf ${unit.id}: ${[given ?? '(first name unknown)', surname].filter(Boolean).join(' ')}, ${p.they}/${p.them}, ${Math.floor(unit.age)} years old, ${unit.profession}.`,
  ]
  if (surname) {
    lines.push(
      `Their nickname would read \`Nickname' ${surname}${meaning && meaning !== surname ? ` (the surname means "${meaning}")` : ''}.`,
    )
  }
  if (current) lines.push(`They are nicknamed "${current}" now; offer different names.`)
  for (const fact of facts.slice(0, FACTS_FOR_MODEL)) {
    const only = fact.shared === 1 && fortSize > 1
    lines.push(`- ${only ? '[only them] ' : ''}${fact.text}`)
  }
  return lines.join('\n')
}

/** What the game can show: ASCII letters, digits and a little punctuation. */
function cleanNickname(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const ascii = raw
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[\u2018\u2019\u201b`\u00b4]/g, "'")
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[^A-Za-z0-9 '\-.,!&]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s'\-.,]+|[\s'\-,]+$/g, '')
  return Array.from(ascii).slice(0, MAX_NICKNAME_LENGTH).join('')
}

function cleanWhy(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/\s+/g, ' ').trim().slice(0, 240)
}

interface ModelDwarf {
  id: number
  options: { nickname: string; why: string }[]
}

function parseReply(text: string): ModelDwarf[] {
  const body = text.replace(/```(?:json)?/gi, '')
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('The model did not answer in JSON.')
  let json: unknown
  try {
    json = JSON.parse(body.slice(start, end + 1))
  } catch {
    throw new Error('The model answered with broken JSON.')
  }
  const dwarves = (json as { dwarves?: unknown }).dwarves
  if (!Array.isArray(dwarves)) throw new Error('The model answered without any dwarves.')
  return dwarves.flatMap((d): ModelDwarf[] => {
    const id = Number((d as { id?: unknown }).id)
    const options = (d as { options?: unknown }).options
    if (!Number.isSafeInteger(id) || !Array.isArray(options)) return []
    return [
      {
        id,
        options: options.map((o) => ({
          nickname: cleanNickname((o as { nickname?: unknown }).nickname),
          why: cleanWhy((o as { why?: unknown }).why),
        })),
      },
    ]
  })
}

const cache = new Map<string, { at: number; ideas: NicknameIdea[] }>()

function remember(key: string, ideas: NicknameIdea[]) {
  if (cache.size >= CACHE_MAX) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) cache.delete(oldest[0])
  }
  cache.set(key, { at: Date.now(), ideas })
}

async function askModel(
  config: ModelConfig,
  fort: Fortress,
  targets: Target[],
  taken: string[],
): Promise<Map<number, NicknameIdea[]>> {
  const header = [
    `Fortress: ${fort.world?.site_name || 'unnamed'}, ${fort.citizens.length} citizens, year ${fort.world?.year ?? 'unknown'}.`,
    taken.length ? `Taken, do not use: ${taken.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n')
  const user = [header, ...targets.map((target) => describe(target, fort.citizens.length))].join(
    '\n\n',
  )
  const text = await complete(config, {
    system: SYSTEM_PROMPT,
    user,
    temperature: 1,
    maxTokens: Math.min(4000, 400 + 220 * targets.length),
    timeoutMs: 90_000,
  })
  const takenSet = new Set(taken.map((name) => name.toLowerCase()))
  const byId = new Map(targets.map((target) => [target.unit.id, target]))
  const out = new Map<number, NicknameIdea[]>()
  for (const dwarf of parseReply(text)) {
    const target = byId.get(dwarf.id)
    if (!target) continue
    const { unit, name } = target
    const own = [name.given, unit.nickname?.trim()].map((n) => n?.toLowerCase()).filter(Boolean)
    const seen = new Set<string>()
    const ideas: NicknameIdea[] = []
    for (const option of dwarf.options) {
      const key = option.nickname.toLowerCase()
      if (!key || own.includes(key) || seen.has(key) || takenSet.has(key)) continue
      seen.add(key)
      ideas.push({ nickname: option.nickname, why: option.why, source: 'model' })
    }
    out.set(unit.id, ideas.slice(0, 3))
  }
  return out
}

export interface WrittenNicknames {
  model: string
  dwarves: { unitId: number; ideas: NicknameIdea[] }[]
}

export const writeNicknames = createServerFn({ method: 'POST' })
  .inputValidator(
    (input: {
      unitIds: number[]
      /** Names in use or on screen elsewhere, which the model must not repeat. */
      avoid?: string[]
      /** Skip the memo and ask the model again. */
      fresh?: boolean
    }) => input,
  )
  .handler(async ({ data }): Promise<WrittenNicknames> => {
    await requireUser()
    const config = readModelConfig()
    if (!config)
      throw new Error(
        'No model is configured. Set LEGENDS_NARRATOR_PROVIDER and LEGENDS_NARRATOR_API_KEY.',
      )
    if (!Array.isArray(data.unitIds) || data.unitIds.length === 0) {
      throw new Error('Choose at least one citizen')
    }
    if (data.unitIds.length > WRITE_BATCH_SIZE * 2) {
      throw new Error(`At most ${WRITE_BATCH_SIZE * 2} dwarves can be named at once`)
    }

    const fort = await loadFortress()
    const dossiers = buildDossiers(fort.citizens, fort.events)
    const byId = new Map(fort.citizens.map((unit) => [unit.id, unit]))
    const wanted = [...new Set(data.unitIds)].flatMap((id): Target[] => {
      const unit = byId.get(id)
      const name = dossiers.names.get(id)
      return unit && name ? [{ unit, facts: dossiers.facts.get(id) ?? [], name }] : []
    })
    if (!wanted.length) throw new Error('None of those citizens are in the current fortress')

    const keyOf = ({ unit, facts }: Target) =>
      `${config.model}:${unit.id}:${facts
        .slice(0, FACTS_FOR_MODEL)
        .map((f) => f.key)
        .join('|')}`
    const results = new Map<number, NicknameIdea[]>()
    const missing = wanted.filter((target) => {
      const hit = cache.get(keyOf(target))
      if (data.fresh || !hit || Date.now() - hit.at > CACHE_TTL_MS) return true
      results.set(target.unit.id, hit.ideas)
      return false
    })

    if (missing.length) {
      const asking = new Set(missing.map(({ unit }) => unit.id))
      const taken = [
        ...fort.citizens
          .filter((unit) => !asking.has(unit.id))
          .map((unit) => unit.nickname?.trim() ?? ''),
        ...(Array.isArray(data.avoid) ? data.avoid : []),
      ]
        .map((name) => (typeof name === 'string' ? cleanNickname(name) : ''))
        .filter(Boolean)
      const written = await askModel(config, fort, missing, [...new Set(taken)].slice(0, 200))
      for (const target of missing) {
        const ideas = written.get(target.unit.id) ?? []
        results.set(target.unit.id, ideas)
        if (ideas.length) remember(keyOf(target), ideas)
      }
    }

    return {
      model: config.model,
      dwarves: wanted.map(({ unit }) => ({ unitId: unit.id, ideas: results.get(unit.id) ?? [] })),
    }
  })

// ---------------------------------------------------------------------------
// Queueing

export const queueDwarfNicknames = createServerFn({ method: 'POST' })
  .inputValidator((input: { assignments: NicknameAssignment[] }) => input)
  .handler(async ({ data }) => {
    await requireUser()

    if (!Array.isArray(data.assignments) || data.assignments.length === 0) {
      throw new Error('Choose at least one citizen')
    }
    if (data.assignments.length > MAX_BATCH_SIZE) {
      throw new Error(`At most ${MAX_BATCH_SIZE} nicknames can be queued at once`)
    }

    const [stateRows, dumpRows] = await Promise.all([
      postgres_db
        .select({ status: schema.fort_state.status })
        .from(schema.fort_state)
        .where(eq(schema.fort_state.id, SINGLETON_ID))
        .limit(1),
      postgres_db
        .select({ units: schema.fort_dump.units })
        .from(schema.fort_dump)
        .where(eq(schema.fort_dump.id, SINGLETON_ID))
        .limit(1),
    ])
    if (stateRows[0]?.status !== 'live') {
      throw new Error('A live fortress is required')
    }

    const citizens = new Map(
      decodeTable<FortUnit>(dumpRows[0]?.units)
        .filter(isLivingCitizen)
        .map((unit) => [unit.id, unit]),
    )
    const seen = new Set<number>()
    const rows = data.assignments.map((assignment) => {
      if (!Number.isSafeInteger(assignment.unitId) || assignment.unitId < 0) {
        throw new Error('Invalid unit id')
      }
      if (seen.has(assignment.unitId)) {
        throw new Error(`Citizen ${assignment.unitId} was included more than once`)
      }
      seen.add(assignment.unitId)
      if (!citizens.has(assignment.unitId)) {
        throw new Error(`Citizen ${assignment.unitId} is not in the current fortress`)
      }
      return {
        kind: 'set_nickname' as const,
        unit_id: assignment.unitId,
        nickname: validateNickname(assignment.nickname),
      }
    })

    const queued = await postgres_db
      .insert(schema.fort_commands)
      .values(rows)
      .returning({ id: schema.fort_commands.id })
    return {
      queued: queued.length,
      commandIds: queued.map((command) => command.id),
    }
  })
