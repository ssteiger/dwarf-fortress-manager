import { type LegendsPayload, type LegendsRecord, postgres_db, schema } from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { type SQL, and, asc, desc, eq, inArray, isNull, notInArray, or, sql } from 'drizzle-orm'

import type { NameIndex } from '../types'
import { type RefSet, addRefs, eventsWhere, lookupNames } from './records'

/*
 * Server function: the historical events that mention one record, a page
 * at a time.
 */

const R = schema.legends_records

export interface LegendsEventsQuery {
  worldId: number
  kind: string
  id: number
  page?: number
  pageSize?: number
  /** Only these event types; empty means all. */
  types?: string[]
  /** Never these event types. */
  excludeTypes?: string[]
  order?: 'asc' | 'desc'
}

export interface LegendsEventsResult {
  events: LegendsRecord[]
  total: number
  page: number
  pageSize: number
  names: NameIndex
  /** Event type -> count, across every event for this record. */
  byType: Record<string, number>
}

export const getLegendsEvents = createServerFn({ method: 'GET' })
  .inputValidator((input: LegendsEventsQuery) => input)
  .handler(async ({ data }): Promise<LegendsEventsResult> => {
    const pageSize = Math.min(Math.max(data.pageSize ?? 50, 10), 500)
    const page = Math.max(data.page ?? 0, 0)
    const empty = { events: [], total: 0, page, pageSize, names: {}, byType: {} }

    let payload: LegendsPayload | null = null
    if (data.kind === 'historical_event_collection') {
      const rows = await postgres_db
        .select({ payload: R.payload })
        .from(R)
        .where(and(eq(R.world_id, data.worldId), eq(R.kind, data.kind), eq(R.id, data.id)))
        .limit(1)
      payload = (rows[0]?.payload as LegendsPayload | undefined) ?? null
      if (!payload) return empty
    }
    const base = eventsWhere(data.worldId, data.kind, data.id, payload)
    if (!base) return empty
    const where = and(
      base,
      data.types?.length ? inArray(R.type, data.types) : undefined,
      data.excludeTypes?.length
        ? or(isNull(R.type), notInArray(R.type, data.excludeTypes))
        : undefined,
    ) as SQL
    const order = data.order === 'desc' ? 'desc' : 'asc'
    const seconds = sql`(${R.payload}->>'seconds72')::int`

    const [countRows, byTypeRows, events] = await Promise.all([
      postgres_db.select({ count: sql<number>`count(*)::int` }).from(R).where(where),
      postgres_db
        .select({ type: R.type, count: sql<number>`count(*)::int` })
        .from(R)
        .where(base)
        .groupBy(R.type),
      postgres_db
        .select()
        .from(R)
        .where(where)
        .orderBy(
          ...(order === 'asc'
            ? [asc(R.year), sql`${seconds} asc nulls first`, asc(R.id)]
            : [desc(R.year), sql`${seconds} desc nulls last`, desc(R.id)]),
        )
        .limit(pageSize)
        .offset(page * pageSize),
    ])
    const refs: RefSet = {}
    for (const ev of events) addRefs(refs, ev.payload)
    const names = await lookupNames(data.worldId, refs)
    return {
      events,
      total: countRows[0]?.count ?? 0,
      page,
      pageSize,
      names,
      byType: Object.fromEntries(byTypeRows.map((r) => [r.type ?? 'unknown', Number(r.count)])),
    }
  })
