import type {
  FortEvent,
  FortHistoryRow,
  FortLifeEvent,
  FortUnit,
  HistoryFieldValue,
  SnapshotTotals,
} from '@fortress/db-drizzle'

import { deathPhrase } from './death'
import { skillLabel } from './dossier'
import { formatValue } from './format'
import { historyEventParts, historyTone } from './historyEvents'
import {
  type GameTime,
  TICKS_PER_MONTH,
  type TextPart,
  cleanAnnouncement,
  firstName,
  isCitizenish,
  makeNameLinker,
  storyKind,
} from './insights'
import { LIFE_TONE, type LifeTone, lifeEventName, lifeEventParts } from './lifeEvents'

/*
 * A span of the fortress's life told as a short story: who came and went,
 * what happened, the lives of its people, how the fortress changed, and what
 * the world's history records there. Built from the announcements, the life
 * events between daily snapshots and the history events the worker keeps,
 * and nothing else. Client-safe.
 */

// ---------------------------------------------------------------------------
// Seasons

export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'] as const
export const TICKS_PER_SEASON = TICKS_PER_MONTH * 3

export interface SeasonRef {
  year: number
  /** 0 spring, 1 summer, 2 autumn, 3 winter. */
  season: number
}

/** A stretch of game time: `from` included, `to` left out. */
export interface RecapSpan {
  from: GameTime
  to: GameTime
}

/** Seasons counted from the world's beginning, for ordering and paging. */
export const seasonIndex = (s: SeasonRef) => s.year * 4 + s.season

export function seasonFromIndex(index: number): SeasonRef {
  return { year: Math.floor(index / 4), season: ((index % 4) + 4) % 4 }
}

export function seasonAt(t: GameTime): SeasonRef {
  return { year: t.year, season: Math.min(3, Math.max(0, Math.floor(t.tick / TICKS_PER_SEASON))) }
}

export function seasonSpan(s: SeasonRef): RecapSpan {
  return {
    from: { year: s.year, tick: s.season * TICKS_PER_SEASON },
    to:
      s.season === 3
        ? { year: s.year + 1, tick: 0 }
        : { year: s.year, tick: (s.season + 1) * TICKS_PER_SEASON },
  }
}

/** "Summer of 1433". */
export function seasonTitle(s: SeasonRef): string {
  return `${SEASON_NAMES[s.season]} of ${s.year}`
}

// ---------------------------------------------------------------------------
// The recap

export type RecapSectionKey = 'people' | 'events' | 'lives' | 'fortress' | 'world'

export const RECAP_SECTIONS: Record<RecapSectionKey, string> = {
  people: 'Who came and went',
  events: 'What happened',
  lives: 'Their lives',
  fortress: 'The fortress',
  world: 'In the world’s history',
}

const SECTION_ORDER: RecapSectionKey[] = ['people', 'events', 'lives', 'fortress', 'world']

export interface RecapLine {
  key: string
  parts: TextPart[]
  tone: LifeTone
  year: number | null
  tick: number | null
  /** Names one of the dwarves the player watches. */
  watched?: boolean
}

export interface RecapSection {
  key: RecapSectionKey
  title: string
  lines: RecapLine[]
}

export interface SnapshotPoint {
  year: number
  tick: number
  totals: SnapshotTotals
}

export type RecapHistoryEvent = Pick<
  FortHistoryRow,
  'event_id' | 'type' | 'here' | 'hfids' | 'fields' | 'extra' | 'game_year' | 'game_tick'
>

/** What a span's recap is built from, as the server reads it. */
export interface RecapSource {
  announcements: FortEvent[]
  lifeEvents: FortLifeEvent[]
  history: RecapHistoryEvent[]
  /** The fortress's totals on the first and the last day of the span the worker kept. */
  first: SnapshotPoint | null
  last: SnapshotPoint | null
}

export interface Recap {
  /** One sentence: the biggest things that happened, or that nothing did. Empty when nothing is known. */
  headline: TextPart[]
  sections: RecapSection[]
  /** Keys of the lines the headline already tells. */
  told: string[]
  /** Nothing is known of the span at all. */
  empty: boolean
}

/** The fortress's site government and civilization, for `RecapOptions.ownGroups`. */
export function ownGroupsOf(
  world: { group_id: number; civ_id: number } | null | undefined,
): ReadonlySet<number> | undefined {
  return world ? new Set([world.group_id, world.civ_id]) : undefined
}

export interface RecapOptions {
  /** Everyone in the last dump, so names link to their dwarves. */
  units: FortUnit[]
  watched?: ReadonlySet<number>
  /**
   * Entity ids of the fortress's site government and civilization. Joining
   * them is arriving; joining any other group (a guild, a temple) is part of
   * someone's life. Without them, every group counts as the fortress.
   */
  ownGroups?: ReadonlySet<number>
}

