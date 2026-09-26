import {
  type FortUnit,
  type FortWorld,
  decodeTable,
  postgres_db,
  schema,
} from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, sql } from 'drizzle-orm'

import { complete, readModelConfig } from '~/lib/ai/model'
import { getSupabaseServerClient } from '~/lib/utils/supabase/server'
import { VOICE_MODES, type VoiceMode, characterBrief } from './character'
import { type ChronicleEvent, buildDossiers, callName } from './dossier'
import { formatGameTick, mentionNeedles } from './format'
import { gameTimeOf, pronouns } from './insights'

/*
 * Role play for one unit: the player's own notes, what sets them apart from
 * the other citizens, and an optional language model that speaks as them
 * from nothing but what the dump and the chronicle say.
 */

const SINGLETON_ID = 1
const MAX_NOTE = 20_000
const MAX_QUESTION = 500
const MAX_TURNS = 12
const MAX_TURN = 1500
const CACHE_TTL_MS = 30 * 60_000
const CACHE_MAX = 200

async function requireUser(): Promise<string> {
  const {
    data: { user },
  } = await getSupabaseServerClient().auth.getUser()
  if (!user) throw new Error('Sign in to role play')
  return user.id
}

interface Fortress {
  world: FortWorld | null
  /** "save_dir:site_id", as the chronicle keys the fortress. */
  key: string | null
  units: FortUnit[]
}

async function loadFortress(): Promise<Fortress> {
  const [stateRows, dumpRows] = await Promise.all([
    postgres_db
      .select({ world: schema.fort_state.world })
      .from(schema.fort_state)
      .where(eq(schema.fort_state.id, SINGLETON_ID))
      .limit(1),
    postgres_db
      .select({ units: schema.fort_dump.units })
      .from(schema.fort_dump)
      .where(eq(schema.fort_dump.id, SINGLETON_ID))
      .limit(1),
  ])
  const world = stateRows[0]?.world ?? null
  return {
    world,
    key: world ? `${world.save_dir}:${world.site_id}` : null,
    units: decodeTable<FortUnit>(dumpRows[0]?.units),
  }
}

/** The fortress's announcements up to its present, newest first. */
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

function livingCitizens(units: FortUnit[]): FortUnit[] {
  return units.filter(
    (u) => u.flags.includes('citizen') && !u.flags.includes('dead') && !u.flags.includes('ghost'),
  )
}

// ---------------------------------------------------------------------------
// Notes

export interface UnitNote {
  note: string
  updatedAt: string | null
}

export const getUnitNote = createServerFn({ method: 'GET' })
  .inputValidator((input: { unitId: number }) => input)
  .handler(async ({ data }): Promise<UnitNote> => {
    const userId = await requireUser()
    const fort = await loadFortress()
    if (!fort.key) return { note: '', updatedAt: null }
    const N = schema.fort_unit_notes
    const rows = await postgres_db
      .select({ note: N.note, updated_at: N.updated_at })
      .from(N)
      .where(and(eq(N.user_id, userId), eq(N.fort_key, fort.key), eq(N.unit_id, data.unitId)))
      .limit(1)
    return { note: rows[0]?.note ?? '', updatedAt: rows[0]?.updated_at ?? null }
  })

export const saveUnitNote = createServerFn({ method: 'POST' })
  .inputValidator((input: { unitId: number; note: string }) => input)
  .handler(async ({ data }): Promise<UnitNote> => {
    const userId = await requireUser()
    if (!Number.isSafeInteger(data.unitId) || data.unitId < 0) throw new Error('Invalid unit id')
    const fort = await loadFortress()
    if (!fort.key) throw new Error('No fortress has been loaded yet')
    const N = schema.fort_unit_notes
    const note = (data.note ?? '').slice(0, MAX_NOTE)
    if (!note.trim()) {
      await postgres_db
        .delete(N)
        .where(and(eq(N.user_id, userId), eq(N.fort_key, fort.key), eq(N.unit_id, data.unitId)))
      return { note: '', updatedAt: null }
    }
    const now = new Date().toISOString()
    const [row] = await postgres_db
      .insert(N)
      .values({ user_id: userId, fort_key: fort.key, unit_id: data.unitId, note })
      .onConflictDoUpdate({
        target: [N.user_id, N.fort_key, N.unit_id],
        set: { note, updated_at: now },
      })
      .returning({ note: N.note, updated_at: N.updated_at })
    return { note: row?.note ?? note, updatedAt: row?.updated_at ?? now }
  })

