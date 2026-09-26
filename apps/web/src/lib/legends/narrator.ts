import { type LegendsPayload, type LegendsRecord, postgres_db } from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'

import { type ModelConfig, type ModelProvider, complete, readModelConfig } from '~/lib/ai/model'
import { getSpanDigest, getStories } from './chronicle'
import { eventSentence, legendsDate, yearSpan } from './events'
import { kindLabel, titleCase, words } from './model'
import { spanLabel, summarizeSpan } from './prose'
import { R, type RefSet, addRefs, describeRows, eventsWhere, lookupNames } from './records'

/**
 * An optional AI narrator. Configured through environment variables only;
 * without them every page keeps to its deterministic prose. The model is
 * given nothing but sentences the app already derives from the records, and
 * is told to invent nothing beyond them.
 */

export type NarratorProvider = ModelProvider

export interface NarratorStatus {
  enabled: boolean
  provider: NarratorProvider | null
  model: string | null
}

export type NarratorSubject =
  | { kind: 'span'; from: number; to: number }
  | { kind: 'record'; recordKind: string; id: number }
  | { kind: 'story'; key: string }

/** The voice the narration is told in. */
export type NarratorStyle = 'chronicle' | 'saga' | 'tavern'

export const NARRATOR_STYLES: { key: NarratorStyle; label: string; hint: string }[] = [
  {
    key: 'chronicle',
    label: 'Chronicle',
    hint: 'Sober, as a legends-mode scribe would set it down.',
  },
  { key: 'saga', label: 'Saga', hint: 'Sweeping and old, the way dwarves sing of it.' },
  { key: 'tavern', label: 'Tavern tale', hint: 'How a traveller might tell it over a mug.' },
]

export interface Narration {
  title: string
  text: string
  /** How many facts the narrator was handed. */
  facts: number
  model: string
  cached: boolean
}

const MAX_FACTS = 150
const CACHE_TTL_MS = 60 * 60_000
const CACHE_MAX = 200

export const getNarratorStatus = createServerFn({ method: 'GET' }).handler(
  async (): Promise<NarratorStatus> => {
    const config = readModelConfig()
    return config
      ? { enabled: true, provider: config.provider, model: config.model }
      : { enabled: false, provider: null, model: null }
  },
)

// ---------------------------------------------------------------------------
// Facts

interface Facts {
  title: string
  lines: string[]
}

/** Pick up to `limit` events spread across the whole run, keeping first and last. */
function sample<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items
  const out: T[] = []
  const step = (items.length - 1) / (limit - 1)
  for (let i = 0; i < limit; i++) out.push(items[Math.round(i * step)])
  return out
}

async function eventLines(worldId: number, events: LegendsRecord[]): Promise<string[]> {
  const refs: RefSet = {}
  for (const event of events) addRefs(refs, event.payload)
  const names = await lookupNames(worldId, refs)
  return events.map((event) => {
    const p = event.payload as LegendsPayload
    const year = typeof p.year === 'number' ? p.year : null
    const seconds = typeof p.seconds72 === 'number' ? p.seconds72 : null
    return `${legendsDate(year, seconds)}: ${eventSentence(event, names)}`
  })
}

