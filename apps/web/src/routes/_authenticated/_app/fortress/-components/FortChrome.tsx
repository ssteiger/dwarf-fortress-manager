import type { FortState, FortUnit } from '@fortress/db-drizzle'
import { DUMP_VERSION } from '@fortress/db-drizzle/fortress-types'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
  Button,
  cn,
} from '@fortress/ui'
import { useQueryClient } from '@tanstack/react-query'
import { CatchBoundary, Link } from '@tanstack/react-router'
import { formatDistanceToNow } from 'date-fns'
import {
  DatabaseZapIcon,
  EyeIcon,
  MoonIcon,
  PlugZapIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import * as React from 'react'

import {
  type FailingRead,
  useFailingFortReads,
  useLastDumpState,
  useTick,
} from '~/lib/fortress/client/queries'
import { useWatchList } from '~/lib/fortress/client/watch'
import { STRESS_CLASSES, isLiving, stressLabel, unitNeeds } from '~/lib/fortress/format'
import { firstName } from '~/lib/fortress/people/units'

/** Title row shared by every fortress page. */
export function PageHeader({
  title,
  description,
  updatedAt,
  isFetching,
  onRefresh,
  actions,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  updatedAt?: string | number | null
  isFetching?: boolean
  onRefresh?: () => void
  actions?: React.ReactNode
}) {
  useTick(1000)
  const updatedLabel = updatedAt
    ? formatDistanceToNow(new Date(updatedAt), { addSuffix: true })
    : null
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-medium">{title}</h1>
        {description ? <p className="mt-2 text-base text-muted-foreground">{description}</p> : null}
      </div>
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        {updatedLabel ? <span className="hidden sm:inline">Captured {updatedLabel}</span> : null}
        {actions}
        {onRefresh ? (
          <Button
            size="sm"
            variant="outline"
            onClick={onRefresh}
            disabled={isFetching}
            className="gap-2"
          >
            <RefreshCwIcon className={cn('size-3.5', isFetching && 'animate-spin')} />
            Refresh
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * What stands between the page and a fresh read: reads the app could not
 * make, a dump in a format it does not know, a game it cannot reach.
 */
export function StatusBanner({ state }: { state: FortState | null | undefined }) {
  useTick(5000)
  const failing = useFailingFortReads()
  return (
    <>
      {failing.length ? <ReadProblems failing={failing} /> : null}
      <VersionNotice />
      {failing.length && !state ? null : <GameStatus state={state} />}
    </>
  )
}

const MAX_SHOWN_ERROR = 240

const READ_NAMES: Record<string, string> = {
  automation: 'the DFHack plugins',
  changes: 'the changes over time',
  concerns: 'the fortress’s worries',
  dead: 'the dead',
  diplomacy: 'the neighbours',
  dump: 'the worker’s status',
  'event-mentions': 'the mentions in the chronicle',
  events: 'the chronicle',
  fixes: 'the fixes',
  history: 'the world’s history',
  item: 'this item',
  items: 'the items',
  map: 'the map',
  overview: 'the overview',
  people: 'the bonds between citizens',
  supplies: 'the stocks',
  trends: 'the trends',
  unit: 'this creature’s sheet',
  'unit-history': 'this creature’s history',
  units: 'the creatures',
  work: 'the work',
}

function ReadProblems({ failing }: { failing: FailingRead[] }) {
  const client = useQueryClient()
  const [retrying, setRetrying] = React.useState(false)
  const what = [
    ...new Set(failing.map((f) => READ_NAMES[f.what] ?? `the ${f.what.replace(/-/g, ' ')}`)),
  ]
  const message = failing[0].message
  const shown = message.length > MAX_SHOWN_ERROR ? `${message.slice(0, MAX_SHOWN_ERROR)}…` : message
  const kept = failing.filter((f) => f.lastGoodAt > 0)
  const oldest = kept.length ? Math.min(...kept.map((f) => f.lastGoodAt)) : null
  const retry = async () => {
    setRetrying(true)
    try {
      await client.refetchQueries({
        queryKey: ['fort'],
        predicate: (q) =>
          q.state.status === 'error' && failing.some((f) => f.what === String(q.queryKey[1])),
      })
    } finally {
      setRetrying(false)
    }
  }
  return (
    <Alert variant="destructive">
      <DatabaseZapIcon className="size-4" />
      <AlertTitle>
        Could not read {what.length > 3 ? `${what.length} parts of the fortress` : listWords(what)}
      </AlertTitle>
      <AlertDescription>
        <p>
          The read failed with “{shown}”.
          {oldest !== null
            ? ` What you see is the last good read, from ${formatDistanceToNow(oldest, { addSuffix: true })}.`
            : ' What has not been read yet stays empty until it works.'}{' '}
          The app tries again every few seconds, or you can try now.
        </p>
        <Button size="sm" variant="outline" className="mt-2" disabled={retrying} onClick={retry}>
          {retrying ? 'Trying…' : 'Try again now'}
        </Button>
      </AlertDescription>
    </Alert>
  )
}

function listWords(words: string[]): string {
  return words.length <= 1
    ? words.join('')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** A dump written by a game script older or newer than this app. */
function VersionNotice() {
  const version = useLastDumpState()?.dumpVersion ?? null
  if (version === null || version === DUMP_VERSION) return null
  return (
    <Alert>
      <PlugZapIcon className="size-4" />
      <AlertTitle>
        {version < DUMP_VERSION
          ? 'The game was read by an older script'
          : 'The game was read by a newer script'}
      </AlertTitle>
      <AlertDescription>
        {version < DUMP_VERSION ? (
          <>
            The last read came from version {version} of the game script, and this app reads version{' '}
            {DUMP_VERSION}, so some pages show less than they could. Restart the worker (
            <code className="rounded bg-muted px-1 py-0.5 text-xs">bun run dev:worker</code>) so it
            installs the new script, then read the game again.
          </>
        ) : (
          <>
            The last read came from version {version} of the game script, newer than the version{' '}
            {DUMP_VERSION} this app reads. Restart the web app so it picks up the new code.
          </>
        )}
      </AlertDescription>
    </Alert>
  )
}

function GameStatus({ state }: { state: FortState | null | undefined }) {
  if (!state) {
    return (
      <Alert>
        <PlugZapIcon className="size-4" />
        <AlertTitle>No data from the game yet</AlertTitle>
        <AlertDescription>
          Start the worker (
          <code className="rounded bg-muted px-1 py-0.5 text-xs">bun run dev:worker</code>) while
          Dwarf Fortress is running with DFHack. It writes here on its own.
        </AlertDescription>
      </Alert>
    )
  }
  if (state.status === 'live') return null
  const since = formatDistanceToNow(new Date(state.captured_at), { addSuffix: true })
  if (state.status === 'menu') {
    return (
      <Alert>
        <MoonIcon className="size-4" />
        <AlertTitle>The game is on a menu</AlertTitle>
        <AlertDescription>
          Dwarf Fortress is running but no fortress is loaded (checked {since}). Everything below is
          the last dump that was taken.
        </AlertDescription>
      </Alert>
    )
  }
  return (
    <Alert variant="destructive">
      <PlugZapIcon className="size-4" />
      <AlertTitle>Dwarf Fortress is not reachable</AlertTitle>
      <AlertDescription>
        The worker could not talk to DFHack (checked {since})
        {state.error ? `: ${state.error.replace(/[.!]?\s*$/, '.')}` : '.'} Everything below is the
        last dump that was taken.
      </AlertDescription>
    </Alert>
  )
}

/**
 * A part of a page that fails to render says so in its place while the rest
 * of the page stays, and tries again when the next dump lands.
 */
export function SectionBoundary({ name, children }: { name: string; children: React.ReactNode }) {
  const dumpAt = useLastDumpState()?.dumpCapturedAt ?? ''
  return (
    <CatchBoundary
      getResetKey={() => dumpAt}
      errorComponent={({ error, reset }) => (
        <Alert>
          <TriangleAlertIcon className="size-4" />
          <AlertTitle>{name} could not be shown</AlertTitle>
          <AlertDescription>
            <p>
              Something in the last read did not fit what this part of the page expects: “
              {error.message}”. The rest of the page is unaffected, and this part tries again when
              the next dump lands.
            </p>
            <Button size="sm" variant="outline" className="mt-2" onClick={reset}>
              Try again now
            </Button>
          </AlertDescription>
        </Alert>
      )}
    >
      {children}
    </CatchBoundary>
  )
}

export function FortBreadcrumbs({
  items,
}: {
  items: { label: string; to?: string }[]
}) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {items.map((item, i) => (
          <React.Fragment key={item.to ?? item.label}>
            {i > 0 ? <BreadcrumbSeparator /> : null}
            <BreadcrumbItem>
              {item.to ? (
                <BreadcrumbLink asChild>
                  <Link to={item.to}>{item.label}</Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{item.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </React.Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

export function UnitConditionBadges({ unit }: { unit: FortUnit }) {
  const needs = unitNeeds(unit)
  const living = isLiving(unit)
  return (
    <div className="flex flex-wrap gap-1">
      {unit.wounds > 0 ? (
        <Badge variant="destructive">
          {unit.wounds} wound{unit.wounds === 1 ? '' : 's'}
        </Badge>
      ) : null}
      {needs.map((n) => (
        <Badge
          key={n.label}
          variant={n.severity === 'danger' ? 'destructive' : 'secondary'}
          className={cn(
            n.severity === 'warning' &&
              'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
          )}
        >
          {n.label}
        </Badge>
      ))}
      {unit.flags.includes('caged') ? <Badge variant="outline">Caged</Badge> : null}
      {unit.flags.includes('chained') ? <Badge variant="outline">Chained</Badge> : null}
      {unit.flags.includes('insane') && living ? <Badge variant="destructive">Insane</Badge> : null}
      {unit.flags.includes('ghost') ? <Badge variant="outline">Ghost</Badge> : null}
    </div>
  )
}

/** Pins a creature to the watch list, or takes them off it. */
export function WatchButton({ unit, size = 'sm' }: { unit: FortUnit; size?: 'sm' | 'icon' }) {
  const { ids, toggle, fortKey } = useWatchList()
  if (!fortKey) return null
  const watching = ids.has(unit.id)
  const label = watching
    ? `Stop watching ${firstName(unit)}`
    : `Watch ${firstName(unit)}: changes to them come first in alerts and in what changed since your last look`
  return (
    <Button
      size={size}
      variant={watching ? 'secondary' : 'outline'}
      className={size === 'sm' ? 'gap-1.5' : undefined}
      aria-pressed={watching}
      aria-label={label}
      title={label}
      onClick={() => toggle(unit.id)}
    >
      <EyeIcon className={cn('size-3.5', watching && 'text-primary')} />
      {size === 'sm' ? (watching ? 'Watching' : 'Watch') : null}
    </Button>
  )
}

export function MoodBadge({ category, className }: { category: number; className?: string }) {
  const clamped = Math.min(Math.max(category, 0), 6)
  return (
    <Badge className={cn('border-transparent capitalize', STRESS_CLASSES[clamped], className)}>
      {stressLabel(clamped)}
    </Badge>
  )
}

export function StatCard({
  title,
  value,
  hint,
  Icon,
  accentClassName,
  children,
}: {
  title: string
  value: React.ReactNode
  hint?: React.ReactNode
  Icon?: React.ComponentType<{ className?: string }>
  accentClassName?: string
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border bg-card p-4 text-card-foreground">
      <div className="text-sm font-medium text-muted-foreground">{title}</div>
      <div className="mt-1.5 flex items-center gap-2 text-2xl font-semibold tabular-nums">
        {Icon ? <Icon className={cn('size-5', accentClassName)} /> : null}
        {value}
      </div>
      {hint ? (
        <div className="mt-1.5 text-sm leading-snug text-muted-foreground">{hint}</div>
      ) : null}
      {children}
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed p-10 text-center">
      <div className="font-medium">{title}</div>
      {children ? <div className="mt-1 text-sm text-muted-foreground">{children}</div> : null}
    </div>
  )
}
