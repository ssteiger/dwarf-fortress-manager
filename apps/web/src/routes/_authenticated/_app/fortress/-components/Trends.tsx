import type { SnapshotTotals } from '@fortress/db-drizzle'
import { Card, CardContent, CardHeader, CardTitle, cn } from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { TrendingUpIcon } from 'lucide-react'

import { formatGameTick, formatNumber, formatValue } from '~/lib/fortress/format'
import { type TrendPoint, getFortTrends } from '~/lib/fortress/server/history'

/** A small line over evenly spaced readings; `min` and `max` fix the scale when given. */
export function Sparkline({
  values,
  label,
  min,
  max,
  className,
  strokeClassName = 'stroke-primary',
}: {
  values: number[]
  label: string
  min?: number
  max?: number
  className?: string
  strokeClassName?: string
}) {
  const width = 120
  const height = 32
  if (values.length < 2) return null
  const lo = min ?? Math.min(...values)
  const hi = max ?? Math.max(...values)
  const span = hi - lo || 1
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width
      const y = height - 2 - ((v - lo) / span) * (height - 4)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className={cn('h-8 w-full overflow-visible', className)}
    >
      <polyline
        points={points}
        fill="none"
        vectorEffect="non-scaling-stroke"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        className={strokeClassName}
      />
    </svg>
  )
}

interface Measure {
  key: string
  label: string
  value: (t: SnapshotTotals) => number | null
  format: (n: number) => string
  /** More is better, for the colour of the change. */
  better: 'up' | 'down'
}

const count = (t: SnapshotTotals, key: string) => t.stocks[key] ?? 0
const perDwarf = (t: SnapshotTotals, n: number) =>
  t.population ? Math.floor(n / t.population) : null

const MEASURES: Measure[] = [
  {
    key: 'population',
    label: 'Citizens',
    value: (t) => t.population,
    format: formatNumber,
    better: 'up',
  },
  {
    key: 'wealth',
    label: 'Created wealth',
    value: (t) => t.wealth,
    format: formatValue,
    better: 'up',
  },
  {
    key: 'drink',
    label: 'Drink per dwarf',
    value: (t) => perDwarf(t, count(t, 'drink')),
    format: formatNumber,
    better: 'up',
  },
  {
    key: 'food',
    label: 'Food per dwarf',
    value: (t) =>
      perDwarf(
        t,
        ['meals', 'meat', 'fish', 'plants', 'cheese', 'eggs'].reduce(
          (sum, key) => sum + count(t, key),
          0,
        ),
      ),
    format: formatNumber,
    better: 'up',
  },
  {
    key: 'unhappy',
    label: 'Unhappy or worse',
    value: (t) => (t.mood[0] ?? 0) + (t.mood[1] ?? 0),
    format: formatNumber,
    better: 'down',
  },
]

function changeText(
  measure: Measure,
  first: number,
  last: number,
): { text: string; good: boolean | null } {
  const diff = last - first
  if (diff === 0) return { text: 'no change', good: null }
  return {
    text: `${diff > 0 ? '+' : '−'}${measure.format(Math.abs(diff))}`,
    good: diff > 0 === (measure.better === 'up'),
  }
}

/** Population, wealth, drink, food and unhappiness from the worker's daily snapshots. */
export function TrendsCard() {
  const trends = useQuery({
    queryKey: ['fort', 'trends'],
    queryFn: () => getFortTrends(),
  })
  const points = trends.data ?? []
  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUpIcon className="size-4 text-primary" />
          Over time
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {points.length >= 2
            ? `One reading a day, since ${formatGameTick(points[0].year, points[0].tick)}.`
            : 'The worker keeps one reading a day. The lines show once there are two days to compare.'}
        </p>
      </CardHeader>
      {points.length >= 2 ? (
        <CardContent>
          <TrendRows points={points} />
        </CardContent>
      ) : null}
    </Card>
  )
}

function TrendRows({ points }: { points: TrendPoint[] }) {
  return (
    <dl className="flex flex-col divide-y">
      {MEASURES.map((measure) => {
        const series = points
          .map((p) => measure.value(p.totals))
          .filter((v): v is number => v !== null)
        if (series.length < 2) return null
        const first = series[0]
        const last = series[series.length - 1]
        const change = changeText(measure, first, last)
        return (
          <div
            key={measure.key}
            className="grid grid-cols-[minmax(0,1fr)_96px] items-center gap-3 py-2 first:pt-0 last:pb-0"
          >
            <div className="min-w-0">
              <dt className="text-sm text-muted-foreground">{measure.label}</dt>
              <dd className="flex items-baseline gap-2">
                <span className="font-medium tabular-nums">{measure.format(last)}</span>
                <span
                  className={cn(
                    'text-xs tabular-nums',
                    change.good === null
                      ? 'text-muted-foreground'
                      : change.good
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400',
                  )}
                >
                  {change.text}
                </span>
              </dd>
            </div>
            <Sparkline
              values={series}
              min={measure.key === 'unhappy' ? 0 : undefined}
              label={`${measure.label}: ${measure.format(first)} then, ${measure.format(last)} now`}
            />
          </div>
        )
      })}
    </dl>
  )
}