async function recordFacts(
  worldId: number,
  recordKind: string,
  id: number,
  limit = MAX_FACTS,
): Promise<Facts | null> {
  const rows = await postgres_db
    .select()
    .from(R)
    .where(and(eq(R.world_id, worldId), eq(R.kind, recordKind), eq(R.id, id)))
    .limit(1)
  const record = rows[0]
  if (!record) return null
  const [hit] = await describeRows(worldId, [record])
  const payload = record.payload as LegendsPayload
  const title = hit?.name ? titleCase(hit.name) : `An unnamed ${words(record.type ?? recordKind)}`
  const lines: string[] = [
    `${title} is a ${kindLabel(recordKind).toLowerCase()}${hit?.detail ? `: ${hit.detail}` : '.'}`,
  ]
  const where = eventsWhere(worldId, recordKind, id, payload)
  if (where) {
    const index = await postgres_db
      .select({ id: R.id, year: R.year })
      .from(R)
      .where(and(where, sql`${R.year} >= 0`))
      .orderBy(asc(R.year), sql`(${R.payload}->>'seconds72')::int asc nulls first`, asc(R.id))
    const picked = sample(index, Math.max(1, limit - 1))
    if (picked.length) {
      const events = await postgres_db
        .select()
        .from(R)
        .where(
          and(
            eq(R.world_id, worldId),
            eq(R.kind, 'historical_event'),
            inArray(
              R.id,
              picked.map((row) => row.id),
            ),
          ),
        )
        .orderBy(asc(R.year), sql`(${R.payload}->>'seconds72')::int asc nulls first`, asc(R.id))
      if (index.length > picked.length)
        lines.push(
          `The records hold ${index.length.toLocaleString()} events about this; ${picked.length} spread across them follow.`,
        )
      lines.push(...(await eventLines(worldId, events)))
    }
  }
  return { title, lines }
}

async function spanFacts(worldId: number, from: number, to: number): Promise<Facts> {
  const digest = await getSpanDigest({ data: { worldId, from, to } })
  const lines: string[] = [summarizeSpan(digest)]
  for (const battle of digest.battles.slice(0, 12)) {
    lines.push(
      `Battle: ${battle.name ? titleCase(battle.name) : 'an unnamed battle'}${battle.year !== null ? ` in ${battle.year}` : ''}, ${battle.attacker?.name ? titleCase(battle.attacker.name) : 'unknown attackers'} against ${battle.defender?.name ? titleCase(battle.defender.name) : 'unknown defenders'}${battle.site?.name ? ` at ${titleCase(battle.site.name)}` : ''}${battle.casualties ? `; ${battle.casualties.toLocaleString()} fell` : ''}${battle.outcome ? `; ${battle.outcome}` : ''}.`,
    )
  }
  for (const war of digest.wars.slice(0, 8)) {
    lines.push(
      `War: ${war.name ? titleCase(war.name) : 'an unnamed war'}, ${war.aggressor?.name ? titleCase(war.aggressor.name) : 'unknown'} against ${war.defender?.name ? titleCase(war.defender.name) : 'unknown'}${yearSpan(war.startYear, war.endYear) ? `, ${yearSpan(war.startYear, war.endYear)}` : ''}.`,
    )
  }
  for (const person of digest.people.slice(0, 8)) {
    lines.push(
      `Figure of the age: ${person.name ? titleCase(person.name) : 'an unnamed figure'}, ${person.race ?? 'unknown race'}${yearSpan(person.birthYear, person.deathYear) ? ` (${yearSpan(person.birthYear, person.deathYear)})` : ''}, named in ${person.events} events.`,
    )
  }
  const budget = Math.max(20, MAX_FACTS - lines.length)
  const moments = [...digest.moments].sort(
    (a, b) =>
      (a.year ?? 0) - (b.year ?? 0) ||
      (Number((a.payload as LegendsPayload).seconds72) || 0) -
        (Number((b.payload as LegendsPayload).seconds72) || 0),
  )
  lines.push(...(await eventLines(worldId, sample(moments, budget))))
  return { title: `Chronicle of ${spanLabel(from, to)}`, lines }
}

async function storyFacts(worldId: number, key: string): Promise<Facts | null> {
  const stories = await getStories({ data: { worldId } })
  const story = stories.groups.flatMap((g) => g.stories).find((s) => s.key === key)
  if (!story) return null
  const lines: string[] = [story.blurb]
  if (story.events?.length) lines.push(...(await eventLines(worldId, story.events)))
  const lead = story.refs[0]
  if (lead) {
    const more = await recordFacts(
      worldId,
      lead.kind,
      lead.id,
      Math.max(20, MAX_FACTS - lines.length),
    )
    if (more) lines.push(...more.lines)
  }
  return { title: story.title, lines }
}

