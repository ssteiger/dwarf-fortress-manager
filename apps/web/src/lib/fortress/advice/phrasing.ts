import type { FortUnit } from '@fortress/db-drizzle'

import { firstName } from '../people/units'

/*
 * Small helpers the advice is written with: counts, lists, a few names, and
 * step lists without the steps that do not apply. Client-safe.
 */

export const fmt = (n: number) => n.toLocaleString()

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmt(n)} ${n === 1 ? one : many}`
}

export function list(words: string[], conjunction: 'and' | 'or' = 'and'): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} ${conjunction} ${words[words.length - 1]}`
}

export function names(units: FortUnit[], max = 3): string {
  const shown = units.slice(0, max).map(firstName)
  const rest = units.length - shown.length
  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : list(shown)
}

export const compact = (steps: (string | number | null | false | undefined)[]): string[] =>
  steps.filter((s): s is string => typeof s === 'string' && s.length > 0)
