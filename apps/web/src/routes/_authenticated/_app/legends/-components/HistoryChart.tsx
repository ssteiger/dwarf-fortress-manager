import { cn } from '@fortress/ui'
import * as React from 'react'

import type { TimelineBin } from '~/lib/legends/server/summary'

export interface YearSpan {
  from: number
  to: number
}

const HEIGHT = 200
const PAD_LEFT = 40
const PAD_TOP = 8
const PAD_BOTTOM = 24

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

/** A round step that splits `max` into about `count` gridlines. */
function niceStep(max: number, count: number): number {
  const raw = max / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / magnitude
  const factor = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10
  return factor * magnitude
}

/** A column with only its top corners rounded. */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.min(r, w / 2, h)
  return [
    `M${x},${y + h}`,
    `V${y + radius}`,
    `Q${x},${y} ${x + radius},${y}`,
    `H${x + w - radius}`,
    `Q${x + w},${y} ${x + w},${y + radius}`,
    `V${y + h}`,
    'Z',
  ].join(' ')
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T>(null)
  const [width, setWidth] = React.useState(0)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

/**
 * Recorded events per span of years, with the share that were battles or
 * deaths. Eras run along the top. Click a bar, drag across several, or click
 * an era to pick the years the chronicle below should tell.
 */
