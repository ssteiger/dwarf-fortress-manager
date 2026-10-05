import { type FortEvent, postgres_db, schema } from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { type SQL, desc, sql } from 'drizzle-orm'

import { mentionNeedles } from '../format'
import { currentTimeline, ofFortress, undoneIn } from './fortState'

/*
 * Server functions for the chronicle: the fortress's announcements,
 * searched and filtered, and how often each name comes up in them.
 */

const E = schema.fort_events

export interface FortEventsQuery {
  limit?: number
  q?: string
  /** A unit's name: matches it in full, or as "`Nickname' Surname". */
  unitName?: string
  /** Only the loaded fortress, rather than every fortress the worker has seen. */
  fortressOnly?: boolean
  /** Leave out job cancellations, which drown out everything else about a dwarf. */
  withoutCancellations?: boolean
}

export const getFortEvents = createServerFn({ method: 'GET' })
  .inputValidator((input: FortEventsQuery) => input)
  .handler(async ({ data }): Promise<FortEvent[]> => {
    const limit = Math.min(Math.max(data.limit ?? 300, 10), 2000)
    const q = (data.q ?? '').trim()
    const timeline = await currentTimeline()
    const conditions: SQL[] = []
    if (q) conditions.push(sql`${E.text} ilike ${`%${q}%`}`)
    const needles = data.unitName ? mentionNeedles(data.unitName) : []
    if (needles.length)
      conditions.push(
        sql`(${sql.join(
          needles.map((n) => sql`${E.text} ilike ${`%${n}%`}`),
          sql` or `,
        )})`,
      )
    if (data.withoutCancellations) conditions.push(sql`coalesce(${E.type}, '') <> 'CANCEL_JOB'`)
    if (timeline) {
      conditions.push(sql`not ${undoneIn(timeline)}`)
      if (data.fortressOnly) conditions.push(ofFortress(timeline))
    }
    const base = postgres_db.select().from(E)
    const query = conditions.length ? base.where(sql.join(conditions, sql` and `)) : base
    return query.orderBy(desc(E.game_year), desc(E.game_tick), desc(E.id)).limit(limit)
  })

/**
 * How many of the fortress's announcements quote each name, in full or in
 * the nicknamed form. Matching is case-insensitive.
 */
export const getChronicleMentionCounts = createServerFn({ method: 'GET' })
  .inputValidator((input: { names: string[] }) => input)
  .handler(async ({ data }): Promise<{ name: string; count: number }[]> => {
    const names = [
      ...new Set(data.names.map((name) => name.trim()).filter((name) => name.length > 0)),
    ].slice(0, 500)
    if (names.length === 0) return []
    const timeline = await currentTimeline()
    const rows = await postgres_db
      .select({ text: E.text })
      .from(E)
      .where(timeline ? sql`${ofFortress(timeline)} and not ${undoneIn(timeline)}` : undefined)
    const texts = rows.map((row) => row.text.toLowerCase())
    return names.map((name) => {
      const needles = mentionNeedles(name).map((n) => n.toLowerCase())
      return {
        name,
        count: texts.reduce(
          (sum, text) => sum + (needles.some((needle) => text.includes(needle)) ? 1 : 0),
          0,
        ),
      }
    })
  })
