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

import { type SortDirection, type SortValue, compareSortValues } from './sort'

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

export interface FortUnitQuery {
  id: number
}

export interface CarriedItem {
  itemId: number
  mode: string
  item: FortItem | null
}

export interface FortUnitDetail {
  capturedAt: string | null
  unit: FortUnit | null
  inventory: CarriedItem[]
  buildings: FortBuilding[]
  job: FortJob | null
}

export const getFortUnit = createServerFn({ method: 'GET' })
  .inputValidator((input: FortUnitQuery) => input)
  .handler(async ({ data }): Promise<FortUnitDetail> => {
    const rows = await postgres_db
      .select({
        captured_at: schema.fort_dump.captured_at,
        units: schema.fort_dump.units,
        items: schema.fort_dump.items,
        buildings: schema.fort_dump.buildings,
        jobs: schema.fort_dump.jobs,
      })
      .from(schema.fort_dump)
      .where(eq(schema.fort_dump.id, SINGLETON_ID))
      .limit(1)
    const row = rows[0]
    const empty: FortUnitDetail = {
      capturedAt: row?.captured_at ?? null,
      unit: null,
      inventory: [],
      buildings: [],
      job: null,
    }
    if (!row) return empty
    const unit = decodeTable<FortUnit>(row.units).find((u) => u.id === data.id) ?? null
    if (!unit) return empty

    const items = decodeTable<FortItem>(row.items)
    const byId = new Map(items.map((item) => [item.id, item]))
    const seen = new Set<number>()
    const inventory: CarriedItem[] = []
    for (const [itemId, mode] of unit.inventory) {
      seen.add(itemId)
      inventory.push({ itemId, mode, item: byId.get(itemId) ?? null })
    }
    for (const item of items) {
      if (item.holder_unit_id === unit.id && !seen.has(item.id)) {
        inventory.push({ itemId: item.id, mode: 'Carried', item })
      }
    }

    return {
      capturedAt: row.captured_at ?? null,
      unit,
      inventory,
      buildings: decodeTable<FortBuilding>(row.buildings).filter((b) =>
        b.assigned_units.includes(unit.id),
      ),
      job:
        unit.job_id !== null
          ? (decodeTable<FortJob>(row.jobs).find((j) => j.id === unit.job_id) ?? null)
          : null,
    }
  })

export interface FortItemQuery {
  id: number
}

export interface FortItemDetail {
  capturedAt: string | null
  item: FortItem | null
  holder: Pick<FortUnit, 'id' | 'name' | 'readable'> | null
  building: FortBuilding | null
  container: Pick<FortItem, 'id' | 'description'> | null
  contents: FortItem[]
}

export const getFortItem = createServerFn({ method: 'GET' })
  .inputValidator((input: FortItemQuery) => input)
  .handler(async ({ data }): Promise<FortItemDetail> => {
    const rows = await postgres_db
      .select({
        captured_at: schema.fort_dump.captured_at,
        units: schema.fort_dump.units,
        items: schema.fort_dump.items,
        buildings: schema.fort_dump.buildings,
      })
      .from(schema.fort_dump)
      .where(eq(schema.fort_dump.id, SINGLETON_ID))
      .limit(1)
    const row = rows[0]
    const empty: FortItemDetail = {
      capturedAt: row?.captured_at ?? null,
      item: null,
      holder: null,
      building: null,
      container: null,
      contents: [],
    }
    if (!row) return empty
    const items = decodeTable<FortItem>(row.items)
    const item = items.find((entry) => entry.id === data.id) ?? null
    if (!item) return empty

    const holderUnit =
      item.holder_unit_id !== null
        ? (decodeTable<FortUnit>(row.units).find((unit) => unit.id === item.holder_unit_id) ?? null)
        : null
    const building =
      item.holder_building_id !== null
        ? (decodeTable<FortBuilding>(row.buildings).find(
            (entry) => entry.id === item.holder_building_id,
          ) ?? null)
        : null
    const container =
      item.container_id !== null
        ? (items.find((entry) => entry.id === item.container_id) ?? null)
        : null

    return {
      capturedAt: row.captured_at ?? null,
      item,
      holder: holderUnit
        ? { id: holderUnit.id, name: holderUnit.name, readable: holderUnit.readable }
        : null,
      building,
      container: container ? { id: container.id, description: container.description } : null,
      contents: items.filter((entry) => entry.container_id === item.id),
    }
  })

