import {
  type FortUnit,
  type FortWorld,
  decodeTable,
  postgres_db,
  schema,
} from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'

import { type ModelConfig, complete, readModelConfig } from '~/lib/ai/model'
import {
  type ChronicleEvent,
  type DwarfFact,
  type DwarfName,
  type NicknameIdea,
  buildDossiers,
  factIdeas,
} from '~/lib/fortress/dossier'
import { pronouns } from '~/lib/fortress/insights'
import { type ListState, matchNameList } from '~/lib/fortress/nameList'
import { getSupabaseServerClient } from '~/lib/utils/supabase/server'
import { isLivingCitizen, livingCitizens } from './-utils'

export type { NicknameIdea } from '~/lib/fortress/dossier'

const SINGLETON_ID = 1
const MAX_BATCH_SIZE = 250
export const MAX_NICKNAME_LENGTH = 40
/** Dwarves per request to the model; the page sends batches this size. */
export const WRITE_BATCH_SIZE = 6
const FACTS_SHOWN = 8
const FACTS_FOR_MODEL = 14
const CACHE_TTL_MS = 60 * 60_000
const CACHE_MAX = 500
const MAX_WHY = 300
export const MAX_LIST = 500
const LIST_FOR_MODEL = 60

type IdeaSource = NicknameIdea['source'] | 'typed'
const SOURCES = new Set<IdeaSource>(['facts', 'model', 'list', 'typed'])

export interface NicknameAssignment {
  unitId: number
  nickname: string
  /** The fact behind the name, kept so the dwarf's page can tell it. */
  why?: string | null
  source?: IdeaSource
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
  /** "save_dir:site_id", as the chronicle keys the fortress. */
  key: string | null
  citizens: FortUnit[]
  /** Every unit in the dump, the dead included. */
  everyone: FortUnit[]
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
  const everyone = decodeTable<FortUnit>(dumpRows[0]?.units)
  return {
    capturedAt: dumpRows[0]?.captured_at ?? null,
    world,
    key: world ? `${world.save_dir}:${world.site_id}` : null,
    citizens: livingCitizens(everyone),
    everyone,
    events: await fortressEvents(world),
  }
}

/** The player's list, oldest first. */
async function readList(userId: string): Promise<{ id: number; name: string }[]> {
  const L = schema.nickname_list
  return postgres_db
    .select({ id: L.id, name: L.name })
    .from(L)
    .where(eq(L.user_id, userId))
    .orderBy(L.created_at, L.id)
    .limit(MAX_LIST)
}

export interface RememberedNickname {
  nickname: string
  why: string | null
  source: IdeaSource
  at: string
}

/** Each unit's newest remembered nickname in this fortress. */
async function readRemembered(
  userId: string,
  fortKey: string | null,
): Promise<Map<number, RememberedNickname>> {
  const out = new Map<number, RememberedNickname>()
  if (!fortKey) return out
  const N = schema.fort_nicknames
  const rows = await postgres_db
    .select({
      unit_id: N.unit_id,
      nickname: N.nickname,
      why: N.why,
      source: N.source,
      created_at: N.created_at,
    })
    .from(N)
    .where(and(eq(N.user_id, userId), eq(N.fort_key, fortKey)))
    .orderBy(desc(N.created_at), desc(N.id))
    .limit(5000)
  for (const row of rows) {
    if (out.has(row.unit_id)) continue
    out.set(row.unit_id, {
      nickname: row.nickname,
      why: row.why,
      source: row.source,
      at: row.created_at,
    })
  }
  return out
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
  /** Their own first name and surname, for showing how a nickname reads in the game. */
  name: DwarfName | null
  facts: DossierFact[]
  ideas: NicknameIdea[]
  /** Why they got the nickname they have, when it was given here. */
  remembered: RememberedNickname | null
}

export interface ListedName {
  id: number
  name: string
  /** The dwarf who goes by it, fits it, or is offered it as a wild card. */
  unitId: number | null
  state: ListState
}

export interface NicknameIdeas {
  capturedAt: string | null
  writer: { enabled: boolean; model: string | null }
  dwarves: DwarfIdeas[]
  list: ListedName[]
}

