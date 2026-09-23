import type { FortState, FortUnit } from '@fortress/db-drizzle'
import { Button } from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { BookOpenIcon, ScrollTextIcon } from 'lucide-react'
import * as React from 'react'

import { useFortOverview } from '~/lib/fortress/queries'
import { getChronicleMentionCounts } from '~/lib/fortress/server'
import { matchLegendsWorld } from '~/lib/legends/model'
import { getFigureEventCounts, getKnownFigures, getLegendsOverview } from '~/lib/legends/server'

export interface UnitLegendsRef {
  worldId: number
  figureId: number
}

/** Legends world for the fortress currently loaded, matched by either of its names. */
export function useFortLegendsWorldId(): number | null {
  const overview = useFortOverview()
  const legends = useQuery({
    queryKey: ['legends', 'overview'],
    queryFn: () => getLegendsOverview(),
    staleTime: 60_000,
  })
  const state: FortState | null | undefined = overview.data?.state
  return (
    matchLegendsWorld(legends.data?.worlds ?? [], [
      state?.world_name,
      state?.world?.name,
      state?.world?.name_native,
    ])?.id ?? null
  )
}

/** Which of these historical figure ids were actually exported for that world. */
export function useKnownHistFigures(worldId: number | null, ids: number[]): Set<number> {
  const hfIds = React.useMemo(
    () => [...new Set(ids.filter((id) => Number.isInteger(id) && id >= 0))],
    [ids],
  )
  const known = useQuery({
    queryKey: ['legends', 'known-figures', worldId, hfIds.join(',')],
    queryFn: () => getKnownFigures({ data: { worldId: worldId ?? -1, ids: hfIds } }),
    enabled: worldId !== null && hfIds.length > 0,
    staleTime: 5 * 60_000,
  })
  return React.useMemo(() => new Set(known.data ?? []), [known.data])
}

function stableIds(ids: number[]): number[] {
  return [...new Set(ids.filter((id) => Number.isInteger(id) && id >= 0))].sort((a, b) => a - b)
}

/** Historical events recorded for each figure. Missing ids count as zero. */
export function useFigureEventCounts(worldId: number | null, ids: number[]): Map<number, number> {
  const hfIds = stableIds(ids)
  const key = hfIds.join(',')
  const counts = useQuery({
    queryKey: ['legends', 'figure-events', worldId, key],
    queryFn: () => getFigureEventCounts({ data: { worldId: worldId ?? -1, ids: hfIds } }),
    enabled: worldId !== null && hfIds.length > 0,
    staleTime: 5 * 60_000,
  })
  return React.useMemo(
    () => new Map((counts.data ?? []).map((row) => [row.id, row.count])),
    [counts.data],
  )
}

/** Chronicle announcements that quote each name. Missing names count as zero. */
export function useChronicleMentionCounts(names: string[]): Map<string, number> {
  const unique = [
    ...new Set(names.map((name) => name.trim()).filter((name) => name.length > 0)),
  ].sort()
  const key = unique.join('\n')
  const counts = useQuery({
    queryKey: ['fort', 'event-mentions', key],
    queryFn: () => getChronicleMentionCounts({ data: { names: unique } }),
    enabled: unique.length > 0,
    staleTime: 30_000,
  })
  return React.useMemo(
    () => new Map((counts.data ?? []).map((row) => [row.name, row.count])),
    [counts.data],
  )
}

export function legendsRefFor(
  unit: Pick<FortUnit, 'hist_figure_id'>,
  worldId: number | null,
  known: Set<number>,
): UnitLegendsRef | null {
  if (worldId === null || !known.has(unit.hist_figure_id)) return null
  return { worldId, figureId: unit.hist_figure_id }
}

/**
 * Opens this unit in legends, when the export has their historical figure,
 * and in the chronicle, when the game has given them a name announcements can quote.
 */
export function UnitLinks({
  unit,
  legends,
  variant = 'icon',
  stopPropagation = false,
}: {
  unit: Pick<FortUnit, 'name' | 'hist_figure_id'>
  legends: UnitLegendsRef | null
  variant?: 'icon' | 'button'
  stopPropagation?: boolean
}) {
  const name = unit.name.trim()
  if (!name && !legends) return null
  const halt = stopPropagation ? (event: React.MouseEvent) => event.stopPropagation() : undefined
  const iconClass = 'size-3.5'

  const legendsLink = legends ? (
    <Link
      to="/legends/$kind/$id"
      params={{ kind: 'historical_figure', id: String(legends.figureId) }}
      search={{ world: legends.worldId }}
      onClick={halt}
      title="Their legends"
      className={variant === 'icon' ? 'text-muted-foreground hover:text-foreground' : undefined}
    >
      <BookOpenIcon className={iconClass} />
      {variant === 'button' ? 'Legends' : null}
    </Link>
  ) : null

  const eventsLink = name ? (
    <Link
      to="/fortress/chronicle"
      search={{ q: name, filter: 'all' }}
      onClick={halt}
      title="Announcements that name them"
      className={variant === 'icon' ? 'text-muted-foreground hover:text-foreground' : undefined}
    >
      <ScrollTextIcon className={iconClass} />
      {variant === 'button' ? 'Events' : null}
    </Link>
  ) : null

  if (variant === 'button') {
    return (
      <>
        {legendsLink ? (
          <Button asChild size="sm" variant="outline" className="gap-2">
            {legendsLink}
          </Button>
        ) : null}
        {eventsLink ? (
          <Button asChild size="sm" variant="outline" className="gap-2">
            {eventsLink}
          </Button>
        ) : null}
      </>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {legendsLink}
      {eventsLink}
    </span>
  )
}
