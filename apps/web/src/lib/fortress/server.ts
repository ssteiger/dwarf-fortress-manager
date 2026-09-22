import {
  type FortBuilding,
  type FortEvent,
  type FortItem,
  type FortJob,
  type FortMapBlock,
  type FortState,
  type FortTiletype,
  type FortUnit,
  decodeTable,
  postgres_db,
  schema,
} from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { desc, eq, sql } from 'drizzle-orm'

const SINGLETON_ID = 1

/**
 * Everything the web app knows about the fortress comes from Postgres. The
 * worker in apps/worker is the only process that talks to the game.
 */

export interface FortOverview {
  state: FortState | null
  dumpCapturedAt: string | null
  events: FortEvent[]
}

export const getFortOverview = createServerFn({ method: 'GET' }).handler(
  async (): Promise<FortOverview> => {
    const [stateRows, dumpRows, events] = await Promise.all([
      postgres_db
        .select()
        .from(schema.fort_state)
        .where(eq(schema.fort_state.id, SINGLETON_ID))
        .limit(1),
      postgres_db
        .select({ captured_at: schema.fort_dump.captured_at })
        .from(schema.fort_dump)
        .where(eq(schema.fort_dump.id, SINGLETON_ID))
        .limit(1),
      postgres_db
        .select()
        .from(schema.fort_events)
        .orderBy(
          desc(schema.fort_events.game_year),
          desc(schema.fort_events.game_tick),
          desc(schema.fort_events.id),
        )
        .limit(40),
    ])
    return {
      state: stateRows[0] ?? null,
      dumpCapturedAt: dumpRows[0]?.captured_at ?? null,
      events,
    }
  },
)

export interface FortUnitsResult {
  capturedAt: string | null
  units: FortUnit[]
}

export const getFortUnits = createServerFn({ method: 'GET' }).handler(
  async (): Promise<FortUnitsResult> => {
    const rows = await postgres_db
      .select({ captured_at: schema.fort_dump.captured_at, units: schema.fort_dump.units })
      .from(schema.fort_dump)
      .where(eq(schema.fort_dump.id, SINGLETON_ID))
      .limit(1)
    const row = rows[0]
    return { capturedAt: row?.captured_at ?? null, units: decodeTable<FortUnit>(row?.units) }
  },
)

export interface ItemsQuery {
  q?: string
  type?: string
  page?: number
  pageSize?: number
  onlyForbidden?: boolean
}

export interface FortItemsResult {
  capturedAt: string | null
  total: number
  filtered: number
  page: number
  pageSize: number
  items: FortItem[]
  /** Item type -> count, over the whole dump (for the type filter). */
  types: Record<string, number>
  /** Item type -> total value, over the whole dump. */
  valueByType: Record<string, number>
}

export const getFortItems = createServerFn({ method: 'GET' })
  .inputValidator((input: ItemsQuery) => input)
  .handler(async ({ data }): Promise<FortItemsResult> => {
    const rows = await postgres_db
      .select({ captured_at: schema.fort_dump.captured_at, items: schema.fort_dump.items })
      .from(schema.fort_dump)
      .where(eq(schema.fort_dump.id, SINGLETON_ID))
      .limit(1)
    const row = rows[0]
    const all = decodeTable<FortItem>(row?.items)
    const types: Record<string, number> = {}
    const valueByType: Record<string, number> = {}
    for (const item of all) {
      types[item.type] = (types[item.type] ?? 0) + 1
      valueByType[item.type] = (valueByType[item.type] ?? 0) + (item.value ?? 0)
    }
    const q = (data.q ?? '').trim().toLowerCase()
    let filtered = all
    if (data.type) filtered = filtered.filter((i) => i.type === data.type)
    if (data.onlyForbidden) filtered = filtered.filter((i) => i.flags.includes('forbid'))
    if (q) {
      filtered = filtered.filter(
        (i) =>
          i.description.toLowerCase().includes(q) ||
          i.material.toLowerCase().includes(q) ||
          i.type.toLowerCase().includes(q) ||
          (i.subtype ?? '').toLowerCase().includes(q),
      )
    }
    filtered.sort((a, b) => b.value - a.value || a.description.localeCompare(b.description))
    const pageSize = Math.min(Math.max(data.pageSize ?? 100, 10), 500)
    const page = Math.max(data.page ?? 0, 0)
    return {
      capturedAt: row?.captured_at ?? null,
      total: all.length,
      filtered: filtered.length,
      page,
      pageSize,
      items: filtered.slice(page * pageSize, (page + 1) * pageSize),
      types,
      valueByType,
    }
  })

export interface FortWorkResult {
  capturedAt: string | null
  buildings: FortBuilding[]
  jobs: FortJob[]
  units: Pick<FortUnit, 'id' | 'name' | 'profession'>[]
}

