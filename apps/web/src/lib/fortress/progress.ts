import * as React from 'react'

/**
 * Client-only: which steps of each guide the player has ticked off, kept in
 * localStorage so a half-done fix survives a reload.
 */

type Store = Record<string, number[]>

const STORAGE_KEY = 'fort-guide-progress'
const MAX_GUIDES = 200
const EMPTY: number[] = []
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
  const keys = Object.keys(next)
  if (keys.length > MAX_GUIDES)
    for (const key of keys.slice(0, keys.length - MAX_GUIDES)) delete next[key]
  cache = next
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Private windows: progress lasts for this page only.
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

/** How many guides have steps ticked off. */
export function stepProgressCount(): number {
  return Object.keys(read()).length
}

export function clearStepProgress() {
  write({})
}

export function useStepProgress(key: string) {
  const done = React.useSyncExternalStore(
    subscribe,
    () => read()[key] ?? EMPTY,
    () => EMPTY,
  )
  const toggle = React.useCallback(
    (index: number) => {
      const store = read()
      const current = store[key] ?? []
      const next = current.includes(index)
        ? current.filter((i) => i !== index)
        : [...current, index]
      const { [key]: _, ...rest } = store
      write(next.length ? { ...rest, [key]: next } : rest)
    },
    [key],
  )
  const reset = React.useCallback(() => {
    const { [key]: _, ...rest } = read()
    write(rest)
  }, [key])
  return { done, toggle, reset }
}
