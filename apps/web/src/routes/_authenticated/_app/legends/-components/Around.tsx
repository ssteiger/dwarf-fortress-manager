import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'

import { words } from '~/lib/legends/model'
import { displayName } from '~/lib/legends/prose'
import { type AroundBeast, getAroundFortress } from '~/lib/legends/server/around'
import { Fragments, type LiveFortress, RecordLink } from './LegendsChrome'

/** Beasts and neighbours around the fortress; without distances when the worlds differ. */
export function useAroundFortress(
  worldId: number,
  live: LiveFortress | null,
  matchesLive: boolean,
) {
  const siteId = matchesLive ? (live?.siteId ?? null) : null
  const civId = matchesLive ? (live?.civId ?? null) : null
  return useQuery({
    queryKey: ['legends', 'around', worldId, siteId, civId],
    queryFn: () => getAroundFortress({ data: { worldId, siteId, civId } }),
    staleTime: 10 * 60_000,
  })
}

export const BeastRow = ({ beast, worldId }: { beast: AroundBeast; worldId: number }) => (
  <li className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0">
    <div className="flex items-baseline justify-between gap-3">
      <RecordLink
        kind="historical_figure"
        id={beast.id}
        name={beast.name ? displayName(beast.name) : undefined}
        worldId={worldId}
        className="min-w-0 truncate"
      />
      {beast.distance !== null ? (
        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
          {beast.distance === 0 ? 'at your site' : `${beast.distance} squares away`}
        </span>
      ) : null}
    </div>
    <div className="text-sm text-muted-foreground">
      <span className="text-foreground">{beast.what}</span>
      {beast.kills ? ` · ${beast.kills.toLocaleString()} slain` : ''}
      {beast.place ? (
        <>
          {' · '}
          {beast.place.link === 'lair' ? 'lairs in ' : `${words(beast.place.link)} at `}
          <RecordLink kind="site" id={beast.place.id} name={beast.place.name} worldId={worldId} />
        </>
      ) : null}
    </div>
    {beast.line.length ? (
      <div className="text-sm text-muted-foreground">
        <Fragments fragments={beast.line} worldId={worldId} />
      </div>
    ) : null}
  </li>
)

/** The three nearest dangers, for the overview's "Your people" panel. */
export const NearestDangers = ({ worldId, live }: { worldId: number; live: LiveFortress }) => {
  const around = useAroundFortress(worldId, live, true)
  if (!around.data?.home) return null
  const { great, night, cursed } = around.data.beasts
  const nearest = [...great, ...night, ...cursed]
    .filter((b) => b.distance !== null)
    .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))
    .slice(0, 3)
  if (!nearest.length) return null
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-muted-foreground">Nearest dangers</span>
        <Link
          to="/legends/around"
          search={{ world: worldId }}
          className="text-primary underline-offset-4 hover:underline"
        >
          All around you
        </Link>
      </div>
      <ul className="flex flex-col">
        {nearest.map((beast) => (
          <BeastRow key={beast.id} beast={beast} worldId={worldId} />
        ))}
      </ul>
    </div>
  )
}