/** Announcements a recap leaves out: routine, or told better by another line. */
const SKIPPED_TYPES = new Set([
  'CANCEL_JOB',
  'VERMIN_BITE',
  'CITIZEN_STUCK',
  'MOOD_BUILDING_CLAIMED',
  'ARTIFACT_BEGUN',
  'BIRTH_WILD_ANIMAL',
  'CITIZEN_BECOMES_SOLDIER',
  'CITIZEN_BECOMES_NONSOLDIER',
])

/** What part an announcement plays in a recap, or null to leave it out. */
type Role =
  | 'death'
  | 'pet_death'
  | 'birth'
  | 'migrants'
  | 'no_migrants'
  | 'missing'
  | 'visit'
  | 'grew_up'
  | 'madness'
  | 'mood'
  | 'artifact'
  | 'threat'
  | 'masterpiece'
  | 'struck'
  | 'discovery'
  | 'society'
  | 'other'

function roleOf(event: Pick<FortEvent, 'type' | 'text'>): Role | null {
  const type = event.type ?? ''
  const text = event.text.trim()
  if (SKIPPED_TYPES.has(type) || /^\[DFHack|^Work order/.test(text)) return null
  if (type === 'PET_DEATH') return 'pet_death'
  if (type === 'CITIZEN_MISSING') return 'missing'
  if (/NO_MIGRANT/.test(type)) return 'no_migrants'
  if (/MIGRANTS?_ARRIVAL/.test(type)) return 'migrants'
  if (/GROWS_UP/.test(type)) return 'grew_up'
  if (type === 'MADE_ARTIFACT') return 'artifact'
  if (/LOST_TO_STRESS|INSANE|BERSERK|MELANCHOLY/.test(type)) return 'madness'
  if (/STRUCK/.test(type) && STRUCK_RE.test(text)) return 'struck'
  switch (storyKind(event)) {
    case 'death':
      return 'death'
    case 'threat':
      return 'threat'
    case 'mood':
      return 'mood'
    case 'birth':
      return /CITIZEN/.test(type) ? 'birth' : null
    case 'arrival':
      return 'visit'
    case 'craft':
      return 'masterpiece'
    case 'discovery':
      return 'discovery'
    case 'society':
      return 'society'
    case 'other':
      return 'other'
    default:
      return null
  }
}

const ROLE_SECTION: Record<Role, RecapSectionKey> = {
  death: 'people',
  pet_death: 'people',
  birth: 'people',
  migrants: 'people',
  no_migrants: 'people',
  missing: 'people',
  visit: 'people',
  grew_up: 'lives',
  madness: 'events',
  mood: 'events',
  artifact: 'events',
  threat: 'events',
  masterpiece: 'events',
  struck: 'events',
  discovery: 'events',
  society: 'events',
  other: 'events',
}

const ROLE_TONE: Record<Role, LifeTone> = {
  death: 'bad',
  pet_death: 'bad',
  birth: 'good',
  migrants: 'neutral',
  no_migrants: 'neutral',
  missing: 'bad',
  visit: 'neutral',
  grew_up: 'good',
  madness: 'bad',
  mood: 'neutral',
  artifact: 'good',
  threat: 'bad',
  masterpiece: 'good',
  struck: 'neutral',
  discovery: 'neutral',
  society: 'neutral',
  other: 'neutral',
}

const STRUCK_RE = /^You have struck (.+?)!$/

/** Life events worth a line among the lives, besides everything about a watched dwarf. */
const LIFE_LINES = new Set([
  'skill',
  'office',
  'squad',
  'bond',
  'unhappy',
  'miserable',
  'recovered',
  'hurt',
  'kills',
])
/** Ratings from Master up; lower milestones stay on the dwarf's own page. */
const SKILL_LINE_FROM = 12
const LEGENDARY = 15

/** History events that tell nothing a recap needs: wanderings and job changes. */
const HISTORY_SKIPPED = new Set(['CHANGE_HF_STATE', 'CHANGE_HF_JOB'])
const MASTERPIECE_TYPE = /^MASTERPIECE_CREATED/
/** Family links told by the births instead. */
const BIRTH_LINKS = new Set(['CHILD', 'MOTHER', 'FATHER'])

const num = (v: HistoryFieldValue | undefined): number | null =>
  typeof v === 'number' && v >= 0 ? v : null

const article = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`)

const before = (
  a: { year: number | null; tick: number | null },
  b: { year: number | null; tick: number | null },
) => (a.year ?? 0) - (b.year ?? 0) || (a.tick ?? 0) - (b.tick ?? 0)

/** "a, b and c", or "a, b, c and 4 more" past `max`. */
function listWords(words: string[], max = 6): string {
  const unique = [...new Set(words)]
  const shown = unique.slice(0, max)
  const rest = unique.length - shown.length
  if (rest > 0) return `${shown.join(', ')} and ${rest} more`
  return shown.length > 1
    ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
    : shown.join('')
}

/** Parts joined as "a, b and c", each part kept so names stay links. */
function listParts(items: TextPart[][], max = 4, noun = 'more'): TextPart[] {
  const shown = items.slice(0, max)
  const rest = items.length - shown.length
  const out: TextPart[] = []
  shown.forEach((item, i) => {
    if (i > 0) out.push({ text: i === shown.length - 1 && rest <= 0 ? ' and ' : ', ' })
    out.push(...item)
  })
  if (rest > 0) out.push({ text: ` and ${rest} ${noun}` })
  return out
}

/** The first dwarf an announcement names, or the nickname it opens with. */
function subjectOf(parts: TextPart[], text: string): TextPart | null {
  const named = parts.find((p) => p.unit)
  if (named?.unit) return { text: firstName(named.unit), unit: named.unit }
  const nick = /^`([^'`]{1,60})'/.exec(text.trim())?.[1]
  return nick ? { text: nick } : null
}

interface Fact {
  kind: FactKind
  key: string
  subject: TextPart | null
  detail?: string
  /** For a migrant wave, how many came. */
  count?: number
  /** For a threat, the announcement type. */
  type?: string
}

type FactKind =
  | 'death'
  | 'madness'
  | 'threat'
  | 'artifact'
  | 'migrants'
  | 'birth'
  | 'mood'
  | 'legend'
  | 'discovery'
  | 'no_migrants'

const FACT_ORDER: FactKind[] = [
  'death',
  'madness',
  'threat',
  'artifact',
  'migrants',
  'birth',
  'mood',
  'legend',
  'discovery',
  'no_migrants',
]

const HEADLINE_CLAUSES = 3

export function buildRecap(
  source: RecapSource,
  { units, watched = new Set(), ownGroups }: RecapOptions,
): Recap {
  const byId = new Map(units.map((u) => [u.id, u]))
  const byHf = new Map<number, FortUnit>()
  for (const u of units) if (u.hist_figure_id >= 0) byHf.set(u.hist_figure_id, u)
  const link = makeNameLinker(units)
  const isWatchedUnit = (unit: FortUnit | undefined) => unit !== undefined && watched.has(unit.id)

  const sections = new Map<RecapSectionKey, RecapLine[]>(SECTION_ORDER.map((k) => [k, []]))
  const add = (section: RecapSectionKey, line: RecapLine) => sections.get(section)?.push(line)
  const facts: Fact[] = []

  // History first: its deaths carry the cause and the slayer.
  const historyDeaths = new Set<number>()
  const isOurs = (hf: number, event: RecapHistoryEvent) => {
    const unit = byHf.get(hf)
    if (unit)
      return (
        !unit.flags.includes('animal') && (isCitizenish(unit) || unit.flags.includes('own_civ'))
      )
    const race = event.extra.figures?.[String(hf)]?.[2]
    return event.here && race === 'dwarf'
  }
  const isOurAnimal = (hf: number) => {
    const unit = byHf.get(hf)
    return unit?.flags.includes('animal') === true && unit.flags.includes('own_civ')
  }
  const victimOf = (e: RecapHistoryEvent) =>
    num(e.fields.victim_hf) ?? num(e.fields.victim) ?? e.hfids[0] ?? null

  const announced = source.announcements
    .map((event) => ({ event, role: roleOf(event) }))
    .filter((a): a is { event: FortEvent; role: Role } => a.role !== null)
  const count = (role: Role) => announced.filter((a) => a.role === role).length

  const arrivals = source.lifeEvents.filter((e) => e.kind === 'arrived')
  const arrivedHf = new Set(arrivals.map((e) => e.hf).filter((hf): hf is number => hf !== null))
  const marriages = new Set<string>()
  const offices = new Set<string>()
  const pairKey = (kind: string, a: number, b: number) =>
    `${kind}:${Math.min(a, b)}:${Math.max(a, b)}`

  const deathAnnouncedUnits = new Set<number>()
  for (const { event, role } of announced) {
    if (role !== 'death') continue
    for (const p of link(event.text)) if (p.unit) deathAnnouncedUnits.add(p.unit.id)
  }

  // ---- History -----------------------------------------------------------
  const masterpiecesAnnounced = count('masterpiece') > 0
  const artifactsAnnounced = count('artifact')
  const historyArtifacts = source.history.filter((e) => e.type === 'ARTIFACT_CREATED').length
  const historyMasterpieces: RecapHistoryEvent[] = []
  const memberships = new Map<string, RecapHistoryEvent[]>()

  for (const e of source.history) {
    if (HISTORY_SKIPPED.has(e.type)) continue
    const key = `h${e.event_id}`
    const parts = historyEventParts(e, byId)
    const watchedLine = e.hfids.some((hf) => isWatchedUnit(byHf.get(hf)))
    const line: RecapLine = {
      key,
      parts,
      tone: historyTone(e),
      year: e.game_year,
      tick: e.game_tick,
      watched: watchedLine || undefined,
    }
    if (e.type === 'HIST_FIGURE_DIED') {
      const victim = victimOf(e)
      if (victim !== null && isOurs(victim, e)) {
        historyDeaths.add(victim)
        add('people', line)
        facts.push({
          kind: 'death',
          key,
          subject: parts[0] ?? null,
          detail: deathPhrase(
            typeof e.fields.death_cause === 'string' ? e.fields.death_cause : null,
          ),
        })
      } else if (victim !== null && isOurAnimal(victim)) add('people', line)
      else add('world', line)
      continue
    }
    if (MASTERPIECE_TYPE.test(e.type)) {
      if (!masterpiecesAnnounced) historyMasterpieces.push(e)
      continue
    }
    if (e.type === 'ARTIFACT_CREATED') {
      if (artifactsAnnounced >= historyArtifacts) continue
      add('events', line)
      facts.push({ kind: 'artifact', key, subject: parts[0] ?? null })
      continue
    }
    if (e.type === 'ADD_HF_HF_LINK' || e.type === 'REMOVE_HF_HF_LINK') {
      const linkType = typeof e.fields.type === 'string' ? e.fields.type : ''
      if (BIRTH_LINKS.has(linkType)) continue
      const a = num(e.fields.hf) ?? num(e.fields.hfid) ?? e.hfids[0]
      const b = num(e.fields.hf_target) ?? num(e.fields.hfid_target) ?? e.hfids[1]
      if (linkType === 'SPOUSE' && e.type === 'ADD_HF_HF_LINK' && a != null && b != null) {
        const pair = pairKey('spouse', a, b)
        if (marriages.has(pair)) continue
        marriages.add(pair)
      }
      add('lives', line)
      continue
    }
    if (e.type === 'ADD_HF_ENTITY_LINK' || e.type === 'REMOVE_HF_ENTITY_LINK') {
      const linkType = e.fields.link_type
      const hf = num(e.fields.histfig) ?? num(e.fields.hfid) ?? num(e.fields.hf) ?? e.hfids[0]
      if (linkType === 'POSITION') {
        if (e.type === 'ADD_HF_ENTITY_LINK' && hf != null) offices.add(`office:${hf}`)
        add('lives', line)
      } else if (linkType === 'MEMBER') {
        if (e.type === 'ADD_HF_ENTITY_LINK' && hf != null && arrivedHf.has(hf)) continue
        const group = `${e.type}|${e.extra.entity ?? ''}|${e.game_year}|${Math.floor(e.game_tick / 1200)}`
        memberships.set(group, [...(memberships.get(group) ?? []), e])
      }
      continue
    }
    add('world', line)
  }

  const dayOf = (year: number | null, tick: number | null) =>
    `${year}|${Math.floor((tick ?? 0) / 1200)}`
  const migrantDays = new Set(
    announced
      .filter((a) => a.role === 'migrants')
      .map((a) => dayOf(a.event.game_year, a.event.game_tick)),
  )
  /** Days whose migrant announcement is told by the line naming who joined. */
  const migrantsNamed = new Set<string>()

  for (const [group, events] of memberships) {
    const first = events[0]
    const day = dayOf(first.game_year, first.game_tick)
    const entityId = num(first.fields.civ)
    const section: RecapSectionKey =
      !ownGroups || entityId === null || ownGroups.has(entityId) ? 'people' : 'lives'
    if (
      section === 'people' &&
      first.type === 'ADD_HF_ENTITY_LINK' &&
      migrantDays.has(day) &&
      !migrantsNamed.has(day)
    ) {
      migrantsNamed.add(day)
      const people = events.map((e) => historyEventParts(e, byId)[0] ?? { text: 'someone' })
      const entity = first.extra.entity ? cleanAnnouncement(first.extra.entity) : 'the fortress'
      add('people', {
        key: `members:${group}`,
        parts: [
          {
            text: `${events.length === 1 ? 'A migrant' : `${events.length} migrants`} arrived and joined ${entity}: `,
          },
          ...listParts(
            people.map((p) => [p]),
            5,
            'others',
          ),
          { text: '.' },
        ],
        tone: 'good',
        year: first.game_year,
        tick: first.game_tick,
        watched: events.some((e) => e.hfids.some((hf) => isWatchedUnit(byHf.get(hf)))) || undefined,
      })
      continue
    }
    if (events.length === 1) {
      add(section, {
        key: `h${first.event_id}`,
        parts: historyEventParts(first, byId),
        tone: 'neutral',
        year: first.game_year,
        tick: first.game_tick,
        watched: first.hfids.some((hf) => isWatchedUnit(byHf.get(hf))) || undefined,
      })
      continue
    }
    const people = events.map((e) => {
      const parts = historyEventParts(e, byId)
      return parts[0] ? [parts[0]] : [{ text: 'someone' }]
    })
    const entity = first.extra.entity ? cleanAnnouncement(first.extra.entity) : 'a group'
    const joined = first.type === 'ADD_HF_ENTITY_LINK'
    add(section, {
      key: `members:${group}`,
      parts: [
        ...listParts(people, 5, 'others'),
        { text: ` ${joined ? 'joined' : 'left'} ${entity}.` },
      ],
      tone: 'neutral',
      year: first.game_year,
      tick: first.game_tick,
      watched: events.some((e) => e.hfids.some((hf) => isWatchedUnit(byHf.get(hf)))) || undefined,
    })
  }

  // ---- Announcements -----------------------------------------------------
  const masterpieces: { event: FortEvent; maker: TextPart | null }[] = []
  const strikes: FortEvent[] = []
  const bornLife = source.lifeEvents.filter((e) => e.kind === 'born').length
  /** The same words on the same day, as the game sometimes repeats them: one line, counted. */
  const repeats = new Map<string, { line: RecapLine; n: number }>()
  for (const { event, role } of announced) {
    const sameDay = `${event.text}|${event.game_year}|${Math.floor((event.game_tick ?? 0) / 1200)}`
    const repeated = repeats.get(sameDay)
    if (repeated && role !== 'masterpiece' && role !== 'struck') {
      repeated.n += 1
      continue
    }
    const parts = link(event.text)
    const subject = subjectOf(parts, event.text)
    if (role === 'masterpiece') {
      masterpieces.push({ event, maker: subject })
      continue
    }
    if (role === 'struck') {
      strikes.push(event)
      continue
    }
    if (role === 'migrants' && arrivals.length) continue
    if (role === 'migrants' && migrantsNamed.has(dayOf(event.game_year, event.game_tick))) {
      facts.push({ kind: 'migrants', key: `a${event.id}`, subject: null })
      continue
    }
    if (role === 'grew_up') {
      const named = parts.find((p) => p.unit)?.unit
      if (named ? !isCitizenish(named) : /^An? animal\b/i.test(event.text.trim())) continue
    }
    if (role === 'death') {
      const named = parts.find((p) => p.unit)?.unit
      if (named && named.hist_figure_id >= 0 && historyDeaths.has(named.hist_figure_id)) continue
    }
    const key = `a${event.id}`
    const announcedLine: RecapLine = {
      key,
      parts,
      tone: ROLE_TONE[role],
      year: event.game_year,
      tick: event.game_tick,
      watched: parts.some((p) => isWatchedUnit(p.unit)) || undefined,
    }
    add(ROLE_SECTION[role], announcedLine)
    repeats.set(sameDay, { line: announcedLine, n: 1 })
    const text = event.text.trim()
    if (role === 'death') facts.push({ kind: 'death', key, subject })
    else if (role === 'madness') {
      const m = /has (gone|become|been) ([^!.]+)/.exec(text)
      const verb = m ? { gone: 'went', become: 'became', been: 'was' }[m[1]] : null
      facts.push({
        kind: 'madness',
        key,
        subject,
        detail: m && verb ? `${verb} ${m[2]}` : 'was lost to stress',
      })
    } else if (role === 'threat')
      facts.push({ kind: 'threat', key, subject, type: event.type ?? '' })
    else if (role === 'artifact') facts.push({ kind: 'artifact', key, subject })
    else if (role === 'migrants') facts.push({ kind: 'migrants', key, subject: null })
    else if (role === 'birth') {
      const to = /given birth to ([^.!]+)/.exec(text)?.[1]
      facts.push({ kind: 'birth', key, subject, detail: to ? `gave birth to ${to}` : undefined })
    } else if (
      role === 'mood' &&
      /STRANGE_MOOD|FEY|SECRETIVE|POSSESSED|MACABRE|FELL/.test(event.type ?? '')
    ) {
      const word = /taken by an? (\w+) mood/i.exec(text)?.[1]
      facts.push({
        kind: 'mood',
        key,
        subject,
        detail: word ? `was taken by ${article(word)} mood` : 'was taken by a strange mood',
      })
    } else if (role === 'discovery' && /FEATURE|CAVERN|DISCOVER/.test(event.type ?? '')) {
      const what = /You have discovered (.+?)[.!]$/.exec(text)?.[1]
      if (what)
        facts.push({ kind: 'discovery', key, subject: null, detail: `you discovered ${what}` })
    } else if (role === 'no_migrants') facts.push({ kind: 'no_migrants', key, subject: null })
  }

  for (const { line, n } of repeats.values()) {
    if (n < 2) continue
    const times = n === 2 ? 'twice' : `${n} times`
    const last = line.parts[line.parts.length - 1]
    const text = /[.!]$/.test(last.text)
      ? last.text.replace(/\s*([.!]+)$/, ` (${times})$1`)
      : `${last.text} (${times}).`
    line.parts = [...line.parts.slice(0, -1), { ...last, text }]
  }

  // Masterpieces and strikes read as one line each.
  const madeLine = (
    key: string,
    makers: (TextPart | null)[],
    n: number,
    at: { year: number | null; tick: number | null },
  ) => {
    const byMaker = new Map<string, { part: TextPart; n: number }>()
    for (const maker of makers) {
      if (!maker) continue
      const id = maker.unit ? `u${maker.unit.id}` : `t${maker.text}`
      const entry = byMaker.get(id) ?? { part: maker, n: 0 }
      entry.n += 1
      byMaker.set(id, entry)
    }
    const top = [...byMaker.values()].sort((a, b) => b.n - a.n)[0]
    const parts: TextPart[] =
      top && top.n === n
        ? [top.part, { text: ` made ${n} masterpieces.` }]
        : top && top.n >= 2
          ? [{ text: `${n} masterpieces were made, ${top.n} of them by ` }, top.part, { text: '.' }]
          : [{ text: `${n} masterpieces were made.` }]
    add('events', { key, parts, tone: 'good', year: at.year, tick: at.tick })
  }
  if (masterpieces.length === 1) {
    const { event } = masterpieces[0]
    add('events', {
      key: `a${event.id}`,
      parts: link(event.text),
      tone: 'good',
      year: event.game_year,
      tick: event.game_tick,
    })
  } else if (masterpieces.length > 1) {
    const last = masterpieces[masterpieces.length - 1].event
    madeLine(
      'masterpieces',
      masterpieces.map((m) => m.maker),
      masterpieces.length,
      { year: last.game_year, tick: last.game_tick },
    )
  }
  if (historyMasterpieces.length === 1) {
    const e = historyMasterpieces[0]
    add('events', {
      key: `h${e.event_id}`,
      parts: historyEventParts(e, byId),
      tone: 'good',
      year: e.game_year,
      tick: e.game_tick,
    })
  } else if (historyMasterpieces.length > 1) {
    const last = historyMasterpieces[historyMasterpieces.length - 1]
    madeLine(
      'masterpieces',
      historyMasterpieces.map((e) => historyEventParts(e, byId)[0] ?? null),
      historyMasterpieces.length,
      { year: last.game_year, tick: last.game_tick },
    )
  }
  if (strikes.length) {
    const minerals = strikes.map((e) => STRUCK_RE.exec(e.text.trim())?.[1] ?? '').filter(Boolean)
    const last = strikes[strikes.length - 1]
    add('events', {
      key: strikes.length === 1 ? `a${last.id}` : 'strikes',
      parts: [{ text: `You struck ${listWords(minerals, 8)}.` }],
      tone: 'neutral',
      year: last.game_year,
      tick: last.game_tick,
    })
    const economic = strikes.filter((e) => e.type === 'STRUCK_ECONOMIC_MINERAL')
    if (economic.length) {
      const found = economic.map((e) => STRUCK_RE.exec(e.text.trim())?.[1] ?? '').filter(Boolean)
      facts.push({
        kind: 'discovery',
        key: strikes.length === 1 ? `a${last.id}` : 'strikes',
        subject: null,
        detail: `you struck ${listWords(found, 3)}`,
      })
    }
  }

  // ---- Life events -------------------------------------------------------
  const waves = new Map<number, FortLifeEvent[]>()
  for (const e of arrivals) {
    const day = e.game_year * 336 + Math.floor(e.game_tick / 1200)
    waves.set(day, [...(waves.get(day) ?? []), e])
  }
  for (const [day, wave] of waves) {
    const key = `wave:${day}`
    const first = wave[0]
    if (wave.length === 1) {
      add('people', {
        key,
        parts: lifeEventParts(first, byId),
        tone: 'neutral',
        year: first.game_year,
        tick: first.game_tick,
        watched: watched.has(first.unit_id) || undefined,
      })
    } else {
      const names = wave.map((e) => [{ text: lifeEventName(e), unit: byId.get(e.unit_id) }])
      add('people', {
        key,
        parts: [
          { text: `${wave.length} migrants arrived: ` },
          ...listParts(names, 5),
          { text: '.' },
        ],
        tone: 'neutral',
        year: first.game_year,
        tick: first.game_tick,
        watched: wave.some((e) => watched.has(e.unit_id)) || undefined,
      })
    }
    facts.push({ kind: 'migrants', key, subject: null, count: wave.length })
  }

  const birthsAnnounced = count('birth')
  for (const e of source.lifeEvents) {
    if (e.kind === 'arrived') continue
    const key = `l${e.id}`
    const unit = byId.get(e.unit_id)
    const isWatched = watched.has(e.unit_id)
    const line: RecapLine = {
      key,
      parts: lifeEventParts(e, byId),
      tone: LIFE_TONE[e.kind],
      year: e.game_year,
      tick: e.game_tick,
      watched: isWatched || undefined,
    }
    const subject: TextPart = { text: lifeEventName(e), unit }
    switch (e.kind) {
      case 'died':
        if ((e.hf !== null && historyDeaths.has(e.hf)) || deathAnnouncedUnits.has(e.unit_id))
          continue
        add('people', line)
        facts.push({ kind: 'death', key, subject })
        continue
      case 'born':
        if (birthsAnnounced >= bornLife) continue
        add('people', line)
        facts.push({ kind: 'birth', key, subject, detail: 'was born' })
        continue
      case 'left':
      case 'returned':
        add('people', line)
        continue
    }
    const to = typeof e.data.to === 'number' ? e.data.to : 0
    if (
      e.kind === 'bond' &&
      e.data.bond === 'spouse' &&
      e.hf !== null &&
      typeof e.data.other_hf === 'number'
    ) {
      const pair = pairKey('spouse', e.hf, e.data.other_hf)
      if (marriages.has(pair)) continue
      marriages.add(pair)
    }
    if (e.kind === 'office' && e.data.gained && e.hf !== null && offices.has(`office:${e.hf}`))
      continue
    const worthALine =
      isWatched || (LIFE_LINES.has(e.kind) && (e.kind !== 'skill' || to >= SKILL_LINE_FROM))
    if (!worthALine) continue
    add('lives', line)
    if (e.kind === 'skill' && to >= LEGENDARY && e.data.skill)
      facts.push({
        kind: 'legend',
        key,
        subject,
        detail: `reached Legendary in ${skillLabel(e.data.skill, { sex: e.data.sex ?? 2 })}`,
      })
  }

  // ---- The fortress ------------------------------------------------------
  const start = source.first
  const end = source.last
  if (
    start &&
    end &&
    (start.year !== end.year || Math.floor(start.tick / 1200) !== Math.floor(end.tick / 1200))
  ) {
    const a = start.totals
    const b = end.totals
    if (a.population !== b.population)
      add('fortress', {
        key: 'population',
        parts: [{ text: `The fortress went from ${a.population} to ${b.population} citizens.` }],
        tone: b.population > a.population ? 'good' : 'bad',
        year: end.year,
        tick: end.tick,
      })
    if (a.wealth !== null && b.wealth !== null && a.wealth !== b.wealth)
      add('fortress', {
        key: 'wealth',
        parts: [
          {
            text: `Its created wealth ${b.wealth > a.wealth ? 'rose' : 'fell'} from ${formatValue(a.wealth)} to ${formatValue(b.wealth)}.`,
          },
        ],
        tone: b.wealth > a.wealth ? 'good' : 'bad',
        year: end.year,
        tick: end.tick,
      })
  }

  const built: RecapSection[] = SECTION_ORDER.map((key) => {
    const lines = [...(sections.get(key) ?? [])].sort(before)
    if (key === 'lives') lines.sort((a, b) => Number(!!b.watched) - Number(!!a.watched))
    return { key, title: RECAP_SECTIONS[key], lines }
  }).filter((s) => s.lines.length > 0)

  const empty = built.length === 0
  const { headline, told } = headlineOf(facts, empty)
  return { headline, sections: built, told, empty }
}

// ---------------------------------------------------------------------------
// The headline

function threatClause(fact: Fact): TextPart[] {
  const type = fact.type ?? ''
  if (/GHOST/.test(type) && fact.subject)
    return [fact.subject, { text: '’s ghost haunted the fortress' }]
  if (/SIEGE/.test(type)) return [{ text: 'a siege came' }]
  if (/MEGABEAST|FORGOTTEN|FB_|TITAN|COLOSSUS|DRAGON/.test(type))
    return [{ text: 'a great beast came' }]
  if (/AMBUSH/.test(type)) return [{ text: 'an ambush struck' }]
  if (/WEREBEAST|NIGHT_CREATURE/.test(type)) return [{ text: 'a creature of the night came' }]
  if (/UNDEAD/.test(type)) return [{ text: 'the dead walked' }]
  if (/GHOST/.test(type)) return [{ text: 'a ghost haunted the fortress' }]
  if (/THIEF|SNATCHER/.test(type)) return [{ text: 'thieves came' }]
  if (/FLOOD/.test(type)) return [{ text: 'water flooded in' }]
  if (/CAVE_COLLAPSE/.test(type)) return [{ text: 'a cave-in struck' }]
  return [{ text: 'danger came' }]
}

const THREAT_RANK = [
  /SIEGE/,
  /MEGABEAST|FORGOTTEN|FB_|TITAN|COLOSSUS|DRAGON/,
  /AMBUSH/,
  /WEREBEAST|NIGHT_CREATURE/,
  /UNDEAD/,
  /GHOST/,
]
const threatRank = (type = '') => {
  const i = THREAT_RANK.findIndex((re) => re.test(type))
  return i < 0 ? THREAT_RANK.length : i
}

const who = (fact: Fact): TextPart => fact.subject ?? { text: 'someone' }

/** One clause for all the facts of a kind, or null when they make none. */
function clause(kind: FactKind, facts: Fact[]): TextPart[] | null {
  const n = facts.length
  const [one, two] = facts
  switch (kind) {
    case 'death':
      if (n === 1) return [who(one), { text: ` ${one.detail ?? 'died'}` }]
      if (n === 2 && one.subject && two.subject)
        return [one.subject, { text: ' and ' }, two.subject, { text: ' died' }]
      return [{ text: `${n} of your people died` }]
    case 'madness':
      return n === 1
        ? [who(one), { text: ` ${one.detail}` }]
        : [{ text: `${n} dwarves were lost to stress` }]
    case 'threat':
      return threatClause([...facts].sort((a, b) => threatRank(a.type) - threatRank(b.type))[0])
    case 'artifact':
      return n === 1
        ? [who(one), { text: ' made an artifact' }]
        : [{ text: `${n} artifacts were made` }]
    case 'migrants': {
      const counted = facts.filter((f) => f.count !== undefined)
      if (!counted.length) return [{ text: 'migrants arrived' }]
      const total = counted.reduce((sum, f) => sum + (f.count ?? 0), 0)
      return [{ text: total === 1 ? 'a migrant arrived' : `${total} migrants arrived` }]
    }
    case 'birth':
      return n === 1
        ? [who(one), { text: ` ${one.detail ?? 'had a child'}` }]
        : [{ text: `${n} children were born` }]
    case 'mood':
      return n === 1
        ? [who(one), { text: ` ${one.detail}` }]
        : [{ text: `${n} dwarves were taken by strange moods` }]
    case 'legend':
      return n === 1
        ? [who(one), { text: ` ${one.detail}` }]
        : [{ text: `${n} dwarves reached Legendary in a skill` }]
    case 'discovery':
      return one.detail ? [{ text: one.detail }] : null
    case 'no_migrants':
      return [{ text: 'no migrants came' }]
  }
}

function headlineOf(facts: Fact[], empty: boolean): { headline: TextPart[]; told: string[] } {
  if (empty) return { headline: [], told: [] }
  const byKind = new Map<FactKind, Fact[]>()
  for (const fact of facts) byKind.set(fact.kind, [...(byKind.get(fact.kind) ?? []), fact])
  // A mood that ended in an artifact is told by the artifact.
  const artifacts = byKind.get('artifact')?.length ?? 0
  const moods = byKind.get('mood') ?? []
  if (artifacts && moods.length <= artifacts) byKind.delete('mood')

  const clauses: TextPart[][] = []
  const told: string[] = []
  for (const kind of FACT_ORDER) {
    const group = byKind.get(kind)
    if (!group?.length) continue
    const parts = clause(kind, group)
    if (!parts) continue
    clauses.push(parts)
    told.push(...group.map((f) => f.key))
    if (clauses.length === HEADLINE_CLAUSES) break
  }
  if (!clauses.length)
    return { headline: [{ text: 'Nothing out of the ordinary happened.' }], told }
  const headline = listParts(clauses, HEADLINE_CLAUSES)
  headline[0] = {
    ...headline[0],
    text: headline[0].text.charAt(0).toUpperCase() + headline[0].text.slice(1),
  }
  headline.push({ text: '.' })
  return { headline, told }
}

/**
 * The first sentences of a recap, for the overview: the headline, then the
 * lines it does not already tell, watched dwarves and the people first. The
 * fortress's own numbers and the world's history are left to the full recap.
 */
export function lead(recap: Recap, sentences: number): LeadLine[] {
  if (recap.empty) return []
  const out: LeadLine[] = [{ key: 'headline', parts: recap.headline, tone: null }]
  const told = new Set(recap.told)
  const lines = recap.sections
    .filter((s) => s.key !== 'world' && s.key !== 'fortress')
    .flatMap((s) => s.lines)
    .filter((l) => !told.has(l.key))
    .sort((a, b) => Number(!!b.watched) - Number(!!a.watched))
  for (const line of lines) {
    if (out.length >= sentences) break
    out.push({ key: line.key, parts: line.parts, tone: line.tone, watched: line.watched })
  }
  return out
}

export interface LeadLine {
  key: string
  parts: TextPart[]
  /** Null for the headline. */
  tone: LifeTone | null
  watched?: boolean
}
