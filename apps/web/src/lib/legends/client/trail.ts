import * as React from 'react'

import type { LegendsSpriteSubject } from '~/lib/df-assets/legends'

/**
 * Client-only: the records a reader opened lately, per world, newest first.
 * Kept in localStorage so a thread can be picked up after a reload.
 */

export interface TrailEntry {
  kind: string
  id: number
  title: string
  /** One line of context: "female goblin · born 165". */
  detail?: string
  sprite?: LegendsSpriteSubject | null
  at: number
}

const STORAGE_KEY = 'legends-trail'
const MAX_ENTRIES = 30
const EMPTY: TrailEntry[] = []

type Store = Record<string, TrailEntry[]>

const listeners = new Set<() => void>()
let cache: Store | null = null

function read(): Store {
  if (cache) return cache
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    cache = parsed && typeof parsed === 'object' ? (parsed as Store) : {}
  } catch {
    cache = {}
  }
  return cache
}

function write(next: Store) {
  cache = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Private windows and full quotas: the trail lives for this session only.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return
    cache = null
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function recordVisit(worldId: number, entry: Omit<TrailEntry, 'at'>) {
  const store = read()
  const key = String(worldId)
  const rest = (store[key] ?? []).filter((e) => !(e.kind === entry.kind && e.id === entry.id))
  write({ ...store, [key]: [{ ...entry, at: Date.now() }, ...rest].slice(0, MAX_ENTRIES) })
}

export function clearTrail(worldId: number) {
  const { [String(worldId)]: _, ...rest } = read()
  write(rest)
}

/** Records on the trail, across every world. */
export function trailCount(): number {
  return Object.values(read()).reduce((sum, entries) => sum + entries.length, 0)
}

export function clearAllTrails() {
  write({})
}

export function useTrail(worldId: number | null): TrailEntry[] {
  return React.useSyncExternalStore(
    subscribe,
    () => (worldId === null ? EMPTY : (read()[String(worldId)] ?? EMPTY)),
    () => EMPTY,
  )
}
