import type { FortUnit, StrangeMood, StrangeMoodNeed } from '@fortress/db-drizzle'

import { humanize, isLiving, stressLabel, unitNeeds } from '../format'
import type { GameTime } from '../time'
import { emotionTone, notableThought, thoughtPhrase } from './thoughts'
import { isCitizenish, isGrownCitizen, pronouns } from './units'

/*
 * One dwarf's troubles: a strange mood or madness, wounds, unmet needs,
 * stress and idleness, each with a severity and a hint, for the dwarf list
 * and the dwarf pages. Client-safe.
 */

export type Severity = 'danger' | 'warning' | 'info'

export interface Concern {
  key: string
  severity: Severity
  label: string
  hint?: string
}

const MOOD_TEXT: Record<string, { label: string; severity: Severity; hint: string }> = {
  Fey: {
    label: 'Taken by a fey mood',
    severity: 'warning',
    hint: 'They will claim a workshop and gather materials for an artifact. Keep what they ask for in stock: if they cannot finish, they go mad.',
  },
  Secretive: {
    label: 'In a secretive mood',
    severity: 'warning',
    hint: 'They will claim a workshop and gather materials for an artifact. Keep what they ask for in stock: if they cannot finish, they go mad.',
  },
  Possessed: {
    label: 'Possessed',
    severity: 'warning',
    hint: 'They will make an artifact, but gain no skill from it. Let them work undisturbed.',
  },
  Macabre: {
    label: 'In a macabre mood',
    severity: 'warning',
    hint: 'They want bones, skulls and other remains. Keep some in reach, or they go mad.',
  },
  Fell: {
    label: 'In a fell mood',
    severity: 'danger',
    hint: 'They will kill someone to finish their work. Keep others clear of them, or make peace with the loss.',
  },
  Melancholy: {
    label: 'Stricken by melancholy',
    severity: 'danger',
    hint: 'They will wander and starve. There is no cure, but a burial and a memorial keep the grief from spreading.',
  },
  Raving: {
    label: 'Raving mad',
    severity: 'danger',
    hint: 'There is no cure. Keep them away from others.',
  },
  Berserk: {
    label: 'Gone berserk',
    severity: 'danger',
    hint: 'They will attack anyone near them. Lock them away or let the militia deal with it.',
  },
  Traumatized: {
    label: 'Traumatized',
    severity: 'danger',
    hint: 'They have seen too much. Keep them from the dead and from danger.',
  },
}

export function moodText(mood: string | null) {
  if (!mood) return null
  return (
    MOOD_TEXT[mood] ?? {
      label: `${humanize(mood)} mood`,
      severity: 'warning' as Severity,
      hint: 'Something has taken hold of them. Watch what they do next.',
    }
  )
}

