import type { FortEvent, FortHistoryRow, FortUnit } from '@fortress/db-drizzle'
import { Badge, Card, DataTable, cn } from '@fortress/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import * as React from 'react'

import { formatGameTick, humanize } from '~/lib/fortress/format'
import { getFortHistory } from '~/lib/fortress/history'
import { historyEventParts, historyTone } from '~/lib/fortress/historyEvents'
import type { TextPart } from '~/lib/fortress/insights'
import { useFortOverview, useFortSeasons, useFortUnits } from '~/lib/fortress/queries'
import { getFortEvents } from '~/lib/fortress/server'
import { PageHeader, StatusBanner } from '../-components/FortChrome'
import { AnnouncementText } from '../-components/Insights'
import { useFortLegendsWorldId, useKnownHistFigures } from '../dwarves/-components/UnitLinks'
import { Seasons } from './-components/Seasons'

type Filter = 'all' | 'notable' | 'history' | 'cancellations' | 'combat'

const FILTERS: Record<Filter, string> = {
  all: 'Everything',
  notable: 'Notable',
  history: 'History',
  cancellations: 'Cancellations',
  combat: 'Combat & danger',
}

const COMBAT_RE =
  /ambush|siege|attack|struck|slain|dead|died|killed|fight|combat|thief|snatcher|forgotten beast|titan|megabeast|invader|dragon|goblin|kobold/i

/** An announcement, or an event from the world's history read live from the game. */
interface ChronicleRow {
  key: string
  year: number | null
  tick: number | null
  /** Plain text, for search. */
  text: string
  kind: string
  filters: Filter[]
  parts?: TextPart[]
}

function announcementRow(event: FortEvent): ChronicleRow {
  const filters: Filter[] = ['all']
  if (event.type === 'CANCEL_JOB' || / cancels /.test(event.text)) filters.push('cancellations')
  else filters.push('notable')
  if (COMBAT_RE.test(event.text) || (event.type ?? '').startsWith('COMBAT')) filters.push('combat')
  return {
    key: `a${event.id}`,
    year: event.game_year,
    tick: event.game_tick,
    text: event.text,
    kind: event.type ? humanize(event.type) : '',
    filters,
  }
}

function historyRow(event: FortHistoryRow, units: Map<number, FortUnit>): ChronicleRow {
  const parts = historyEventParts(event, units)
  const filters: Filter[] = ['all', 'notable', 'history']
  if (historyTone(event) === 'bad') filters.push('combat')
  return {
    key: `h${event.event_id}`,
    year: event.game_year,
    tick: event.game_tick,
    text: parts.map((p) => p.text).join(''),
    kind: 'History',
    filters,
    parts,
  }
}

function eventColumns(
  legends: { worldId: number; known: Set<number> } | null,
): ColumnDef<ChronicleRow>[] {
  return [
    {
      id: 'when',
      header: 'When',
      accessorFn: (row) => (row.year ?? 0) * 1_000_000 + (row.tick ?? 0),
      meta: { cellClassName: 'whitespace-nowrap text-sm tabular-nums' },
      cell: ({ row }) => formatGameTick(row.original.year, row.original.tick) || '—',
    },
    {
      id: 'text',
      header: 'Announcement',
      accessorFn: (row) => row.text,
      meta: { cellClassName: 'max-w-[52rem]' },
      cell: ({ row }) => {
        const combat = row.original.filters.includes('combat')
        return (
          <span className="flex items-start gap-2">
            {combat ? (
              <Badge variant="destructive" className="mt-0.5 shrink-0">
                !
              </Badge>
            ) : null}
            <span>
              {row.original.parts ? (
                <AnnouncementText parts={row.original.parts} legends={legends} />
              ) : (
                row.original.text
              )}
            </span>
          </span>
        )
      },
    },
    {
      id: 'kind',
      header: 'Kind',
      accessorFn: (row) => row.kind,
      meta: { cellClassName: 'whitespace-nowrap text-sm text-muted-foreground' },
      cell: ({ row }) => row.original.kind || '—',
    },
  ]
}

type View = 'entries' | 'seasons'

const VIEWS: Record<View, string> = {
  entries: 'Every entry',
  seasons: 'By season',
}

