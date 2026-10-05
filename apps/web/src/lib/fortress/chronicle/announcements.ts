import type { FortEvent, FortUnit } from '@fortress/db-drizzle'

import { isLiving } from '../format'
import { isCitizenish } from '../people/units'

/*
 * The fortress's announcements read as a story: what kind of happening each
 * one is, how loudly it should be told, and its text with the citizens'
 * names turned into links. Client-safe.
 */

// ---------------------------------------------------------------------------
// Announcements as a story

export type StoryKind =
  | 'death'
  | 'threat'
  | 'mood'
  | 'birth'
  | 'arrival'
  | 'craft'
  | 'discovery'
  | 'society'
  | 'work'
  | 'season'
  | 'other'

export const STORY_KINDS: Record<
  StoryKind,
  {
    label: string
    /** Singular and plural, for counts: "1 birth", "3 births". */
    noun: [string, string]
    tone: 'danger' | 'warning' | 'good' | 'info' | 'muted'
    story: boolean
  }
> = {
  death: {
    label: 'Deaths',
    noun: ['death', 'deaths'],
    tone: 'danger',
    story: true,
  },
  threat: {
    label: 'Danger',
    noun: ['danger', 'dangers'],
    tone: 'danger',
    story: true,
  },
  mood: {
    label: 'Moods and madness',
    noun: ['mood', 'moods'],
    tone: 'warning',
    story: true,
  },
  birth: {
    label: 'Births',
    noun: ['birth', 'births'],
    tone: 'good',
    story: true,
  },
  arrival: {
    label: 'Arrivals and departures',
    noun: ['arrival', 'arrivals'],
    tone: 'info',
    story: true,
  },
  craft: {
    label: 'Masterworks',
    noun: ['masterwork', 'masterworks'],
    tone: 'good',
    story: true,
  },
  discovery: {
    label: 'Discoveries',
    noun: ['discovery', 'discoveries'],
    tone: 'info',
    story: true,
  },
  society: {
    label: 'Nobles and society',
    noun: ['matter of state', 'matters of state'],
    tone: 'info',
    story: true,
  },
  work: {
    label: 'Work',
    noun: ['work event', 'work events'],
    tone: 'muted',
    story: false,
  },
  season: {
    label: 'Seasons and weather',
    noun: ['change of season', 'changes of season'],
    tone: 'muted',
    story: false,
  },
  other: {
    label: 'Other',
    noun: ['other event', 'other events'],
    tone: 'muted',
    story: true,
  },
}

export function storyKind(event: Pick<FortEvent, 'type' | 'text'>): StoryKind {
  const type = event.type ?? ''
  const text = event.text
  if (text.startsWith('[DFHack')) return 'work'
  if (
    /DEATH|DIED|KILLED|SLAIN/.test(type) ||
    /found dead|has died|has been slain|starved to death|drowned/i.test(text)
  )
    return 'death'
  if (/LOST_TO_STRESS|TANTRUM|MOOD|ARTIFACT|INSANE|BERSERK|MELANCHOLY/.test(type)) return 'mood'
  if (
    /SIEGE|AMBUSH|ATTACK|INVADER|MEGABEAST|FORGOTTEN|FB_|WEREBEAST|NIGHT_CREATURE|THIEF|SNATCHER|CAVE_COLLAPSE|FLOOD|VERMIN_BITE|COMBAT|DANGER|UNDEAD|CURSE/.test(
      type,
    )
  )
    return 'threat'
  if (/BIRTH|GROWS_UP/.test(type)) return 'birth'
  if (/ARRIVAL|LEAVE|DEPART|CARAVAN|MIGRANT|DIPLOMAT|LIAISON|VISITOR|PETITION/.test(type))
    return 'arrival'
  if (/MASTERPIECE|MASTERWORK/.test(type)) return 'craft'
  if (/STRUCK|DISCOVER|CAVERN|FEATURE|REACHED_PEAK/.test(type)) return 'discovery'
  if (/NOBLE|ELECT|MANDATE|POSITION|APPOINT|MARRIAGE|MARRY|SPOUSE|LAND_ELEVATED|TITLE/.test(type))
    return 'society'
  if (/SEASON|WEATHER/.test(type)) return 'season'
  if (/CANCEL|QUOTA|PROFESSION|CONSTRUCTION|DIG_|JOB|NOTHING_TO_CATCH/.test(type)) return 'work'
  return 'other'
}

/** How loudly to tell the player about a new announcement, if at all. */
export function alertLevel(event: Pick<FortEvent, 'type' | 'text'>): 'urgent' | 'notable' | null {
  const kind = storyKind(event)
  if (kind === 'death' || kind === 'threat') return 'urgent'
  if (kind === 'mood')
    return /LOST_TO_STRESS|INSANE|BERSERK/.test(event.type ?? '') ? 'urgent' : 'notable'
  if (kind === 'birth' || kind === 'arrival' || kind === 'society') return 'notable'
  if (kind === 'craft' && /artifact/i.test(event.text)) return 'notable'
  return null
}

// ---------------------------------------------------------------------------
// Names in announcements

export interface TextPart {
  text: string
  unit?: FortUnit
  /** A historical figure off the map, for a link to their legends. */
  hf?: number
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** DF quotes nicknames as `Nick'; show them the way the rest of the app does. */
export function cleanAnnouncement(text: string): string {
  return text.replace(/`([^'`]{1,60})'/g, '“$1”').replace(/\s{2,}/g, ' ')
}

/**
 * Split an announcement into text and the units it names, so names can link
 * to their dwarves. Matches full names and the nicknamed "`Nick' Surname".
 */
export function makeNameLinker(units: FortUnit[]): (text: string) => TextPart[] {
  const ordered = [...units].sort(
    (a, b) =>
      Number(isCitizenish(b)) - Number(isCitizenish(a)) ||
      Number(isLiving(b)) - Number(isLiving(a)),
  )
  const byFull = new Map<string, FortUnit>()
  const bySurname = new Map<string, FortUnit>()
  for (const unit of ordered) {
    const name = unit.name.trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (!byFull.has(key)) byFull.set(key, unit)
    const parts = name.split(/\s+/)
    if (parts.length > 1) {
      const surname = parts[parts.length - 1].toLowerCase()
      if (!bySurname.has(surname)) bySurname.set(surname, unit)
    }
  }
  if (!byFull.size) return (text) => [{ text: cleanAnnouncement(text) }]
  const full = [...byFull.keys()].sort((a, b) => b.length - a.length).map(escapeRe)
  const surnames = [...bySurname.keys()].sort((a, b) => b.length - a.length).map(escapeRe)
  // Groups: 1 full name; 2 nickname and 3 surname. `(?!)` keeps the numbering when empty.
  const re = new RegExp(
    `(${full.join('|')})|\`([^'\`]{1,60})' (${surnames.length ? surnames.join('|') : '(?!)'})`,
    'giu',
  )
  const cache = new Map<string, TextPart[]>()

  return (text) => {
    const hit = cache.get(text)
    if (hit) return hit
    const parts: TextPart[] = []
    let last = 0
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0
      if (at > last) parts.push({ text: cleanAnnouncement(text.slice(last, at)) })
      const unit = m[1] ? byFull.get(m[1].toLowerCase()) : bySurname.get((m[3] ?? '').toLowerCase())
      parts.push({ text: cleanAnnouncement(m[0]), unit })
      last = at + m[0].length
    }
    if (last < text.length) parts.push({ text: cleanAnnouncement(text.slice(last)) })
    cache.set(text, parts)
    return parts
  }
}
