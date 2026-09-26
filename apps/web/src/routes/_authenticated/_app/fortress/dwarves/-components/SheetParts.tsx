import type { FortUnit, SheetPerson } from '@fortress/db-drizzle'
import { Badge, Card, CardContent, CardHeader, CardTitle, cn } from '@fortress/ui'
import { Link } from '@tanstack/react-router'
import { InfoIcon } from 'lucide-react'
import type * as React from 'react'

import { CreatureSprite } from '~/lib/df-assets/components'
import type { Standing, Tone } from '~/lib/fortress/character'

/** A titled card; `count` shows as a badge next to the title. */
export function Section({
  title,
  count,
  action,
  description,
  className,
  contentClassName,
  children,
}: {
  title: React.ReactNode
  count?: number
  action?: React.ReactNode
  description?: React.ReactNode
  className?: string
  contentClassName?: string
  children: React.ReactNode
}) {
  return (
    <Card className={cn('gap-3 py-4', className)}>
      <CardHeader className="px-4">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            {title}
            {count !== undefined && count > 0 ? (
              <Badge variant="secondary" className="tabular-nums">
                {count}
              </Badge>
            ) : null}
          </span>
          {action ? <span className="text-sm font-normal">{action}</span> : null}
        </CardTitle>
        {description ? (
          <p className="text-sm leading-snug text-muted-foreground">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent className={cn('px-4', contentClassName)}>{children}</CardContent>
    </Card>
  )
}

export function Muted({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('text-sm text-muted-foreground', className)}>{children}</p>
}

/** Shown where the dump predates the sheet the updated worker collects. */
export function SheetMissing({ what }: { what: string }) {
  return (
    <p className="flex gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
      <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {what} come with the next dump from the updated worker. Restart it (
        <code className="rounded bg-muted px-1 text-xs">bun run dev:worker</code>) so it installs
        the new dump script in the game.
      </span>
    </p>
  )
}

export const STANDING_TEXT: Record<Standing, string> = {
  good: 'text-emerald-700 dark:text-emerald-400',
  ok: 'text-muted-foreground',
  warning: 'text-amber-700 dark:text-amber-300',
  danger: 'text-red-600 dark:text-red-400',
}

export const STANDING_BAR: Record<Standing, string> = {
  good: 'bg-emerald-500',
  ok: 'bg-sky-500/70',
  warning: 'bg-amber-400',
  danger: 'bg-red-500',
}

export const TONE_TEXT: Record<Tone, string> = {
  good: 'text-emerald-700 dark:text-emerald-400',
  bad: 'text-red-600 dark:text-red-400',
  neutral: 'text-muted-foreground',
}

/** A thin bar; `marker` draws a tick, e.g. where a typical dwarf sits. */
export function Meter({
  pct,
  barClassName,
  marker,
  className,
  label,
}: {
  pct: number
  barClassName?: string
  marker?: number
  className?: string
  label?: string
}) {
  const clamped = Math.max(0, Math.min(100, pct))
  return (
    <div
      className={cn('relative h-1.5 overflow-hidden rounded-full bg-muted', className)}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
    >
      <div
        className={cn('h-full rounded-full bg-primary', barClassName)}
        style={{ width: `${clamped}%` }}
      />
      {marker !== undefined ? (
        <div
          className="absolute top-0 h-full w-px bg-foreground/50"
          style={{ left: `${Math.max(0, Math.min(100, marker))}%` }}
        />
      ) : null}
    </div>
  )
}

export function Facts({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  const shown = items.filter(
    (item) => item.value !== null && item.value !== undefined && item.value !== '',
  )
  if (!shown.length) return null
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
      {shown.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 wrap-break-word">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A label then a few words, the way a character sheet reads. */
export function SheetLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[8rem_1fr] sm:gap-3">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm leading-relaxed">{children}</dd>
    </div>
  )
}

/** Someone from the sheet: their sprite and a link to their page when they are in the dump. */
export function PersonName({
  person,
  units,
  className,
}: {
  person: SheetPerson
  units: Map<number, FortUnit>
  className?: string
}) {
  const unit = person.unit !== null ? units.get(person.unit) : undefined
  const name = person.name ?? person.name_english ?? 'Someone unnamed'
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      {unit ? <CreatureSprite unit={unit} size={24} className="-my-1 shrink-0" /> : null}
      {unit ? (
        <Link
          to="/fortress/dwarves/$id"
          params={{ id: String(unit.id) }}
          className="truncate font-medium hover:underline"
          title={person.name_english ?? undefined}
        >
          {name}
        </Link>
      ) : (
        <span className="truncate font-medium" title={person.name_english ?? undefined}>
          {name}
        </span>
      )}
    </span>
  )
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
