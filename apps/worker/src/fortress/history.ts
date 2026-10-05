import {
  type FortDumpPayload,
  type FortSnapshot,
  type FortUnit,
  type LifeEvent,
  decodeTable,
  diffSnapshots,
  fortKeyOf,
  gameDay,
  postgres_db,
  schema,
  snapshotOf,
} from '@fortress/db-drizzle'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'

const S = schema.fort_snapshots
const L = schema.fort_life_events
const A = schema.fort_unit_archive

/** The last snapshot written, so most dumps need not read it back. */
let last: { fortKey: string; snapshot: FortSnapshot } | null = null
/** The citizens of the dump before, as the archive keeps those who die or leave. */
let lastSheets: { fortKey: string; units: Map<number, FortUnit> } | null = null

const after = (year: number, tick: number) => (t: typeof S | typeof L | typeof A) =>
  sql`(${t.game_year}, ${t.game_tick}) > (${year}, ${tick})`

async function latestSnapshot(fortKey: string): Promise<FortSnapshot | null> {
  const rows = await postgres_db
    .select()
    .from(S)
    .where(eq(S.fort_key, fortKey))
    .orderBy(desc(S.day))
    .limit(1)
  const row = rows[0]
  return row
    ? { year: row.game_year, tick: row.game_tick, totals: row.totals, units: row.units }
    : null
}

const isEarlier = (a: FortSnapshot, b: { year: number; tick: number }) =>
  a.year < b.year || (a.year === b.year && a.tick < b.tick)

/**
 * Keep the day's snapshot and the life events since the one before. When the
 * game is earlier than what was written (an earlier save was loaded), the
 * snapshots and events of that undone future are dropped first.
 */
export async function recordSnapshot(payload: FortDumpPayload): Promise<{ lifeEvents: number }> {
  const fortKey = fortKeyOf(payload.world)
  const next = snapshotOf(payload)
  if (!fortKey || !next) return { lifeEvents: 0 }

  let prev = last?.fortKey === fortKey ? last.snapshot : await latestSnapshot(fortKey)
  if (prev && isEarlier(next, prev)) {
    const undone = after(next.year, next.tick)
    await postgres_db.delete(S).where(and(eq(S.fort_key, fortKey), undone(S)))
    await postgres_db.delete(L).where(and(eq(L.fort_key, fortKey), undone(L)))
    await postgres_db.delete(A).where(and(eq(A.fort_key, fortKey), undone(A)))
    prev = await latestSnapshot(fortKey)
    lastSheets = null
  }

  const dumped = new Map(decodeTable<FortUnit>(payload.units).map((u) => [u.id, u]))
  let events: LifeEvent[] = []
  if (prev && (prev.year !== next.year || prev.tick !== next.tick)) {
    events = diffSnapshots(prev, next, (id) => {
      const unit = dumped.get(id)
      return unit ? { dead: unit.flags.includes('dead') } : null
    })
    await markReturns(fortKey, events)
    await archiveGone(fortKey, events, dumped)
  } else if (prev) {
    // Paused: the same moment again. Keep what the diff would have carried over.
    for (const [id, unit] of Object.entries(next.units)) unit.low = prev.units[id]?.low
  }

  if (events.length) {
    await postgres_db.insert(L).values(
      events.map((e) => ({
        fort_key: fortKey,
        unit_id: e.unit_id,
        hf: e.hf >= 0 ? e.hf : null,
        kind: e.kind,
        game_year: e.year,
        game_tick: e.tick,
        data: e.data,
      })),
    )
  }

  const row = {
    game_year: next.year,
    game_tick: next.tick,
    captured_at: new Date().toISOString(),
    totals: next.totals,
    units: next.units,
  }
  await postgres_db
    .insert(S)
    .values({ fort_key: fortKey, day: gameDay(next.year, next.tick), ...row })
    .onConflictDoUpdate({ target: [S.fort_key, S.day], set: row })

  last = { fortKey, snapshot: next }
  const citizens = new Map<number, FortUnit>()
  for (const id of Object.keys(next.units)) {
    const unit = dumped.get(Number(id))
    if (unit) citizens.set(unit.id, unit)
  }
  lastSheets = { fortKey, units: citizens }
  return { lifeEvents: events.length }
}

/**
 * Keep the last living sheet of each citizen who died or left, and forget it
 * when they come back.
 */
async function archiveGone(
  fortKey: string,
  events: LifeEvent[],
  dumped: Map<number, FortUnit>,
): Promise<void> {
  const before = lastSheets?.fortKey === fortKey ? lastSheets.units : null
  for (const e of events) {
    if (e.kind === 'arrived' || e.kind === 'returned') {
      await postgres_db.delete(A).where(and(eq(A.fort_key, fortKey), eq(A.unit_id, e.unit_id)))
      continue
    }
    if (e.kind !== 'died' && e.kind !== 'left') continue
    const unit = before?.get(e.unit_id) ?? dumped.get(e.unit_id)
    if (!unit) continue
    const row = {
      reason: e.kind,
      game_year: e.year,
      game_tick: e.tick,
      unit,
      updated_at: new Date().toISOString(),
    }
    await postgres_db
      .insert(A)
      .values({ fort_key: fortKey, unit_id: e.unit_id, ...row })
      .onConflictDoUpdate({ target: [A.fort_key, A.unit_id], set: row })
  }
}

/** A citizen who left the map and is listed again came back rather than arrived. */
async function markReturns(fortKey: string, events: LifeEvent[]): Promise<void> {
  const arrivals = events.filter((e) => e.kind === 'arrived')
  if (!arrivals.length) return
  const rows = await postgres_db
    .selectDistinct({ unit_id: L.unit_id })
    .from(L)
    .where(
      and(
        eq(L.fort_key, fortKey),
        eq(L.kind, 'left'),
        inArray(
          L.unit_id,
          arrivals.map((e) => e.unit_id),
        ),
      ),
    )
  const left = new Set(rows.map((r) => r.unit_id))
  for (const e of arrivals) if (left.has(e.unit_id)) e.kind = 'returned'
}
