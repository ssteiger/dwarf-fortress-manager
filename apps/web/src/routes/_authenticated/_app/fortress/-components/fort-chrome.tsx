import type { FortState } from '@fortress/db-drizzle'
import { Alert, AlertDescription, AlertTitle, Badge, Button, cn } from '@fortress/ui'
import { formatDistanceToNow } from 'date-fns'
import { MoonIcon, PlugZapIcon, RefreshCwIcon } from 'lucide-react'
import type * as React from 'react'

import { STRESS_CLASSES, stressLabel } from '~/lib/fortress/format'
import { useTick } from '~/lib/fortress/queries'

/** Title row shared by every fortress page. */
export function PageHeader({
  eyebrow,
  title,
  description,
  updatedAt,
  isFetching,
  onRefresh,
  actions,
}: {
  eyebrow: string
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
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <div className="font-heading text-xs uppercase tracking-[0.2em] text-highlight">
          {eyebrow}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
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

/** Shown when the worker cannot see a loaded fortress. */
export function StatusBanner({ state }: { state: FortState | null | undefined }) {
  useTick(5000)
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
        {state.error ? `: ${state.error}` : '.'} Everything below is the last dump that was taken.
      </AlertDescription>
    </Alert>
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
    <div className="rounded-xl border bg-card p-4 text-card-foreground shadow-sm">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className="mt-1 flex items-center gap-2 font-heading text-2xl font-semibold tabular-nums">
        {Icon ? <Icon className={cn('size-5', accentClassName)} /> : null}
        {value}
      </div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
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
