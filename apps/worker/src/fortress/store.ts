import {
  type FortAnnouncement,
  type FortDumpPayload,
  type FortStatus,
  decodeTable,
  postgres_db,
  schema,
} from '@fortress/db-drizzle'
import { sql } from 'drizzle-orm'

const SINGLETON_ID = 1

function formatGameDate(payload: FortDumpPayload): string | null {
  const w = payload.world
  if (!w) return null
  return `${w.day} ${w.month_name}, ${w.year} (${w.season})`
}

/** Write the fast dump: state row, dump row, and any new announcements. */
export async function storeLiveDump(
  payload: FortDumpPayload,
  elapsedMs: number,
): Promise<{ newEvents: number }> {
  const now = new Date().toISOString()
  await postgres_db
    .insert(schema.fort_state)
    .values({
      id: SINGLETON_ID,
      status: 'live',
      fort_name: payload.world?.site_name ?? null,
      world_name: payload.world?.name ?? null,
      game_date: formatGameDate(payload),
      captured_at: now,
      world: payload.world,
      summary: payload.summary,
      error: null,
      elapsed_ms: elapsedMs,
    })
    .onConflictDoUpdate({
      target: schema.fort_state.id,
      set: {
        status: 'live',
        fort_name: payload.world?.site_name ?? null,
        world_name: payload.world?.name ?? null,
        game_date: formatGameDate(payload),
        captured_at: now,
        world: payload.world,
        summary: payload.summary,
        error: null,
        elapsed_ms: elapsedMs,
      },
    })

  await postgres_db
    .insert(schema.fort_dump)
    .values({
      id: SINGLETON_ID,
      captured_at: now,
      units: payload.units,
      items: payload.items,
      buildings: payload.buildings,
      jobs: payload.jobs,
      announcements: payload.announcements,
    })
    .onConflictDoUpdate({
      target: schema.fort_dump.id,
      set: {
        captured_at: now,
        units: payload.units,
        items: payload.items,
        buildings: payload.buildings,
        jobs: payload.jobs,
        announcements: payload.announcements,
      },
    })

  const newEvents = await appendEvents(payload)
  return { newEvents }
}

/** Append announcements not yet in the chronicle. */
async function appendEvents(payload: FortDumpPayload): Promise<number> {
  const announcements = decodeTable<FortAnnouncement>(payload.announcements)
  if (announcements.length === 0) return 0
  const worldKey = payload.world ? `${payload.world.save_dir}:${payload.world.site_id}` : 'unknown'
  const rows = announcements.map((a) => ({
    dedupe_key: `${worldKey}:${a.id}:${a.year}:${a.time}`,
    report_id: a.id,
    game_year: a.year,
    game_tick: a.time,
    type: a.type,
    text: a.text,
    x: a.x,
    y: a.y,
    z: a.z,
  }))
  const inserted = await postgres_db
    .insert(schema.fort_events)
    .values(rows)
    .onConflictDoNothing({ target: schema.fort_events.dedupe_key })
    .returning({ id: schema.fort_events.id })
  return inserted.length
}

export async function storeMap(payload: FortDumpPayload): Promise<void> {
  const map = payload.map
  if (!map) return
  const now = new Date().toISOString()
  await postgres_db
    .insert(schema.fort_map)
    .values({
      id: SINGLETON_ID,
      captured_at: now,
      x_count: map.x_count,
      y_count: map.y_count,
      z_count: map.z_count,
      tiletypes: map.tiletypes,
      blocks: map.blocks,
    })
    .onConflictDoUpdate({
      target: schema.fort_map.id,
      set: {
        captured_at: now,
        x_count: map.x_count,
        y_count: map.y_count,
        z_count: map.z_count,
        tiletypes: map.tiletypes,
        blocks: map.blocks,
      },
    })
}

/**
 * Record that the game is on a menu or unreachable. The previous dump is kept
 * so the web app can keep showing the last known fortress.
 */
export async function storeStatus(
  status: Exclude<FortStatus, 'live'>,
  error: string | null,
): Promise<void> {
  const now = new Date().toISOString()
  await postgres_db
    .insert(schema.fort_state)
    .values({ id: SINGLETON_ID, status, captured_at: now, error })
    .onConflictDoUpdate({
      target: schema.fort_state.id,
      set: { status, captured_at: now, error },
    })
}

/** Last status we wrote, so the loop can log transitions only. */
export async function readStatus(): Promise<FortStatus | null> {
  const rows = await postgres_db
    .select({ status: schema.fort_state.status })
    .from(schema.fort_state)
    .where(sql`${schema.fort_state.id} = ${SINGLETON_ID}`)
    .limit(1)
  return rows[0]?.status ?? null
}
