export type SortDirection = 'asc' | 'desc'

export type SortValue = string | number | null

/**
 * Compare two cell values. Missing values stay at the bottom in both directions
 * so a column of blanks does not jump above real data when the sort flips.
 * Used by the items query, which sorts before it pages.
 */
export function compareSortValues(a: SortValue, b: SortValue, direction: SortDirection): number {
  const aMissing = a === null || a === undefined
  const bMissing = b === null || b === undefined
  if (aMissing && bMissing) return 0
  if (aMissing) return 1
  if (bMissing) return -1
  const cmp =
    typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
  return direction === 'asc' ? cmp : -cmp
}
