import type { FortUnit } from '@fortress/db-drizzle'
import { Badge, Button, cn } from '@fortress/ui'
import { Link } from '@tanstack/react-router'
import {
  BedIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CoinsIcon,
  FactoryIcon,
  HeartPulseIcon,
  PickaxeIcon,
  ShieldIcon,
  TriangleAlertIcon,
  UtensilsIcon,
  ZapIcon,
} from 'lucide-react'
import * as React from 'react'

import { CreatureSprite } from '~/lib/df-assets/components'
import {
  AREAS,
  AREA_ORDER,
  type Advice,
  type AdviceArea,
  type AdviceStatus,
  type JobGroup,
  type Situation,
  type WorkshopRow,
} from '~/lib/fortress/advisor'
import { skillRank } from '~/lib/fortress/format'
import { adviceGuide, jobGroupGuide, situationGuide, workshopGuide } from '~/lib/fortress/guides'
import { firstName } from '~/lib/fortress/insights'
import { useOpenGuide } from './Guide'
import { UnitChips } from './Insights'

export const AREA_ICON: Record<AdviceArea, typeof ShieldIcon> = {
  food: UtensilsIcon,
  health: HeartPulseIcon,
  safety: ShieldIcon,
  industry: FactoryIcon,
  labor: PickaxeIcon,
  comfort: BedIcon,
  trade: CoinsIcon,
}

const STATUS_STYLE: Record<
  AdviceStatus,
  { Icon: typeof ShieldIcon; icon: string; box: string; label: string }
> = {
  problem: {
    Icon: CircleAlertIcon,
    icon: 'text-red-600 dark:text-red-400',
    box: 'border-red-500/40 bg-red-500/5',
    label: 'Problem',
  },
  attention: {
    Icon: TriangleAlertIcon,
    icon: 'text-amber-600 dark:text-amber-400',
    box: 'border-amber-500/40 bg-amber-500/5',
    label: 'Needs attention',
  },
  good: {
    Icon: CircleCheckIcon,
    icon: 'text-emerald-600 dark:text-emerald-400',
    box: 'border-border',
    label: 'Fine',
  },
}

export function StatusIcon({ status, className }: { status: AdviceStatus; className?: string }) {
  const { Icon, icon } = STATUS_STYLE[status]
  return (
    <Icon
      className={cn('size-4 shrink-0', icon, className)}
      aria-label={STATUS_STYLE[status].label}
    />
  )
}

function OneClickHint({ count }: { count: number }) {
  if (!count) return null
  return (
    <span className="inline-flex items-center gap-1 text-xs text-primary">
      <ZapIcon className="size-3" />
      {count === 1 ? 'one-click fix' : `${count} one-click fixes`}
    </span>
  )
}

/** One piece of advice: what the dump shows. Click for the step-by-step guide. */
export function AdviceCard({ advice }: { advice: Advice }) {
  const open = useOpenGuide()
  const style = STATUS_STYLE[advice.status]
  const AreaIcon = AREA_ICON[advice.area]
  return (
    <li className={cn('rounded-lg border transition-colors hover:bg-accent/30', style.box)}>
      <button
        type="button"
        onClick={() => open(adviceGuide(advice))}
        className="flex w-full items-start gap-3 p-3 text-left"
      >
        <StatusIcon status={advice.status} className="mt-0.5" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">{advice.title}</span>
            <Badge variant="outline" className="gap-1 font-normal text-muted-foreground">
              <AreaIcon className="size-3" />
              {AREAS[advice.area].label}
            </Badge>
          </span>
          <span className="text-sm text-muted-foreground">{advice.why}</span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-sm text-primary">
              {advice.status === 'good' ? 'How to keep it so' : 'How to fix it'}
              {advice.steps.length ? ` · ${advice.steps.length} steps` : ''}
            </span>
            <OneClickHint count={advice.actions?.length ?? 0} />
          </span>
        </span>
        <ChevronRightIcon className="mt-1 size-4 shrink-0 text-muted-foreground" />
      </button>
      {advice.units?.length ? (
        <div className="px-3 pb-3 pl-10">
          <UnitChips units={advice.units} max={6} />
        </div>
      ) : null}
    </li>
  )
}

/** Problems first, then what needs attention. */
export function NextSteps({ advice, max = 8 }: { advice: Advice[]; max?: number }) {
  const [all, setAll] = React.useState(false)
  const todo = advice.filter((a) => a.status !== 'good')
  const shown = all ? todo : todo.slice(0, max)
  if (!todo.length)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CircleCheckIcon className="size-4 text-emerald-600 dark:text-emerald-400" />
        Every check passes. The fortress is thriving.
      </p>
    )
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {shown.map((a) => (
          <AdviceCard key={a.key} advice={a} />
        ))}
      </ul>
      {todo.length > shown.length ? (
        <Button variant="link" size="sm" className="self-start px-0" onClick={() => setAll(true)}>
          Show all {todo.length}
        </Button>
      ) : null}
    </div>
  )
}

