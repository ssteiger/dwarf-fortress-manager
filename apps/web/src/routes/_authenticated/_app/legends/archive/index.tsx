import {
  DataTable,
  MultiSelect,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@fortress/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import * as React from 'react'

import { LegendsSprite } from '~/lib/df-assets/legends'
import { EVENT_CATEGORIES, yearSpan } from '~/lib/legends/events'
import { BROWSE_TABS, kindLabel, racePlural, titleCase, words } from '~/lib/legends/model'
import {
  type LegendsBrowseQuery,
  type LegendsHit,
  type LegendsSortKey,
  type LegendsWorldSummary,
  browseLegends,
} from '~/lib/legends/server'
import { EventsArchive, YearInput } from '../-components/EventsArchive'
import {
  LegendsShell,
  RecordLink,
  Section,
  parseWorldParam,
  recordName,
} from '../-components/LegendsChrome'
import { FilterChip } from '../-components/Timeline'

interface ArchiveSearch {
  world?: number
  archive?: string
  q?: string
  type?: string
  /** Figures: living or dead at export. */
  alive?: 'alive' | 'dead'
  /** Figures: mortals, gods, or forces. */
  nature?: 'mortal' | 'deity' | 'force'
  /** Figures: members of; sites: held by; events: involving. */
  civ?: number
  /** Figures: born between; events: happened between. */
  from?: number
  to?: number
  /** Events: category keys, comma separated. */
  cat?: string
  hf?: number
  site?: number
  artifact?: number
  order?: 'asc' | 'desc'
  page?: number
}

const EVENTS_TAB = { key: 'events', label: 'Events' } as const
const NONE_TYPE = '__none__'
const ANY = '__any__'

function parseList(raw: unknown): string[] {
  if (Array.isArray(raw))
    return raw.filter((value): value is string => typeof value === 'string' && value.length > 0)
  if (typeof raw === 'string' && raw)
    return raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  return []
}

function parseNumber(raw: unknown): number | undefined {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10)
  return Number.isFinite(n) ? n : undefined
}

function typeLabel(type: string | null): string {
  if (!type) return 'No type'
  return titleCase(words(type)) || type
}

function typeValue(type: string | null): string {
  return type ?? NONE_TYPE
}

const ARCHIVE_COLUMNS: (worldId: number) => ColumnDef<LegendsHit>[] = (worldId) => [
  {
    id: 'name',
    header: 'Name',
    accessorFn: (hit) => hit.name ?? '',
    meta: { cellClassName: 'max-w-[320px]' },
    cell: ({ row }) => (
      <span className="flex items-center gap-2">
        <LegendsSprite subject={row.original} size={24} className="-my-1" />
        <RecordLink
          kind={row.original.kind}
          id={row.original.id}
          name={row.original.name}
          type={row.original.type}
          worldId={worldId}
        >
          {recordName(row.original)}
        </RecordLink>
      </span>
    ),
  },
  {
    id: 'type',
    header: 'Type',
    accessorFn: (hit) => hit.type ?? '',
    meta: { cellClassName: 'text-sm text-muted-foreground' },
    cell: ({ row }) =>
      row.original.kind === 'historical_figure'
        ? row.original.type
          ? words(row.original.type)
          : '—'
        : [kindLabel(row.original.kind), row.original.type ? words(row.original.type) : null]
            .filter(Boolean)
            .join(' · '),
  },
  {
    id: 'detail',
    header: 'Details',
    accessorFn: (hit) => hit.detail ?? '',
    enableSorting: false,
    meta: { cellClassName: 'text-sm text-muted-foreground' },
    cell: ({ row }) => row.original.detail || '—',
  },
  {
    id: 'year',
    header: 'Years',
    accessorFn: (hit) => hit.year,
    meta: { align: 'right', cellClassName: 'tabular-nums text-sm' },
    cell: ({ row }) => yearSpan(row.original.year, row.original.endYear) || '—',
  },
  {
    id: 'events',
    header: 'Events',
    accessorFn: (hit) => hit.events,
    meta: { align: 'right', cellClassName: 'tabular-nums text-sm' },
    cell: ({ row }) => (row.original.events == null ? '—' : row.original.events.toLocaleString()),
  },
]

/** The most storied first for figures; alphabetical elsewhere. */
function defaultSorting(tabKey: string): SortingState {
  return tabKey === 'figures' ? [{ id: 'events', desc: true }] : [{ id: 'name', desc: false }]
}

