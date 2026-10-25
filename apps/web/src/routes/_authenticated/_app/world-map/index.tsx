import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'

import { titleCase } from '~/lib/legends/model'
import { getLegendsMap } from '~/lib/legends/server/map'
import { EmptyState } from '../fortress/-components/FortChrome'
import { parseWorldSearch, useSelectedWorld } from '../legends/-components/LegendsChrome'
import { WorldMap } from '../legends/-components/WorldMap'

const WorldMapPage = () => {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { legends, worlds, selectedWorld, worldId, live, matchesLive } = useSelectedWorld(
    search.world,
  )
  const map = useQuery({
    queryKey: ['legends', 'map', worldId],
    queryFn: () => getLegendsMap({ data: { worldId: worldId ?? -1 } }),
    enabled: worldId !== null,
    staleTime: 10 * 60_000,
  })

  const openRecord = (kind: string, id: number) =>
    navigate({
      to: '/legends/$kind/$id',
      params: { kind, id: String(id) },
      search: { world: worldId ?? undefined },
    })

  if (!selectedWorld || worldId === null) {
    if (legends.isLoading) return <Skeleton className="m-4 flex-1 rounded-xl" />
    return legends.isError ? (
      <EmptyState title="The legends could not be read" className="m-4">
        The database did not answer. Reload the page to try again.
      </EmptyState>
    ) : (
      <EmptyState title="No world map yet" className="m-4">
        The world map comes from a legends export. Export legends from the game (Legends mode, or
        DFHack's <code>exportlegends</code>) into the Dwarf Fortress folder and the worker picks it
        up on its next start.
      </EmptyState>
    )
  }

  if (map.isError)
    return (
      <EmptyState title="The map could not be drawn" className="m-4">
        The world's regions and sites could not be read. Reload the page to try again.
      </EmptyState>
    )

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {map.data ? (
        <WorldMap
          fill
          variant="full"
          showLegend={false}
          data={map.data}
          homeSite={matchesLive ? (live?.siteId ?? null) : null}
          onSelectSite={(site) => openRecord('site', site.id)}
          onSelectRegion={(region) => openRecord('region', region.id)}
        />
      ) : (
        <div className="flex-1 animate-pulse bg-muted" />
      )}

      <div className="absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-x-3 gap-y-2 rounded-md border bg-popover/90 px-3 py-2 text-sm text-popover-foreground shadow-md backdrop-blur">
        {worlds.length > 1 ? (
          <Select
            value={String(worldId)}
            onValueChange={(v) =>
              navigate({ search: (prev) => ({ ...prev, world: Number(v) }), replace: true })
            }
          >
            <SelectTrigger size="sm" className="h-8 w-[200px]">
              <SelectValue placeholder="World" />
            </SelectTrigger>
            <SelectContent>
              {worlds.map((w) => (
                <SelectItem key={w.id} value={String(w.id)}>
                  {titleCase(w.name ?? w.key)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="min-w-0">
            <div className="truncate font-medium">
              {titleCase(selectedWorld.name ?? selectedWorld.key)}
            </div>
            {selectedWorld.alt_name ? (
              <div className="truncate text-muted-foreground">{selectedWorld.alt_name}</div>
            ) : null}
          </div>
        )}
        <Link
          to="/legends/world"
          search={{ world: worldId }}
          className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
        >
          History and civilizations
          <ArrowRightIcon className="size-3.5" />
        </Link>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/_app/world-map/')({
  validateSearch: parseWorldSearch,
  component: WorldMapPage,
})
