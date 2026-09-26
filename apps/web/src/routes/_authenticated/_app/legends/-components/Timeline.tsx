import type { LegendsRecord } from '@fortress/db-drizzle'
import { Button, cn } from '@fortress/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ArrowDownNarrowWideIcon,
  ArrowUpNarrowWideIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon,
} from 'lucide-react'
import * as React from 'react'

import { EVENT_CATEGORIES, ROUTINE_TYPES, eventCategory, yearSpan } from '~/lib/legends/events'
import { words } from '~/lib/legends/model'
import { type NameIndex, getLegendsEvents } from '~/lib/legends/server'
import { EventLine, Section } from './LegendsChrome'

const PAGE_SIZE = 40

/** Types whose back-to-back repeats fold into one row. */
const FOLDABLE = new Set([...ROUTINE_TYPES, 'creature devoured'])

type TimelineRow = { event: LegendsRecord } | { run: LegendsRecord[] }

/** Same gathering, same place, same hosts: one row with a count. */
function runKey(event: LegendsRecord): string | null {
  if (!event.type || !FOLDABLE.has(event.type)) return null
  return `${event.type}|${(event.site_ids ?? []).join(',')}|${(event.entity_ids ?? []).join(',')}`
}

function foldRuns(events: LegendsRecord[], min = 3): TimelineRow[] {
  const rows: TimelineRow[] = []
  let i = 0
  while (i < events.length) {
    const key = runKey(events[i])
    let j = i + 1
    if (key) while (j < events.length && runKey(events[j]) === key) j++
    if (j - i >= min) rows.push({ run: events.slice(i, j) })
    else for (let k = i; k < j; k++) rows.push({ event: events[k] })
    i = j
  }
  return rows
}

function EventRun({
  events,
  names,
  worldId,
}: {
  events: LegendsRecord[]
  names: NameIndex
  worldId: number
}) {
  const [open, setOpen] = React.useState(false)
  const first = events[0]
  const last = events[events.length - 1]
  if (open) {
    return (
      <>
        {events.map((event) => (
          <EventLine key={event.id} event={event} names={names} worldId={worldId} />
        ))}
        <li className="py-1.5 pl-[calc(6.5rem+1rem)]">
          <button
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground hover:underline"
            onClick={() => setOpen(false)}
          >
            Fold these {events.length} back into one line
          </button>
        </li>
      </>
    )
  }
  return (
    <EventLine
      event={first}
      names={names}
      worldId={worldId}
      pinnable={false}
      dateLabel={yearSpan(first.year, last.year)}
      after={
        <button
          type="button"
          className="ml-2 inline-flex items-center rounded-full border px-2 py-px align-baseline text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={() => setOpen(true)}
          title="Show each of them"
        >
          and {events.length - 1} more like it
        </button>
      }
    />
  )
}

/** Which events-archive filter a record kind maps to. */
const EVENTS_FILTER: Record<string, 'hf' | 'civ' | 'site' | 'artifact'> = {
  historical_figure: 'hf',
  entity: 'civ',
  site: 'site',
  artifact: 'artifact',
}

/**
 * Everything that happened to one record, as sentences, oldest first.
 * Filter by what kind of thing happened; page through the rest. Routine
 * gatherings are skipped until asked for, except on the gathering itself.
 */