export type ItemSortKey =
  | 'item'
  | 'type'
  | 'material'
  | 'qty'
  | 'quality'
  | 'status'
  | 'value'
  | 'where'

const ITEM_SORT_KEYS = new Set<ItemSortKey>([
  'item',
  'type',
  'material',
  'qty',
  'quality',
  'status',
  'value',
  'where',
])

const QUALITY_RANK: Record<string, number> = {
  Ordinary: 0,
  WellCrafted: 1,
  FinelyCrafted: 2,
  Superior: 3,
  Exceptional: 4,
  Masterful: 5,
  Artifact: 6,
}

const STATUS_FLAGS = ['artifact', 'forbid', 'dump', 'melt', 'rotten', 'owned', 'trader', 'foreign']

const STATUS_WORDS: Record<string, string> = {
  artifact: 'artifact',
  forbid: 'forbidden',
  dump: 'dump',
  melt: 'melt',
  rotten: 'rotten',
  owned: 'owned',
  trader: 'merchant',
  foreign: 'foreign',
}

function itemSearchText(item: FortItem): string {
  const where =
    item.holder_unit_id !== null
      ? 'carried'
      : item.holder_building_id !== null
        ? 'in building'
        : item.container_id !== null
          ? 'in container'
          : item.x !== null
            ? `${item.x} ${item.y} ${item.z}`
            : ''
  return [
    item.description,
    item.type,
    item.subtype ?? '',
    item.material,
    item.quality,
    item.stack,
    item.value,
    item.wear > 0 ? `worn ${item.wear}` : '',
    ...item.flags.map((flag) => STATUS_WORDS[flag] ?? flag),
    where,
  ]
    .join(' ')
    .toLowerCase()
}

function itemSortValue(item: FortItem, key: ItemSortKey): SortValue {
  switch (key) {
    case 'item':
      return item.description
    case 'type':
      return `${item.type}\u0000${item.subtype ?? ''}`
    case 'material':
      return item.material
    case 'qty':
      return item.stack
    case 'quality':
      return (QUALITY_RANK[item.quality] ?? -1) * 100 + item.wear
    case 'status':
      return STATUS_FLAGS.filter((flag) => item.flags.includes(flag)).join(' ')
    case 'value':
      return item.value
    case 'where':
      if (item.holder_unit_id !== null) return 'carried'
      if (item.holder_building_id !== null) return 'in building'
      if (item.container_id !== null) return 'in container'
      if (item.x !== null) return `map ${item.z} ${item.y} ${item.x}`
      return null
  }
}

export interface ItemsQuery {
  q?: string
  type?: string
  page?: number
  pageSize?: number
  onlyForbidden?: boolean
  sortKey?: ItemSortKey
  sortDir?: SortDirection
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
    if (q) filtered = filtered.filter((item) => itemSearchText(item).includes(q))
    const sortKey = data.sortKey && ITEM_SORT_KEYS.has(data.sortKey) ? data.sortKey : 'value'
    const sortDir: SortDirection = data.sortDir === 'asc' ? 'asc' : 'desc'
    filtered.sort((a, b) => {
      const primary = compareSortValues(
        itemSortValue(a, sortKey),
        itemSortValue(b, sortKey),
        sortDir,
      )
      return primary !== 0 ? primary : a.description.localeCompare(b.description) || a.id - b.id
    })
    const pageSize = Math.min(Math.max(data.pageSize ?? 100, 10), 5000)
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

/** How many chronicle announcements quote each name. Matching is case-insensitive. */
export const getChronicleMentionCounts = createServerFn({ method: 'GET' })
  .inputValidator((input: { names: string[] }) => input)
  .handler(async ({ data }): Promise<{ name: string; count: number }[]> => {
    const names = [
      ...new Set(data.names.map((name) => name.trim()).filter((name) => name.length > 0)),
    ].slice(0, 500)
    if (names.length === 0) return []
    const rows = await postgres_db
      .select({ text: schema.fort_events.text })
      .from(schema.fort_events)
    const texts = rows.map((row) => row.text.toLowerCase())
    return names.map((name) => {
      const needle = name.toLowerCase()
      return { name, count: texts.reduce((sum, text) => sum + (text.includes(needle) ? 1 : 0), 0) }
    })
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
