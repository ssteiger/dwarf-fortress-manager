import { type DumpProgress, postgres_db, schema } from '@fortress/db-drizzle'
import { and, eq, sql } from 'drizzle-orm'
import type { Config } from '../config'

const W = schema.fort_worker
const SINGLETON_ID = 1

export interface DumpSchedule {
  /** Off: dump only when the web app asks. */
  auto: boolean
  intervalMs: number
  /** Someone asked for a dump that no dump has answered yet. */
  requested: boolean
}

/**
 * What Settings chose. The first time the row is created from DF_POLL_MS;
 * after that the choice in Settings wins.
 */
export async function readSchedule(config: Config): Promise<DumpSchedule> {
  const [row] = await postgres_db
    .select({
      auto: W.auto_dump,
      intervalMs: W.dump_interval_ms,
      requested: sql<boolean>`${W.dump_requested_at} is not null and (${W.dump_answered_at} is null or ${W.dump_answered_at} < ${W.dump_requested_at})`,
    })
    .from(W)
    .where(eq(W.id, SINGLETON_ID))
    .limit(1)
  if (row) return row
  await postgres_db
    .insert(W)
    .values({ id: SINGLETON_ID, dump_interval_ms: config.pollMs })
    .onConflictDoNothing({ target: W.id })
  return { auto: true, intervalMs: config.pollMs, requested: false }
}

/** A dump that just finished answers every request made before it did. */
export async function answerDumpRequests(): Promise<void> {
  await postgres_db
    .update(W)
    .set({ dump_answered_at: sql`${W.dump_requested_at}` })
    .where(eq(W.id, SINGLETON_ID))
}

export async function markAlive(): Promise<void> {
  await postgres_db.update(W).set({ seen_at: sql`now()` }).where(eq(W.id, SINGLETON_ID))
}

/** Where the read in progress has got to, or how it ended. */
export async function setDumpProgress(progress: DumpProgress): Promise<void> {
  await postgres_db.update(W).set({ dump_progress: progress }).where(eq(W.id, SINGLETON_ID))
}

/** A read the worker was stopped in the middle of will never end; forget it. */
export async function clearInterruptedDumpProgress(): Promise<void> {
  await postgres_db
    .update(W)
    .set({ dump_progress: null })
    .where(and(eq(W.id, SINGLETON_ID), sql`${W.dump_progress}->>'state' = 'running'`))
}
