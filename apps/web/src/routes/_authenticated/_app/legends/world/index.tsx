import { cn } from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import * as React from 'react'

import { useDfAssets } from '~/lib/df-assets'
import { LegendsSprite, TerrainChip, TileChip } from '~/lib/df-assets/legends'
import { formatNumber } from '~/lib/fortress/format'
import { raceColor, raceToken, regionColor, titleCase, words } from '~/lib/legends/model'
import { type LegendsWorldSummary, getLegendsMap } from '~/lib/legends/server'
import { siteSpriteNameFor } from '~/lib/legends/worldTiles'
import { LegendsShell, RecordLink, Section, parseWorldSearch } from '../-components/LegendsChrome'
import { WorldMap } from '../-components/WorldMap'

function WorldPage() {
  const { world } = Route.useSearch()
  return (
    <LegendsShell section="world" world={world}>
      {({ worldId, summary, counts }) => (
        <WorldBody worldId={worldId} summary={summary} counts={counts} />
      )}
    </LegendsShell>
  )
}

function WorldBody({
  worldId,
  summary,
  counts,
}: {
  worldId: number
  summary: LegendsWorldSummary | undefined
  counts: Record<string, number>
}) {
  const navigate = useNavigate()
  const assets = useDfAssets()
  const [civ, setCiv] = React.useState<number | null>(null)
  const map = useQuery({
    queryKey: ['legends', 'map', worldId],
    queryFn: () => getLegendsMap({ data: { worldId } }),
    staleTime: 10 * 60_000,
  })
  const highlight = React.useMemo(() => {
    if (civ === null || !map.data) return null
    return new Set(map.data.sites.filter((s) => s.civ === civ || s.owner === civ).map((s) => s.id))
  }, [civ, map.data])

  const openRecord = (kind: string, id: number) =>
    navigate({
      to: '/legends/$kind/$id',
      params: { kind, id: String(id) },
      search: { world: worldId },
    })

  const civs = summary?.civilizations ?? []
  const living = civs.filter((c) => c.sites > 0)
  const fallen = civs.filter((c) => c.sites === 0)

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Section
        title="The known world"
        description={
          map.data
            ? `${map.data.width}×${map.data.height} tiles, ${formatNumber(map.data.sites.length)} sites, ${formatNumber(map.data.regions.length)} regions. Hover for names; click a site or region to open it.`
            : 'Drawing the map…'
        }
      >
        {map.data ? (
          <WorldMap
            data={map.data}
            highlightSites={highlight}
            onSelectSite={(site) => openRecord('site', site.id)}
            onSelectRegion={(region) => openRecord('region', region.id)}
          />
        ) : (
          <div className="aspect-square w-full animate-pulse rounded-lg bg-muted" />
        )}
      </Section>

      <div className="flex flex-col gap-4">
        <Section
          title="Civilizations"
          count={civs.length || null}
          description={
            civ !== null
              ? 'Their sites are lit on the map.'
              : 'Pick one to light its sites on the map.'
          }
        >
          {summary ? (
            <ul className="flex flex-col divide-y">
              {living.map((c) => (
                <li key={c.id}>
                  <div
                    className={cn(
                      'flex items-center gap-3 rounded-md px-1 py-2 transition-colors',
                      civ === c.id && 'bg-accent',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setCiv(civ === c.id ? null : c.id)}
                      className="inline-block size-3 shrink-0 rounded-full border border-black/30"
                      style={{ backgroundColor: raceColor(c.race) }}
                      aria-label={`Show sites of ${c.name ?? 'this civilization'}`}
                    />
                    <LegendsSprite
                      subject={{ kind: 'entity', id: c.id, race: raceToken(c.race) }}
                      size={28}
                      className="-my-1"
                    />
                    <div className="min-w-0 flex-1">
                      <RecordLink
                        kind="entity"
                        id={c.id}
                        name={c.name}
                        worldId={worldId}
                        className="block truncate"
                      />
                      <div className="text-sm text-muted-foreground">
                        {c.race ? `${words(c.race)}s` : 'unknown race'} · {c.sites} site
                        {c.sites === 1 ? '' : 's'}
                        {c.wars ? ` · ${c.wars} war${c.wars === 1 ? '' : 's'}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCiv(civ === c.id ? null : c.id)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      {civ === c.id ? 'clear' : 'show'}
                    </button>
                  </div>
                </li>
              ))}
              {fallen.length ? (
                <li className="pt-2 text-sm text-muted-foreground">
                  {fallen.length} civilization{fallen.length === 1 ? '' : 's'} hold no sites:{' '}
                  {fallen.slice(0, 8).map((c, i) => (
                    <span key={c.id}>
                      {i > 0 ? ', ' : ''}
                      <RecordLink
                        kind="entity"
                        id={c.id}
                        name={c.name}
                        worldId={worldId}
                        className="font-normal"
                      />
                    </span>
                  ))}
                  {fallen.length > 8 ? ` and ${fallen.length - 8} more` : ''}
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Counting banners…</p>
          )}
        </Section>

        <Section title="The land">
          <div className="flex flex-col gap-4 text-sm">
            <div>
              <div className="mb-1.5 font-medium">Regions</div>
              <ul className="flex flex-col gap-1">
                {Object.entries(summary?.regionTypes ?? {})
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, n]) => (
                    <li key={type} className="flex items-center gap-2">
                      {assets ? (
                        <TerrainChip index={assets} type={type} />
                      ) : (
                        <span
                          className="inline-block size-3 rounded-sm border border-black/20"
                          style={{ backgroundColor: regionColor(type) }}
                        />
                      )}
                      <span className="flex-1">{type}</span>
                      <span className="tabular-nums text-muted-foreground">{n}</span>
                    </li>
                  ))}
              </ul>
            </div>
            <div>
              <div className="mb-1.5 font-medium">Sites</div>
              <ul className="flex flex-col gap-1">
                {Object.entries(summary?.siteTypes ?? {})
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, n]) => (
                    <li key={type} className="flex items-center gap-2">
                      {assets ? (
                        <span className="inline-flex w-4 justify-center">
                          {siteSpriteNameFor(type, 0, false) ? (
                            <TileChip
                              index={assets}
                              name={siteSpriteNameFor(type, 0, false) ?? ''}
                            />
                          ) : null}
                        </span>
                      ) : null}
                      <span className="flex-1">{titleCase(type)}s</span>
                      <span className="tabular-nums text-muted-foreground">{n}</span>
                    </li>
                  ))}
              </ul>
            </div>
            <div className="text-muted-foreground">
              {formatNumber(counts.mountain_peak)} mountain peaks, {formatNumber(counts.river)}{' '}
              rivers, {formatNumber(counts.underground_region)} cavern layers below.
            </div>
          </div>
        </Section>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/_app/legends/world/')({
  validateSearch: parseWorldSearch,
  component: WorldPage,
})
