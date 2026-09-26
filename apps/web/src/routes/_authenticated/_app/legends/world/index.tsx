import { Card, Tabs, TabsContent, TabsList, TabsTrigger, cn } from '@fortress/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowDownRightIcon, ArrowUpRightIcon } from 'lucide-react'
import * as React from 'react'

import { useDfAssets } from '~/lib/df-assets'
import { LegendsSprite, TerrainChip, TileChip } from '~/lib/df-assets/legends'
import { formatNumber } from '~/lib/fortress/format'
import { getSiteHistory, getSpanDigest } from '~/lib/legends/chronicle'
import {
  raceColor,
  racePlural,
  raceToken,
  regionColor,
  titleCase,
  words,
} from '~/lib/legends/model'
import { summarizeSpan } from '~/lib/legends/prose'
import { type LegendsWorldSummary, getLegendsMap } from '~/lib/legends/server'
import { changesBySite, holdingsAt, siteStatesAt } from '~/lib/legends/timeline'
import { siteSpriteNameFor } from '~/lib/legends/worldTiles'
import {
  EventLine,
  LegendsShell,
  RecordLink,
  Section,
  parseWorldParam,
} from '../-components/LegendsChrome'
import { type PlaybackSpeed, TimeSlider } from '../-components/TimeSlider'
import { WorldMap } from '../-components/WorldMap'

interface WorldSearch {
  world?: number
  year?: number
  /** Civilization whose sites are lit on the map. */
  civ?: number
}

type Panel = 'year' | 'civs' | 'land'

function WorldPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  return (
    <LegendsShell section="world" world={search.world}>
      {({ worldId, summary, counts }) => (
        <WorldBody
          worldId={worldId}
          summary={summary}
          counts={counts}
          year={search.year}
          onYear={(year) => navigate({ search: (prev) => ({ ...prev, year }), replace: true })}
          civ={search.civ ?? null}
          onCiv={(civ) =>
            navigate({ search: (prev) => ({ ...prev, civ: civ ?? undefined }), replace: true })
          }
        />
      )}
    </LegendsShell>
  )
}

