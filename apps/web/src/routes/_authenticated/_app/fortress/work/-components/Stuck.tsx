import type { FortAlert, FortJob, FortUnit } from '@fortress/db-drizzle/fortress-types'
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
} from '@fortress/ui'
import { Link } from '@tanstack/react-router'
import { ArrowRightIcon, CirclePauseIcon, CoffeeIcon, RepeatIcon, WrenchIcon } from 'lucide-react'
import * as React from 'react'

import { adviceGuide, workshopGuide } from '~/lib/fortress/advice/guides'
import { cancellationHint } from '~/lib/fortress/advice/notices'
import type { Advice } from '~/lib/fortress/advice/types'
import type { WorkshopRow } from '~/lib/fortress/advice/workshops'
import { jobNeedsText, splitPascal } from '~/lib/fortress/format'
import { useOpenGuide } from '../../-components/Guide'
import { UnitChips } from '../../-components/Insights'
import { FixStepsButton } from './FixSteps'

function GuideButton({ advice, label }: { advice: Advice | undefined; label: string }) {
  const open = useOpenGuide()
  if (!advice) return null
  return (
    <Button variant="outline" size="sm" onClick={() => open(adviceGuide(advice))}>
      {label}
      <ArrowRightIcon className="size-3.5" />
    </Button>
  )
}

function Count({ n }: { n: number }) {
  return n ? (
    <span className="text-sm font-normal text-muted-foreground tabular-nums">
      {n.toLocaleString()}
    </span>
  ) : null
}

const WHERE_SHOWN = 4

/** The way into the step-by-step work orders, while anything is suspended or failing. */
export function StuckFixes({ suspended, failing }: { suspended: number; failing: number }) {
  if (!suspended && !failing) return null
  const what = [
    suspended ? `${suspended} suspended ${suspended === 1 ? 'job' : 'jobs'}` : null,
    failing ? `${failing} ${failing === 1 ? 'job that keeps' : 'jobs that keep'} failing` : null,
  ]
    .filter(Boolean)
    .join(' and ')
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-3">
      <p className="text-sm">
        <span className="font-medium">{what.charAt(0).toUpperCase() + what.slice(1)}.</span>{' '}
        <span className="text-muted-foreground">
          See the work orders that make what they lack, and add them to the game one by one.
        </span>
      </p>
      <FixStepsButton />
    </div>
  )
}