export function Timeline({
  worldId,
  kind,
  id,
  title = 'History',
  description,
}: {
  worldId: number
  kind: string
  id: number
  title?: string
  description?: string
}) {
  const [category, setCategory] = React.useState<string>('all')
  const [order, setOrder] = React.useState<'asc' | 'desc'>('asc')
  const [page, setPage] = React.useState(0)
  const [showRoutine, setShowRoutine] = React.useState(kind === 'historical_event_collection')

  const types = React.useMemo(
    () =>
      category === 'all' ? undefined : EVENT_CATEGORIES.find((c) => c.key === category)?.types,
    [category],
  )
  const excludeTypes = showRoutine ? undefined : ROUTINE_TYPES

  const query = useQuery({
    queryKey: ['legends', 'events', worldId, kind, id, category, order, page, showRoutine],
    queryFn: () =>
      getLegendsEvents({
        data: { worldId, kind, id, page, pageSize: PAGE_SIZE, types, excludeTypes, order },
      }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })

  const data = query.data
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const rows = React.useMemo(() => foldRuns(data?.events ?? []), [data?.events])

  // Routine events within the chosen category, so the note can say what it hides.
  const routineCount = React.useMemo(() => {
    let n = 0
    for (const type of ROUTINE_TYPES) {
      if (types && !types.includes(type)) continue
      n += data?.byType[type] ?? 0
    }
    return n
  }, [data?.byType, types])
  const toggleRoutine = () => {
    setShowRoutine((v) => !v)
    setPage(0)
  }

  const categoryCounts = React.useMemo(() => {
    const counts: Record<string, number> = { all: 0 }
    for (const [type, count] of Object.entries(data?.byType ?? {})) {
      counts.all += count
      const key = eventCategory(type)?.key ?? 'other'
      counts[key] = (counts[key] ?? 0) + count
    }
    return counts
  }, [data?.byType])

  const otherTypes = React.useMemo(
    () => Object.keys(data?.byType ?? {}).filter((type) => !eventCategory(type)),
    [data?.byType],
  )

  const pick = (next: string) => {
    setCategory(next)
    setPage(0)
  }

  return (
    <Section
      title={title}
      count={categoryCounts.all || null}
      description={description}
      action={
        <div className="flex flex-wrap items-center gap-1.5">
          {EVENTS_FILTER[kind] ? (
            <Button asChild size="sm" variant="ghost" className="gap-1.5">
              <Link
                to="/legends/archive"
                search={{ world: worldId, archive: 'events', [EVENTS_FILTER[kind]]: id }}
                title="Open in the events archive, to combine with years and other names"
              >
                <SearchIcon className="size-3.5" />
                Search these
              </Link>
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              setOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
              setPage(0)
            }}
          >
            {order === 'asc' ? (
              <ArrowDownNarrowWideIcon className="size-3.5" />
            ) : (
              <ArrowUpNarrowWideIcon className="size-3.5" />
            )}
            {order === 'asc' ? 'Oldest first' : 'Newest first'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <FilterChip
            active={category === 'all'}
            onClick={() => pick('all')}
            count={categoryCounts.all}
          >
            Everything
          </FilterChip>
          {EVENT_CATEGORIES.filter((c) => categoryCounts[c.key]).map((c) => (
            <FilterChip
              key={c.key}
              active={category === c.key}
              onClick={() => pick(c.key)}
              count={categoryCounts[c.key]}
            >
              {c.label}
            </FilterChip>
          ))}
        </div>

        {routineCount > 0 && (showRoutine ? kind !== 'historical_event_collection' : total > 0) ? (
          <p className="-mt-1 text-sm text-muted-foreground">
            {showRoutine
              ? `Showing ${routineCount.toLocaleString()} routine gatherings. `
              : `Skipping ${routineCount.toLocaleString()} routine gatherings: competitions, gambling, performances, ceremonies and processions. `}
            <button
              type="button"
              className="text-primary underline-offset-4 hover:underline"
              onClick={toggleRoutine}
            >
              {showRoutine ? 'Skip them' : 'Show them'}
            </button>
          </p>
        ) : null}

        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">Reading the chronicles…</p>
        ) : !data?.events.length ? (
          <p className="text-sm text-muted-foreground">
            {!showRoutine && routineCount > 0 ? (
              <>
                Only routine gatherings are recorded here ({routineCount.toLocaleString()}).{' '}
                <button
                  type="button"
                  className="text-primary underline-offset-4 hover:underline"
                  onClick={toggleRoutine}
                >
                  Show them
                </button>
              </>
            ) : categoryCounts.all ? (
              'Nothing of this kind is recorded.'
            ) : (
              'No recorded events mention this.'
            )}
          </p>
        ) : (
          <ol className={cn('divide-y', query.isFetching && 'opacity-70')}>
            {rows.map((row) =>
              'run' in row ? (
                <EventRun
                  key={`run-${row.run[0].id}`}
                  events={row.run}
                  names={data.names}
                  worldId={worldId}
                />
              ) : (
                <EventLine
                  key={row.event.id}
                  event={row.event}
                  names={data.names}
                  worldId={worldId}
                />
              ),
            )}
          </ol>
        )}

        {otherTypes.length && category === 'all' ? (
          <p className="text-xs text-muted-foreground">
            Also recorded: {otherTypes.map((t) => `${words(t)} (${data?.byType[t]})`).join(', ')}.
          </p>
        ) : null}

        {pageCount > 1 ? (
          <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
            <span className="tabular-nums">
              Showing {(page * PAGE_SIZE + 1).toLocaleString()}–
              {Math.min((page + 1) * PAGE_SIZE, total).toLocaleString()} of {total.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="outline"
                className="size-8"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeftIcon className="size-4" />
                <span className="sr-only">Previous page</span>
              </Button>
              <span className="tabular-nums">
                {page + 1} / {pageCount}
              </span>
              <Button
                size="icon"
                variant="outline"
                className="size-8"
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRightIcon className="size-4" />
                <span className="sr-only">Next page</span>
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Section>
  )
}

export function FilterChip({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean
  onClick: () => void
  count?: number
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors hover:bg-accent',
        active && 'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
      )}
    >
      {children}
      {typeof count === 'number' ? (
        <span className={cn('tabular-nums', active ? 'opacity-80' : 'text-muted-foreground')}>
          {count.toLocaleString()}
        </span>
      ) : null}
    </button>
  )
}
