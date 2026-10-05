import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  Input,
  Skeleton,
  cn,
} from '@fortress/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { format, isToday, isYesterday } from 'date-fns'
import {
  BookOpenIcon,
  CircleAlertIcon,
  CopyIcon,
  InfoIcon,
  MoonIcon,
  PlugIcon,
  SearchIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { useDumpState } from '~/lib/fortress/queries'
import {
  LOG_FILTERS,
  type LogEntry,
  type LogFilter,
  buildEntries,
  burstLabel,
  copyText,
  headline,
  isProblem,
  matchesFilter,
  matchesSearch,
  openProblem,
  overLabel,
} from '~/lib/logs/model'
import { getWorkerLogs } from '~/lib/logs/server'
import { EmptyState, PageHeader } from '../fortress/-components/FortChrome'

const PAGE_SIZE = 500
const REFRESH_INTERVAL_MS = 10_000

/** Backticks in a hint mark a command or a setting. */
function WithCode({ text }: { text: string }) {
  return (
    <>
      {text.split('`').map((part, i) =>
        i % 2 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed string
          <code key={i} className="rounded bg-muted px-1 py-0.5 text-xs">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  )
}

function entryIcon(entry: LogEntry): { Icon: typeof InfoIcon; label: string; className: string } {
  if (entry.level === 'error')
    return { Icon: CircleAlertIcon, label: 'Error', className: 'text-red-600 dark:text-red-400' }
  if (entry.level === 'warning')
    return {
      Icon: TriangleAlertIcon,
      label: 'Warning',
      className: 'text-amber-600 dark:text-amber-400',
    }
  if (entry.kind === 'connected')
    return {
      Icon: PlugIcon,
      label: 'Connected',
      className: 'text-emerald-600 dark:text-emerald-400',
    }
  if (entry.kind === 'menu')
    return { Icon: MoonIcon, label: 'On a menu', className: 'text-muted-foreground' }
  if (entry.source === 'legends')
    return { Icon: BookOpenIcon, label: 'Legends', className: 'text-muted-foreground' }
  return { Icon: InfoIcon, label: 'Note', className: 'text-muted-foreground' }
}

async function copyEntry(entry: LogEntry) {
  try {
    await navigator.clipboard.writeText(copyText(entry))
    toast.success('Copied the line as the worker wrote it')
  } catch {
    toast.error('The clipboard would not take it.')
  }
}

function EntryRow({ entry }: { entry: LogEntry }) {
  const { Icon, label, className } = entryIcon(entry)
  const problem = isProblem(entry)
  const over = overLabel(entry)
  const burst = burstLabel(entry)
  const at = entry.at ? new Date(entry.at) : null
  const first = entry.firstAt && entry.count > 1 ? new Date(entry.firstAt) : null
  return (
    <li className="group flex items-start gap-3 py-2.5">
      <time
        dateTime={entry.at ?? undefined}
        title={
          at
            ? `${format(at, 'EEE d MMM yyyy, HH:mm:ss')}${first ? ` (first at ${format(first, 'HH:mm:ss')})` : ''}`
            : undefined
        }
        className="w-11 shrink-0 pt-0.5 text-sm text-muted-foreground tabular-nums"
      >
        {at ? format(at, 'HH:mm') : '—'}
      </time>
      <Icon
        role="img"
        aria-label={label}
        className={cn('mt-1 size-4 shrink-0', over ? 'text-muted-foreground' : className)}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={cn('break-words', problem && !over && 'font-medium')}>
            {entry.title}
          </span>
          {burst ? (
            <Badge variant="secondary" className="tabular-nums">
              {burst}
            </Badge>
          ) : null}
        </p>
        {entry.detail ? (
          <p className="text-sm break-words text-muted-foreground">
            {problem ? `“${entry.detail}”` : entry.detail}
          </p>
        ) : null}
        {over ? (
          <p className="text-sm text-muted-foreground">{over}</p>
        ) : entry.hint ? (
          <p className="max-w-prose text-sm">
            <WithCode text={entry.hint} />
          </p>
        ) : null}
      </div>
      <Button
        size="icon"
        variant="ghost"
        className="size-7 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        aria-label="Copy the line as the worker wrote it"
        title="Copy the line as the worker wrote it"
        onClick={() => void copyEntry(entry)}
      >
        <CopyIcon className="size-3.5" />
      </Button>
    </li>
  )
}

function dayLabel(date: Date): string {
  if (isToday(date)) return 'Today'
  if (isYesterday(date)) return 'Yesterday'
  return format(
    date,
    date.getFullYear() === new Date().getFullYear() ? 'EEEE d MMMM' : 'EEEE d MMMM yyyy',
  )
}

function byDay(entries: LogEntry[]): { key: string; label: string; entries: LogEntry[] }[] {
  const days: { key: string; label: string; entries: LogEntry[] }[] = []
  for (const entry of entries) {
    const date = entry.at ? new Date(entry.at) : null
    const key = date ? format(date, 'yyyy-MM-dd') : 'unknown'
    let day = days[days.length - 1]
    if (day?.key !== key) {
      day = { key, label: date ? dayLabel(date) : 'When is not known', entries: [] }
      days.push(day)
    }
    day.entries.push(entry)
  }
  return days
}

/** The newest problem, while nothing good has been heard since. */
function OpenProblem({ entry }: { entry: LogEntry }) {
  return (
    <Alert variant={entry.level === 'error' ? 'destructive' : 'default'}>
      {entry.level === 'error' ? (
        <CircleAlertIcon className="size-4" />
      ) : (
        <TriangleAlertIcon className="size-4" />
      )}
      <AlertTitle>{entry.title}</AlertTitle>
      <AlertDescription>
        {entry.detail ? <p>The worker said “{entry.detail}”.</p> : null}
        {entry.hint ? (
          <p>
            <WithCode text={entry.hint} />
          </p>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}

function FilterChips({
  current,
  counts,
}: {
  current: LogFilter
  counts: Record<LogFilter, number>
}) {
  const shown = (Object.keys(LOG_FILTERS) as LogFilter[]).filter(
    (key) => key === 'all' || key === 'problems' || key === current || counts[key] > 0,
  )
  return (
    <nav aria-label="Which entries to show" className="flex flex-wrap gap-2">
      {shown.map((key) => (
        <Link
          key={key}
          to="/activity-logs"
          search={(prev) => ({ ...prev, show: key === 'all' ? undefined : key })}
          replace
          aria-current={current === key ? 'true' : undefined}
          className={cn(
            'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-accent',
            current === key &&
              'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
          )}
        >
          {LOG_FILTERS[key]}
          <span
            className={cn(
              'tabular-nums',
              current === key ? 'text-primary-foreground/70' : 'text-muted-foreground',
            )}
          >
            {counts[key]}
          </span>
        </Link>
      ))}
    </nav>
  )
}

function WorkerLogsPage() {
  const { show = 'all' } = Route.useSearch()
  const [limit, setLimit] = React.useState(PAGE_SIZE)
  const [search, setSearch] = React.useState('')
  const q = React.useDeferredValue(search)

  const query = useQuery({
    queryKey: ['worker-logs', limit],
    queryFn: () => getWorkerLogs({ data: { limit } }),
    refetchInterval: REFRESH_INTERVAL_MS,
    placeholderData: keepPreviousData,
  })
  const dump = useDumpState()

  const entries = React.useMemo(
    () => buildEntries(query.data?.rows ?? [], query.data?.commandDoneAt ?? null),
    [query.data],
  )
  const counts = React.useMemo(() => {
    const out = { all: 0, problems: 0, game: 0, commands: 0, legends: 0 }
    for (const entry of entries) {
      for (const key of Object.keys(out) as LogFilter[]) {
        if (matchesFilter(entry, key)) out[key]++
      }
    }
    return out
  }, [entries])
  const shown = React.useMemo(
    () => entries.filter((e) => matchesFilter(e, show) && matchesSearch(e, q)),
    [entries, show, q],
  )
  const days = React.useMemo(() => byDay(shown), [shown])
  const open = openProblem(entries)

  const worker = dump.data
    ? { running: dump.data.workerRunning, seenAt: dump.data.workerSeenAt, status: dump.data.status }
    : null

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        title="Worker logs"
        description={
          <>
            {query.data
              ? headline(entries, worker)
              : 'What the worker notes on its own: connecting to the game and losing it, legends imports, and anything that went wrong.'}{' '}
            <Link
              to="/settings/connection"
              className="text-foreground underline underline-offset-4 hover:text-primary"
            >
              How it is set up
            </Link>
          </>
        }
        updatedAt={query.dataUpdatedAt || null}
        isFetching={query.isFetching}
        onRefresh={() => void query.refetch()}
      />

      {open ? <OpenProblem entry={open} /> : null}

      {query.isError && !query.data ? (
        <Alert variant="destructive">
          <CircleAlertIcon className="size-4" />
          <AlertTitle>Could not read the worker logs</AlertTitle>
          <AlertDescription>
            <p>{query.error.message}</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              {query.isFetching ? 'Trying…' : 'Try again now'}
            </Button>
          </AlertDescription>
        </Alert>
      ) : !query.data ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : !entries.length ? (
        <EmptyState title="The worker has not written anything yet">
          Start it with{' '}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">bun run dev:worker</code> while
          Dwarf Fortress runs with DFHack. It notes here when it connects.
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <FilterChips current={show} counts={counts} />
            <div className="relative w-full lg:max-w-xs">
              <SearchIcon className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search the logs"
                aria-label="Search the logs"
                className="pl-9"
              />
            </div>
          </div>

          {days.length ? (
            <Card className="gap-0 px-4 py-2">
              {days.map((day) => (
                <section key={day.key} aria-labelledby={`day-${day.key}`} className="py-2">
                  <h2 id={`day-${day.key}`} className="text-sm font-semibold text-muted-foreground">
                    {day.label}
                  </h2>
                  <ul className="flex flex-col divide-y">
                    {day.entries.map((entry) => (
                      <EntryRow key={entry.id} entry={entry} />
                    ))}
                  </ul>
                </section>
              ))}
            </Card>
          ) : (
            <EmptyState title="Nothing matches">
              {q.trim()
                ? `No entry mentions “${q.trim()}”${show === 'all' ? '' : ` under ${LOG_FILTERS[show]}`}.`
                : `Nothing under ${LOG_FILTERS[show]} in the newest ${limit.toLocaleString()} lines.`}
            </EmptyState>
          )}

          {query.data.hasMore ? (
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span>Showing the newest {limit.toLocaleString()} lines.</span>
              <Button
                size="sm"
                variant="outline"
                disabled={query.isFetching}
                onClick={() => setLimit((n) => n + PAGE_SIZE)}
              >
                {query.isFetching ? 'Loading…' : 'Show older entries'}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

const FILTER_KEYS = Object.keys(LOG_FILTERS) as LogFilter[]

export const Route = createFileRoute('/_authenticated/_app/activity-logs/')({
  validateSearch: (raw: Record<string, unknown>): { show?: LogFilter } =>
    typeof raw.show === 'string' &&
    raw.show !== 'all' &&
    FILTER_KEYS.includes(raw.show as LogFilter)
      ? { show: raw.show as LogFilter }
      : {},
  component: WorkerLogsPage,
})
