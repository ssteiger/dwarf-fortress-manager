import type { FortItem, FortSummary } from '@fortress/db-drizzle'
import { Button, cn } from '@fortress/ui'
import { ChevronRightIcon, ZapIcon } from 'lucide-react'
import * as React from 'react'

import { ItemSprite } from '~/lib/df-assets/components'
import { type Advice, type AdviceStatus, WORKSHOPS } from '~/lib/fortress/advisor'
import { formatNumber, formatValue, humanize, splitPascal } from '~/lib/fortress/format'
import { adviceGuide, planGuide, viewGuide } from '~/lib/fortress/guides'
import { firstName } from '~/lib/fortress/insights'
import {
  ITEM_VIEWS,
  ITEM_VIEW_INFO,
  type ItemView,
  type PlanRow,
  type StoreTile,
} from '~/lib/fortress/stores'
import { StatusIcon } from '../../-components/Advice'
import { GuideButton, useOpenGuide } from '../../-components/Guide'

const TILE_TONE: Record<AdviceStatus, string> = {
  problem: 'border-red-500/40 bg-red-500/5',
  attention: 'border-amber-500/40 bg-amber-500/5',
  good: '',
}

/** The stores at a glance; each tile opens the advice behind it. */
export function StoreTiles({ tiles, advice }: { tiles: StoreTile[]; advice: Advice[] }) {
  const open = useOpenGuide()
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
      {tiles.map((tile) => {
        const match = advice.find((a) => a.key === tile.advice)
        return (
          <button
            type="button"
            key={tile.key}
            disabled={!match}
            onClick={() => match && open(adviceGuide(match))}
            title={match ? `${match.title}: ${match.why}` : undefined}
            className={cn(
              'flex flex-col gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors enabled:hover:bg-accent/40',
              match && TILE_TONE[match.status],
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <ItemSprite item={tile.sprite} size={24} className="-my-0.5" />
              {match ? <StatusIcon status={match.status} /> : null}
            </span>
            <span className="text-sm text-muted-foreground">{tile.label}</span>
            <span className="text-lg leading-tight font-semibold tabular-nums">{tile.value}</span>
            <span className="text-xs leading-snug text-muted-foreground">{tile.detail}</span>
          </button>
        )
      })}
    </div>
  )
}

function shopLabel(key: string): string {
  return (WORKSHOPS[key]?.label ?? splitPascal(key)).toLowerCase()
}

const BAR_TONE: Record<AdviceStatus, string> = {
  problem: 'bg-red-500/80',
  attention: 'bg-amber-500/80',
  good: 'bg-emerald-500/80',
}

/** What the fortress is short of, where to make it, and who can. */
export function ProductionPlan({ rows, max = 8 }: { rows: PlanRow[]; max?: number }) {
  const open = useOpenGuide()
  const [all, setAll] = React.useState(false)
  const short = rows.filter((r) => r.status !== 'good')
  const shown = all ? rows : short.slice(0, max)
  return (
    <div className="flex flex-col gap-1">
      {short.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing is running short. The fortress keeps enough of everything this list checks.
        </p>
      ) : null}
      <ul className="divide-y">
        {shown.map((row) => (
          <li key={row.key}>
            <button
              type="button"
              onClick={() => open(planGuide(row))}
              className="group flex w-full items-center gap-3 rounded-sm py-2 text-left hover:bg-accent/30"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted/40">
                <ItemSprite item={row.sprite} size={32} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="flex items-center gap-2 font-medium group-hover:underline">
                    {row.label}
                    {row.actions?.length ? <ZapIcon className="size-3.5 text-primary" /> : null}
                  </span>
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {formatNumber(row.have)} of {formatNumber(row.want)}
                  </span>
                </span>
                <span className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                  <span
                    className={BAR_TONE[row.status]}
                    style={{ width: `${Math.min(100, (row.have / Math.max(1, row.want)) * 100)}%` }}
                  />
                </span>
                <span className="text-sm text-muted-foreground">
                  {row.task} at the {shopLabel(row.shop)}
                  {row.built ? null : (
                    <span className="text-amber-700 dark:text-amber-300"> · not built yet</span>
                  )}
                  {row.hands.length ? ` · ${row.hands.slice(0, 2).map(firstName).join(', ')}` : ''}
                </span>
              </span>
              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          </li>
        ))}
      </ul>
      {!all && rows.length > shown.length ? (
        <Button variant="link" size="sm" className="self-start px-0" onClick={() => setAll(true)}>
          Show all {rows.length}, the well-stocked ones too
        </Button>
      ) : null}
    </div>
  )
}