/** Suspended jobs, a line per kind of job at each kind of building, with where they are. */
export function SuspendedJobs({
  jobs,
  buildingNames,
  advice,
}: {
  jobs: FortJob[]
  buildingNames: Map<number, string>
  advice: Advice | undefined
}) {
  const groups = React.useMemo(() => {
    const byKind = new Map<
      string,
      { name: string; building: string | null; needs: string; jobs: FortJob[] }
    >()
    for (const job of jobs) {
      if (!job.suspended) continue
      const name = job.name || splitPascal(job.type)
      const building =
        job.building_id !== null ? (buildingNames.get(job.building_id) ?? null) : null
      const needs = jobNeedsText(job)
      const key = `${name}|${building ?? ''}|${needs}`
      const group = byKind.get(key) ?? { name, building, needs, jobs: [] }
      group.jobs.push(job)
      byKind.set(key, group)
    }
    return [...byKind.entries()].sort((a, b) => b[1].jobs.length - a[1].jobs.length)
  }, [jobs, buildingNames])
  const total = groups.reduce((sum, [, group]) => sum + group.jobs.length, 0)

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CirclePauseIcon className="size-4 text-primary" />
          Suspended jobs
          <Count n={total} />
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {total
            ? 'A job suspends when its site is blocked by an item, a creature or water, or its materials cannot be reached.'
            : 'Nothing is suspended.'}
        </p>
        {total ? (
          <CardAction>
            <GuideButton advice={advice} label="Unsuspend" />
          </CardAction>
        ) : null}
      </CardHeader>
      {total ? (
        <CardContent>
          <ul className="flex flex-col divide-y">
            {groups.map(([key, group]) => (
              <li key={key} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{group.name}</span>
                    {group.building ? (
                      <span className="text-muted-foreground"> · {group.building}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                    ×{group.jobs.length}
                  </span>
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  {group.jobs
                    .slice(0, WHERE_SHOWN)
                    .map((job) => `${job.x},${job.y} z${job.z}`)
                    .join('  ·  ')}
                  {group.jobs.length > WHERE_SHOWN
                    ? `  ·  ${group.jobs.length - WHERE_SHOWN} more`
                    : ''}
                </span>
                {group.needs ? (
                  <span className="text-sm text-muted-foreground">Needs {group.needs}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </CardContent>
      ) : null}
    </Card>
  )
}

/** Jobs the game keeps cancelling, with the reason it gives and what usually fixes it. */
export function FailingJobs({
  alerts,
  advice,
}: {
  alerts: FortAlert[]
  advice: Advice | undefined
}) {
  const failing = alerts.filter((alert) => alert.kind === 'cancellation')
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <RepeatIcon className="size-4 text-primary" />
          Jobs that keep failing
          <Count n={failing.length} />
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {failing.length
            ? 'Cancelled over and over, with the reason the game gives.'
            : 'No job keeps getting cancelled.'}
        </p>
        {failing.length ? (
          <CardAction>
            <GuideButton advice={advice} label="How to fix it" />
          </CardAction>
        ) : null}
      </CardHeader>
      {failing.length ? (
        <CardContent className="flex flex-col gap-3">
          <ul className="flex flex-col divide-y">
            {failing.map((alert) => {
              const hint = cancellationHint(alert.detail)
              return (
                <li
                  key={`${alert.title}-${alert.detail}`}
                  className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0"
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 font-medium">
                      {alert.title.replace(/ keeps failing$/, '')}
                    </span>
                    <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                      ×{alert.count}
                    </span>
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {alert.detail}
                    {hint ? `. ${hint}` : ''}
                  </span>
                </li>
              )
            })}
          </ul>
          <Link
            to="/fortress/chronicle"
            search={{ filter: 'cancellations' }}
            className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            See the cancellations in the chronicle
            <ArrowRightIcon className="size-3.5" />
          </Link>
        </CardContent>
      ) : null}
    </Card>
  )
}

/** Workshops the fortress is missing, or that nobody has the skill to work. */
export function UnworkableWork({ rows, idle }: { rows: WorkshopRow[]; idle: FortUnit[] }) {
  const open = useOpenGuide()
  const blocked = rows.filter(
    (row) =>
      (row.info.essential && row.count === 0) ||
      (row.count > 0 && row.info.skills.length > 0 && row.skilled.length === 0),
  )
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <WrenchIcon className="size-4 text-primary" />
          Work nobody can do
          <Count n={blocked.length} />
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {blocked.length
            ? 'Workshops every fortress wants but this one lacks, and workshops nobody has the skill to work. Open one for what to do.'
            : 'Every workshop is built, and someone can work each one.'}
        </p>
      </CardHeader>
      {blocked.length ? (
        <CardContent>
          <ul className="grid gap-x-6 sm:grid-cols-2">
            {blocked.map((row) => {
              const missing = row.count === 0
              return (
                <li key={row.key}>
                  <button
                    type="button"
                    onClick={() => open(workshopGuide(row, idle))}
                    className="-mx-2 flex w-[calc(100%+1rem)] flex-col gap-0.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{row.info.label}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          'font-normal',
                          missing
                            ? 'border-amber-500/50 text-amber-700 dark:text-amber-300'
                            : 'text-muted-foreground',
                        )}
                      >
                        {missing ? 'not built' : `nobody knows ${row.info.skillLabel}`}
                      </Badge>
                      {row.jobs ? (
                        <span className="text-sm text-muted-foreground tabular-nums">
                          {row.jobs} queued
                        </span>
                      ) : null}
                    </span>
                    {row.info.makes ? (
                      <span className="text-sm text-muted-foreground">Makes {row.info.makes}</span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </CardContent>
      ) : null}
    </Card>
  )
}

/** Grown citizens with no job, no squad and no mood. */
export function IdleHands({ idle, advice }: { idle: FortUnit[]; advice: Advice | undefined }) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CoffeeIcon className="size-4 text-primary" />
          Nothing to do
          <Count n={idle.length} />
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {idle.length
            ? 'Grown citizens with no job, no squad and no strange mood.'
            : 'Every grown citizen has work.'}
        </p>
      </CardHeader>
      {idle.length ? (
        <CardContent className="flex flex-col gap-3">
          <UnitChips units={idle} max={12} />
          <span>
            <GuideButton advice={advice} label="Find them work" />
          </span>
        </CardContent>
      ) : null}
    </Card>
  )
}
