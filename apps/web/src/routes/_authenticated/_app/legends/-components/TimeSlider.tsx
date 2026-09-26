import { Button, cn } from '@fortress/ui'
import { PauseIcon, PlayIcon, SkipBackIcon, SkipForwardIcon } from 'lucide-react'
import * as React from 'react'

export const PLAYBACK_SPEEDS = [5, 20, 50, 100] as const
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number]

/**
 * Scrub through the years. Eras are ticked along the track; play rolls the
 * years forward at a chosen pace until the end of the record.
 */
export function TimeSlider({
  min,
  max,
  year,
  eras,
  playing,
  speed,
  onYear,
  onPlaying,
  onSpeed,
  className,
}: {
  min: number
  max: number
  year: number
  eras: { name: string; startYear: number }[]
  playing: boolean
  speed: PlaybackSpeed
  onYear: (year: number) => void
  onPlaying: (playing: boolean) => void
  onSpeed: (speed: PlaybackSpeed) => void
  className?: string
}) {
  const span = Math.max(1, max - min)
  const pct = ((year - min) / span) * 100
  const inputRef = React.useRef<HTMLInputElement>(null)
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="icon"
          variant="outline"
          className="size-8"
          aria-label="Back to the beginning"
          onClick={() => {
            onPlaying(false)
            onYear(min)
          }}
        >
          <SkipBackIcon className="size-4" />
        </Button>
        <Button
          size="icon"
          variant={playing ? 'default' : 'outline'}
          className="size-8"
          aria-label={playing ? 'Pause' : 'Play the years forward'}
          onClick={() => {
            if (!playing && year >= max) onYear(min)
            onPlaying(!playing)
          }}
        >
          {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
        </Button>
        <Button
          size="icon"
          variant="outline"
          className="size-8"
          aria-label="Jump to the present"
          onClick={() => {
            onPlaying(false)
            onYear(max)
          }}
        >
          <SkipForwardIcon className="size-4" />
        </Button>
        <div className="ml-1 text-2xl font-semibold tabular-nums" aria-live="off">
          {year}
        </div>
        <div className="text-sm text-muted-foreground">
          {year >= max
            ? 'the present'
            : `${(max - year).toLocaleString()} years before the present`}
        </div>
        <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
          <span className="mr-1">speed</span>
          {PLAYBACK_SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSpeed(s)}
              className={cn(
                'rounded px-1.5 py-0.5 tabular-nums hover:bg-accent',
                s === speed && 'bg-accent font-medium text-foreground',
              )}
            >
              {s}/s
            </button>
          ))}
        </div>
      </div>
      <div className="relative pt-4 pb-1">
        {eras
          .filter((era) => era.startYear >= min && era.startYear <= max)
          .map((era) => (
            <button
              key={`${era.name}-${era.startYear}`}
              type="button"
              className="absolute top-0 -translate-x-1/2 text-[10px] text-amber-600 whitespace-nowrap hover:underline dark:text-amber-400"
              style={{ left: `${((era.startYear - min) / span) * 100}%` }}
              onClick={() => onYear(era.startYear)}
              title={`Go to ${era.startYear}`}
            >
              {era.name}
            </button>
          ))}
        <input
          ref={inputRef}
          type="range"
          min={min}
          max={max}
          value={year}
          onChange={(e) => onYear(Number(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === ' ') {
              e.preventDefault()
              onPlaying(!playing)
            }
          }}
          className="relative z-10 w-full accent-amber-500"
          aria-label="Year"
          aria-valuetext={`Year ${year}`}
        />
        <div
          className="pointer-events-none absolute right-0 bottom-0 left-0 h-1 rounded bg-amber-500/25"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