export const HistoryChart = ({
  bins,
  binYears,
  eras,
  selection,
  onSelect,
}: {
  bins: TimelineBin[]
  binYears: number
  eras: { name: string; startYear: number }[]
  selection?: YearSpan | null
  onSelect?: (span: YearSpan) => void
}) => {
  const [active, setActive] = React.useState<number | null>(null)
  const [brush, setBrush] = React.useState<{ start: number; end: number } | null>(null)
  const [wrapRef, width] = useWidth<HTMLDivElement>()
  const clipId = React.useId().replace(/[^a-zA-Z0-9]/g, '')
  if (!bins.length) return <p className="text-sm text-muted-foreground">No dated events yet.</p>

  const first = bins[0].start
  const last = bins[bins.length - 1].start + binYears
  const span = Math.max(last - first, 1)
  const plotW = Math.max(width - PAD_LEFT, 1)
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM
  const xFor = (year: number) => PAD_LEFT + ((year - first) / span) * plotW

  const maxTotal = Math.max(...bins.map((b) => b.total), 1)
  const step = niceStep(maxTotal, 4)
  const top = Math.ceil(maxTotal / step) * step
  const yFor = (value: number) => PAD_TOP + plotH - (value / top) * plotH
  const gridlines = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)

  const yearStep =
    [10, 25, 50, 100, 200, 250, 500, 1000, 2000].find((s) => (s / span) * plotW >= 72) ?? 5000
  const yearTicks: number[] = []
  for (let y = Math.ceil(first / yearStep) * yearStep; y <= last; y += yearStep) yearTicks.push(y)

  const slot = (plotW / span) * binYears
  const gap = Math.min(4, Math.max(1, slot * 0.18))
  const barW = Math.max(1, slot - gap)

  const sortedEras = [...eras]
    .sort((a, b) => a.startYear - b.startYear)
    .filter((era, i, all) => (all[i + 1]?.startYear ?? last) > first && era.startYear < last)
  const eraSpan = (index: number): YearSpan => {
    const start = Math.max(sortedEras[index].startYear, first)
    const next = sortedEras[index + 1]?.startYear
    return { from: start, to: Math.min(next ?? last, last) - 1 }
  }

  /** Index of the bin under a client x. */
  const binAt = (clientX: number): number => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return 0
    const year = first + ((clientX - rect.left - PAD_LEFT) / plotW) * span
    const index = Math.floor((year - first) / binYears)
    return Math.min(Math.max(index, 0), bins.length - 1)
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!onSelect) return
    const start = bins[binAt(e.clientX)].start
    setBrush({ start, end: start })
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const index = binAt(e.clientX)
    setActive(index)
    if (brush) setBrush({ ...brush, end: bins[index].start })
  }
  const onPointerUp = () => {
    if (!brush || !onSelect) return
    const from = Math.min(brush.start, brush.end)
    const to = Math.max(brush.start, brush.end) + binYears - 1
    setBrush(null)
    onSelect({ from, to: Math.min(to, last - 1) })
  }

  const shown = brush
    ? {
        from: Math.min(brush.start, brush.end),
        to: Math.max(brush.start, brush.end) + binYears - 1,
      }
    : selection
  const current = active !== null ? bins[active] : null
  const currentX = active !== null ? xFor(bins[active].start) + barW / 2 : 0

  return (
    <div className="flex flex-col gap-3">
      {sortedEras.length ? (
        <div className="relative h-7" style={{ marginLeft: PAD_LEFT }}>
          {sortedEras.map((era, index) => {
            const eraYears = eraSpan(index)
            const left = ((eraYears.from - first) / span) * 100
            const right = ((eraYears.to + 1 - first) / span) * 100
            const picked = selection?.from === eraYears.from && selection?.to === eraYears.to
            const style = { left: `${left}%`, width: `${right - left}%` }
            const since = era.startYear <= first ? null : era.startYear
            const base =
              'absolute inset-y-0 flex min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 text-xs font-medium'
            return onSelect ? (
              <button
                key={`${era.name}-${era.startYear}`}
                type="button"
                title={`Read ${era.name}`}
                onClick={() => onSelect(eraYears)}
                style={style}
                className={cn(
                  base,
                  'text-left transition-colors hover:bg-accent',
                  picked && 'bg-accent',
                )}
              >
                <EraLabel name={era.name} since={since} />
              </button>
            ) : (
              <span key={`${era.name}-${era.startYear}`} style={style} className={base}>
                <EraLabel name={era.name} since={since} />
              </span>
            )
          })}
        </div>
      ) : null}

      <div ref={wrapRef} className="relative" style={{ height: HEIGHT }}>
        {width > 0 ? (
          <svg
            width={width}
            height={HEIGHT}
            className={cn('block overflow-visible select-none', onSelect && 'cursor-crosshair')}
            role="img"
            aria-label="Events recorded per period"
            style={{ touchAction: 'none' }}
            onPointerLeave={() => setActive(null)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setBrush(null)}
          >
            <defs>
              {bins.map((bin, i) => {
                const y = yFor(bin.total)
                return (
                  <clipPath key={bin.start} id={`${clipId}-${i}`}>
                    <path d={topRounded(xFor(bin.start), y, barW, yFor(0) - y, 3)} />
                  </clipPath>
                )
              })}
            </defs>

            {gridlines.map((value) => (
              <g key={value}>
                <line
                  x1={PAD_LEFT}
                  x2={width}
                  y1={yFor(value)}
                  y2={yFor(value)}
                  className={value === 0 ? 'stroke-border' : 'stroke-border/60'}
                  shapeRendering="crispEdges"
                />
                <text
                  x={PAD_LEFT - 10}
                  y={yFor(value)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-muted-foreground text-[11px] tabular-nums"
                >
                  {value === 0 ? '0' : compact.format(value)}
                </text>
              </g>
            ))}

            {sortedEras.slice(1).map((era) => (
              <line
                key={`${era.name}-${era.startYear}`}
                x1={xFor(era.startYear) - gap / 2}
                x2={xFor(era.startYear) - gap / 2}
                y1={PAD_TOP}
                y2={yFor(0)}
                className="stroke-border"
                shapeRendering="crispEdges"
              />
            ))}

            {shown ? (
              <rect
                x={xFor(shown.from) - gap / 2}
                y={PAD_TOP - 4}
                width={Math.max(2, xFor(Math.min(shown.to + 1, last)) - xFor(shown.from))}
                height={plotH + 4}
                rx={6}
                className="fill-brand/10 stroke-brand/40"
              />
            ) : null}

            {current && !brush ? (
              <rect
                x={xFor(current.start) - gap / 2}
                y={PAD_TOP - 4}
                width={slot}
                height={plotH + 4}
                rx={6}
                className="fill-accent"
              />
            ) : null}

            {bins.map((bin, i) => {
              const x = xFor(bin.start)
              const inSelection = shown ? bin.start >= shown.from && bin.start <= shown.to : true
              const isActive = active === i
              return (
                <g
                  key={bin.start}
                  clipPath={`url(#${clipId}-${i})`}
                  className="transition-opacity duration-150"
                  opacity={inSelection ? 1 : 0.5}
                >
                  <rect
                    x={x}
                    y={PAD_TOP}
                    width={barW}
                    height={plotH}
                    className={isActive ? 'fill-muted-foreground/45' : 'fill-muted-foreground/25'}
                  />
                  <rect
                    x={x}
                    y={yFor(bin.battles + bin.deaths)}
                    width={barW}
                    height={yFor(0) - yFor(bin.battles + bin.deaths)}
                    className="fill-muted-foreground/70"
                  />
                  <rect
                    x={x}
                    y={yFor(bin.battles)}
                    width={barW}
                    height={yFor(0) - yFor(bin.battles)}
                    className="fill-chart-5"
                  />
                </g>
              )
            })}

            {yearTicks.map((year) => (
              <text
                key={year}
                x={xFor(year)}
                y={HEIGHT - 6}
                textAnchor={year === first ? 'start' : 'middle'}
                className="fill-muted-foreground text-[11px] tabular-nums"
              >
                {year}
              </text>
            ))}
          </svg>
        ) : null}

        {current && !brush ? (
          <div
            className="pointer-events-none absolute z-10 w-52 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md"
            style={{
              left: Math.min(Math.max(currentX - 104, PAD_LEFT), Math.max(width - 208, PAD_LEFT)),
              bottom: HEIGHT - yFor(current.total) + 10,
            }}
          >
            <p className="mb-1.5 font-medium tabular-nums">
              Years {current.start}–{current.start + binYears - 1}
            </p>
            <dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1">
              <TooltipRow swatch="bg-muted-foreground/25" label="Events" value={current.total} />
              <TooltipRow swatch="bg-muted-foreground/70" label="Deaths" value={current.deaths} />
              <TooltipRow swatch="bg-chart-5" label="Acts of war" value={current.battles} />
              <TooltipRow swatch="bg-transparent" label="Art and faith" value={current.culture} />
            </dl>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <Swatch className="bg-muted-foreground/25">Everything recorded</Swatch>
        <Swatch className="bg-muted-foreground/70">Deaths</Swatch>
        <Swatch className="bg-chart-5">War & battle</Swatch>
        <span className="ml-auto">
          {onSelect
            ? `Each bar is ${binYears} year${binYears === 1 ? '' : 's'}. Click or drag to choose the years to read.`
            : `Each bar is ${binYears} year${binYears === 1 ? '' : 's'}. Hover for numbers.`}
        </span>
      </div>
    </div>
  )
}

const EraLabel = ({ name, since }: { name: string; since: number | null }) => (
  <>
    <span className="truncate">{name}</span>
    <span className="shrink-0 font-normal text-muted-foreground tabular-nums">
      {since === null ? 'from the beginning' : `from ${since}`}
    </span>
  </>
)

const Swatch = ({ className, children }: { className: string; children: React.ReactNode }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className={cn('inline-block size-2.5 rounded-[3px]', className)} />
    {children}
  </span>
)

const TooltipRow = ({ swatch, label, value }: { swatch: string; label: string; value: number }) => (
  <>
    <span className={cn('size-2 rounded-[2px]', swatch)} />
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="text-right tabular-nums">{value.toLocaleString()}</dd>
  </>
)
