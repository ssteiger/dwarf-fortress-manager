import {
  type FortDumpPayload,
  type FortHistoryEvent,
  type HistoryFigure,
  decodeTable,
  fortKeyOf,
  postgres_db,
  schema,
} from '@fortress/db-drizzle'
import { and, eq, gt } from 'drizzle-orm'

const H = schema.fort_history_events
const C = schema.fort_history_cursors
const INSERT_BATCH = 500

/** Where the next dump should start reading history events, by fortress. */
let cursor: { key: string; lastEventId: number } | null = null

/**
 * The script's history arguments: the last event id read for the fortress
 * the worker saw last. The script starts from the founding when the loaded
 * fortress is another one.
 */
export async function historyCursor(): Promise<{ from: number; key: string } | null> {
  if (!cursor) {
    const state = await postgres_db
      .select({ world: schema.fort_state.world })
      .from(schema.fort_state)
      .limit(1)
    const key = fortKeyOf(state[0]?.world ?? null)
    if (!key) return null
    const rows = await postgres_db.select().from(C).where(eq(C.fort_key, key)).limit(1)
    cursor = { key, lastEventId: rows[0]?.last_event_id ?? -1 }
  }
  return { from: cursor.lastEventId, key: cursor.key }
}

/** Store the events a dump read and move the cursor on. */
export async function recordHistory(
  payload: FortDumpPayload,
): Promise<{ events: number; done: boolean }> {
  const history = payload.history
  const fortKey = fortKeyOf(payload.world)
  if (!history || !fortKey || history.key !== fortKey) return { events: 0, done: true }

  // An earlier save was loaded: events past the game's newest never happened.
  await postgres_db.delete(H).where(and(eq(H.fort_key, fortKey), gt(H.event_id, history.last_id)))

  const events = decodeTable<FortHistoryEvent>(history.events)
  const rows = events.map((e) => {
    const figures: Record<string, HistoryFigure> = {}
    for (const hf of e.hfs) {
      const figure = history.figures[String(hf)]
      if (figure) figures[String(hf)] = figure
    }
    return {
      fort_key: fortKey,
      event_id: e.id,
      type: e.type,
      game_year: e.year,
      game_tick: e.tick,
      here: e.here,
      hfids: e.hfs,
      fields: e.fields,
      extra: { ...e.extra, figures },
    }
  })
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    await postgres_db
      .insert(H)
      .values(rows.slice(i, i + INSERT_BATCH))
      .onConflictDoNothing({ target: [H.fort_key, H.event_id] })
  }

  const lastEventId = Math.max(history.scanned, -1)
  await postgres_db
    .insert(C)
    .values({ fort_key: fortKey, last_event_id: lastEventId })
    .onConflictDoUpdate({
      target: C.fort_key,
      set: { last_event_id: lastEventId, updated_at: new Date().toISOString() },
    })
  cursor = { key: fortKey, lastEventId }
  return { events: rows.length, done: history.done }
}
