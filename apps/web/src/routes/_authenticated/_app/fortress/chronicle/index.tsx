import type { FortEvent } from '@fortress/db-drizzle'
import { Badge, Card, Input, cn } from '@fortress/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import * as React from 'react'

import { formatGameTick } from '~/lib/fortress/format'
import { FORT_REFRESH_MS, useFortOverview } from '~/lib/fortress/queries'
import { getFortEvents } from '~/lib/fortress/server'
import { EmptyState, PageHeader, StatusBanner } from '../-components/fort-chrome'

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
    () => (data ?? []).filter((e) => classify(e).includes(filter)),
    [data, filter],
  )

  // Group by in-game day so the chronicle reads like a journal.
  const days = React.useMemo(() => {
    const groups: { key: string; label: string; events: FortEvent[] }[] = []
    for (const event of events) {
      const label = formatGameTick(event.game_year, event.game_tick) || 'Unknown day'
      const last = groups[groups.length - 1]
      if (last && last.label === label) last.events.push(event)
      else groups.push({ key: `${label}-${event.id}`, label, events: [event] })
    }
    return groups
  }, [events])

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        eyebrow="Fortress"
        title="Chronicle"
        description="Every announcement the game has made since the worker started, newest first."
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        onRefresh={() => refetch()}
        actions={
          <Input
            placeholder="Search the chronicle…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-56"
          />
        }
      />
      <StatusBanner state={overview.data?.state} />

      <div className="flex flex-wrap gap-2">
        {(Object.keys(FILTERS) as Filter[]).map((key) => (
          <button
            type="button"
            key={key}
            onClick={() => setFilter(key)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs transition-colors hover:bg-accent',
              filter === key &&
                'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
            )}
          >
            {FILTERS[key]}
          </button>
        ))}
        <span className="self-center text-xs text-muted-foreground">
          {events.length.toLocaleString()} entries
        </span>
      </div>

      {days.length === 0 ? (
        <EmptyState title="The chronicle is empty">
          Announcements are recorded each time the worker dumps the game. Play a little and come
          back.
        </EmptyState>
      ) : (
        <Card className="p-0">
          <ol className="divide-y">
            {days.map((day) => (
              <li key={day.key} className="grid gap-2 p-4 sm:grid-cols-[160px_1fr]">
                <div className="text-sm font-semibold text-muted-foreground">{day.label}</div>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {day.events.map((event) => {
                    const cancel = classify(event).includes('cancellations')
                    const combat = classify(event).includes('combat')
                    return (
                      <li
                        key={event.id}
                        className={cn('flex items-start gap-2', cancel && 'text-muted-foreground')}
                      >
                        {combat ? (
                          <Badge variant="destructive" className="mt-0.5 shrink-0">
                            !
                          </Badge>
                        ) : null}
                        <span>{event.text}</span>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/_app/fortress/chronicle/')({
  component: ChroniclePage,
})
