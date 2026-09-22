import type { FortEvent } from '@fortress/db-drizzle'
import { Badge, Card, DataTable, cn } from '@fortress/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import * as React from 'react'

import { formatGameTick, humanize } from '~/lib/fortress/format'
import { FORT_REFRESH_MS, useFortOverview } from '~/lib/fortress/queries'
import { getFortEvents } from '~/lib/fortress/server'
import { PageHeader, StatusBanner } from '../-components/FortChrome'

type Filter = 'all' | 'notable' | 'cancellations' | 'combat'

const FILTERS: Record<Filter, string> = {
  all: 'Everything',
  notable: 'Notable',
  cancellations: 'Cancellations',
  combat: 'Combat & danger',
}

const COMBAT_RE =
  /ambush|siege|attack|struck|slain|dead|died|killed|fight|combat|thief|snatcher|forgotten beast|titan|megabeast|invader|dragon|goblin|kobold/i

function classify(event: FortEvent): Filter[] {
  const out: Filter[] = ['all']
  const text = event.text
  if (event.type === 'CANCEL_JOB' || / cancels /.test(text)) out.push('cancellations')
  else out.push('notable')
  if (COMBAT_RE.test(text) || (event.type ?? '').startsWith('COMBAT')) out.push('combat')
  return out
}

const EVENT_COLUMNS: ColumnDef<FortEvent>[] = [
  {
    id: 'when',
    header: 'When',
    accessorFn: (event) => (event.game_year ?? 0) * 1_000_000 + (event.game_tick ?? 0),
    meta: { cellClassName: 'whitespace-nowrap text-sm tabular-nums' },
    cell: ({ row }) =>
      formatGameTick(row.original.game_year, row.original.game_tick) || '—',
  },
  {
    id: 'text',
    header: 'Announcement',
    accessorFn: (event) => event.text,
    meta: { cellClassName: 'max-w-[52rem]' },
    cell: ({ row }) => {
      const combat = classify(row.original).includes('combat')
      return (
        <span className="flex items-start gap-2">
          {combat ? (
            <Badge variant="destructive" className="mt-0.5 shrink-0">
              !
            </Badge>
          ) : null}
          <span>{row.original.text}</span>
        </span>
      )
    },
  },
  {
    id: 'kind',
    header: 'Kind',
    accessorFn: (event) => event.type ?? '',
    meta: { cellClassName: 'whitespace-nowrap text-sm text-muted-foreground' },
    cell: ({ row }) => (row.original.type ? humanize(row.original.type) : '—'),
  },
]

function ChroniclePage() {
  const overview = useFortOverview()
  const [search, setSearch] = React.useState('')
  const [filter, setFilter] = React.useState<Filter>('notable')
  const [q, setQ] = React.useState('')
  React.useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(id)
  }, [search])

  const { data, isFetching, refetch, dataUpdatedAt } = useQuery({
    queryKey: ['fort', 'events', q],
    queryFn: () => getFortEvents({ data: { q, limit: 1500 } }),
    refetchInterval: FORT_REFRESH_MS,
    placeholderData: keepPreviousData,
  })

  const events = React.useMemo(
    () => (data ?? []).filter((event) => classify(event).includes(filter)),
    [data, filter],
  )

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        eyebrow="Fortress"
        title="Chronicle"
        description="Every announcement the game has made since the worker started, newest first."
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        onRefresh={() => refetch()}
      />
      <StatusBanner state={overview.data?.state} />

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
          {events.length.toLocaleString()} entries
        </span>
      </div>

      <Card className="overflow-hidden p-0">
        <DataTable
          data={events}
          columns={EVENT_COLUMNS}
          showSelectColumn={false}
          showActionsColumn={false}
          showToolbar={false}
          enableSortingRemoval={false}
          defaultSort={[{ id: 'when', desc: true }]}
          search={search}
          onSearch={setSearch}
          getRowId={(event) => String(event.id)}
          rowClassName={(event) =>
            classify(event).includes('cancellations') ? 'text-muted-foreground' : undefined
          }
          emptyState={{
            title: 'The chronicle is empty',
            subtitle: q
              ? 'Nothing matches this search.'
              : 'Announcements are recorded each time the worker dumps the game. Play a little and come back.',
          }}
        />
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/_app/fortress/chronicle/')({
  component: ChroniclePage,
})