export const getNicknameIdeas = createServerFn({ method: 'GET' }).handler(
  async (): Promise<NicknameIdeas> => {
    const user = await requireUser()
    const fort = await loadFortress()
    const [list, remembered] = await Promise.all([
      readList(user.id),
      readRemembered(user.id, fort.key),
    ])
    const dossiers = buildDossiers(fort.citizens, fort.events, fort.everyone)
    const ideas = factIdeas(fort.citizens, dossiers)
    const listed = matchNameList(
      list.map((entry) => entry.name),
      fort.citizens,
      dossiers,
    )
    const config = readModelConfig()
    return {
      capturedAt: fort.capturedAt,
      writer: { enabled: Boolean(config), model: config?.model ?? null },
      dwarves: fort.citizens.map((unit) => {
        const mine = listed.ideas.get(unit.id)
        const facts = ideas.get(unit.id) ?? []
        const own = remembered.get(unit.id)
        const current = unit.nickname?.trim().toLowerCase()
        return {
          unitId: unit.id,
          name: dossiers.names.get(unit.id) ?? null,
          facts: (dossiers.facts.get(unit.id) ?? []).slice(0, FACTS_SHOWN).map((fact) => ({
            text: fact.text,
            only: fact.shared === 1 && fort.citizens.length > 1,
          })),
          ideas: !mine
            ? facts
            : listed.placements.get(mine.nickname.toLowerCase())?.state === 'fits'
              ? [mine, ...facts]
              : [...facts.slice(0, 4), mine],
          remembered: own && current && own.nickname.toLowerCase() === current ? own : null,
        }
      }),
      list: list.map((entry) => {
        const placement = listed.placements.get(entry.name.toLowerCase())
        return {
          id: entry.id,
          name: entry.name,
          unitId: placement?.unitId ?? null,
          state: placement?.state ?? 'spare',
        }
      }),
    }
  },
)

// ---------------------------------------------------------------------------
// The player's list

/** A name as the game can hold it, or empty when there is nothing usable. */
function cleanListName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const printable = Array.from(raw)
    .map((character) => {
      const code = character.charCodeAt(0)
      return code < 32 || code === 127 ? ' ' : character
    })
    .join('')
  const name = printable
    .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return Array.from(name).slice(0, MAX_NICKNAME_LENGTH).join('').trim()
}

