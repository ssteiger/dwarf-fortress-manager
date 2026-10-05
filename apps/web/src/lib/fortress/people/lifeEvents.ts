import type { FortLifeEvent, FortUnit, LifeEventKind } from '@fortress/db-drizzle'
import { STRESS_LABELS } from '@fortress/db-drizzle/fortress-types'

import { type TextPart, cleanAnnouncement } from '../chronicle/announcements'
import { skillRank } from '../format'
import { skillLabel } from './dossier'
import { firstName } from './units'

/*
 * Life events in words: what two daily snapshots of a citizen differ by,
 * told as plain sentences. Client-safe.
 */

export type LifeTone = 'good' | 'bad' | 'neutral'

export const LIFE_TONE: Record<LifeEventKind, LifeTone> = {
  arrived: 'neutral',
  returned: 'neutral',
  born: 'good',
  died: 'bad',
  left: 'neutral',
  skill: 'good',
  profession: 'neutral',
  office: 'neutral',
  squad: 'neutral',
  bond: 'good',
  unhappy: 'bad',
  miserable: 'bad',
  recovered: 'good',
  hurt: 'bad',
  healed: 'good',
  kills: 'neutral',
}

/** The dot before a line of someone's life, by its tone. */
export const LIFE_TONE_DOT: Record<LifeTone, string> = {
  good: 'bg-emerald-500',
  bad: 'bg-red-500',
  neutral: 'bg-muted-foreground/50',
}

/** Kinds worth a line in "since your last look"; the rest stay on the dwarf's page. */
const HEADLINE: ReadonlySet<LifeEventKind> = new Set([
  'arrived',
  'returned',
  'born',
  'died',
  'left',
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

export function isHeadline(event: Pick<FortLifeEvent, 'kind' | 'data'>): boolean {
  if (event.kind === 'bond' && event.data.bond === 'grudge') return true
  return HEADLINE.has(event.kind)
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`)

const stress = (category: unknown) =>
  typeof category === 'number' ? (STRESS_LABELS[Math.min(Math.max(category, 0), 6)] ?? '') : ''

/** "Thelma" for a nicknamed or named dwarf, as the rest of the app calls them. */
export function lifeEventName(event: Pick<FortLifeEvent, 'data'>): string {
  return event.data.nickname || event.data.name.split(/\s+/)[0] || event.data.name
}

/**
 * The sentence for one life event as parts, so names can link to their
 * dwarves. With `subject` false it reads as a line on the dwarf's own page:
 * "Reached Master in mining."
 */
export function lifeEventParts(
  event: Pick<FortLifeEvent, 'kind' | 'data' | 'unit_id'>,
  units: Map<number, FortUnit>,
  { subject = true }: { subject?: boolean } = {},
): TextPart[] {
  const d = event.data
  const self = { sex: d.sex ?? 2 }
  const their = d.sex === 0 ? 'her' : d.sex === 1 ? 'his' : 'their'
  const otherUnit = d.other_unit != null ? units.get(d.other_unit) : undefined
  const other: TextPart = {
    text: otherUnit
      ? firstName(otherUnit)
      : d.other_name
        ? cleanAnnouncement(d.other_name)
        : 'someone',
    unit: otherUnit,
  }

  let rest: (string | TextPart)[]
  switch (event.kind) {
    case 'arrived':
      rest = [
        `arrived at the fortress${typeof d.age === 'number' && d.age > 0 ? `, ${d.age} years old` : ''}`,
      ]
      break
    case 'returned':
      rest = ['came back to the fortress']
      break
    case 'born':
      rest = ['was born']
      break
    case 'died':
      rest = ['died']
      break
    case 'left':
      rest = ['is no longer on the map']
      break
    case 'skill': {
      const to = typeof d.to === 'number' ? d.to : 0
      rest = [`reached ${skillRank(to)} in ${d.skill ? skillLabel(d.skill, self) : 'a skill'}`]
      break
    }
    case 'profession':
      rest = [
        `became ${article(String(d.to ?? 'something new').toLowerCase())}${d.from ? `, after being ${article(String(d.from).toLowerCase())}` : ''}`,
      ]
      break
    case 'office':
      rest = [d.gained ? `was made ${d.position ?? 'an officer'}` : `is no longer ${d.position}`]
      break
    case 'squad':
      rest = [d.gained ? `joined ${d.squad ?? 'a squad'}` : `left ${d.squad ?? 'their squad'}`]
      break
    case 'bond':
      rest =
        d.bond === 'spouse'
          ? ['married ', other]
          : d.bond === 'lover'
            ? ['fell in love with ', other]
            : d.bond === 'child'
              ? ['had a child, ', other]
              : d.bond === 'grudge'
                ? ['came to hold a grudge against ', other]
                : ['became friends with ', other]
      break
    case 'unhappy':
      rest = [`grew ${stress(d.to) || 'unhappy'}`]
      break
    case 'miserable':
      rest = ['became miserable']
      break
    case 'recovered':
      rest = [`is ${stress(d.to) || 'content'} again`]
      break
    case 'hurt':
      rest = [`was hurt${d.wound ? ` (${d.wound})` : ''}`]
      break
    case 'healed':
      rest = [`has healed from ${their} wounds`]
      break
    case 'kills':
      rest = [
        d.from === 0
          ? `made ${their} first kill`
          : `has now killed ${typeof d.to === 'number' ? d.to : 'more'}`,
      ]
      break
    default:
      rest = ['changed']
  }

  const parts: TextPart[] = []
  if (subject) {
    parts.push({ text: lifeEventName(event), unit: units.get(event.unit_id) })
    parts.push({ text: ' ' })
  }
  rest.forEach((piece, i) => {
    const part = typeof piece === 'string' ? { text: piece } : piece
    if (!subject && i === 0) part.text = part.text.charAt(0).toUpperCase() + part.text.slice(1)
    parts.push(part)
  })
  parts.push({ text: '.' })
  return parts
}