function WorldBody({
  worldId,
  summary,
  counts,
  year: requestedYear,
  onYear,
  civ,
  onCiv,
}: {
  worldId: number
  summary: LegendsWorldSummary | undefined
  counts: Record<string, number>
  year: number | undefined
  onYear: (year: number | undefined) => void
  civ: number | null
  onCiv: (civ: number | null) => void
}) {
  const navigate = useNavigate()
  const assets = useDfAssets()
  const [panel, setPanel] = React.useState<Panel>('year')
  const toggleCiv = (id: number) => onCiv(civ === id ? null : id)
  const map = useQuery({
    queryKey: ['legends', 'map', worldId],
    queryFn: () => getLegendsMap({ data: { worldId } }),
    staleTime: 10 * 60_000,
  })
  const history = useQuery({
    queryKey: ['legends', 'site-history', worldId],
    queryFn: () => getSiteHistory({ data: { worldId } }),
    staleTime: 10 * 60_000,
  })

  const years = history.data?.years ?? summary?.years ?? null
  const present = years?.max ?? 0
  // The slider lives in local state while playing; the URL only follows when it stops.
  const [year, setYear] = React.useState<number>(requestedYear ?? present)
  const [playing, setPlaying] = React.useState(false)
  const [speed, setSpeed] = React.useState<PlaybackSpeed>(20)
  React.useEffect(() => {
    if (!playing) setYear(requestedYear ?? present)
  }, [requestedYear, present, playing])

  // The loop keeps its own accumulator so a year change does not restart it.
  const yearRef = React.useRef(year)
  yearRef.current = year
  const onYearRef = React.useRef(onYear)
  onYearRef.current = onYear
  React.useEffect(() => {
    if (!playing || !years) return
    let frame = 0
    let last = performance.now()
    let acc = yearRef.current
    const tick = (now: number) => {
      acc += ((now - last) / 1000) * speed
      last = now
      const next = Math.min(Math.floor(acc), years.max)
      setYear(next)
      if (next >= years.max) {
        setPlaying(false)
        onYearRef.current(undefined)
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, speed, years])

  const commitYear = (next: number) => {
    setYear(next)
    if (!playing) onYear(years && next >= years.max ? undefined : next)
  }
  const stopPlaying = (next: boolean) => {
    setPlaying(next)
    if (!next) onYear(years && year >= years.max ? undefined : year)
  }

  const inThePast = years !== null && year < years.max
  const bySite = React.useMemo(
    () => (history.data ? changesBySite(history.data) : null),
    [history.data],
  )
  const states = React.useMemo(
    () => (map.data && bySite ? siteStatesAt(map.data.sites, bySite, year) : null),
    [map.data, bySite, year],
  )
  const earlierStates = React.useMemo(
    () =>
      map.data && bySite ? siteStatesAt(map.data.sites, bySite, Math.max(0, year - 50)) : null,
    [map.data, bySite, year],
  )
  const holdings = React.useMemo(() => (states ? holdingsAt(states) : null), [states])
  const earlierHoldings = React.useMemo(
    () => (earlierStates ? holdingsAt(earlierStates) : null),
    [earlierStates],
  )

  const highlight = React.useMemo(() => {
    if (civ === null || !map.data) return null
    if (states) {
      return new Set(
        map.data.sites
          .filter((s) => states.get(s.id)?.exists && states.get(s.id)?.civ === civ)
          .map((s) => s.id),
      )
    }
    return new Set(map.data.sites.filter((s) => s.civ === civ || s.owner === civ).map((s) => s.id))
  }, [civ, map.data, states])

  // What happened this year, once the slider rests.
  const [restingYear, setRestingYear] = React.useState(year)
  React.useEffect(() => {
    if (playing) return
    const timer = setTimeout(() => setRestingYear(year), 250)
    return () => clearTimeout(timer)
  }, [year, playing])
  const digest = useQuery({
    queryKey: ['legends', 'digest', worldId, restingYear, restingYear],
    queryFn: () => getSpanDigest({ data: { worldId, from: restingYear, to: restingYear } }),
    enabled: years !== null && !playing,
    placeholderData: keepPreviousData,
    staleTime: 10 * 60_000,
  })

  const openRecord = (kind: string, id: number) =>
    navigate({
      to: '/legends/$kind/$id',
      params: { kind, id: String(id) },
      search: { world: worldId },
    })

  const civs = React.useMemo(() => {
    const list = (summary?.civilizations ?? []).map((c) => ({
      ...c,
      held: holdings ? (holdings.get(c.id) ?? 0) : c.sites,
      before: earlierHoldings ? (earlierHoldings.get(c.id) ?? 0) : null,
    }))
    // Civilizations the summary does not know (long gone) but the year does.
    if (holdings && history.data) {
      for (const [id, held] of holdings) {
        if (list.some((c) => c.id === id)) continue
        const info = history.data.civs[id]
        if (info)
          list.push({
            id,
            name: info.name,
            race: info.race,
            sites: 0,
            wars: 0,
            held,
            before: earlierHoldings?.get(id) ?? null,
          })
      }
    }
    return list.sort((a, b) => b.held - a.held || (a.name ?? '').localeCompare(b.name ?? ''))
  }, [summary, holdings, earlierHoldings, history.data])
  const living = civs.filter((c) => c.held > 0)
  const fallen = civs.filter((c) => c.held === 0 && (inThePast ? c.sites > 0 || c.before : true))

  const lit = civ !== null ? (civs.find((c) => c.id === civ) ?? null) : null

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Section
        title={inThePast ? `The world in ${year}` : 'The known world'}
        description={
          map.data
            ? `${map.data.width}×${map.data.height} tiles, ${formatNumber(map.data.sites.length)} sites, ${formatNumber(map.data.regions.length)} regions. Scroll or pinch to zoom, drag to pan, double-click to zoom in. Click a site or region for details.`
            : 'Drawing the map…'
        }
      >
        <div className="flex flex-col gap-4">
          {years ? (
            <TimeSlider
              min={years.min}
              max={years.max}
              year={year}
              eras={summary?.eras ?? []}
              playing={playing}
              speed={speed}
              onYear={commitYear}
              onPlaying={stopPlaying}
              onSpeed={setSpeed}
            />
          ) : null}
          {civ !== null ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-muted/40 px-3 py-1.5 text-sm">
              <span
                className="inline-block size-2.5 shrink-0 rounded-full border border-black/30"
                style={{ backgroundColor: raceColor(lit?.race) }}
              />
              <span className="text-muted-foreground">Lighting the sites of</span>
              <RecordLink kind="entity" id={civ} name={lit?.name ?? null} worldId={worldId} />
              <span className="text-muted-foreground tabular-nums">
                {lit ? `${lit.held} site${lit.held === 1 ? '' : 's'}` : ''}
                {lit && inThePast ? ` in ${year}` : ''}
              </span>
              <button
                type="button"
                className="ml-auto text-muted-foreground hover:text-foreground hover:underline"
                onClick={() => onCiv(null)}
              >
                Clear
              </button>
            </div>
          ) : null}
          {map.data ? (
            <WorldMap
              data={map.data}
              highlightSites={highlight}
              year={history.data ? year : null}
              history={history.data ?? null}
              onSelectSite={(site) => openRecord('site', site.id)}
              onSelectRegion={(region) => openRecord('region', region.id)}
            />
          ) : (
            <div className="aspect-square w-full animate-pulse rounded-lg bg-muted" />
          )}
        </div>
      </Section>

      <Card className="gap-0 overflow-hidden py-0 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)]">
        <Tabs
          value={panel}
          onValueChange={(value) => setPanel(value as Panel)}
          className="min-h-0 flex-1 gap-0"
        >
          <div className="border-b p-3">
            <TabsList className="w-full">
              <TabsTrigger value="year" className="tabular-nums">
                {inThePast ? `Year ${year}` : 'The present'}
              </TabsTrigger>
              <TabsTrigger value="civs">
                Civilizations
                {living.length ? (
                  <span className="tabular-nums text-muted-foreground">{living.length}</span>
                ) : null}
              </TabsTrigger>
              <TabsTrigger value="land">The land</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="year" className="min-h-0 overflow-y-auto px-5 py-4">
            <PanelHeading
              title={inThePast ? `The year ${year}` : `The present, ${present}`}
              description={
                playing
                  ? 'Pause to read the year.'
                  : digest.data
                    ? 'What the records say about this year.'
                    : 'Reading the records…'
              }
              action={
                <Link
                  to="/legends/history"
                  search={{ world: worldId, from: Math.max(0, year - 24), to: year }}
                  className="shrink-0 text-sm text-primary underline-offset-4 hover:underline"
                >
                  Read the age
                </Link>
              }
            />
            {digest.data && !playing ? (
              <div className={cn('flex flex-col gap-3', digest.isPlaceholderData && 'opacity-60')}>
                <p className="text-sm leading-relaxed">{summarizeSpan(digest.data)}</p>
                {digest.data.moments.length ? (
                  <ol className="divide-y text-sm">
                    {digest.data.moments.slice(0, 8).map((event) => (
                      <EventLine
                        key={event.id}
                        event={event}
                        names={digest.data.names}
                        worldId={worldId}
                        showDate={false}
                      />
                    ))}
                  </ol>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {playing ? `Rolling forward at ${speed} years a second.` : 'Reading the records…'}
              </p>
            )}
          </TabsContent>

          <TabsContent value="civs" className="min-h-0 overflow-y-auto px-5 py-4">
            <PanelHeading
              description={
                inThePast
                  ? `Sites held in ${year}, and how that compares with fifty years before. Pick one to light its sites on the map.`
                  : 'Pick one to light its sites on the map.'
              }
            />
            {summary ? (
              <ul className="flex flex-col divide-y">
                {living.map((c) => {
                  const delta = c.before !== null ? c.held - c.before : 0
                  return (
                    <li key={c.id}>
                      <div
                        className={cn(
                          'flex items-center gap-3 rounded-md px-1 py-2 transition-colors',
                          civ === c.id && 'bg-accent',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => toggleCiv(c.id)}
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
                          <div className="flex items-center gap-1 text-sm text-muted-foreground">
                            {c.race ? racePlural(c.race) : 'unknown race'} · {c.held} site
                            {c.held === 1 ? '' : 's'}
                            {inThePast && delta !== 0 ? (
                              <span
                                className={cn(
                                  'inline-flex items-center gap-0.5 tabular-nums',
                                  delta > 0
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-red-600 dark:text-red-400',
                                )}
                                title="Change over the previous fifty years"
                              >
                                {delta > 0 ? (
                                  <ArrowUpRightIcon className="size-3.5" />
                                ) : (
                                  <ArrowDownRightIcon className="size-3.5" />
                                )}
                                {Math.abs(delta)}
                              </span>
                            ) : null}
                            {!inThePast && c.wars
                              ? ` · ${c.wars} war${c.wars === 1 ? '' : 's'}`
                              : ''}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleCiv(c.id)}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          {civ === c.id ? 'clear' : 'show'}
                        </button>
                      </div>
                    </li>
                  )
                })}
                {fallen.length ? (
                  <li className="pt-2 text-sm text-muted-foreground">
                    {fallen.length} civilization{fallen.length === 1 ? '' : 's'} hold no sites
                    {inThePast ? ` in ${year}` : ''}:{' '}
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
          </TabsContent>

          <TabsContent value="land" className="min-h-0 overflow-y-auto px-5 py-4">
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
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  )
}

function PanelHeading({
  title,
  description,
  action,
}: {
  title?: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div>
        {title ? <div className="font-semibold">{title}</div> : null}
        <p className={cn('text-sm text-muted-foreground', title && 'mt-0.5')}>{description}</p>
      </div>
      {action}
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/_app/legends/world/')({
  validateSearch: (raw: Record<string, unknown>): WorldSearch => {
    const out: WorldSearch = {}
    const world = parseWorldParam(raw.world)
    if (world !== undefined) out.world = world
    const year =
      typeof raw.year === 'number'
        ? raw.year
        : typeof raw.year === 'string'
          ? Number.parseInt(raw.year, 10)
          : Number.NaN
    if (Number.isFinite(year) && year >= 0) out.year = year
    const civ = parseWorldParam(raw.civ)
    if (civ !== undefined && civ >= 0) out.civ = civ
    return out
  },
  component: WorldPage,
})