function ArchivePage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const setSearch = (patch: Partial<ArchiveSearch>, replace = false) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace })

  return (
    <LegendsShell section="archive" world={search.world}>
      {({ worldId, counts, summary }) => (
        <Section
          title="The archive"
          description="Every record in the export, and every recorded event. Search by name or race, narrow by what matters, sort by any column."
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {[...BROWSE_TABS.slice(0, -1), EVENTS_TAB, BROWSE_TABS[BROWSE_TABS.length - 1]].map(
                (t) => {
                  const kinds = 'kinds' in t ? t.kinds : ['historical_event']
                  const n = kinds.length
                    ? kinds.reduce((sum, kind) => sum + (counts[kind] ?? 0), 0)
                    : null
                  const showCount = n && !('types' in t && t.types)
                  return (
                    <FilterChip
                      key={t.key}
                      active={t.key === (search.archive ?? 'figures')}
                      onClick={() =>
                        navigate({
                          search: { world: worldId, archive: t.key },
                        })
                      }
                      count={showCount ? n : undefined}
                    >
                      {t.label}
                    </FilterChip>
                  )
                },
              )}
            </div>
            {search.archive === EVENTS_TAB.key ? (
              <EventsArchive
                worldId={worldId}
                years={summary?.years ?? null}
                filters={{
                  from: search.from,
                  to: search.to,
                  categories: parseList(search.cat),
                  hf: search.hf,
                  civ: search.civ,
                  site: search.site,
                  artifact: search.artifact,
                  order: search.order ?? 'asc',
                  page: search.page ?? 0,
                }}
                onChange={(patch) => {
                  const { categories, page, ...rest } = patch
                  setSearch({
                    ...rest,
                    ...(categories !== undefined
                      ? { cat: categories.length ? categories.join(',') : undefined }
                      : {}),
                    ...(page !== undefined ? { page: page || undefined } : {}),
                  })
                }}
              />
            ) : (
              <RecordsArchive
                worldId={worldId}
                summary={summary}
                archive={search.archive ?? 'figures'}
                q={search.q ?? ''}
                type={parseList(search.type)}
                facets={{
                  alive: search.alive,
                  nature: search.nature,
                  civ: search.civ,
                  from: search.from,
                  to: search.to,
                }}
                onQuery={(q) => setSearch({ q: q || undefined }, true)}
                onType={(type) => setSearch({ type: type.length ? type.join(',') : undefined })}
                onFacets={(patch) => setSearch(patch)}
              />
            )}
          </div>
        </Section>
      )}
    </LegendsShell>
  )
}

interface Facets {
  alive?: 'alive' | 'dead'
  nature?: 'mortal' | 'deity' | 'force'
  civ?: number
  from?: number
  to?: number
}

