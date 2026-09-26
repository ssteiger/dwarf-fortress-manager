import { Button, Input, cn } from '@fortress/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  ArrowDownNarrowWideIcon,
  ArrowUpNarrowWideIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from 'lucide-react'
import * as React from 'react'

import { type EventSearchQuery, searchEvents } from '~/lib/legends/chronicle'
import { EVENT_CATEGORIES } from '~/lib/legends/events'
import { EventLine } from './LegendsChrome'
import { type PickedRecord, RecordPicker } from './QuickSearch'
import { FilterChip } from './Timeline'

const PAGE_SIZE = 50

/** The URL-borne state of the Events tab. */
export interface EventFilters {
  from?: number
  to?: number
  categories: string[]
  hf?: number
  civ?: number
  site?: number
  artifact?: number
  order: 'asc' | 'desc'
  page: number
}

const INVOLVEMENT: {
  key: 'hf' | 'civ' | 'site' | 'artifact'
  kind: string
  kinds: string[]
  placeholder: string
}[] = [
  { key: 'hf', kind: 'historical_figure', kinds: ['historical_figure'], placeholder: 'A figure' },
  { key: 'civ', kind: 'entity', kinds: ['entity'], placeholder: 'A civilization or group' },
  { key: 'site', kind: 'site', kinds: ['site'], placeholder: 'A site' },
  { key: 'artifact', kind: 'artifact', kinds: ['artifact'], placeholder: 'An artifact' },
]

export function YearInput({
  value,
  placeholder,
  onCommit,
  label,
}: {
  value: number | undefined
  placeholder: string
  onCommit: (next: number | undefined) => void
  label: string
}) {
  const [text, setText] = React.useState(value === undefined ? '' : String(value))
  React.useEffect(() => setText(value === undefined ? '' : String(value)), [value])
  const commit = () => {
    const n = Number.parseInt(text, 10)
    onCommit(Number.isFinite(n) ? n : undefined)
  }
  return (
    <Input
      type="number"
      inputMode="numeric"
      aria-label={label}
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
      className="h-9 w-24 tabular-nums"
    />
  )
}

/**
 * Every historical event in the world, searchable by years, by kind of
 * happening, and by who or where was involved. The rows are the same
 * sentences the record pages use, so every name is a link onward.
 */
export function EventsArchive({
  worldId,
  years,
  filters,
  onChange,
}: {
  worldId: number
  years: { min: number; max: number } | null
  filters: EventFilters
  onChange: (patch: Partial<EventFilters>) => void
}) {
  const query: EventSearchQuery = {
    worldId,
    from: filters.from,
    to: filters.to,
    categories: filters.categories.length ? filters.categories : undefined,
    hfid: filters.hf,
    entityId: filters.civ,
    siteId: filters.site,
    artifactId: filters.artifact,
    order: filters.order,
    page: filters.page,
    pageSize: PAGE_SIZE,
  }
  const results = useQuery({
    queryKey: ['legends', 'event-search', query],
    queryFn: () => searchEvents({ data: query }),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })
  const data = results.data
  const total = data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const allCount = Object.values(data?.byCategory ?? {}).reduce((a, b) => a + b, 0)

  // Names for the involvement chips come back with the events themselves.
  const picked = (key: (typeof INVOLVEMENT)[number]['key'], kind: string): PickedRecord | null => {
    const id = filters[key]
    if (id === undefined) return null
    return { kind, id, name: data?.names[kind]?.[id] ?? null }
  }
  const toggleCategory = (key: string) => {
    const has = filters.categories.includes(key)
    onChange({
      categories: has ? filters.categories.filter((c) => c !== key) : [...filters.categories, key],
      page: 0,
    })
  }
  const anyFilter =
    filters.from !== undefined ||
    filters.to !== undefined ||
    filters.categories.length > 0 ||
    filters.hf !== undefined ||
    filters.civ !== undefined ||
    filters.site !== undefined ||
    filters.artifact !== undefined

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Years</span>
          <YearInput
            label="From year"
            value={filters.from}
            placeholder={years ? String(years.min) : 'from'}
            onCommit={(from) => onChange({ from, page: 0 })}
          />
          <span className="text-sm text-muted-foreground">to</span>
          <YearInput
            label="To year"
            value={filters.to}
            placeholder={years ? String(years.max) : 'to'}
            onCommit={(to) => onChange({ to, page: 0 })}
          />
          <span className="ml-3 text-sm text-muted-foreground">Involving</span>
          {INVOLVEMENT.map((inv) => (
            <RecordPicker
              key={inv.key}
              worldId={worldId}
              kinds={inv.kinds}
              placeholder={inv.placeholder}
              value={picked(inv.key, inv.kind)}
              onChange={(next) => onChange({ [inv.key]: next?.id, page: 0 })}
            />
          ))}
          <div className="ml-auto flex items-center gap-2">
            {anyFilter ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onChange({
                    from: undefined,
                    to: undefined,
                    categories: [],
                    hf: undefined,
                    civ: undefined,
                    site: undefined,
                    artifact: undefined,
                    page: 0,
                  })
                }
              >
                Clear
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => onChange({ order: filters.order === 'asc' ? 'desc' : 'asc', page: 0 })}
            >
              {filters.order === 'asc' ? (
                <ArrowDownNarrowWideIcon className="size-3.5" />
              ) : (
                <ArrowUpNarrowWideIcon className="size-3.5" />
              )}
              {filters.order === 'asc' ? 'Oldest first' : 'Newest first'}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterChip
            active={filters.categories.length === 0}
            onClick={() => onChange({ categories: [], page: 0 })}
            count={data ? allCount : undefined}
          >
            Everything
          </FilterChip>
          {EVENT_CATEGORIES.map((c) => (
            <FilterChip
              key={c.key}
              active={filters.categories.includes(c.key)}
              onClick={() => toggleCategory(c.key)}
              count={data?.byCategory[c.key] ?? 0}
            >
              {c.label}
            </FilterChip>
          ))}
        </div>
      </div>

      {results.isLoading ? (
        <p className="text-sm text-muted-foreground">Reading the chronicles…</p>
      ) : !data?.events.length ? (
        <p className="text-sm text-muted-foreground">
          {anyFilter
            ? 'Nothing recorded matches all of these. Loosen a filter.'
            : 'No events are recorded.'}
        </p>
      ) : (
        <ol className={cn('divide-y', results.isFetching && 'opacity-70')}>
          {data.events.map((event) => (
            <EventLine key={event.id} event={event} names={data.names} worldId={worldId} />
          ))}
        </ol>
      )}

      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span className="tabular-nums">
          {total
            ? `Showing ${(filters.page * PAGE_SIZE + 1).toLocaleString()}–${Math.min(
                (filters.page + 1) * PAGE_SIZE,
                total,
              ).toLocaleString()} of ${total.toLocaleString()} events`
            : ''}
        </span>
        {pageCount > 1 ? (
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="outline"
              className="size-8"
              disabled={filters.page === 0}
              onClick={() => onChange({ page: filters.page - 1 })}
            >
              <ChevronLeftIcon className="size-4" />
              <span className="sr-only">Previous page</span>
            </Button>
            <span className="tabular-nums">
              {filters.page + 1} / {pageCount.toLocaleString()}
            </span>
            <Button
              size="icon"
              variant="outline"
              className="size-8"
              disabled={filters.page + 1 >= pageCount}
              onClick={() => onChange({ page: filters.page + 1 })}
            >
              <ChevronRightIcon className="size-4" />
              <span className="sr-only">Next page</span>
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