const WEALTH_PARTS: { key: keyof NonNullable<FortSummary['wealth']>; label: string }[] = [
  { key: 'architecture', label: 'Architecture' },
  { key: 'furniture', label: 'Furniture' },
  { key: 'displayed', label: 'On display' },
  { key: 'weapons', label: 'Weapons' },
  { key: 'armor', label: 'Armor and clothing' },
  { key: 'held', label: 'Held and worn' },
  { key: 'other', label: 'Other goods' },
]

export function WealthBreakdown({ wealth }: { wealth: FortSummary['wealth'] }) {
  if (!wealth) return <p className="text-sm text-muted-foreground">No wealth reported yet.</p>
  const parts = WEALTH_PARTS.map((p) => ({ ...p, value: wealth[p.key] })).sort(
    (a, b) => b.value - a.value,
  )
  const max = Math.max(1, ...parts.map((p) => p.value))
  return (
    <div className="flex flex-col gap-3">
      <div className="text-2xl font-semibold tabular-nums">{formatValue(wealth.total)}</div>
      <dl className="flex flex-col gap-1.5 text-sm">
        {parts.map((part) => (
          <div key={part.key} className="grid grid-cols-[8.5rem_1fr_auto] items-center gap-2">
            <dt className="text-muted-foreground">{part.label}</dt>
            <span className="flex h-2 overflow-hidden rounded-full bg-muted">
              <span className="bg-primary/70" style={{ width: `${(part.value / max) * 100}%` }} />
            </span>
            <dd className="text-right tabular-nums">{formatNumber(part.value)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Traded: {formatValue(wealth.imported)} in, {formatValue(wealth.exported)} out. Wealth draws
        migrants, nobles and caravans, and sooner or later thieves and sieges. Smoothed and engraved
        rooms, fine furniture and artifacts on display count the most.
      </p>
    </div>
  )
}

/** The views of the item list, with how many items each holds. */
export function ViewChips({
  view,
  counts,
  onChange,
}: {
  view: ItemView
  counts: Record<ItemView, number> | undefined
  onChange: (view: ItemView) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {ITEM_VIEWS.filter((v) => v === 'fortress' || v === view || (counts?.[v] ?? 0) > 0).map(
        (v) => (
          <button
            type="button"
            key={v}
            onClick={() => onChange(v)}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-accent',
              view === v && 'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
            )}
          >
            {ITEM_VIEW_INFO[v].label}
            {counts ? <span className="ml-1.5 opacity-70">{formatNumber(counts[v])}</span> : null}
          </button>
        ),
      )}
    </div>
  )
}

/** What the chosen view shows, and what to do about it. */
export function ViewHint({ view, count, value }: { view: ItemView; count: number; value: number }) {
  const info = ITEM_VIEW_INFO[view]
  const guide = viewGuide(view, count)
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
      <span className="text-muted-foreground">
        {info.blurb} {formatNumber(count)} item{count === 1 ? '' : 's'}, worth {formatValue(value)}.
      </span>
      {guide && count > 0 ? <GuideButton guide={guide} label="What to do about them" /> : null}
    </div>
  )
}

/** Item types in the view, each drawn with its most valuable example. */
export function TypeChips({
  types,
  valueByType,
  samples,
  selected,
  onSelect,
  max = 16,
}: {
  types: Record<string, number>
  valueByType: Record<string, number>
  samples: Record<string, FortItem>
  selected: string | null
  onSelect: (type: string | null) => void
  max?: number
}) {
  const [all, setAll] = React.useState(false)
  const sorted = Object.entries(types).sort((a, b) => b[1] - a[1])
  const shown = all ? sorted : sorted.slice(0, max)
  if (!sorted.length) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {shown.map(([name, count]) => (
        <button
          type="button"
          key={name}
          onClick={() => onSelect(selected === name ? null : name)}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border py-1 pr-3 pl-1.5 text-sm transition-colors hover:bg-accent',
            selected === name &&
              'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
          )}
        >
          {samples[name] ? (
            <ItemSprite item={samples[name]} size={20} className="rounded-sm" />
          ) : null}
          {humanize(name)}
          <span className="opacity-70">{formatNumber(count)}</span>
          {valueByType[name] ? (
            <span className="opacity-70">· {formatValue(valueByType[name])}</span>
          ) : null}
        </button>
      ))}
      {sorted.length > shown.length ? (
        <Button variant="link" size="sm" className="px-1" onClick={() => setAll(true)}>
          +{sorted.length - shown.length} more kinds
        </Button>
      ) : null}
    </div>
  )
}