export const addToNameList = createServerFn({ method: 'POST' })
  .inputValidator((input: { names: string[] }) => input)
  .handler(async ({ data }): Promise<{ added: number }> => {
    const user = await requireUser()
    if (!Array.isArray(data.names)) throw new Error('Send a list of names')
    const seen = new Set<string>()
    const names = data.names
      .map(cleanListName)
      .filter((name) => {
        const key = name.toLowerCase()
        if (!name || seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, MAX_LIST)
    if (!names.length) return { added: 0 }
    const added = await postgres_db
      .insert(schema.nickname_list)
      .values(names.map((name) => ({ user_id: user.id, name })))
      .onConflictDoNothing()
      .returning({ id: schema.nickname_list.id })
    return { added: added.length }
  })

export const removeFromNameList = createServerFn({ method: 'POST' })
  .inputValidator((input: { ids: number[] }) => input)
  .handler(async ({ data }): Promise<{ removed: number }> => {
    const user = await requireUser()
    const ids = (Array.isArray(data.ids) ? data.ids : []).filter(Number.isSafeInteger)
    if (!ids.length) return { removed: 0 }
    const L = schema.nickname_list
    const removed = await postgres_db
      .delete(L)
      .where(and(eq(L.user_id, user.id), inArray(L.id, ids)))
      .returning({ id: L.id })
    return { removed: removed.length }
  })

// ---------------------------------------------------------------------------
// Ideas from the model

const SYSTEM_PROMPT = [
  "You give nicknames to the dwarves of a Dwarf Fortress fortress, the way the funniest Dwarf Fortress streamers name theirs on stream. In the game a nickname replaces the dwarf's first name, shown as `Nickname' Surname, and it sticks for life. So it has to be funny out loud and impossible to forget.",
  '',
  'The spirit wanted, from names a streamer gave his dwarves: Tiny Toes Thompson, OSHA Supervisor, Dr. Methylene Blue, PhD, Lever Enjoyer, Test Dummy, Driftwood Muncher, Curling Stone 2 Unleashed, Ice Cube Jr., Fluid Druid, Space Potato, Fred Durst the Vampire, Elf Fister, Dwarfy McDwarfface, Weed McGee.',
  '',
  'What makes one land:',
  "- It hangs on one concrete fact from that dwarf's dossier, best of all one marked [only them]: what they eat, drink, love or detest, what they are missing, a mishap from the chronicle, an odd best skill, a job they are hopeless at, who their parent or partner is, whose job they took over. Things you could watch happen in the game beat personality.",
  '- Two facts that clash are gold: a legendary miner who is a coward, a doctor without a single medical skill.',
  "- A label is not a joke. 'Oyster Hater' only states the fact; 'Shuck Norris' makes it a name. 'Lynx Gourmet' states; 'Tripe Hound' or 'Cat Gut' lands. Twist the fact with a pun, a rhyme, a title or a pop-culture swap instead of describing it.",
  '- Mix the forms: a thing plus a doer (Driftwood Muncher, Lever Enjoyer), an ironic job title (OSHA Supervisor, Test Dummy), a mock credential (Dr. ..., PhD; Sir; Esq.), sequels and family (Jr., II, 2 Unleashed, Lil), rhymes (Fluid Druid, Gizzard Wizard), alliteration with a made-up surname (Tiny Toes Thompson), an absurd noun (Space Potato), McGee and McFace templates, and pop culture, memes or real people when the fact sets them up (Fred Durst the Vampire for a blood drinker, Van Gogh for a lost ear).',
  '- Crude, rude and silly are all welcome. Slurs and jokes at the expense of real-world groups are not.',
  '- A name that would suit most dwarves, or anyone with the same job, is a failure.',
  '',
  'Rules:',
  "- One to four words, at most 28 characters. Plain ASCII letters, digits, spaces and the punctuation - ' . , ! & only.",
  "- Never put the dwarf's surname in the nickname: the game already prints it after. Never repeat the dwarf's own first name, and never use a name listed as taken. Across the whole reply, no two names may share their main word, and no form may be used for more than a third of the names.",
  '- Invent nothing. Every name and every why must rest on the facts given.',
  "- When the player's own list is given, you may offer a name from it word for word where it truly fits a dwarf's facts. Never force one.",
  '',
  'For each dwarf give three options built on three different facts, in three different forms. Give each a "why": one short sentence a fortmate might say to explain the name, stating the fact truthfully.',
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
  list: string[],
): Promise<Map<number, NicknameIdea[]>> {
  const header = [
    `Fortress: ${fort.world?.site_name || 'unnamed'}, ${fort.citizens.length} citizens, year ${fort.world?.year ?? 'unknown'}.`,
    taken.length ? `Taken, do not use: ${taken.join(', ')}.` : '',
    list.length ? `The player's own list, free to hand out: ${list.join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n')
  const listed = new Set(list.map((name) => name.toLowerCase()))
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
      if (name.surname && key.includes(name.surname.toLowerCase())) continue
      seen.add(key)
      ideas.push({
        nickname: option.nickname,
        why: option.why,
        source: listed.has(key) ? 'list' : 'model',
      })
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
    const user = await requireUser()
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
    const dossiers = buildDossiers(fort.citizens, fort.events, fort.everyone)
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
      const takenKeys = new Set(taken.map((name) => name.toLowerCase()))
      const list = (await readList(user.id))
        .map((entry) => cleanNickname(entry.name))
        .filter((name) => name && !takenKeys.has(name.toLowerCase()))
        .slice(0, LIST_FOR_MODEL)
      const written = await askModel(config, fort, missing, [...new Set(taken)].slice(0, 200), list)
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
    const user = await requireUser()

    if (!Array.isArray(data.assignments) || data.assignments.length === 0) {
      throw new Error('Choose at least one citizen')
    }
    if (data.assignments.length > MAX_BATCH_SIZE) {
      throw new Error(`At most ${MAX_BATCH_SIZE} nicknames can be queued at once`)
    }

    const [stateRows, dumpRows] = await Promise.all([
      postgres_db
        .select({ status: schema.fort_state.status, world: schema.fort_state.world })
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

    const world = stateRows[0]?.world
    const fortKey = world ? `${world.save_dir}:${world.site_id}` : null
    const memories = fortKey
      ? data.assignments.flatMap((assignment, i) => {
          const nickname = rows[i].nickname
          if (!nickname) return []
          const source = SOURCES.has(assignment.source as IdeaSource)
            ? (assignment.source as IdeaSource)
            : 'typed'
          const why =
            typeof assignment.why === 'string' && source !== 'typed'
              ? assignment.why.replace(/\s+/g, ' ').trim().slice(0, MAX_WHY) || null
              : null
          return [
            {
              user_id: user.id,
              fort_key: fortKey,
              unit_id: assignment.unitId,
              nickname,
              why,
              source,
            },
          ]
        })
      : []

    const queued = await postgres_db.transaction(async (tx) => {
      const commands = await tx
        .insert(schema.fort_commands)
        .values(rows)
        .returning({ id: schema.fort_commands.id })
      if (memories.length) await tx.insert(schema.fort_nicknames).values(memories)
      return commands
    })
    return {
      queued: queued.length,
      commandIds: queued.map((command) => command.id),
    }
  })
