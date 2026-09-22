import * as React from 'react'

import type { TimelineBin } from '~/lib/legends/server'

/**
 * Recorded events per span of years, with the share that were battles or
 * deaths. Eras are marked along the top.
 */
export function HistoryChart({
  bins,
  binYears,
  eras,
}: {
  bins: TimelineBin[]
  binYears: number
  eras: { name: string; startYear: number }[]
}) {
  const [active, setActive] = React.useState<number | null>(null)
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

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label="Events recorded per period"
        onMouseLeave={() => setActive(null)}
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
        {bins.map((bin, i) => {
          const x = xFor(bin.start)
          const isActive = active === i
          return (
            <g
              key={bin.start}
              onMouseEnter={() => setActive(i)}
              opacity={active === null || isActive ? 1 : 0.65}
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
        {eras
          .filter((era) => era.startYear >= first && era.startYear <= last)
          .map((era) => (
            <g key={`${era.name}-${era.startYear}`}>
              <line
                x1={xFor(era.startYear)}
                x2={xFor(era.startYear)}
                y1={4}
                y2={height - padBottom}
                stroke="#f59e0b"
                strokeDasharray="3 3"
              />
              <text x={xFor(era.startYear) + 4} y={12} fontSize={10} fill="#b45309">
                {era.name}
              </text>
            </g>
          ))}
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
            : `Each bar is ${binYears} year${binYears === 1 ? '' : 's'}. Hover for numbers.`}
        </span>
      </div>
    </div>
  )
}