function ViewSwitch({ current }: { current: View }) {
  return (
    <nav aria-label="How to read the chronicle" className="flex w-fit rounded-lg border p-0.5">
      {(Object.keys(VIEWS) as View[]).map((key) => (
        <Link
          key={key}
          to="/fortress/chronicle"
          search={(prev) => ({ ...prev, view: key === 'entries' ? undefined : key })}
          aria-current={current === key ? 'page' : undefined}
          className={cn(
            'rounded-md px-3 py-1 text-sm transition-colors',
            current === key
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {VIEWS[key]}
        </Link>
      ))}
    </nav>
  )
}

function ChroniclePage() {
  const { view } = Route.useSearch()
  return view === 'seasons' ? <BySeason /> : <EveryEntry />
}

/** The fortress's book: a recap of each season. */
function BySeason() {
  const overview = useFortOverview()
  const seasons = useFortSeasons()
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        title="Chronicle"
        description="Each season of the fortress told in a few lines: who came and went, what happened, how their lives changed and what the world’s history records. Written from the announcements, the daily snapshots and the game’s own history."
        updatedAt={seasons.dataUpdatedAt}
        isFetching={seasons.isFetching}
        onRefresh={() => void seasons.refetch()}
      />
      <StatusBanner state={overview.data?.state} />
      <ViewSwitch current="seasons" />
      <Seasons />
    </div>
  )
}

function EveryEntry() {
  const overview = useFortOverview()
  const everyone = useFortUnits()
  const params = Route.useSearch()
  const [search, setSearch] = React.useState(params.q ?? '')
  const [filter, setFilter] = React.useState<Filter>(params.filter ?? 'notable')
  const [q, setQ] = React.useState((params.q ?? '').trim())
  React.useEffect(() => {
    setSearch(params.q ?? '')
    setFilter(params.filter ?? 'notable')
  }, [params.q, params.filter])
  React.useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(id)
  }, [search])

  const { data, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['fort', 'events', q],
    queryFn: () => getFortEvents({ data: { q, limit: 1500 } }),
    placeholderData: keepPreviousData,
  })
  const history = useQuery({
    queryKey: ['fort', 'history'],
    queryFn: () => getFortHistory({ data: { limit: 1000 } }),
  })
  const worldId = useFortLegendsWorldId()
  const known = useKnownHistFigures(
    worldId,
    React.useMemo(() => (history.data ?? []).flatMap((e) => e.hfids), [history.data]),
  )
  const legends = React.useMemo(
    () => (worldId !== null ? { worldId, known } : null),
    [worldId, known],
  )
  const columns = React.useMemo(() => eventColumns(legends), [legends])

  const rows = React.useMemo(() => {
    const units = new Map((everyone.data?.units ?? []).map((u) => [u.id, u]))
    const all = [
      ...(data ?? []).map(announcementRow),
      ...(history.data ?? []).map((e) => historyRow(e, units)),
    ]
    return all.filter((row) => row.filters.includes(filter))
  }, [data, history.data, everyone.data, filter])

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        title="Chronicle"
        description="Every announcement the game has made since the worker started, and what the world’s history records of the fortress and its people, newest first. Whatever loading an earlier save undid is left out."
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        onRefresh={() => {
          void refetch()
          void history.refetch()
        }}
      />
      <StatusBanner state={overview.data?.state} />
      <ViewSwitch current="entries" />

      <div className="flex flex-wrap gap-2">
        {(Object.keys(FILTERS) as Filter[]).map((key) => (
          <button
            type="button"
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-accent',
              filter === key &&
                'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
            )}
          >
            {FILTERS[key]}
          </button>
        ))}
        <span className="self-center text-sm text-muted-foreground">
          {rows.length.toLocaleString()} entries
        </span>
      </div>

      <Card className="overflow-hidden p-0">
        <DataTable
          data={rows}
          columns={columns}
          showSelectColumn={false}
          showActionsColumn={false}
          showToolbar={false}
          enableSortingRemoval={false}
          defaultSort={[{ id: 'when', desc: true }]}
          search={search}
          onSearch={setSearch}
          getRowId={(row) => row.key}
          rowClassName={(row) =>
            row.filters.includes('cancellations') ? 'text-muted-foreground' : undefined
          }
          emptyState={{
            title: filter === 'history' ? 'No history recorded yet' : 'The chronicle is empty',
            subtitle: q
              ? 'Nothing matches this search.'
              : filter === 'history'
                ? 'The worker reads the world’s history with each dump: masterpieces, artifacts, marriages, deaths and offices. Restart the worker so the game runs the new dump script.'
                : 'Announcements are recorded each time the worker dumps the game. Play a little and come back.',
          }}
        />
      </Card>
    </div>
  )
}

interface ChronicleSearch {
  q?: string
  filter?: Filter
  view?: 'seasons'
}

export const Route = createFileRoute('/_authenticated/_app/fortress/chronicle/')({
  validateSearch: (raw: Record<string, unknown>): ChronicleSearch => {
    const out: ChronicleSearch = {}
    if (typeof raw.q === 'string' && raw.q) out.q = raw.q
    if (raw.view === 'seasons') out.view = 'seasons'
    if (
      raw.filter === 'all' ||
      raw.filter === 'notable' ||
      raw.filter === 'history' ||
      raw.filter === 'cancellations' ||
      raw.filter === 'combat'
    )
      out.filter = raw.filter
    return out
  },
  component: ChroniclePage,
})
