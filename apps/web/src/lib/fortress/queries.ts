import { useQuery } from '@tanstack/react-query'
import * as React from 'react'
import { getFortItem, getFortOverview, getFortUnit } from './server'

/** Shared polling cadence for the fortress pages (reads Postgres, not the game). */
export const FORT_REFRESH_MS = 5_000
export const FORT_SLOW_REFRESH_MS = 20_000

export function useFortOverview() {
  return useQuery({
    queryKey: ['fort', 'overview'],
    queryFn: () => getFortOverview(),
    refetchInterval: FORT_REFRESH_MS,
  })
}

export function useFortUnit(id: number) {
  return useQuery({
    queryKey: ['fort', 'unit', id],
    queryFn: () => getFortUnit({ data: { id } }),
    enabled: Number.isFinite(id),
    refetchInterval: FORT_REFRESH_MS * 2,
  })
}

export function useFortItem(id: number) {
  return useQuery({
    queryKey: ['fort', 'item', id],
    queryFn: () => getFortItem({ data: { id } }),
    enabled: Number.isFinite(id),
    refetchInterval: FORT_REFRESH_MS * 2,
  })
}

/**
 * Re-render on a fixed cadence without writing to state from an effect, so
 * relative timestamps ("12 seconds ago") stay fresh.
 */
export function useTick(intervalMs: number): number {
  return React.useSyncExternalStore(
    React.useCallback(
      (onChange) => {
        const id = setInterval(onChange, intervalMs)
        return () => clearInterval(id)
      },
      [intervalMs],
    ),
    () => Math.floor(Date.now() / intervalMs),
    () => 0,
  )
}