// ---------------------------------------------------------------------------
// What sets them apart

export interface UnitDossier {
  /** Strongest first; `only` when no other citizen shares it. */
  facts: { text: string; only: boolean }[]
  /** What to call them in a sentence, with a nickname put back to their own name. */
  callName: string | null
}

export const getUnitDossier = createServerFn({ method: 'GET' })
  .inputValidator((input: { unitId: number }) => input)
  .handler(async ({ data }): Promise<UnitDossier> => {
    await requireUser()
    const fort = await loadFortress()
    const citizens = livingCitizens(fort.units)
    const unit = citizens.find((u) => u.id === data.unitId)
    if (!unit) return { facts: [], callName: null }
    const dossiers = buildDossiers(citizens, await fortressEvents(fort.world))
    return {
      facts: (dossiers.facts.get(unit.id) ?? []).slice(0, 12).map((fact) => ({
        text: fact.text,
        only: fact.shared === 1 && citizens.length > 1,
      })),
      callName: callName(dossiers.names.get(unit.id), unit),
    }
  })

// ---------------------------------------------------------------------------
// Speaking as them

export interface VoiceTurn {
  role: 'player' | 'dwarf'
  text: string
}

export interface VoiceStatus {
  enabled: boolean
  model: string | null
}

export interface Voiced {
  text: string
  model: string
  /** How many statements the model was given. */
  facts: number
  cached: boolean
}

export const getVoiceStatus = createServerFn({ method: 'GET' }).handler(
  async (): Promise<VoiceStatus> => {
    const config = readModelConfig()
    return { enabled: Boolean(config), model: config?.model ?? null }
  },
)

const SYSTEM_PROMPT = [
  'You give voice to one inhabitant of a Dwarf Fortress fortress, usually a dwarf, for a player who role-plays their fortress.',
  'Stay true to the facts you are given: personality, beliefs, longings, likes, the people they know, their memories and what the chronicle says happened. Do not invent events, people, places, possessions or outcomes the facts do not give. You may add feeling, opinion, turns of phrase and small everyday colour that fit the facts.',
  'Let the personality set the voice: a rude dwarf is rude, a shy one hesitant, an anxious one frets, a cheerful one jokes. Beliefs colour what they approve of and scorn.',
  'Use names exactly as given. Dwarves speak plainly and concretely, of stone, drink, craft, kin and grudges.',
  'Never mention game mechanics or numbers: no stress, focus, needs, labors, skills levels, syndromes, units or ticks. Turn them into lived experience instead.',
  'No modern slang, no pop culture, no headings, no lists unless asked, no preamble.',
].join(' ')

function modeInstruction(mode: VoiceMode, name: string, they: string, date: string): string {
  switch (mode) {
    case 'voice':
      return `Write what ${name} would say, in the first person, to someone who sat down beside ${name} right now: what is on ${name}'s mind, how ${they} feel about the fortress and the people in it, what ${they} want. 80 to 160 words. Only ${name}'s words, without narration or quotation marks.`
    case 'diary':
      return `Write tonight's entry in ${name}'s diary, in the first person, headed with the date ${date}. What happened lately, who ${they} saw, what ${they} feel and want. 100 to 200 words of plain prose; a dwarf's diary is blunt.`
    case 'gossip':
      return `Write three or four pieces of tavern gossip about ${name}, one or two sentences each, each said by a different fortmate. Speakers must come from the people listed as knowing ${name}; each speaker's tone must fit how they stand with ${name}. Put each on its own line as: Speaker: what they say.`
    case 'bio':
      return `Write a short biography of ${name} as the fortress chronicler would set it down: who ${they} are, how ${they} came to be here as far as the facts say, what drives ${name} and what troubles ${name}. Third person, 120 to 220 words, two paragraphs.`
    case 'ask':
      return `The player puts a question to ${name}. Answer as ${name}, in the first person and in character, in one to five sentences. Where the facts are silent, answer as ${name} would: dodge, grumble, guess or admit ${they} do not know, but invent no facts about the fortress.`
  }
}

const cache = new Map<string, { at: number; value: Voiced }>()

function remember(key: string, value: Voiced) {
  if (cache.size >= CACHE_MAX) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) cache.delete(oldest[0])
  }
  cache.set(key, { at: Date.now(), value })
}

