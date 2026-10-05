/*
 * Game time: the game's calendar in ticks, how long ago something happened,
 * and the seasons recaps and trends are cut into. A year is 12 months of 28
 * days, a day 1200 ticks; the game's own clock (`world.year`, `world.tick`)
 * counts ticks from the start of the year. Client-safe.
 */

// ---------------------------------------------------------------------------
// Ticks and spans

export const TICKS_PER_DAY = 1200
export const TICKS_PER_MONTH = TICKS_PER_DAY * 28
export const TICKS_PER_YEAR = TICKS_PER_MONTH * 12

export interface GameTime {
  year: number
  tick: number
}

export const absTicks = (t: GameTime) => t.year * TICKS_PER_YEAR + t.tick

export function gameTimeOf(
  state: { world?: { year: number; tick: number } | null } | null | undefined,
): GameTime | null {
  const w = state?.world
  return w && typeof w.year === 'number' && typeof w.tick === 'number'
    ? { year: w.year, tick: w.tick }
    : null
}

/** "3 days", "2 months", "a year and a half" is too clever: "1 year". */
export function gameSpan(ticks: number): string {
  const days = Math.floor(ticks / TICKS_PER_DAY)
  if (days < 1) return 'less than a day'
  if (days < 28) return `${days} day${days === 1 ? '' : 's'}`
  const months = Math.floor(days / 28)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`
  const years = Math.floor(months / 12)
  return `${years} year${years === 1 ? '' : 's'}`
}

export function gameAgo(then: GameTime, now: GameTime | null): string | null {
  if (!now) return null
  const diff = absTicks(now) - absTicks(then)
  if (diff < 0) return null
  if (diff < TICKS_PER_DAY) return 'today'
  return `${gameSpan(diff)} ago`
}

const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const

export function seasonOf(tick: number): (typeof SEASONS)[number] {
  return SEASONS[Math.min(3, Math.floor(tick / TICKS_PER_MONTH / 3))]
}

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
