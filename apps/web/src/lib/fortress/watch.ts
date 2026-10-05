import { fortKeyOf } from '@fortress/db-drizzle/snapshots'
import * as React from 'react'

import { useFortOverview } from './queries'

/*
 * Client-only: the creatures the player watches, per fortress. Changes to
 * them come first in "since your last look", in the compact view and in
 * alerts. Kept in localStorage like the other choices of this browser.
 */

const STORAGE_KEY = 'fort-watch'
const listeners = new Set<() => void>()

type Stored = Record<string, number[]>

function readRaw(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '{}'
  } catch {
    return '{}'
  }
}

function parse(raw: string): Stored {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Stored) : {}
  } catch {
    return {}
  }
}

function write(next: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Private windows: the list lasts until the page closes.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

const NOTHING: ReadonlySet<number> = new Set()

export interface WatchList {
  fortKey: string | null
  ids: ReadonlySet<number>
  toggle: (unitId: number) => void
}

/** The loaded fortress's watch list; changes in one tab show in the others. */
export function useWatchList(): WatchList {
  const world = useFortOverview().data?.state?.world
  const fortKey = fortKeyOf(world)
  const raw = React.useSyncExternalStore(subscribe, readRaw, () => '{}')
  const ids = React.useMemo(() => {
    const list = fortKey ? parse(raw)[fortKey] : undefined
    return Array.isArray(list) ? new Set(list.filter(Number.isSafeInteger)) : NOTHING
  }, [raw, fortKey])
  const toggle = React.useCallback(
    (unitId: number) => {
      if (!fortKey) return
      const stored = parse(readRaw())
      const list = new Set(stored[fortKey] ?? [])
      if (list.has(unitId)) list.delete(unitId)
      else list.add(unitId)
      if (list.size) stored[fortKey] = [...list]
      else delete stored[fortKey]
      write(stored)
    },
    [fortKey],
  )
  return { fortKey, ids, toggle }
}

/** How many creatures are watched, across every fortress. */
export function watchCount(): number {
  return Object.values(parse(readRaw())).reduce(
    (sum, list) => sum + (Array.isArray(list) ? list.length : 0),
    0,
  )
}

export function clearWatchLists() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing stored to remove.
  }
  for (const listener of listeners) listener()
}