function RecordsArchive({
  worldId,
  summary,
  archive,
  q,
  type,
  facets,
  onQuery,
  onType,
  onFacets,
}: {
  worldId: number
  summary: LegendsWorldSummary | undefined
  archive: string
  q: string
  type: string[]
  facets: Facets
  onQuery: (q: string) => void
  onType: (type: string[]) => void
  onFacets: (patch: Partial<Facets>) => void
}) {
  const tab = BROWSE_TABS.find((t) => t.key === archive) ?? BROWSE_TABS[0]
  const [search, setSearchText] = React.useState(q)
  const [debounced, setDebounced] = React.useState(q)
  const [page, setPage] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(50)
  const [sorting, setSorting] = React.useState<SortingState>(() => defaultSorting(tab.key))

  React.useEffect(() => {
    setSearchText(q)
    setDebounced(q)
    setPage(0)
  }, [q])
  React.useEffect(() => {
    setSorting(defaultSorting(tab.key))
    setPage(0)
  }, [tab.key])

  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  React.useEffect(() => () => clearTimeout(timer.current ?? undefined), [])
  const onSearchInput = (value: string) => {
    setSearchText(value)
    setPage(0)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const next = value.trim()
      setDebounced(next)
      onQuery(next)
    }, 250)
  }

  const sortKey = (sorting[0]?.id ?? 'name') as LegendsSortKey
  const sortDir = sorting[0]?.desc ? 'desc' : 'asc'
  const isFigures = tab.key === 'figures'
  const isSites = tab.key === 'sites'

  const browseQuery: LegendsBrowseQuery = {
    worldId,
    kinds: tab.kinds,
    types: tab.types,
    type: type.length ? type : undefined,
    namedOnly: tab.namedOnly,
    q: debounced,
    page,
    pageSize,
    sortKey,
    sortDir,
    ...(isFigures
      ? { alive: facets.alive, nature: facets.nature, bornFrom: facets.from, bornTo: facets.to }
      : {}),
    ...(isFigures || isSites ? { entityId: facets.civ } : {}),
  }
  const results = useQuery({
    queryKey: ['legends', 'browse', browseQuery],
    queryFn: () => browseLegends({ data: browseQuery }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })

  const columns = React.useMemo(() => ARCHIVE_COLUMNS(worldId), [worldId])
  const typeOptions = React.useMemo(
    () =>
      (results.data?.types ?? []).map((row) => ({
        value: typeValue(row.type),
        label: `${typeLabel(row.type)} (${row.count.toLocaleString()})`,
      })),
    [results.data?.types],
  )
  const civilizations = React.useMemo(
    () => [...(summary?.civilizations ?? [])].sort((a, b) => b.sites - a.sites || a.id - b.id),
    [summary?.civilizations],
  )
  const setFacet = (patch: Partial<Facets>) => {
    setPage(0)
    onFacets(patch)
  }

  return (
    <>
      {isFigures || isSites ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
          {isFigures ? (
            <>
              <div className="flex items-center gap-1">
                {(
                  [
                    [undefined, 'Anyone'],
                    ['alive', 'Living'],
                    ['dead', 'Dead'],
                  ] as const
                ).map(([value, label]) => (
                  <FilterChip
                    key={label}
                    active={facets.alive === value}
                    onClick={() => setFacet({ alive: value })}
                  >
                    {label}
                  </FilterChip>
                ))}
              </div>
              <div className="flex items-center gap-1">
                {(
                  [
                    [undefined, 'All natures'],
                    ['mortal', 'Mortals'],
                    ['deity', 'Gods'],
                    ['force', 'Forces'],
                  ] as const
                ).map(([value, label]) => (
                  <FilterChip
                    key={label}
                    active={facets.nature === value}
                    onClick={() => setFacet({ nature: value })}
                  >
                    {label}
                  </FilterChip>
                ))}
              </div>
            </>
          ) : null}
          <Select
            value={facets.civ === undefined ? ANY : String(facets.civ)}
            onValueChange={(v) => setFacet({ civ: v === ANY ? undefined : Number(v) })}
          >
            <SelectTrigger className="h-9 w-[260px]" aria-label="Civilization">
              <SelectValue
                placeholder={isSites ? 'Held by any civilization' : 'Any civilization'}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>
                {isSites ? 'Held by any civilization' : 'Any civilization'}
              </SelectItem>
              {civilizations.map((civ) => (
                <SelectItem key={civ.id} value={String(civ.id)}>
                  {civ.name ? titleCase(civ.name) : `Civilization #${civ.id}`}
                  {civ.race ? ` · ${racePlural(civ.race)}` : ''}
                  {civ.sites ? ` · ${civ.sites} sites` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isFigures ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Born</span>
              <YearInput
                label="Born from year"
                value={facets.from}
                placeholder={summary?.years ? String(summary.years.min) : 'from'}
                onCommit={(from) => setFacet({ from })}
              />
              <span className="text-sm text-muted-foreground">to</span>
              <YearInput
                label="Born to year"
                value={facets.to}
                placeholder={summary?.years ? String(summary.years.max) : 'to'}
                onCommit={(to) => setFacet({ to })}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      <DataTable
        data={results.data?.rows ?? []}
        columns={columns}
        isLoading={results.isLoading}
        showSelectColumn={false}
        showActionsColumn={false}
        showToolbar={false}
        enableSortingRemoval={false}
        sorting={sorting}
        onSortingChange={(next) => {
          setSorting(next.length ? next : defaultSorting(tab.key))
          setPage(0)
        }}
        search={search}
        onSearch={onSearchInput}
        pagination={{ pageIndex: page, pageSize }}
        onPaginationChange={(next) => {
          setPage(next.pageIndex)
          setPageSize(next.pageSize)
        }}
        rowCount={results.data?.total ?? 0}
        getRowId={(hit) => `${hit.kind}-${hit.id}`}
        emptyState={{
          title: 'Nothing found',
          subtitle:
            debounced || type.length || Object.values(facets).some((v) => v !== undefined)
              ? 'Try another spelling, a race, a different type, or loosen a filter.'
              : 'This part of the archive is empty.',
        }}
        toolbar={
          typeOptions.length > 1 ? (
            <MultiSelect
              options={typeOptions}
              value={type}
              defaultValue={type}
              onValueChange={(next) => {
                const all = typeOptions.length > 0 && next.length === typeOptions.length
                onType(all ? [] : next)
                setPage(0)
              }}
              placeholder="All types"
              variant="secondary"
              maxCount={2}
              className="min-h-9 w-[min(100%,20rem)] border-input bg-background text-sm dark:bg-background"
              aria-label="Filter by type"
            />
          ) : null
        }
      />
    </>
  )
}

const ARCHIVE_KEYS = new Set([...BROWSE_TABS.map((t) => t.key), EVENTS_TAB.key])
const CATEGORY_KEYS = new Set(EVENT_CATEGORIES.map((c) => c.key))

export const Route = createFileRoute('/_authenticated/_app/legends/archive/')({
  validateSearch: (raw: Record<string, unknown>): ArchiveSearch => {
    const out: ArchiveSearch = {}
    const world = parseWorldParam(raw.world)
    if (world !== undefined) out.world = world
    if (typeof raw.archive === 'string' && ARCHIVE_KEYS.has(raw.archive)) out.archive = raw.archive
    if (typeof raw.q === 'string' && raw.q) out.q = raw.q
    const type = parseList(raw.type)
    if (type.length) out.type = type.join(',')
    if (raw.alive === 'alive' || raw.alive === 'dead') out.alive = raw.alive
    if (raw.nature === 'mortal' || raw.nature === 'deity' || raw.nature === 'force')
      out.nature = raw.nature
    for (const key of ['civ', 'from', 'to', 'hf', 'site', 'artifact', 'page'] as const) {
      const n = parseNumber(raw[key])
      if (n !== undefined) out[key] = n
    }
    const cat = parseList(raw.cat).filter((c) => CATEGORY_KEYS.has(c))
    if (cat.length) out.cat = cat.join(',')
    if (raw.order === 'asc' || raw.order === 'desc') out.order = raw.order
    return out
  },
  component: ArchivePage,
})
