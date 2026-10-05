import {
  type QueryCache,
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import * as React from 'react'

import { getFortDiplomacy } from '../server/diplomacy'
import { getFortDead, getFortRecap, getFortSeasons } from '../server/history'
import { getFortItem, getFortSupplies } from '../server/items'
import { getFortAutomation, getFortConcerns, getFortOverview } from '../server/overview'
import { getFortPeople, getFortUnit, getFortUnits } from '../server/units'
import { getDumpState } from '../server/worker'
import type { GameTime } from '../time'

/*
 * Browser only: the React Query hooks every fortress page reads through.
 * They share keys, so pages that read the same server function share one
 * fetch, and they all refetch together when the worker writes a new dump.
 */

/**
 * How often the app asks Postgres whether the worker has written a new dump;
 * the fortress queries refetch only when it has. Slower for the other readers
 * of the dump state.
 */
export const FORT_REFRESH_MS = 5_000
export const FORT_SLOW_REFRESH_MS = 20_000

export const DUMP_STATE_KEY = ['fort', 'dump']

/**
 * When the worker reads the game; polled every second while a read is on its
 * way, twice as often with `watch` so each step shows. `paused` holds off
 * while a request is being sent, so a poll from before it cannot answer it.
 */
export function useDumpState({ watch = false, paused = false, every = FORT_SLOW_REFRESH_MS } = {}) {
  return useQuery({
    queryKey: DUMP_STATE_KEY,
    queryFn: () => getDumpState(),
    refetchInterval: (query) =>
      paused ? false : query.state.data?.pending ? (watch ? 500 : 1_000) : every,
  })
}

/** The dump state as the app's own poll last saw it, without polling again. */
export function useLastDumpState() {
  return useQuery({ queryKey: DUMP_STATE_KEY, queryFn: () => getDumpState(), enabled: false }).data
}

/** Queries under ['fort'] that do not come from the dump, or keep their own pace. */
const OWN_PACE = new Set([
  'dump',
  'dfhack-runs',
  'nickname-ideas',
  'nickname-reason',
  'unit-dossier',
  'voice-status',
])

export interface FailingRead {
  /** The second part of the query key: 'units', 'overview', ... */
  what: string
  message: string
  /** When it last read fine, in ms; 0 if it never has. */
  lastGoodAt: number
}

function failingReads(cache: QueryCache): string {
  return JSON.stringify(
    cache
      .findAll({ queryKey: ['fort'], type: 'active' })
      .filter(
        (q) =>
          q.state.status === 'error' &&
          (q.queryKey[1] === 'dump' || !OWN_PACE.has(String(q.queryKey[1]))),
      )
      .map(
        (q): FailingRead => ({
          what: String(q.queryKey[1] ?? ''),
          message: q.state.error instanceof Error ? q.state.error.message : String(q.state.error),
          lastGoodAt: q.state.dataUpdatedAt,
        }),
      ),
  )
}

/**
 * Fortress reads on this page whose last fetch failed. React Query keeps
 * their last good data, so the page goes on showing it.
 */
export function useFailingFortReads(): FailingRead[] {
  const cache = useQueryClient().getQueryCache()
  const subscribe = React.useCallback((onChange: () => void) => cache.subscribe(onChange), [cache])
  const snapshot = React.useSyncExternalStore(
    subscribe,
    () => failingReads(cache),
    () => '[]',
  )
  return React.useMemo(() => JSON.parse(snapshot) as FailingRead[], [snapshot])
}

/**
 * The one poll the fortress pages need: when the worker writes a new dump or
 * reports on the game, every query that reads from it refetches. Mounted once,
 * in the app layout.
 */
export function useFortDumpWatch() {
  const client = useQueryClient()
  const { data, dataUpdatedAt } = useDumpState({ every: FORT_REFRESH_MS })
  const mark = data ? `${data.dumpCapturedAt}|${data.lastDumpAt}` : null
  const seen = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!mark) return
    if (seen.current !== null && seen.current !== mark)
      void client.invalidateQueries({
        queryKey: ['fort'],
        predicate: (query) => !OWN_PACE.has(String(query.queryKey[1])),
      })
    seen.current = mark
  }, [mark, client])
  React.useEffect(() => {
    if (!dataUpdatedAt) return
    void client.refetchQueries({
      queryKey: ['fort'],
      type: 'active',
      predicate: (query) =>
        query.state.status === 'error' &&
        query.state.fetchStatus === 'idle' &&
        !OWN_PACE.has(String(query.queryKey[1])),
    })
  }, [dataUpdatedAt, client])
}

export function useFortOverview() {
  return useQuery({
    queryKey: ['fort', 'overview'],
    queryFn: () => getFortOverview(),
  })
}

/** Every unit in the last dump; shared by the overview, the grid and the edge dwarves. */
export function useFortUnits() {
  return useQuery({
    queryKey: ['fort', 'units'],
    queryFn: () => getFortUnits(),
  })
}

export function useFortConcerns() {
  return useQuery({
    queryKey: ['fort', 'concerns'],
    queryFn: () => getFortConcerns(),
  })
}

export function useFortSupplies() {
  return useQuery({
    queryKey: ['fort', 'supplies'],
    queryFn: () => getFortSupplies(),
  })
}

/** Bonds between citizens and the talents they may not use, read from every sheet. */
export function useFortPeople() {
  return useQuery({
    queryKey: ['fort', 'people'],
    queryFn: () => getFortPeople(),
  })
}

/** Neighbours, wars, petitions and invasion triggers; they change slowly. */
export function useFortDiplomacy() {
  return useQuery({
    queryKey: ['fort', 'diplomacy'],
    queryFn: () => getFortDiplomacy(),
  })
}

/** Which DFHack plugins run in the game. */
export function useFortAutomation() {
  return useQuery({
    queryKey: ['fort', 'automation'],
    queryFn: () => getFortAutomation(),
  })
}

/** The fortress's dead and those who left; they change slowly. */
export function useFortDead() {
  return useQuery({
    queryKey: ['fort', 'dead'],
    queryFn: () => getFortDead(),
  })
}

/** What happened from `from` to the present, told from every source the app keeps. */
export function useFortRecap(from: GameTime | null) {
  return useQuery({
    queryKey: ['fort', 'recap', from?.year, from?.tick],
    queryFn: () => getFortRecap({ data: { from: from ?? { year: 0, tick: 0 } } }),
    enabled: from !== null,
    placeholderData: keepPreviousData,
  })
}

/** The fortress's seasons, newest first, a page at a time. */
export function useFortSeasons() {
  return useInfiniteQuery({
    queryKey: ['fort', 'seasons'],
    queryFn: ({ pageParam }) =>
      getFortSeasons({ data: pageParam === null ? {} : { before: pageParam } }),
    initialPageParam: null as number | null,
    getNextPageParam: (page) => page.next,
  })
}

export function useFortUnit(id: number) {
  return useQuery({
    queryKey: ['fort', 'unit', id],
    queryFn: () => getFortUnit({ data: { id } }),
    enabled: Number.isFinite(id),
  })
}

export function useFortItem(id: number) {
  return useQuery({
    queryKey: ['fort', 'item', id],
    queryFn: () => getFortItem({ data: { id } }),
    enabled: Number.isFinite(id),
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
