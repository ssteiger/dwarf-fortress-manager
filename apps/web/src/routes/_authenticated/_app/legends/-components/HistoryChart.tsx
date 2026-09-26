import * as React from 'react'

import type { TimelineBin } from '~/lib/legends/server'

export interface YearSpan {
  from: number
  to: number
}

/**
 * Recorded events per span of years, with the share that were battles or
 * deaths. Eras are marked along the top. Click a bar, drag across several,
 * or click an era's name to pick the years the chronicle below should tell.
 */
export function HistoryChart({
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
}) {
  const [active, setActive] = React.useState<number | null>(null)
  const [brush, setBrush] = React.useState<{ start: number; end: number } | null>(null)
  const svgRef = React.useRef<SVGSVGElement>(null)
  if (!bins.length) return <p className="text-sm text-muted-foreground">No dated events yet.</p>

  const width = 720
  const height = 180
  const padLeft = 44
  const padBottom = 26
  const padTop = 18
  const plotW = width - padLeft - 8
  const plotH = height - padBottom - padTop
  const maxTotal = Math.max(...bins.map((b) => b.total), 1)
  const first = bins[0].start
  const last = bins[bins.length - 1].start + binYears
  const span = Math.max(last - first, 1)
  const barW = Math.max(2, (plotW / span) * binYears - 1.5)
  const xFor = (year: number) => padLeft + ((year - first) / span) * plotW
  const yFor = (value: number) => padTop + plotH - (value / maxTotal) * plotH

  const labelEvery = Math.max(1, Math.ceil(bins.length / 8))
  const current = active !== null ? bins[active] : null

  /** Year under a client x, snapped to the start of its bin. */
  const yearAt = (clientX: number): number => {
    const svg = svgRef.current
    if (!svg) return first
    const rect = svg.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * width
    const year = first + ((x - padLeft) / plotW) * span
    const snapped = Math.floor(year / binYears) * binYears
    return Math.min(Math.max(snapped, first), last - binYears)
  }

  const eraSpan = (index: number): YearSpan => {
    const sorted = [...eras].sort((a, b) => a.startYear - b.startYear)
    const start = Math.max(sorted[index].startYear, first)
    const next = sorted[index + 1]?.startYear
    return { from: start, to: (next ?? last) - 1 }
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!onSelect) return
    const year = yearAt(e.clientX)
    setBrush({ start: year, end: year })
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (brush) setBrush({ ...brush, end: yearAt(e.clientX) })
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

  return (
    <div className="flex flex-col gap-2">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        className={onSelect ? 'h-auto w-full cursor-crosshair select-none' : 'h-auto w-full'}
        role="img"
        aria-label="Events recorded per period"
        style={{ touchAction: 'none' }}
        onMouseLeave={() => setActive(null)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => setBrush(null)}
      >
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line
              x1={padLeft}
              x2={width - 8}
              y1={yFor(maxTotal * f)}
              y2={yFor(maxTotal * f)}
              stroke="currentColor"
              strokeOpacity={0.12}
            />
            <text
              x={padLeft - 6}
              y={yFor(maxTotal * f) + 3}
              textAnchor="end"
              fontSize={10}
              fill="currentColor"
              fillOpacity={0.6}
            >
              {Math.round(maxTotal * f).toLocaleString()}
            </text>
          </g>
        ))}
        {shown ? (
          <rect
            x={xFor(shown.from)}
            y={padTop - 2}
            width={Math.max(2, xFor(Math.min(shown.to + 1, last)) - xFor(shown.from))}
            height={plotH + 4}
            fill="#fbbf24"
            fillOpacity={0.18}
            stroke="#f59e0b"
            strokeOpacity={0.8}
            rx={2}
          />
        ) : null}
        {bins.map((bin, i) => {
          const x = xFor(bin.start)
          const isActive = active === i
          const inSelection = shown ? bin.start >= shown.from && bin.start <= shown.to : true
          return (
            <g
              key={bin.start}
              onMouseEnter={() => setActive(i)}
              opacity={(active === null || isActive ? 1 : 0.65) * (inSelection ? 1 : 0.45)}
            >
              <rect x={x} y={padTop} width={barW} height={plotH} fill="transparent" />
              <rect
                x={x}
                y={yFor(bin.total)}
                width={barW}
                height={plotH - (yFor(bin.total) - padTop)}
                fill="#0ea5e9"
                fillOpacity={0.35}
                rx={1}
              />
              <rect
                x={x}
                y={yFor(bin.battles + bin.deaths)}
                width={barW}
                height={yFor(0) - yFor(bin.battles + bin.deaths)}
                fill="#78716c"
                rx={1}
              />
              <rect
                x={x}
                y={yFor(bin.battles)}
                width={barW}
                height={yFor(0) - yFor(bin.battles)}
                fill="#dc2626"
                rx={1}
              />
              {i % labelEvery === 0 ? (
                <text x={x} y={height - 8} fontSize={10} fill="currentColor" fillOpacity={0.7}>
                  {bin.start}
                </text>
              ) : null}
            </g>
          )
        })}
        {[...eras]
          .sort((a, b) => a.startYear - b.startYear)
          .map((era, index) =>
            era.startYear >= first - binYears && era.startYear <= last ? (
              <g
                key={`${era.name}-${era.startYear}`}
                className={onSelect ? 'cursor-pointer' : undefined}
                onPointerDown={(e) => {
                  if (!onSelect) return
                  e.stopPropagation()
                  onSelect(eraSpan(index))
                }}
              >
                <line
                  x1={xFor(Math.max(era.startYear, first))}
                  x2={xFor(Math.max(era.startYear, first))}
                  y1={4}
                  y2={height - padBottom}
                  stroke="#f59e0b"
                  strokeDasharray="3 3"
                />
                <text
                  x={xFor(Math.max(era.startYear, first)) + 4}
                  y={12}
                  fontSize={10}
                  fill="#b45309"
                  className={onSelect ? 'hover:underline' : undefined}
                >
                  {era.name}
                </text>
              </g>
            ) : null,
          )}
      </svg>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm bg-sky-500/40" /> Everything recorded
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm bg-stone-500" /> Deaths
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm bg-red-600" /> War & battle
        </span>
        <span className="ml-auto tabular-nums">
          {current
            ? `Years ${current.start}–${current.start + binYears - 1}: ${current.total.toLocaleString()} events, ${current.deaths.toLocaleString()} deaths, ${current.battles.toLocaleString()} acts of war, ${current.culture.toLocaleString()} of art and faith`
            : onSelect
              ? `Each bar is ${binYears} year${binYears === 1 ? '' : 's'}. Click or drag to choose the years to read.`
              : `Each bar is ${binYears} year${binYears === 1 ? '' : 's'}. Hover for numbers.`}
        </span>
      </div>
    </div>
  )
}
