import { Button, cn } from '@fortress/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  ArrowDownNarrowWideIcon,
  ArrowUpNarrowWideIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from 'lucide-react'
import * as React from 'react'

import { EVENT_CATEGORIES, eventCategory } from '~/lib/legends/events'
import { words } from '~/lib/legends/model'
import { getLegendsEvents } from '~/lib/legends/server'
import { EventLine, Section } from './LegendsChrome'

const PAGE_SIZE = 50

/**
 * Everything that happened to one record, as sentences, oldest first.
 * Filter by what kind of thing happened; page through the rest.
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

  const types = React.useMemo(
    () =>
      category === 'all' ? undefined : EVENT_CATEGORIES.find((c) => c.key === category)?.types,
    [category],
  )

  const query = useQuery({
    queryKey: ['legends', 'events', worldId, kind, id, category, order, page],
    queryFn: () =>
      getLegendsEvents({ data: { worldId, kind, id, page, pageSize: PAGE_SIZE, types, order } }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })

  const data = query.data
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

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

        {query.isLoading ? (
          <p className="text-sm text-muted-foreground">Reading the chronicles…</p>
        ) : !data?.events.length ? (
          <p className="text-sm text-muted-foreground">
            {categoryCounts.all
              ? 'Nothing of this kind is recorded.'
              : 'No recorded events mention this.'}
          </p>
        ) : (
          <ol className={cn('divide-y', query.isFetching && 'opacity-70')}>
            {data.events.map((event) => (
              <EventLine key={event.id} event={event} names={data.names} worldId={worldId} />
            ))}
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
