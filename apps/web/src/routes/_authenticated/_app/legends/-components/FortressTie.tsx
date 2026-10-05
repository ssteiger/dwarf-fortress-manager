import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { HouseIcon } from 'lucide-react'

import { displayName } from '~/lib/legends/prose'
import { getFortressInLegends } from '~/lib/legends/server/fortressLinks'

import { useSelectedWorld } from './LegendsChrome'

export function useFortressInLegends(worldId: number, enabled: boolean) {
  return useQuery({
    queryKey: ['legends', 'fortress', worldId],
    queryFn: () => getFortressInLegends({ data: { worldId } }),
    enabled,
    staleTime: 5 * 60_000,
  })
}

const RELATION: Record<string, string> = {
  mother: 'Mother of',
  father: 'Father of',
  grandmother: 'Grandmother of',
  grandfather: 'Grandfather of',
  spouse: 'Married to',
  'late spouse': 'Was married to',
}

const linkClass = 'font-medium text-primary underline-offset-4 hover:underline'

/** The figure's tie to the running fortress: living there now, or kin to someone who does. */
export function FortressTieLine({ worldId, figureId }: { worldId: number; figureId: number }) {
  const { matchesLive } = useSelectedWorld(worldId)
  const tie = useFortressInLegends(worldId, matchesLive)
  const data = tie.data
  if (!matchesLive || !data) return null

  const here = data.living.find((d) => d.figureId === figureId)
  if (here)
    return (
      <p className="mb-4 flex items-center gap-2 text-sm">
        <HouseIcon className="size-4 shrink-0 text-primary" />
        <span>
          Lives in your fortress now.{' '}
          <Link
            to="/fortress/dwarves/$id"
            params={{ id: String(here.unitId) }}
            className={linkClass}
          >
            See them there
          </Link>
        </span>
      </p>
    )

  const kin = data.kin.filter((k) => k.figureId === figureId).slice(0, 3)
  if (!kin.length) return null
  return (
    <ul className="mb-4 flex flex-col gap-1 text-sm">
      {kin.map((k) => {
        const name = data.names.historical_figure?.[k.dweller.figureId]
        return (
          <li key={k.dweller.figureId} className="flex items-center gap-2">
            <HouseIcon className="size-4 shrink-0 text-primary" />
            <span>
              {RELATION[k.relation] ?? 'Kin to'}{' '}
              <Link
                to="/fortress/dwarves/$id"
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
    </ul>
  )
}
