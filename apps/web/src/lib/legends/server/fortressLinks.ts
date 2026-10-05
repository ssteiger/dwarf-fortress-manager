import {
  type FortUnit,
  type JsonObject,
  decodeTable,
  postgres_db,
  schema,
} from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { and, eq, inArray, sql } from 'drizzle-orm'

import { isLiving, unitGroup } from '~/lib/fortress/format'
import { num, str } from '../events'
import { matchLegendsWorld } from '../model'
import type { NameIndex } from '../types'
import { type FortressTie, fortressInLegends } from './lives'
import { type RefSet, addRef, lookupNames } from './records'

/*
 * Server functions that link the live fortress to the legends export:
 * names for ids, which figures the export knows, the fortress's people in
 * the record, and how many events mention each one.
 */

const R = schema.legends_records

/** Names for a few ids of any kind; ids the export does not contain are left out. */
export const getLegendsNames = createServerFn({ method: 'GET' })
  .inputValidator((input: { worldId: number; refs: Record<string, number[]> }) => input)
  .handler(async ({ data }): Promise<NameIndex> => {
    const refs: RefSet = {}
    for (const [kind, ids] of Object.entries(data.refs).slice(0, 12))
      for (const id of ids.slice(0, 200)) addRef(refs, kind, id)
    return lookupNames(data.worldId, refs)
  })

export interface LegendsFigureLookup {
  worldId: number
  ids: number[]
}

/** Which of these historical figure ids exist in the legends world. */
export const getKnownFigures = createServerFn({ method: 'GET' })
  .inputValidator((input: LegendsFigureLookup) => input)
  .handler(async ({ data }): Promise<number[]> => {
    const ids = data.ids.filter((v) => Number.isInteger(v) && v >= 0).slice(0, 2000)
    if (ids.length === 0) return []
    const rows = await postgres_db
      .select({ id: R.id })
      .from(R)
      .where(and(eq(R.world_id, data.worldId), eq(R.kind, 'historical_figure'), inArray(R.id, ids)))
    return rows.map((r) => r.id)
  })

/**
 * The running fortress's people in this world's record: who the export knows,
 * their kin, the storied few and their civilization. Null when the fortress
 * stands in another world.
 */
export const getFortressInLegends = createServerFn({ method: 'GET' })
  .inputValidator((input: { worldId: number }) => input)
  .handler(async ({ data }): Promise<FortressTie | null> => {
    const [worlds, states, dumps] = await Promise.all([
      postgres_db
        .select()
        .from(schema.legends_worlds)
        .where(eq(schema.legends_worlds.id, data.worldId))
        .limit(1),
      postgres_db
        .select({ world_name: schema.fort_state.world_name, world: schema.fort_state.world })
        .from(schema.fort_state)
        .limit(1),
      postgres_db.select({ units: schema.fort_dump.units }).from(schema.fort_dump).limit(1),
    ])
    const state = states[0]
    const world = (state?.world && typeof state.world === 'object' ? state.world : {}) as JsonObject
    const names = [state?.world_name, str(world.name), str(world.name_native)]
    if (!worlds[0] || !matchLegendsWorld(worlds, names)) return null
    const dwellers = decodeTable<FortUnit>(dumps[0]?.units)
      .filter((u) => isLiving(u) && ['citizen', 'resident'].includes(unitGroup(u)))
      .map((u) => ({ figureId: u.hist_figure_id, unitId: u.id }))
    const civ = num(world.civ_id)
    return fortressInLegends(data.worldId, dwellers, civ !== null && civ >= 0 ? civ : null)
  })

/** How many historical events mention each figure. Figures with none are omitted. */
export const getFigureEventCounts = createServerFn({ method: 'GET' })
  .inputValidator((input: LegendsFigureLookup) => input)
  .handler(async ({ data }): Promise<{ id: number; count: number }[]> => {
    const ids = data.ids.filter((v) => Number.isInteger(v) && v >= 0).slice(0, 2000)
    if (ids.length === 0) return []
    const list = sql`array[${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )}]::int[]`
    const result = await postgres_db.execute<{ id: number; c: number }>(sql`
      select u.id, count(distinct e.id)::int as c
      from ${R} e, unnest(e.hfids) as u(id)
      where e.world_id = ${data.worldId}
        and e.kind = 'historical_event'
        and e.hfids && ${list}
        and u.id = any(${list})
      group by u.id
    `)
    return [...result].map((row) => ({ id: Number(row.id), count: Number(row.c) }))
  })