function cleanTurns(turns: VoiceTurn[] | undefined): VoiceTurn[] {
  if (!Array.isArray(turns)) return []
  return turns
    .filter((t) => (t.role === 'player' || t.role === 'dwarf') && typeof t.text === 'string')
    .slice(-MAX_TURNS)
    .map((t) => ({ role: t.role, text: t.text.trim().slice(0, MAX_TURN) }))
    .filter((t) => t.text)
}

export const speakAs = createServerFn({ method: 'POST' })
  .inputValidator(
    (input: {
      unitId: number
      mode: VoiceMode
      /** For "ask": the question, and the conversation so far. */
      question?: string
      history?: VoiceTurn[]
      /** Skip the memo and ask the model again. */
      fresh?: boolean
    }) => input,
  )
  .handler(async ({ data }): Promise<Voiced> => {
    await requireUser()
    const config = readModelConfig()
    if (!config)
      throw new Error(
        'No model is configured. Set LEGENDS_NARRATOR_PROVIDER and LEGENDS_NARRATOR_API_KEY.',
      )
    if (!VOICE_MODES.some((m) => m.key === data.mode)) throw new Error('Unknown way to speak')
    const question = (data.question ?? '').trim().slice(0, MAX_QUESTION)
    if (data.mode === 'ask' && !question) throw new Error('Ask them something first')
    const history = data.mode === 'ask' ? cleanTurns(data.history) : []

    const fort = await loadFortress()
    const unit = fort.units.find((u) => u.id === data.unitId)
    if (!unit) throw new Error('They are not in the current fortress')
    const now = gameTimeOf({ world: fort.world })
    const events = await fortressEvents(fort.world)
    const citizens = livingCitizens(fort.units)
    const isCitizen = citizens.some((u) => u.id === unit.id)
    const dossiers = isCitizen ? buildDossiers(citizens, events) : null
    const name = dossiers ? callName(dossiers.names.get(unit.id), unit) : unit.name || unit.readable
    const needles = mentionNeedles(unit.name).map((n) => n.toLowerCase())
    const mentions = needles.length
      ? events
          .filter(
            (e) => e.type !== 'CANCEL_JOB' && needles.some((n) => e.text.toLowerCase().includes(n)),
          )
          .slice(0, 15)
      : []

    const brief = characterBrief(unit, now)
    const facts = (dossiers?.facts.get(unit.id) ?? []).slice(0, 10).map((f) => `${name} ${f.text}.`)
    const world = fort.world
    const date = world ? formatGameTick(world.year, world.tick) : 'today'
    const p = pronouns(unit)
    const lines = [
      world
        ? `Fortress: ${world.site_name || 'unnamed'}, in the world of ${world.name || 'unknown'}. Today is ${date}, ${world.season}.`
        : '',
      '',
      `About ${name}:`,
      ...brief.map((l) => `- ${l}`),
      ...(facts.length
        ? ['', 'What sets them apart from the other citizens:', ...facts.map((f) => `- ${f}`)]
        : []),
      ...(mentions.length
        ? [
            '',
            'The fortress chronicle mentions them (newest first):',
            ...mentions.map((e) => `- ${e.text}`),
          ]
        : []),
      '',
      modeInstruction(data.mode, name, p.they, date),
      ...(data.mode === 'ask'
        ? [
            '',
            ...(history.length
              ? [
                  'The conversation so far:',
                  ...history.map((t) => `${t.role === 'player' ? 'Player' : name}: ${t.text}`),
                ]
              : []),
            `Player: ${question}`,
            `${name}:`,
          ]
        : []),
    ].filter((line, i, all) => line !== '' || (i > 0 && all[i - 1] !== ''))
    const user = lines.join('\n')

    const key = `${config.model}:${unit.id}:${data.mode}:${user}`
    const hit = cache.get(key)
    if (hit && !data.fresh && Date.now() - hit.at < CACHE_TTL_MS)
      return { ...hit.value, cached: true }

    const text = await complete(config, {
      system: SYSTEM_PROMPT,
      user,
      temperature: 0.9,
      maxTokens: data.mode === 'ask' ? 400 : 700,
      timeoutMs: 90_000,
    })
    const speaker = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*`)
    const voiced: Voiced = {
      text: text.replace(speaker, '').trim(),
      model: config.model,
      facts: brief.length + facts.length + mentions.length,
      cached: false,
    }
    remember(key, voiced)
    return voiced
  })