// ---------------------------------------------------------------------------
// The model

const STYLE_PROMPT: Record<NarratorStyle, string> = {
  chronicle:
    'Write as the chronicler of this world would set it down in the legends: measured, vivid, concrete, in the past tense.',
  saga: 'Write as a dwarven saga, sung down the generations: sweeping, weighty, fond of epithets and of stone, ale and iron, but never silly.',
  tavern:
    'Write as a well-travelled storyteller telling it over a mug in a tavern: warm, wry, direct, with the odd aside to the listener.',
}

function systemPrompt(style: NarratorStyle): string {
  return [
    'You narrate the history of a Dwarf Fortress world for a reader exploring its legends.',
    STYLE_PROMPT[style],
    'Use only the facts you are given. Do not invent people, places, causes, feelings or outcomes the facts do not state; where the record is silent you may say the record is silent.',
    'Refer to people, places and groups by exactly the names given. Keep dates as years.',
    'Write two to four short paragraphs and at most 280 words. No headings, lists, titles or preamble.',
  ].join(' ')
}

function callModel(config: ModelConfig, style: NarratorStyle, facts: Facts): Promise<string> {
  return complete(config, {
    system: systemPrompt(style),
    user: `Subject: ${facts.title}\n\nFacts, in order:\n${facts.lines.map((l) => `- ${l}`).join('\n')}`,
    temperature: 0.8,
    maxTokens: config.provider === 'openai' ? 700 : 900,
  })
}

// ---------------------------------------------------------------------------
// Memo

const cache = new Map<string, { at: number; value: Narration }>()

function subjectKey(worldId: number, subject: NarratorSubject, style: NarratorStyle): string {
  switch (subject.kind) {
    case 'span':
      return `${worldId}:span:${subject.from}-${subject.to}:${style}`
    case 'record':
      return `${worldId}:record:${subject.recordKind}:${subject.id}:${style}`
    case 'story':
      return `${worldId}:story:${subject.key}:${style}`
  }
}

function remember(key: string, value: Narration) {
  if (cache.size >= CACHE_MAX) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest) cache.delete(oldest[0])
  }
  cache.set(key, { at: Date.now(), value })
}

export const narrate = createServerFn({ method: 'POST' })
  .inputValidator(
    (input: {
      worldId: number
      subject: NarratorSubject
      style?: NarratorStyle
      /** Skip the memo and ask the model again. */
      fresh?: boolean
    }) => input,
  )
  .handler(async ({ data }): Promise<Narration> => {
    const config = readModelConfig()
    if (!config)
      throw new Error(
        'The narrator is not configured. Set LEGENDS_NARRATOR_PROVIDER and LEGENDS_NARRATOR_API_KEY.',
      )
    const style: NarratorStyle = NARRATOR_STYLES.some((s) => s.key === data.style)
      ? (data.style as NarratorStyle)
      : 'chronicle'
    const key = subjectKey(data.worldId, data.subject, style)
    const hit = cache.get(key)
    if (hit && !data.fresh && Date.now() - hit.at < CACHE_TTL_MS)
      return { ...hit.value, cached: true }

    let facts: Facts | null
    switch (data.subject.kind) {
      case 'span':
        facts = await spanFacts(data.worldId, data.subject.from, data.subject.to)
        break
      case 'record':
        facts = await recordFacts(data.worldId, data.subject.recordKind, data.subject.id)
        break
      case 'story':
        facts = await storyFacts(data.worldId, data.subject.key)
        break
    }
    if (!facts) throw new Error('There is nothing in the records to narrate.')
    const text = await callModel(config, style, facts)
    const narration: Narration = {
      title: facts.title,
      text,
      facts: facts.lines.length,
      model: config.model,
      cached: false,
    }
    remember(key, narration)
    return narration
  })
