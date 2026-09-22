import { DataTable, MultiSelect } from '@fortress/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import * as React from 'react'

import { LegendsSprite } from '~/lib/df-assets/legends'
import { yearSpan } from '~/lib/legends/events'
import { BROWSE_TABS, kindLabel, titleCase, words } from '~/lib/legends/model'
import { type LegendsHit, type LegendsSortKey, browseLegends } from '~/lib/legends/server'
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
}

const NONE_TYPE = '__none__'

function parseTypeFilter(raw: unknown): string[] {
  if (Array.isArray(raw))
    return raw.filter((value): value is string => typeof value === 'string' && value.length > 0)
  if (typeof raw === 'string' && raw)
    return raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  return []
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
]

function ArchivePage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const setSearch = (patch: Partial<ArchiveSearch>, replace = false) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace })

  return (
    <LegendsShell section="archive" world={search.world}>
      {({ worldId, counts }) => (
        <ArchiveBody
          worldId={worldId}
          counts={counts}
          archive={search.archive ?? 'figures'}
          q={search.q ?? ''}
          type={parseTypeFilter(search.type)}
          onArchive={(archive) => setSearch({ archive, q: undefined, type: undefined })}
          onQuery={(q) => setSearch({ q: q || undefined }, true)}
          onType={(type) => setSearch({ type: type.length ? type.join(',') : undefined })}
        />
      )}
    </LegendsShell>
  )
}

function ArchiveBody({
  worldId,
  counts,
  archive,
  q,
  type,
  onArchive,
  onQuery,
  onType,
}: {
  worldId: number
  counts: Record<string, number>
  archive: string
  q: string
  type: string[]
  onArchive: (key: string) => void
  onQuery: (q: string) => void
  onType: (type: string[]) => void
}) {
  const tab = BROWSE_TABS.find((t) => t.key === archive) ?? BROWSE_TABS[0]
  const [search, setSearchText] = React.useState(q)
  const [debounced, setDebounced] = React.useState(q)
  const [page, setPage] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(50)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'name', desc: false }])

  React.useEffect(() => {
    setSearchText(q)
    setDebounced(q)
    setPage(0)
  }, [q])

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

  const results = useQuery({
    queryKey: [
      'legends',
      'browse',
      worldId,
      tab.key,
      debounced,
      type,
      page,
      pageSize,
      sortKey,
      sortDir,
    ],
    queryFn: () =>
      browseLegends({
        data: {
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
        },
      }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })

  const columns = React.useMemo(() => ARCHIVE_COLUMNS(worldId), [worldId])
  const tabCount = (t: (typeof BROWSE_TABS)[number]) =>
    t.kinds.length ? t.kinds.reduce((sum, kind) => sum + (counts[kind] ?? 0), 0) : null
  const typeOptions = React.useMemo(
    () =>
      (results.data?.types ?? []).map((row) => ({
        value: typeValue(row.type),
        label: `${typeLabel(row.type)} (${row.count.toLocaleString()})`,
      })),
    [results.data?.types],
  )

  return (
    <Section
      title="The archive"
      description="Every record in the export. Search by name or race; filter by type; sort by any column."
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {BROWSE_TABS.map((t) => {
            const n = tabCount(t)
            return (
              <FilterChip
                key={t.key}
                active={t.key === tab.key}
                onClick={() => {
                  onArchive(t.key)
                  setPage(0)
                }}
                count={n && !t.types ? n : undefined}
              >
                {t.label}
              </FilterChip>
            )
          })}
        </div>
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
            setSorting(next.length ? next : [{ id: 'name', desc: false }])
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
              debounced || type.length
                ? 'Try another spelling, a race, a different type, or a different part of the archive.'
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
      </div>
    </Section>
  )
}

export const Route = createFileRoute('/_authenticated/_app/legends/archive/')({
  validateSearch: (raw: Record<string, unknown>): ArchiveSearch => {
    const out: ArchiveSearch = {}
    const world = parseWorldParam(raw.world)
    if (world !== undefined) out.world = world
    if (typeof raw.archive === 'string' && BROWSE_TABS.some((t) => t.key === raw.archive))
      out.archive = raw.archive
    if (typeof raw.q === 'string' && raw.q) out.q = raw.q
    const type = parseTypeFilter(raw.type)
    if (type.length) out.type = type.join(',')
    return out
  },
  component: ArchivePage,
})