/** Every check, by area, good ones included: what a thriving fortress has. */
export function Checklist({ advice }: { advice: Advice[] }) {
  const open = useOpenGuide()
  return (
    <div className="flex flex-col gap-4">
      {AREA_ORDER.map((area) => {
        const checks = advice.filter((a) => a.area === area)
        if (!checks.length) return null
        const Icon = AREA_ICON[area]
        const fine = checks.filter((a) => a.status === 'good').length
        return (
          <section key={area} id={`area-${area}`} className="scroll-mt-4">
            <div className="mb-1 flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2 font-medium">
                <Icon className="size-4 text-muted-foreground" />
                {AREAS[area].label}
              </span>
              <span className="text-muted-foreground tabular-nums">
                {fine}/{checks.length} fine
              </span>
            </div>
            <ul className="flex flex-col">
              {checks.map((a) => (
                <li key={a.key} className="border-b last:border-b-0">
                  <button
                    type="button"
                    onClick={() => open(adviceGuide(a))}
                    className="group flex w-full items-start gap-2 rounded-sm py-1.5 text-left text-sm hover:bg-accent/40"
                  >
                    <StatusIcon status={a.status} className="mt-0.5" />
                    <span className="min-w-0 flex-1">{a.title}</span>
                    {a.actions?.length ? (
                      <ZapIcon className="mt-0.5 size-3.5 text-primary" />
                    ) : null}
                    <ChevronRightIcon className="mt-0.5 size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

/** Summary tiles across the top: how each area of the fortress is doing. */
export function AreaStrip({ advice }: { advice: Advice[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
      {AREA_ORDER.map((area) => {
        const checks = advice.filter((a) => a.area === area)
        if (!checks.length) return null
        const worst: AdviceStatus = checks.some((a) => a.status === 'problem')
          ? 'problem'
          : checks.some((a) => a.status === 'attention')
            ? 'attention'
            : 'good'
        const Icon = AREA_ICON[area]
        const open = checks.filter((a) => a.status !== 'good').length
        return (
          <a
            key={area}
            href={`#area-${area}`}
            title={AREAS[area].blurb}
            className={cn(
              'rounded-xl border px-3 py-2.5 transition-colors hover:bg-accent/40',
              STATUS_STYLE[worst].box,
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <Icon className="size-4 text-muted-foreground" />
              <StatusIcon status={worst} />
            </div>
            <div className="mt-1.5 text-sm font-medium">{AREAS[area].label}</div>
            <div className="text-xs text-muted-foreground">
              {open ? `${open} to see to` : 'All fine'}
            </div>
          </a>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Situations

export function SituationList({ situations }: { situations: Situation[] }) {
  const active = situations.filter((s) => s.now)
  const rest = situations.filter((s) => !s.now)
  return (
    <div className="flex flex-col gap-4">
      {active.length ? (
        <ul className="flex flex-col gap-2">
          {active.map((s) => (
            <SituationRow key={s.key} situation={s} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing out of the ordinary right now.</p>
      )}
      {rest.length ? (
        <div>
          <div className="mb-1 text-sm font-medium text-muted-foreground">
            When something else happens
          </div>
          <ul className="grid sm:grid-cols-2 sm:gap-x-6">
            {rest.map((s) => (
              <SituationRow key={s.key} situation={s} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function SituationRow({ situation }: { situation: Situation }) {
  const open = useOpenGuide()
  const active = Boolean(situation.now)
  return (
    <li
      className={cn(active ? 'rounded-lg border border-amber-500/40 bg-amber-500/5' : 'border-b')}
    >
      <button
        type="button"
        onClick={() => open(situationGuide(situation))}
        className={cn(
          'group flex w-full items-start gap-3 text-left hover:bg-accent/30',
          active ? 'rounded-lg p-3' : 'py-2',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className={cn(active ? 'font-medium' : 'text-sm')}>{situation.title}</span>
            {active ? (
              <Badge className="bg-amber-500 text-[10px] tracking-wide text-black uppercase hover:bg-amber-500">
                happening now
              </Badge>
            ) : null}
            {situation.actions?.length ? <ZapIcon className="size-3.5 text-primary" /> : null}
          </span>
          {active ? (
            <span className="mt-0.5 block text-sm text-muted-foreground">{situation.now}</span>
          ) : null}
        </span>
        <ChevronRightIcon
          className={cn(
            'mt-1 size-4 shrink-0 text-muted-foreground',
            !active && 'opacity-0 transition-opacity group-hover:opacity-100',
          )}
        />
      </button>
    </li>
  )
}

// ---------------------------------------------------------------------------
// The queue and the workshops

export function JobQueueList({ groups, advice }: { groups: JobGroup[]; advice: Advice[] }) {
  const open = useOpenGuide()
  const max = Math.max(1, ...groups.map((g) => g.total))
  if (!groups.length) return <p className="text-sm text-muted-foreground">Nothing is queued.</p>
  return (
    <ul className="flex flex-col gap-3">
      {groups.map((group) => {
        const waiting = group.total - group.working.length - group.suspended
        const guide = jobGroupGuide(group, advice)
        const heading = (
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span className={cn('font-medium', guide && 'text-primary group-hover:underline')}>
              {group.name}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {group.total.toLocaleString()}
              {group.working.length ? ` · ${group.working.length} at it` : ''}
              {group.suspended ? ` · ${group.suspended} suspended` : ''}
              {group.repeat ? ` · ${group.repeat} repeating` : ''}
            </span>
          </div>
        )
        return (
          <li key={group.name} className="flex flex-col gap-1.5">
            {guide ? (
              <button type="button" className="group text-left" onClick={() => open(guide)}>
                {heading}
              </button>
            ) : (
              heading
            )}
            <div
              className="flex h-2 overflow-hidden rounded-full bg-muted"
              style={{ width: `${Math.max(6, (group.total / max) * 100)}%` }}
            >
              <span className="bg-emerald-500" style={{ flexGrow: group.working.length }} />
              <span className="bg-sky-500/60" style={{ flexGrow: Math.max(0, waiting) }} />
              <span className="bg-red-500/70" style={{ flexGrow: group.suspended }} />
            </div>
            {group.working.length ? (
              <div className="flex flex-wrap gap-1">
                {group.working.slice(0, 16).map((unit) => (
                  <Link
                    key={unit.id}
                    to="/fortress/dwarves/$id"
                    params={{ id: String(unit.id) }}
                    title={unit.readable}
                    className="rounded-md border bg-muted/40 p-0.5 hover:border-primary/60"
                  >
                    <CreatureSprite unit={unit} size={20} />
                  </Link>
                ))}
              </div>
            ) : null}
          </li>
        )
      })}
      <li className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-emerald-500" /> being worked
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-sky-500/60" /> waiting
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-red-500/70" /> suspended
        </span>
      </li>
    </ul>
  )
}

export function WorkshopList({
  rows,
  idle,
  max = 10,
}: {
  rows: WorkshopRow[]
  idle: FortUnit[]
  max?: number
}) {
  const open = useOpenGuide()
  const [all, setAll] = React.useState(false)
  const shown = all ? rows : rows.slice(0, max)
  return (
    <div className="flex flex-col gap-1">
      <ul className="divide-y">
        {shown.map((row) => {
          const missing = row.count === 0
          const unskilled =
            !missing &&
            !!row.info.essential &&
            row.info.skills.length > 0 &&
            row.skilled.length === 0
          return (
            <li key={row.key} className="py-2.5">
              <button
                type="button"
                onClick={() => open(workshopGuide(row, idle))}
                className="group flex w-full flex-wrap items-start gap-x-4 gap-y-1 rounded-sm text-left hover:bg-accent/30"
              >
                <span className="min-w-[12rem] flex-1">
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        'font-medium group-hover:underline',
                        missing && 'text-muted-foreground',
                      )}
                    >
                      {row.info.label}
                    </span>
                    {row.count > 1 ? (
                      <span className="text-sm text-muted-foreground tabular-nums">
                        ×{row.count}
                      </span>
                    ) : null}
                    {missing ? (
                      <Badge
                        variant="outline"
                        className="border-amber-500/50 font-normal text-amber-700 dark:text-amber-300"
                      >
                        not built
                      </Badge>
                    ) : row.jobs ? (
                      <Badge variant="secondary" className="font-normal tabular-nums">
                        {row.jobs} queued
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="font-normal text-muted-foreground">
                        idle
                      </Badge>
                    )}
                  </span>
                  {row.info.makes ? (
                    <span className="block text-sm text-muted-foreground">{row.info.makes}</span>
                  ) : null}
                </span>
                <span className="flex min-w-[14rem] flex-1 flex-wrap items-center gap-1.5 text-sm">
                  {row.skilled.length ? (
                    row.skilled.slice(0, 3).map(({ unit, rating }) => (
                      <span
                        key={unit.id}
                        title={unit.readable}
                        className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5"
                      >
                        <CreatureSprite unit={unit} size={18} className="-my-1" />
                        {firstName(unit)}
                        <span className="text-muted-foreground">
                          {skillRank(rating).toLowerCase()}
                        </span>
                      </span>
                    ))
                  ) : row.info.skills.length ? (
                    <span
                      className={cn(
                        unskilled ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground',
                      )}
                    >
                      Nobody knows {row.info.skillLabel} yet
                    </span>
                  ) : null}
                  {row.skilled.length > 3 ? (
                    <span className="text-muted-foreground">+{row.skilled.length - 3} more</span>
                  ) : null}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {rows.length > shown.length ? (
        <Button variant="link" size="sm" className="self-start px-0" onClick={() => setAll(true)}>
          Show all {rows.length} kinds
        </Button>
      ) : null}
    </div>
  )
}
