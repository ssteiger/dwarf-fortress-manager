import { type FortState, postgres_db, schema } from '@fortress/db-drizzle'
import { eq, sql } from 'drizzle-orm'

/*
 * Server only. Everything the web app knows about the fortress comes from
 * Postgres; the worker in apps/worker is the only process that talks to the
 * game. This is the loaded fortress as the worker last saw it (the singleton
 * `fort_state` row) and its timeline: which announcements belong to it, and
 * which a reload of an earlier save has undone.
 */

const SINGLETON_ID = 1
const E = schema.fort_events

/** The loaded fortress and the moment it has reached, as the chronicle keys it. */
interface Timeline {
  /** Prefix of the fortress's dedupe keys: `save_dir:site_id:`. */
  prefix: string
  year: number
  tick: number
}

export function timelineOf(state: Pick<FortState, 'world'> | null | undefined): Timeline | null {
  const world = state?.world
  if (!world || typeof world.year !== 'number' || typeof world.tick !== 'number') return null
  return {
    prefix: `${world.save_dir}:${world.site_id}:`,
    year: world.year,
    tick: world.tick,
  }
}

export async function currentState(): Promise<Pick<FortState, 'world'> | null> {
  const rows = await postgres_db
    .select({ world: schema.fort_state.world })
    .from(schema.fort_state)
    .where(eq(schema.fort_state.id, SINGLETON_ID))
    .limit(1)
  return rows[0] ?? null
}

/** The headline counts the worker keeps with the state: population, wealth, stocks, alerts. */
export async function currentSummary(): Promise<FortState['summary'] | null> {
  const rows = await postgres_db
    .select({ summary: schema.fort_state.summary })
    .from(schema.fort_state)
    .where(eq(schema.fort_state.id, SINGLETON_ID))
    .limit(1)
  return rows[0]?.summary ?? null
}

export async function currentTimeline(): Promise<Timeline | null> {
  return timelineOf(await currentState())
}

export const ofFortress = (t: Timeline) => sql`starts_with(${E.dedupe_key}, ${t.prefix})`

/**
 * Announcements of this fortress dated after its present. They happened in a
 * future that loading an earlier save undid, and the game may never repeat them.
 */
export const undoneIn = (t: Timeline) =>
  sql`(${ofFortress(t)} and (${E.game_year} > ${t.year} or (${E.game_year} = ${t.year} and ${E.game_tick} > ${t.tick})))`
