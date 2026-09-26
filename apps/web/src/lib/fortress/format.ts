import type { FortUnit } from '@fortress/db-drizzle'
// Client-safe subpath: the package entry also creates the Postgres client,
// which must never reach the browser bundle.
import { DF_MONTHS, STRESS_LABELS } from '@fortress/db-drizzle/fortress-types'

/** Client-safe formatting helpers for fortress data. No server imports here. */

const TICKS_PER_DAY = 1200
const TICKS_PER_MONTH = TICKS_PER_DAY * 28

export function formatGameTick(year: number | null, tick: number | null): string {
  if (year === null || tick === null) return ''
  const month = Math.floor(tick / TICKS_PER_MONTH)
  const day = Math.floor((tick % TICKS_PER_MONTH) / TICKS_PER_DAY) + 1
  return `${day} ${DF_MONTHS[month] ?? '?'} ${year}`
}

export function stressLabel(category: number): string {
  return STRESS_LABELS[Math.min(Math.max(category, 0), 6)] ?? 'unknown'
}

/** Tailwind classes for each stress category, 0 = miserable ... 6 = ecstatic. */
export const STRESS_CLASSES = [
  'bg-red-600 text-white',
  'bg-red-400 text-white',
  'bg-amber-400 text-black',
  'bg-stone-300 text-stone-900 dark:bg-stone-600 dark:text-stone-50',
  'bg-emerald-300 text-emerald-950',
  'bg-emerald-500 text-white',
  'bg-sky-500 text-white',
] as const

export const STRESS_BAR_COLORS = [
  '#dc2626',
  '#f87171',
  '#fbbf24',
  '#a8a29e',
  '#6ee7b7',
  '#10b981',
  '#0ea5e9',
] as const

export interface NeedState {
  label: string
  severity: 'ok' | 'warning' | 'danger'
}

export function hungerState(timer: number): NeedState | null {
  if (timer >= 75_000) return { label: 'Starving', severity: 'danger' }
  if (timer >= 50_000) return { label: 'Hungry', severity: 'warning' }
  return null
}

export function thirstState(timer: number): NeedState | null {
  if (timer >= 50_000) return { label: 'Dehydrated', severity: 'danger' }
  if (timer >= 25_000) return { label: 'Thirsty', severity: 'warning' }
  return null
}

export function sleepState(timer: number): NeedState | null {
  if (timer >= 150_000) return { label: 'Exhausted', severity: 'danger' }
  if (timer >= 57_600) return { label: 'Drowsy', severity: 'warning' }
  return null
}

export function unitNeeds(unit: FortUnit): NeedState[] {
  return [hungerState(unit.hunger), thirstState(unit.thirst), sleepState(unit.sleepiness)].filter(
    (n): n is NeedState => n !== null,
  )
}

export function unitDisplayName(unit: Pick<FortUnit, 'name' | 'readable'>): string {
  return unit.name || unit.readable
}

/**
 * How announcements name a unit: "Urist McDwarf", or "`Nick' McDwarf" once
 * nicknamed. The second needle catches the nicknamed form by its surname.
 */
export function mentionNeedles(name: string): string[] {
  const clean = name.trim()
  if (!clean) return []
  const parts = clean.split(/\s+/)
  return parts.length > 1 ? [clean, `' ${parts[parts.length - 1]}`] : [clean]
}

export function sexLabel(sex: number): string {
  if (sex === 1) return 'male'
  if (sex === 0) return 'female'
  return 'no sex'
}

export function isCitizen(unit: FortUnit): boolean {
  return unit.flags.includes('citizen')
}

export function isLiving(unit: FortUnit): boolean {
  return !unit.flags.includes('dead') && !unit.flags.includes('ghost')
}

export function unitGroup(
  unit: FortUnit,
): 'citizen' | 'resident' | 'visitor' | 'animal' | 'hostile' | 'other' {
  if (unit.flags.includes('citizen')) return 'citizen'
  if (unit.flags.includes('resident')) return 'resident'
  if (
    unit.flags.includes('invader') ||
    unit.flags.includes('danger') ||
    unit.flags.includes('opposed_to_life')
  )
    return 'hostile'
  if (
    unit.flags.includes('visitor') ||
    unit.flags.includes('merchant') ||
    unit.flags.includes('diplomat')
  )
    return 'visitor'
  if (unit.flags.includes('animal')) return 'animal'
  return 'other'
}

/** Turn SKILL_NAME into "Skill name". */
export function humanize(token: string | null | undefined): string {
  if (!token) return ''
  const spaced = token.replace(/_/g, ' ').toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Split PascalCase enum names ("CarveDownwardStaircase") into words. */
export function splitPascal(token: string | null | undefined): string {
  if (!token) return ''
  return token.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
}

export const SKILL_RANKS = [
  'Dabbling',
  'Novice',
  'Adequate',
  'Competent',
  'Skilled',
  'Proficient',
  'Talented',
  'Adept',
  'Expert',
  'Professional',
  'Accomplished',
  'Great',
  'Master',
  'High Master',
  'Grand Master',
  'Legendary',
] as const

export function skillRank(rating: number): string {
  if (rating >= 15) return rating >= 20 ? `Legendary+${rating - 15}` : 'Legendary'
  return SKILL_RANKS[rating] ?? 'Dabbling'
}

export function formatValue(value: number): string {
  return `${value.toLocaleString()}☼`
}

export function formatNumber(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString()
}
