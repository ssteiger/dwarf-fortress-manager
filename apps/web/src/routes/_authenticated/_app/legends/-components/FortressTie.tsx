import { cn } from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { HouseIcon } from 'lucide-react'
import * as React from 'react'

import { displayName } from '~/lib/legends/prose'
import { getFortressInLegends } from '~/lib/legends/server/fortressLinks'
import type { FortressDweller, FortressKin } from '~/lib/legends/server/lives'

import { type LiveFortress, useSelectedWorld } from './LegendsChrome'

export function useFortressInLegends(worldId: number, enabled: boolean) {
  return useQuery({
    queryKey: ['legends', 'fortress', worldId],
    queryFn: () => getFortressInLegends({ data: { worldId } }),
    enabled,
    staleTime: 5 * 60_000,
  })
}

export interface FortressContext {
  live: LiveFortress | null
  /** The selected legends world is the one the fortress stands in. */
  matchesLive: boolean
  tie: ReturnType<typeof useFortressInLegends>
  civId: number | null
  groupId: number | null
  siteId: number | null
  isOurCiv: (id: number | null | undefined) => boolean
  isOurGroup: (id: number | null | undefined) => boolean
  isOurSite: (id: number | null | undefined) => boolean
  /** The fortress dweller this figure is, if any. */
  dwellerFor: (figureId: number) => FortressDweller | null
  /** What this figure is to the fortress's dwellers. */
  kinOf: (figureId: number) => FortressKin[]
}

/** Everything a legends page needs to say what is yours. Empty when the worlds differ. */
export function useFortressContext(worldId: number | null): FortressContext {
  const { live, matchesLive } = useSelectedWorld(worldId ?? undefined)
  const tie = useFortressInLegends(worldId ?? -1, matchesLive && worldId !== null)
  const data = tie.data
  return React.useMemo(() => {
    const ours = (mine: number | null | undefined) => (id: number | null | undefined) =>
      matchesLive && mine !== null && mine !== undefined && id === mine
    const living = new Map((data?.living ?? []).map((d) => [d.figureId, d]))
    const kin = new Map<number, FortressKin[]>()
    for (const k of data?.kin ?? []) kin.set(k.figureId, [...(kin.get(k.figureId) ?? []), k])
    return {
      live,
      matchesLive,
      tie,
      civId: matchesLive ? (live?.civId ?? null) : null,
      groupId: matchesLive ? (live?.groupId ?? null) : null,
      siteId: matchesLive ? (live?.siteId ?? null) : null,
      isOurCiv: ours(live?.civId),
      isOurGroup: ours(live?.groupId),
      isOurSite: ours(live?.siteId),
      dwellerFor: (id) => living.get(id) ?? null,
      kinOf: (id) => kin.get(id) ?? [],
    }
  }, [live, matchesLive, tie, data])
}

/** A small mark saying a record belongs to the player: "Your civilization", "Your fortress". */
export const Yours = ({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) => {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-sm font-medium text-primary',
        className,
      )}
    >
      <HouseIcon className="size-3.5 shrink-0" />
      {children}
    </span>
  )
}

/** What a site, group or chapter is to the fortress, in a few words; null when nothing. */
export function recordTie(
  fort: FortressContext,
  kind: string,
  id: number,
  p: Record<string, unknown>,
): string | null {
  if (!fort.matchesLive) return null
  const plus = (p.plus && typeof p.plus === 'object' ? p.plus : {}) as Record<string, unknown>
  const n = (v: unknown) => (typeof v === 'number' ? v : null)
  if (kind === 'site') {
    if (fort.isOurSite(id)) return 'Your fortress'
    if (fort.isOurCiv(n(plus.civ_id))) return 'Held by your civilization'
    return null
  }
  if (kind === 'entity') {
    if (fort.isOurCiv(id)) return 'The civilization you play'
    if (fort.isOurGroup(id)) return "Your fortress's government"
    return null
  }
  if (kind === 'historical_event_collection') {
    const aggressor = n(p.aggressor_ent_id) ?? n(p.attacking_enid)
    const defender = n(p.defender_ent_id) ?? n(p.defending_enid)
    const war = p.type === 'war'
    if (fort.isOurCiv(defender) || fort.isOurGroup(defender))
      return war ? 'A war against your people' : 'Your people defended'
    if (fort.isOurCiv(aggressor) || fort.isOurGroup(aggressor))
      return war ? 'A war your people waged' : 'Your people attacked'
    if (fort.isOurSite(n(p.site_id))) return 'At your fortress'
    return null
  }
  return null
}

const RELATION: Record<string, string> = {
  mother: 'Mother of',
  father: 'Father of',
  grandmother: 'Grandmother of',
  grandfather: 'Grandfather of',
  spouse: 'Married to',
  'late spouse': 'Was married to',
  child: 'Child of',
  sibling: 'Sibling of',
}

const linkClass = 'font-medium text-primary underline-offset-4 hover:underline'

/** How many of a figure's ties to the fortress are spelled out before "and N more". */
const SHOWN_KIN = 3

/** The figure's tie to the running fortress: living there now, or kin to someone who does. */
export const FortressTieLine = ({
  worldId,
  figureId,
  className,
}: {
  worldId: number
  figureId: number
  className?: string
}) => {
  const fort = useFortressContext(worldId)
  const data = fort.tie.data
  const [all, setAll] = React.useState(false)
  if (!fort.matchesLive || !data) return null

  const here = fort.dwellerFor(figureId)
  if (here)
    return (
      <p className={cn('flex items-center gap-2 text-sm', className)}>
        <HouseIcon className="size-4 shrink-0 text-primary" />
        <span>
          Lives in your fortress now.{' '}
          <Link
            to="/fortress/citizens/$id"
            params={{ id: String(here.unitId) }}
            className={linkClass}
          >
            See them there
          </Link>
        </span>
      </p>
    )

  const kin = fort.kinOf(figureId)
  if (!kin.length) return null
  const shown = all ? kin : kin.slice(0, SHOWN_KIN)
  return (
    <ul className={cn('flex flex-col gap-1 text-sm', className)}>
      {shown.map((k) => {
        const name = data.names.historical_figure?.[k.dweller.figureId]
        return (
          <li key={`${k.dweller.figureId}-${k.relation}`} className="flex items-center gap-2">
            <HouseIcon className="size-4 shrink-0 text-primary" />
            <span>
              {RELATION[k.relation] ?? 'Kin to'}{' '}
              <Link
                to="/fortress/citizens/$id"
                params={{ id: String(k.dweller.unitId) }}
                className={linkClass}
              >
                {name ? displayName(name) : 'one of your people'}
              </Link>
              , who lives in your fortress now.
            </span>
          </li>
        )
      })}
      {kin.length > shown.length ? (
        <li>
          <button
            type="button"
            className="ml-6 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => setAll(true)}
          >
            and {kin.length - shown.length} more of your people
          </button>
        </li>
      ) : null}
    </ul>
  )
}