export const getFortWork = createServerFn({ method: 'GET' }).handler(
  async (): Promise<FortWorkResult> => {
    const rows = await postgres_db
      .select({
        captured_at: schema.fort_dump.captured_at,
        buildings: schema.fort_dump.buildings,
        jobs: schema.fort_dump.jobs,
        units: schema.fort_dump.units,
      })
      .from(schema.fort_dump)
      .where(eq(schema.fort_dump.id, SINGLETON_ID))
      .limit(1)
    const row = rows[0]
    return {
      capturedAt: row?.captured_at ?? null,
      buildings: decodeTable<FortBuilding>(row?.buildings),
      jobs: decodeTable<FortJob>(row?.jobs),
      units: decodeTable<FortUnit>(row?.units).map((u) => ({
        id: u.id,
        name: u.name,
        profession: u.profession,
      })),
    }
  },
)

export interface FortEventsQuery {
  limit?: number
  q?: string
}

export const getFortEvents = createServerFn({ method: 'GET' })
  .inputValidator((input: FortEventsQuery) => input)
  .handler(async ({ data }): Promise<FortEvent[]> => {
    const limit = Math.min(Math.max(data.limit ?? 300, 10), 2000)
    const q = (data.q ?? '').trim()
    const base = postgres_db.select().from(schema.fort_events)
    const query = q ? base.where(sql`${schema.fort_events.text} ilike ${`%${q}%`}`) : base
    return query
      .orderBy(
        desc(schema.fort_events.game_year),
        desc(schema.fort_events.game_tick),
        desc(schema.fort_events.id),
      )
      .limit(limit)
  })

export interface MapLevelQuery {
  z?: number
}

export interface MapLevelUnit {
  id: number
  name: string
  x: number
  y: number
  kind: 'citizen' | 'animal' | 'hostile' | 'other'
}

export interface MapLevelBuilding {
  id: number
  type: string
  name: string
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface FortMapLevel {
  capturedAt: string | null
  xCount: number
  yCount: number
  zCount: number
  z: number
  /** Z-levels that contain at least one block, ascending. */
  levels: number[]
  /** Blocks on this level only: [z, bx, by, tilesRle, flagsRle]. */
  blocks: FortMapBlock[]
  tiletypes: Record<string, FortTiletype>
  units: MapLevelUnit[]
  buildings: MapLevelBuilding[]
  /** Highest z on which a citizen currently stands, a good default level. */
  suggestedZ: number | null
}

export const getFortMapLevel = createServerFn({ method: 'GET' })
  .inputValidator((input: MapLevelQuery) => input)
  .handler(async ({ data }): Promise<FortMapLevel | null> => {
    const [mapRows, dumpRows] = await Promise.all([
      postgres_db
        .select()
        .from(schema.fort_map)
        .where(eq(schema.fort_map.id, SINGLETON_ID))
        .limit(1),
      postgres_db
        .select({ units: schema.fort_dump.units, buildings: schema.fort_dump.buildings })
        .from(schema.fort_dump)
        .where(eq(schema.fort_dump.id, SINGLETON_ID))
        .limit(1),
    ])
    const map = mapRows[0]
    if (!map) return null
    const units = decodeTable<FortUnit>(dumpRows[0]?.units)
    const buildings = decodeTable<FortBuilding>(dumpRows[0]?.buildings)

    const levelSet = new Set<number>()
    for (const block of map.blocks) levelSet.add(block[0])
    const levels = [...levelSet].sort((a, b) => a - b)

    const citizens = units.filter(
      (u) => u.flags.includes('citizen') && u.z !== null && !u.flags.includes('dead'),
    )
    const zCounts = new Map<number, number>()
    for (const u of citizens) zCounts.set(u.z as number, (zCounts.get(u.z as number) ?? 0) + 1)
    let suggestedZ: number | null = null
    let best = 0
    for (const [z, count] of zCounts) {
      if (count > best) {
        best = count
        suggestedZ = z
      }
    }
    const z = data.z ?? suggestedZ ?? levels[Math.floor(levels.length / 2)] ?? 0

    const levelUnits: MapLevelUnit[] = []
    for (const u of units) {
      if (u.z !== z || u.x === null || u.y === null || u.flags.includes('dead')) continue
      let kind: MapLevelUnit['kind'] = 'other'
      if (u.flags.includes('citizen')) kind = 'citizen'
      else if (u.flags.includes('invader') || u.flags.includes('danger')) kind = 'hostile'
      else if (u.flags.includes('animal')) kind = 'animal'
      levelUnits.push({ id: u.id, name: u.readable, x: u.x, y: u.y, kind })
    }

    return {
      capturedAt: map.captured_at,
      xCount: map.x_count,
      yCount: map.y_count,
      zCount: map.z_count,
      z,
      levels,
      blocks: map.blocks.filter((b) => b[0] === z),
      tiletypes: map.tiletypes,
      units: levelUnits,
      buildings: buildings
        .filter((b) => b.z === z)
        .map((b) => ({
          id: b.id,
          type: b.type,
          name: b.name,
          x1: b.x1,
          y1: b.y1,
          x2: b.x2,
          y2: b.y2,
        })),
      suggestedZ,
    }
  })
