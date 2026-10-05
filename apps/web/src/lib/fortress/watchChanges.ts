import type { FortUnit } from '@fortress/db-drizzle'
import { STRESS_LABELS } from '@fortress/db-drizzle/fortress-types'

import { isLiving } from './format'
import {
  type GameTime,
  type Thought,
  absTicks,
  emotionTone,
  firstName,
  moodText,
  thoughtPhrase,
} from './insights'

/* What changed for a watched creature, between two reads or since a moment. Client-safe. */

/** Thoughts that come every few days to everyone and say nothing new. */
const ROUTINE = new Set([
  'NeedsUnfulfilled',
  'SatisfiedAtWork',
  'ImproveSkill',
  'AdmireBuilding',
  'AdmireArrangedBuilding',
  'BedroomQuality',
  'DiningQuality',
  'Talked',
  'Prayer',
  'SleepNoise',
])

/** What a watched creature was like at the last read, to compare the next with. */
export interface WatchMark {
  stress: number
  wounds: number
  mood: string | null
  /** "thought|year|tick" of their newest thought. */
  thought: string | null
  alive: boolean
}

const thoughtKey = (t: Thought | undefined) => (t ? `${t[0]}|${t[3]}|${t[4]}` : null)

export function watchMark(unit: FortUnit): WatchMark {
  return {
    stress: unit.stress_category,
    wounds: unit.wounds,
    mood: unit.mood,
    thought: thoughtKey(unit.thoughts?.[0]),
    alive: isLiving(unit),
  }
}

export interface WatchAlert {
  title: string
  detail?: string
  urgent: boolean
}

const stressWord = (category: number) => STRESS_LABELS[Math.min(Math.max(category, 0), 6)] ?? ''

/**
 * What is worth telling about a watched creature since the last read: growing
 * unhappy or getting over it, a new wound, a mood, a bad new thought. Deaths
 * are left to the chronicle's own alerts.
 */
export function watchAlerts(unit: FortUnit, before: WatchMark): WatchAlert[] {
  const now = watchMark(unit)
  if (!now.alive || !before.alive) return []
  const name = firstName(unit)
  const out: WatchAlert[] = []
  if (now.stress < before.stress && now.stress <= 1)
    out.push({ title: `${name} is now ${stressWord(now.stress)}`, urgent: now.stress === 0 })
  else if (before.stress <= 1 && now.stress > 1)
    out.push({ title: `${name} is ${stressWord(now.stress)} again`, urgent: false })
  if (now.wounds > before.wounds)
    out.push({
      title: `${name} was hurt`,
      detail: `${now.wounds} ${now.wounds === 1 ? 'wound' : 'wounds'} now.`,
      urgent: true,
    })
  if (now.mood && now.mood !== before.mood) {
    const mood = moodText(now.mood)
    out.push({ title: `${name}: ${mood?.label ?? 'in a mood'}`, detail: mood?.hint, urgent: true })
  }
  const newest = unit.thoughts?.[0]
  if (newest && now.thought !== before.thought && !ROUTINE.has(newest[0]))
    if (emotionTone(newest[1]) === 'bad')
      out.push({ title: `${name} ${thoughtPhrase(newest[0], newest[1], unit)}`, urgent: false })
  return out
}

/** Their newest thought that is not one everybody has every few days. */
export function latestThought(unit: FortUnit): Thought | null {
  return (unit.thoughts ?? []).find((t) => !ROUTINE.has(t[0])) ?? null
}

export interface WatchNews {
  unit: FortUnit
  /** What they felt, after their name: "felt euphoria from a syndrome." */
  phrase: string
  year: number
  tick: number
}

const NEWS_PER_UNIT = 2

/** The watched creatures' thoughts since a moment of game time, newest first, a couple each. */
export function watchNews(
  units: FortUnit[],
  watched: ReadonlySet<number>,
  since: GameTime | null,
): WatchNews[] {
  if (!since || !watched.size) return []
  const from = absTicks(since)
  const out: WatchNews[] = []
  for (const unit of units) {
    if (!watched.has(unit.id) || !isLiving(unit)) continue
    const seen = new Set<string>()
    const fresh = (unit.thoughts ?? [])
      .filter((t) => {
        if (ROUTINE.has(t[0]) || absTicks({ year: t[3], tick: t[4] }) <= from) return false
        const key = `${t[0]}|${t[1]}|${t[3]}|${t[4]}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, NEWS_PER_UNIT)
    for (const t of fresh)
      out.push({ unit, phrase: `${thoughtPhrase(t[0], t[1], unit)}.`, year: t[3], tick: t[4] })
  }
  return out.sort((a, b) => absTicks(b) - absTicks(a))
}