/** "a, b and c". */
export function listWords(words: string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** A strange mood's demands not yet brought, and those the fortress has none of. */
export function moodShortfall(mood: StrangeMood | null | undefined): {
  missing: StrangeMoodNeed[]
  lacking: StrangeMoodNeed[]
} {
  const missing = (mood?.needs ?? []).filter((n) => n.have < n.need)
  return { missing, lacking: missing.filter((n) => n.free === 0) }
}

/** Where a strange mood stands, in a sentence or two; null without the details. */
export function moodNeedsText(mood: StrangeMood | null | undefined): string | null {
  if (!mood || mood.error) return null
  if (mood.working) return 'They have everything they asked for and are at work. Leave them be.'
  if (mood.building_id === null)
    return 'They are looking for a free workshop to claim. Their demands come with it.'
  const { missing, lacking } = moodShortfall(mood)
  if (!missing.length) return 'They have everything they asked for and will start work soon.'
  const parts = missing.map((n) => {
    const count = `${n.need - n.have} ${n.label}`
    if (n.free === undefined) return count
    return n.free === 0
      ? `${count} (none in the fortress)`
      : `${count} (${n.free.toLocaleString()} in the stores)`
  })
  return lacking.length
    ? `Still needs ${listWords(parts)}. Make or trade for the ${listWords(lacking.map((n) => n.label))} soon: if they cannot finish, they go mad.`
    : `Still needs ${listWords(parts)}. Dwarves will bring it from the stores.`
}

/** The concern a mood raises: its demands when the dump has them, the general advice otherwise. */
export function moodConcern(
  unit: FortUnit,
): { label: string; severity: Severity; hint: string } | null {
  const mood = moodText(unit.mood)
  if (!mood) return null
  const needs = moodNeedsText(unit.strange_mood)
  if (!needs) return mood
  const general = unit.mood === 'Fey' || unit.mood === 'Secretive' ? null : mood.hint
  return {
    label: mood.label,
    severity: moodShortfall(unit.strange_mood).lacking.length ? 'danger' : mood.severity,
    hint: general ? `${general} ${needs}` : needs,
  }
}

const NEED_HINTS: Record<string, string> = {
  Starving: 'Check food is stocked and nothing blocks the way to it.',
  Hungry: 'They will eat when they can reach food.',
  Dehydrated: 'Check drink is stocked and reachable. A well is a good fallback.',
  Thirsty: 'They will drink when they can reach drink.',
  Exhausted: 'They need a bed. A dormitory will do.',
  Drowsy: 'They will sleep soon.',
}

export function unitConcerns(unit: FortUnit, now: GameTime | null = null): Concern[] {
  if (!isLiving(unit)) return []
  const out: Concern[] = []
  const mood = moodConcern(unit)
  if (mood)
    out.push({
      key: 'mood',
      severity: mood.severity,
      label: mood.label,
      hint: mood.hint,
    })
  else if (unit.flags.includes('insane'))
    out.push({
      key: 'insane',
      severity: 'danger',
      label: 'Insane',
      hint: 'There is no cure.',
    })

  if (unit.wounds > 0) {
    const blood =
      unit.blood !== null && unit.blood_max ? Math.round((unit.blood / unit.blood_max) * 100) : null
    out.push({
      key: 'wounds',
      severity: blood !== null && blood < 60 ? 'danger' : 'warning',
      label: `${unit.wounds} wound${unit.wounds === 1 ? '' : 's'}${blood !== null && blood < 100 ? `, blood ${blood}%` : ''}`,
      hint: 'Rest in a hospital bed, tended by a doctor, heals them fastest.',
    })
  }
  for (const need of unitNeeds(unit)) {
    out.push({
      key: `need-${need.label}`,
      severity: need.severity === 'danger' ? 'danger' : 'info',
      label: need.label,
      hint: NEED_HINTS[need.label],
    })
  }
  if (isCitizenish(unit) && unit.stress_category <= 2) {
    const lately = notableThought(unit, now)
    out.push({
      key: 'stress',
      severity:
        unit.stress_category === 0 ? 'danger' : unit.stress_category === 1 ? 'warning' : 'info',
      label: humanize(stressLabel(unit.stress_category)),
      hint: `${lately && emotionTone(lately[1]) === 'bad' ? `Lately ${pronouns(unit).they} ${thoughtPhrase(lately[0], lately[1])}. ` : ''}Good meals, a finer bedroom and time with friends lift a dwarf’s spirits.`,
    })
  }
  if (isGrownCitizen(unit) && !unit.job && !unit.squad && !unit.mood)
    out.push({
      key: 'idle',
      severity: 'info',
      label: 'Idle',
      hint: 'Queue work orders, or give them more labors.',
    })
  return out
}

export const SEVERITY_RANK: Record<Severity, number> = {
  danger: 0,
  warning: 1,
  info: 2,
}

export function worstSeverity(concerns: Concern[]): Severity | null {
  let worst: Severity | null = null
  for (const c of concerns)
    if (worst === null || SEVERITY_RANK[c.severity] < SEVERITY_RANK[worst]) worst = c.severity
  return worst
}

export function concernScore(concerns: Concern[]): number {
  return concerns.reduce((sum, c) => sum + (3 - SEVERITY_RANK[c.severity]) ** 2, 0)
}
