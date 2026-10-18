import type { FortState, FortUnit } from '@fortress/db-drizzle'
import { Button } from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { BookOpenIcon, ScrollTextIcon } from 'lucide-react'
import * as React from 'react'

import type { LegendsCurse } from '~/lib/fortress/advice/types'
import { useFortOverview } from '~/lib/fortress/client/queries'
import { isLiving } from '~/lib/fortress/format'
import { isCitizenish } from '~/lib/fortress/people/units'
import { getChronicleMentionCounts } from '~/lib/fortress/server/events'
import { matchLegendsWorld } from '~/lib/legends/model'
import { getFigureCurses } from '~/lib/legends/server/curses'
import { getFigureEventCounts, getKnownFigures } from '~/lib/legends/server/fortressLinks'
import { getLegendsOverview } from '~/lib/legends/server/worlds'

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

/** Curses the legends export records on your living citizens, for the advice; empty without a matching export. */
export function useLegendsCurses(units: FortUnit[]): LegendsCurse[] {
  const worldId = useFortLegendsWorldId()
  const citizens = React.useMemo(() => units.filter((u) => isLiving(u) && isCitizenish(u)), [units])
  const ids = stableIds(citizens.map((u) => u.hist_figure_id))
  const curses = useQuery({
    queryKey: ['legends', 'curses', worldId, ids.join(',')],
    queryFn: () => getFigureCurses({ data: { worldId: worldId ?? -1, figureIds: ids } }),
    enabled: worldId !== null && ids.length > 0,
    staleTime: 10 * 60_000,
  })
  return React.useMemo(() => {
    const byFigure = new Map(citizens.map((u) => [u.hist_figure_id, u.id]))
    return (curses.data ?? []).flatMap((c) => {
      const unitId = byFigure.get(c.figureId)
      return unitId === undefined ? [] : [{ unitId, kind: c.kind, what: c.what }]
    })
  }, [curses.data, citizens])
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
export const UnitLinks = ({
  unit,
  legends,
  variant = 'icon',
  stopPropagation = false,
}: {
  unit: Pick<FortUnit, 'name' | 'hist_figure_id'>
  legends: UnitLegendsRef | null
  variant?: 'icon' | 'button'
  stopPropagation?: boolean
}) => {
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
