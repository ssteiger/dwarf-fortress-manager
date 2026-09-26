import {
  type DumpProgress,
  type FortStatus,
  WORKER_HEARTBEAT_MS,
  parseDumpProgress,
  postgres_db,
  schema,
} from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { eq, sql } from 'drizzle-orm'

import { getSupabaseServerClient } from '~/lib/utils/supabase/server'

/*
 * When the worker reads the game. The web app only writes the schedule and
 * requests into fort_worker; the worker picks them up within a few seconds.
 */

const W = schema.fort_worker
const SINGLETON_ID = 1

/** Before the worker has run once, it starts from DF_POLL_MS, 30 s by default. */
const DEFAULT_INTERVAL_MS = 30_000
export const MIN_DUMP_INTERVAL_MS = 10_000
export const MAX_DUMP_INTERVAL_MS = 60 * 60_000

/** A few missed heartbeats and the worker counts as stopped. */
const WORKER_GONE_AFTER_S = (WORKER_HEARTBEAT_MS * 3) / 1000

export interface DumpState {
  /** Off: the game is only read when someone presses refresh. */
  auto: boolean
  intervalMs: number
  /** A read was asked for and the worker has not finished one since. */
  pending: boolean
  /** Heard from the worker within the last few heartbeats. */
  workerRunning: boolean
  /** The worker's last heartbeat; null if it never ran since this was added. */
  workerSeenAt: string | null
  /** When the worker last tried to read the game, and what it found. */
  lastDumpAt: string | null
  status: FortStatus | null
  /** How long the game was paused for the last read. */
  elapsedMs: number | null
  /** Where the latest read is, or how it ended; null once a new request clears it. */
  progress: DumpProgress | null
}

async function requireUser() {
  const {
    data: { user },
  } = await getSupabaseServerClient().auth.getUser()
  if (!user) throw new Error('You must be signed in')
  return user
}

export const getDumpState = createServerFn({ method: 'GET' }).handler(
  async (): Promise<DumpState> => {
    await requireUser()
    const [worker, state] = await Promise.all([
      postgres_db
        .select({
          auto: W.auto_dump,
          intervalMs: W.dump_interval_ms,
          pending: sql<boolean>`${W.dump_requested_at} is not null and (${W.dump_answered_at} is null or ${W.dump_answered_at} < ${W.dump_requested_at})`,
          workerRunning: sql<boolean>`coalesce(${W.seen_at} > now() - make_interval(secs => ${WORKER_GONE_AFTER_S}), false)`,
          workerSeenAt: W.seen_at,
          progress: W.dump_progress,
        })
        .from(W)
        .where(eq(W.id, SINGLETON_ID))
        .limit(1),
      postgres_db
        .select({
          capturedAt: schema.fort_state.captured_at,
          status: schema.fort_state.status,
          elapsedMs: schema.fort_state.elapsed_ms,
        })
        .from(schema.fort_state)
        .where(eq(schema.fort_state.id, SINGLETON_ID))
        .limit(1),
    ])
    const w = worker[0]
    const s = state[0]
    return {
      auto: w?.auto ?? true,
      intervalMs: w?.intervalMs ?? DEFAULT_INTERVAL_MS,
      pending: w?.pending ?? false,
      workerRunning: w?.workerRunning ?? false,
      workerSeenAt: w?.workerSeenAt ?? null,
      lastDumpAt: s?.capturedAt ?? null,
      status: s?.status ?? null,
      elapsedMs: s?.elapsedMs ?? null,
      progress: parseDumpProgress(w?.progress ?? null),
    }
  },
)

export const setDumpSchedule = createServerFn({ method: 'POST' })
  .inputValidator((input: { auto?: boolean; intervalMs?: number }) => input)
  .handler(async ({ data }): Promise<void> => {
    await requireUser()
    const set: { auto_dump?: boolean; dump_interval_ms?: number } = {}
    if (data.auto !== undefined) {
      if (typeof data.auto !== 'boolean') throw new Error('Automatic reads are on or off')
      set.auto_dump = data.auto
    }
    if (data.intervalMs !== undefined) {
      const ms = data.intervalMs
      if (!Number.isInteger(ms) || ms < MIN_DUMP_INTERVAL_MS || ms > MAX_DUMP_INTERVAL_MS)
        throw new Error('Choose between 10 seconds and an hour')
      set.dump_interval_ms = ms
    }
    if (!Object.keys(set).length) return
    await postgres_db
      .insert(W)
      .values({ id: SINGLETON_ID, ...set })
      .onConflictDoUpdate({ target: W.id, set })
  })

/**
 * Ask the worker to read the game now. Asking again before it has answered
 * does not cost a second read: one dump answers every request made before it
 * finished. A read already under way keeps its progress, since it is the one
 * that answers; an ended one is cleared so it is not mistaken for the answer.
 */
export const requestDump = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ workerRunning: boolean }> => {
    await requireUser()
    const [row] = await postgres_db
      .insert(W)
      .values({ id: SINGLETON_ID, dump_requested_at: sql`now()` })
      .onConflictDoUpdate({
        target: W.id,
        set: {
          dump_requested_at: sql`now()`,
          dump_progress: sql`case when ${W.dump_progress}->>'state' = 'running' then ${W.dump_progress} end`,
        },
      })
      .returning({
        workerRunning: sql<boolean>`coalesce(${W.seen_at} > now() - make_interval(secs => ${WORKER_GONE_AFTER_S}), false)`,
      })
    return { workerRunning: row?.workerRunning ?? false }
  },
)
