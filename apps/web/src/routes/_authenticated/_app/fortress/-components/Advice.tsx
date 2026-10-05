import type { DfhackAction, FortUnit } from '@fortress/db-drizzle'
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
  adviceGuide,
  jobGroupGuide,
  situationGuide,
  workshopGuide,
} from '~/lib/fortress/advice/guides'
import type { Situation } from '~/lib/fortress/advice/situations'
import {
  AREAS,
  AREA_ORDER,
  type Advice,
  type AdviceArea,
  type AdviceStatus,
} from '~/lib/fortress/advice/types'
import type { JobGroup, WorkshopRow } from '~/lib/fortress/advice/workshops'
import { skillRank } from '~/lib/fortress/format'
import { firstName } from '~/lib/fortress/people/units'
import { OneClickMark, useActionsToOffer, useOpenGuide } from './Guide'
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
  { Icon: typeof ShieldIcon; icon: string; disc: string; label: string }
> = {
  problem: {
    Icon: CircleAlertIcon,
    icon: 'text-red-600 dark:text-red-400',
    disc: 'bg-red-500/15 text-red-600 dark:text-red-400',
    label: 'Problem',
  },
  attention: {
    Icon: TriangleAlertIcon,
    icon: 'text-amber-600 dark:text-amber-400',
    disc: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
    label: 'Needs attention',
  },
  good: {
    Icon: CircleCheckIcon,
    icon: 'text-emerald-600 dark:text-emerald-400',
    disc: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
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

function OneClickHint({ actions }: { actions?: readonly DfhackAction[] }) {
  const count = useActionsToOffer(actions).length
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
    <li className="py-3 first:pt-0 last:pb-0">
      <button
        type="button"
        onClick={() => open(adviceGuide(advice))}
        className="group flex w-full items-start gap-3 text-left"
      >
        <span
          className={cn(
            '-mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full',
            style.disc,
          )}
        >
          <style.Icon className="size-3.5" aria-label={style.label} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={cn(
                'underline-offset-4 group-hover:underline',
                advice.status === 'problem' ? 'font-semibold' : 'font-medium',
              )}
            >
              {advice.title}
            </span>
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
            <OneClickHint actions={advice.actions} />
          </span>
        </span>
        <ChevronRightIcon className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </button>
      {advice.units?.length ? (
        <div className="pt-2 pl-10">
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
      <ul className="flex flex-col divide-y">
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

/** The checks that already pass, by area, one line each. */
export function FineChecks({ advice }: { advice: Advice[] }) {
  const open = useOpenGuide()
  const fine = advice
    .filter((a) => a.status === 'good')
    .sort((a, b) => AREA_ORDER.indexOf(a.area) - AREA_ORDER.indexOf(b.area))
  if (!fine.length) return <p className="text-sm text-muted-foreground">No check passes yet.</p>
  return (
    <ul className="grid gap-x-6 sm:grid-cols-2">
      {fine.map((a) => {
        const Icon = AREA_ICON[a.area]
        return (
          <li key={a.key}>
            <button
              type="button"
              onClick={() => open(adviceGuide(a))}
              className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
            >
              <StatusIcon status="good" />
              <span className="min-w-0 flex-1 truncate">{a.title}</span>
              <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                <Icon className="size-3" />
                {AREAS[a.area].label}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
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
        <div>
          <div className="mb-1 flex items-center gap-2 text-sm font-medium">
            <span className="inline-block size-2 rounded-full bg-amber-500" />
            Happening now
            <span className="font-normal text-muted-foreground tabular-nums">{active.length}</span>
          </div>
          <ul className="flex flex-col divide-y">
            {active.map((s) => (
              <SituationRow key={s.key} situation={s} />
            ))}
          </ul>
        </div>
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
    <li className={active ? undefined : 'border-b'}>
      <button
        type="button"
        onClick={() => open(situationGuide(situation))}
        className={cn(
          'group flex w-full items-start gap-3 text-left hover:bg-accent/30',
          active ? 'py-3' : 'py-2',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className={cn(active ? 'font-medium' : 'text-sm')}>{situation.title}</span>
            <OneClickMark actions={situation.actions} />
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

const QUEUE_COLUMNS =
  'grid grid-cols-[minmax(0,1fr)_3rem_3rem_4.5rem] items-center gap-x-3 sm:grid-cols-[minmax(0,1fr)_7rem_3rem_3rem_4.5rem_minmax(0,11rem)]'
const QUEUE_WORKERS_SHOWN = 6

/** Every kind of queued job in one row: how many, how many being worked or stuck, and by whom. */
export function JobQueueList({ groups, advice }: { groups: JobGroup[]; advice: Advice[] }) {
  const open = useOpenGuide()
  const max = Math.max(1, ...groups.map((g) => g.total))
  if (!groups.length) return <p className="text-sm text-muted-foreground">Nothing is queued.</p>
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col">
        <div
          className={cn(QUEUE_COLUMNS, 'border-b pb-2 text-xs font-medium text-muted-foreground')}
        >
          <span>Kind</span>
          <span className="hidden sm:block" />
          <span className="text-right">Jobs</span>
          <span className="text-right">At it</span>
          <span className="text-right">Suspended</span>
          <span className="hidden sm:block">Who</span>
        </div>
        <ul className="divide-y">
          {groups.map((group) => {
            const waiting = group.total - group.working.length - group.suspended
            const guide = jobGroupGuide(group, advice)
            return (
              <li key={group.name} className={cn(QUEUE_COLUMNS, 'py-2 text-sm')}>
                <span className="min-w-0 truncate">
                  {guide ? (
                    <button
                      type="button"
                      onClick={() => open(guide)}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {group.name}
                    </button>
                  ) : (
                    <span className="font-medium">{group.name}</span>
                  )}
                  {group.repeat ? (
                    <span className="text-muted-foreground"> · {group.repeat} repeating</span>
                  ) : null}
                </span>
                <span className="hidden sm:block">
                  <span
                    className="flex h-1.5 gap-px overflow-hidden rounded-full"
                    style={{ width: `${Math.max(8, (group.total / max) * 100)}%` }}
                  >
                    <span className="bg-emerald-500" style={{ flexGrow: group.working.length }} />
                    <span className="bg-sky-500/60" style={{ flexGrow: Math.max(0, waiting) }} />
                    <span className="bg-red-500/70" style={{ flexGrow: group.suspended }} />
                  </span>
                </span>
                <span className="text-right tabular-nums">{group.total.toLocaleString()}</span>
                <span className="text-right text-muted-foreground tabular-nums">
                  {group.working.length || '–'}
                </span>
                <span
                  className={cn(
                    'text-right tabular-nums',
                    group.suspended ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
                  )}
                >
                  {group.suspended || '–'}
                </span>
                <span className="hidden min-w-0 items-center gap-0.5 sm:flex">
                  {group.working.slice(0, QUEUE_WORKERS_SHOWN).map((unit) => (
                    <Link
                      key={unit.id}
                      to="/fortress/dwarves/$id"
                      params={{ id: String(unit.id) }}
                      title={unit.readable}
                      className="rounded-md p-0.5 hover:bg-accent"
                    >
                      <CreatureSprite unit={unit} size={20} />
                    </Link>
                  ))}
                  {group.working.length > QUEUE_WORKERS_SHOWN ? (
                    <span className="pl-1 text-xs text-muted-foreground">
                      +{group.working.length - QUEUE_WORKERS_SHOWN}
                    </span>
                  ) : null}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-emerald-500" /> being worked
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-sky-500/60" /> waiting
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-red-500/70" /> suspended
        </span>
      </div>
    </div>
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
