import * as React from 'react'

import type { GameTime } from './insights'

/** Client-only: where the chronicle stood the last time the overview was open. */
export interface LastSeen {
  /** Highest fort_events id shown. */
  eventId: number
  game: GameTime | null
  /** Wall-clock time, ms. */
  at: number
}

const STORAGE_KEY = 'fort-last-seen'

function read(): LastSeen | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    return parsed && typeof parsed.eventId === 'number' ? (parsed as LastSeen) : null
  } catch {
    return null
  }
}

/**
 * The previous visit's mark, fixed for the life of this page, while the mark
 * itself keeps moving with what this visit shows.
 */
export function useLastSeen(current: { eventId: number; game: GameTime | null } | null) {
  const [previous, setPrevious] = React.useState<LastSeen | null>(null)
  const [ready, setReady] = React.useState(false)
  React.useEffect(() => {
    setPrevious(read())
    setReady(true)
  }, [])
  const eventId = current?.eventId
  const year = current?.game?.year
  const tick = current?.game?.tick
  React.useEffect(() => {
    if (!ready || eventId === undefined) return
    const mark: LastSeen = {
      eventId,
      game: year !== undefined && tick !== undefined ? { year, tick } : null,
      at: Date.now(),
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mark))
    } catch {
      // Private windows: nothing to compare with next time.
    }
  }, [ready, eventId, year, tick])
  return previous
}
