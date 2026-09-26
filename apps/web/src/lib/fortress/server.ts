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
import { type SQL, desc, eq, sql } from 'drizzle-orm'

import { isLiving, mentionNeedles } from './format'
import { type SortDirection, type SortValue, compareSortValues } from './sort'
import {
  COAL_STONES,
  GEAR_TYPES,
  ITEM_VIEWS,
  type ItemView,
  ORE_METALS,
  REFUSE_TYPES,
  isItemView,
  isLooseItem,
  itemViews,
  stockpileTest,
} from './stores'

const SINGLETON_ID = 1

/**
 * Everything the web app knows about the fortress comes from Postgres. The
 * worker in apps/worker is the only process that talks to the game.
 */

const E = schema.fort_events

/** The loaded fortress and the moment it has reached, as the chronicle keys it. */
interface Timeline {
  /** Prefix of the fortress's dedupe keys: `save_dir:site_id:`. */
  prefix: string
  year: number
  tick: number
}

function timelineOf(state: Pick<FortState, 'world'> | null | undefined): Timeline | null {
  const world = state?.world
  if (!world || typeof world.year !== 'number' || typeof world.tick !== 'number') return null
  return {
    prefix: `${world.save_dir}:${world.site_id}:`,
    year: world.year,
    tick: world.tick,
  }
}

async function currentTimeline(): Promise<Timeline | null> {
  const rows = await postgres_db
    .select({ world: schema.fort_state.world })
    .from(schema.fort_state)
    .where(eq(schema.fort_state.id, SINGLETON_ID))
    .limit(1)
  return timelineOf(rows[0])
}

const ofFortress = (t: Timeline) => sql`starts_with(${E.dedupe_key}, ${t.prefix})`

/**
 * Announcements of this fortress dated after its present. They happened in a
 * future that loading an earlier save undid, and the game may never repeat them.
 */
const undoneIn = (t: Timeline) =>
  sql`(${ofFortress(t)} and (${E.game_year} > ${t.year} or (${E.game_year} = ${t.year} and ${E.game_tick} > ${t.tick})))`

export interface FortOverview {
  state: FortState | null
  dumpCapturedAt: string | null
  /** This fortress's announcements up to its present, newest first, without job cancellations. */
  events: FortEvent[]
  /** Announcements hidden because loading an earlier save undid them. */
  undone: number
}

export const getFortOverview = createServerFn({ method: 'GET' }).handler(
  async (): Promise<FortOverview> => {
    const [stateRows, dumpRows] = await Promise.all([
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
    ])
    const state = stateRows[0] ?? null
    const timeline = timelineOf(state)
    const notCancel = sql`coalesce(${E.type}, '') <> 'CANCEL_JOB'`
    const [events, undoneRows] = await Promise.all([
      postgres_db
        .select()
        .from(E)
        .where(
          timeline
            ? sql`${ofFortress(timeline)} and not ${undoneIn(timeline)} and ${notCancel}`
            : notCancel,
        )
        .orderBy(desc(E.game_year), desc(E.game_tick), desc(E.id))
        .limit(160),
      timeline
        ? postgres_db.select({ n: sql<number>`count(*)::int` }).from(E).where(undoneIn(timeline))
        : Promise.resolve([{ n: 0 }]),
    ])
    return {
      state,
      dumpCapturedAt: dumpRows[0]?.captured_at ?? null,
      events,
      undone: Number(undoneRows[0]?.n ?? 0),
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
    return {
      capturedAt: row?.captured_at ?? null,
      // The sheet is for one unit's page; the lists poll every few seconds.
      units: decodeTable<FortUnit>(row?.units).map(({ sheet: _sheet, ...unit }) => unit),
    }
  },
)

export interface UnburiedBody {
  unitId: number
  name: string
  description: string
  x: number | null
  y: number | null
  z: number | null
}

/** What the overview checks beyond units and stocks: burials, rooms and cups. */
export interface FortConcerns {
  capturedAt: string | null
  /** Civzone subtype (Hospital, Tomb, DiningHall, Bedroom, ...) -> count. */
  zones: Record<string, number>
  coffins: number
  /** Mugs, cups and goblets: dwarves drinking without one grumble. */
  cups: number
  /** Remains of the fortress's own dead lying anywhere but a coffin. */
  unburied: UnburiedBody[]
}

async function readFortConcerns(): Promise<FortConcerns> {
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
  const empty: FortConcerns = {
    capturedAt: row?.captured_at ?? null,
    zones: {},
    coffins: 0,
    cups: 0,
    unburied: [],
  }
  if (!row) return empty

  const zones: Record<string, number> = {}
  let coffins = 0
  for (const b of decodeTable<FortBuilding>(row.buildings)) {
    if (b.type === 'Civzone' && b.subtype) zones[b.subtype] = (zones[b.subtype] ?? 0) + 1
    if (b.type === 'Coffin') coffins++
  }

  // Our dead, by the name the game gives their corpse: "Urist McDwarf's skeleton".
  const ownDead = new Map<string, FortUnit>()
  for (const u of decodeTable<FortUnit>(row.units)) {
    if (isLiving(u) || !u.name) continue
    if (u.flags.includes('citizen') || u.flags.includes('own_civ') || u.flags.includes('resident'))
      ownDead.set(u.name.toLowerCase(), u)
  }
  let cups = 0
  const unburied: UnburiedBody[] = []
  const seen = new Set<number>()
  for (const item of decodeTable<FortItem>(row.items)) {
    if (item.type === 'GOBLET' && item.x !== null && !item.flags.includes('trader'))
      cups += item.stack || 1
    if (item.type !== 'CORPSE' && item.type !== 'CORPSEPIECE') continue
    if (item.holder_building_id !== null) continue
    const owner = /^(.+?)'s /.exec(item.description)?.[1]?.toLowerCase()
    const unit = owner ? ownDead.get(owner) : undefined
    if (!unit || seen.has(unit.id)) continue
    seen.add(unit.id)
    unburied.push({
      unitId: unit.id,
      name: unit.name,
      description: item.description,
      x: item.x,
      y: item.y,
      z: item.z,
    })
  }
  return {
    capturedAt: row.captured_at ?? null,
    zones,
    coffins,
    cups,
    unburied,
  }
}

export const getFortConcerns = createServerFn({ method: 'GET' }).handler(() => readFortConcerns())

const CLOTHING = new Set(['ARMOR', 'PANTS', 'SHOES', 'GLOVES', 'HELM'])
const GEAR = new Set(['ARMOR', 'PANTS', 'SHOES', 'GLOVES', 'HELM', 'SHIELD'])
const TRADE_GOODS = new Set([
  'AMULET',
  'RING',
  'EARRING',
  'BRACELET',
  'CROWN',
  'FIGURINE',
  'SCEPTER',
  'TOTEM',
  'SMALLGEM',
  'GEM',
])

export interface OreStock {
  metal: string
  boulders: number
  /** Stone names, most plentiful first. */
  sources: string[]
}

/** What the stores hold beyond the headline counts: tools, fuel, ores, supplies, clutter. */
export interface FortSupplies {
  capturedAt: string | null
  /** Forbidden items by type, remains aside (vermin remains are forbidden by the game). */
  forbidden: Record<string, number>
  /** Corpses, body parts and remains lying outside stockpiles. */
  looseRefuse: number
  /** Cave spider webs not yet collected: thread no one can use yet. */
  webs: number
  cups: number
  buckets: number
  splints: number
  crutches: number
  soap: number
  bins: number
  bags: number
  emptyBarrels: number
  wheelbarrows: number
  /** Picks and axes nobody is carrying. */
  picks: number
  axes: number
  /** Unclaimed weapons, and metal armor pieces, for a squad. */
  weapons: number
  metalArmor: number
  ores: OreStock[]
  coalBoulders: number
  /** Charcoal and coke. */
  fuelBars: number
  /** Metal bars by metal. */
  bars: Record<string, number>
  roughGems: number
  tradeGoods: number
  /** Clothing worn by someone that is threadbare or tattered. */
  wornClothes: number
  /** Goods on the floor outside any stockpile, by item type; refuse, webs and forbidden items aside. */
  loose: Record<string, number>
  /** Weapons and armor made abroad that nobody wears: loot. */
  enemyGear: { items: number; metal: number; value: number }
  /** The fortress's artifacts on the map; `loose` ones lie on the floor rather than on display. */
  artifacts: { items: number; loose: number; value: number }
  /** Large pots holding nothing: they take drink and food like barrels. */
  emptyPots: number
  /** Thread that is not an uncollected web. */
  thread: number
  bones: number
  shells: number
  /** Mechanisms not yet built into anything. */
  mechanisms: number
  /** Food, plants and bodies gone rotten, vermin remains aside. */
  rotting: number
  /** What a caravan at the depot has for sale. */
  merchantGoods: { items: number; value: number }
}

async function readFortSupplies(): Promise<FortSupplies> {
  const rows = await postgres_db
    .select({
      captured_at: schema.fort_dump.captured_at,
      items: schema.fort_dump.items,
      buildings: schema.fort_dump.buildings,
    })
    .from(schema.fort_dump)
    .where(eq(schema.fort_dump.id, SINGLETON_ID))
    .limit(1)
  const row = rows[0]
  const out: FortSupplies = {
    capturedAt: row?.captured_at ?? null,
    forbidden: {},
    looseRefuse: 0,
    webs: 0,
    cups: 0,
    buckets: 0,
    splints: 0,
    crutches: 0,
    soap: 0,
    bins: 0,
    bags: 0,
    emptyBarrels: 0,
    wheelbarrows: 0,
    picks: 0,
    axes: 0,
    weapons: 0,
    metalArmor: 0,
    ores: [],
    coalBoulders: 0,
    fuelBars: 0,
    bars: {},
    roughGems: 0,
    tradeGoods: 0,
    wornClothes: 0,
    loose: {},
    enemyGear: { items: 0, metal: 0, value: 0 },
    artifacts: { items: 0, loose: 0, value: 0 },
    emptyPots: 0,
    thread: 0,
    bones: 0,
    shells: 0,
    mechanisms: 0,
    rotting: 0,
    merchantGoods: { items: 0, value: 0 },
  }
  if (!row) return out

  const inPile = stockpileTest(decodeTable<FortBuilding>(row.buildings))
  const items = decodeTable<FortItem>(row.items)
  const holding = new Set<number>()
  for (const item of items) if (item.container_id !== null) holding.add(item.container_id)
  const ores = new Map<string, Map<string, number>>()
  const count = (map: Record<string, number>, key: string, n = 1) => {
    map[key] = (map[key] ?? 0) + n
  }

  for (const item of items) {
    const f = item.flags
    // Artifacts and books elsewhere in the world have no position.
    if (item.x === null || f.includes('removed')) continue
    if (f.includes('trader')) {
      out.merchantGoods.items++
      out.merchantGoods.value += item.value
      continue
    }
    const onFloor = isLooseItem(item)
    const free = !f.includes('forbid') && item.holder_unit_id === null
    const n = item.stack || 1
    if (f.includes('forbid') && item.type !== 'REMAINS') count(out.forbidden, item.type)
    if (f.includes('rotten') && item.type !== 'REMAINS') out.rotting += n
    if (
      onFloor &&
      free &&
      !f.includes('spider_web') &&
      !REFUSE_TYPES.has(item.type) &&
      !inPile(item)
    )
      count(out.loose, item.type)
    if (f.includes('foreign') && GEAR_TYPES.has(item.type) && item.holder_unit_id === null) {
      out.enemyGear.items++
      out.enemyGear.value += item.value
      if (item.mat_class === 'METAL') out.enemyGear.metal++
    }
    if (f.includes('artifact') && item.type !== 'BOOK' && item.subtype_id !== 'ITEM_TOOL_SCROLL') {
      out.artifacts.items++
      out.artifacts.value += item.value
      if (onFloor) out.artifacts.loose++
    }
    const material = item.material.toLowerCase()
    switch (item.type) {
      case 'CORPSE':
      case 'CORPSEPIECE':
      case 'REMAINS':
        if (onFloor && !inPile(item)) out.looseRefuse++
        if (item.type === 'CORPSEPIECE' && free && !f.includes('rotten')) {
          const parts = item.corpse_flags ?? []
          if (parts.includes('shell')) out.shells += n
          else if (parts.includes('bone') || parts.includes('skull')) out.bones += n
        }
        break
      case 'THREAD':
        if (f.includes('spider_web')) out.webs += n
        else if (free) out.thread += n
        break
      case 'TRAPPARTS':
        if (free && !f.includes('in_building')) out.mechanisms += n
        break
      case 'BAG':
        out.bags++
        break
      case 'GOBLET':
        out.cups += item.stack || 1
        break
      case 'BUCKET':
        out.buckets++
        break
      case 'SPLINT':
        out.splints++
        break
      case 'CRUTCH':
        out.crutches++
        break
      case 'BIN':
        out.bins++
        break
      case 'BOX':
        if (item.mat_class === 'CLOTH' || item.mat_class === 'LEATHER') out.bags++
        break
      case 'BARREL':
        if (!holding.has(item.id)) out.emptyBarrels++
        break
      case 'TOOL':
        if (item.subtype_id === 'ITEM_TOOL_WHEELBARROW') out.wheelbarrows++
        else if (item.subtype_id === 'ITEM_TOOL_LARGE_POT' && !holding.has(item.id)) out.emptyPots++
        break
      case 'WEAPON':
        if (!free) break
        if (item.subtype_id === 'ITEM_WEAPON_PICK') out.picks++
        else {
          if (item.subtype_id?.startsWith('ITEM_WEAPON_AXE')) out.axes++
          if (!f.includes('owned')) out.weapons++
        }
        break
      case 'BOULDER': {
        if (COAL_STONES.has(material)) out.coalBoulders += item.stack || 1
        for (const metal of ORE_METALS[material] ?? []) {
          const bySource = ores.get(metal) ?? new Map<string, number>()
          bySource.set(material, (bySource.get(material) ?? 0) + (item.stack || 1))
          ores.set(metal, bySource)
        }
        break
      }
      case 'BAR':
        if (/soap/.test(material)) out.soap += item.stack || 1
        else if (/coke|charcoal/.test(material)) out.fuelBars += item.stack || 1
        else if (item.mat_class === 'METAL') count(out.bars, material, item.stack || 1)
        break
      case 'ROUGH':
        out.roughGems += item.stack || 1
        break
    }
    if (GEAR.has(item.type) && item.mat_class === 'METAL' && free && !f.includes('owned'))
      out.metalArmor++
    if (TRADE_GOODS.has(item.type) && free) out.tradeGoods += item.stack || 1
    if (CLOTHING.has(item.type) && item.holder_unit_id !== null && item.wear >= 2) out.wornClothes++
  }
  out.ores = [...ores.entries()]
    .map(([metal, bySource]) => ({
      metal,
      boulders: [...bySource.values()].reduce((a, b) => a + b, 0),
      sources: [...bySource.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name),
    }))
    .sort((a, b) => b.boulders - a.boulders)
  return out
}

export const getFortSupplies = createServerFn({ method: 'GET' }).handler(() => readFortSupplies())

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
  /** Which view of the list; the fortress's own items when unset. */
  view?: ItemView
  page?: number
  pageSize?: number
  sortKey?: ItemSortKey
  sortDir?: SortDirection
}

export interface FortItemsResult {
  capturedAt: string | null
  /** Every item in the dump, off-map ones included. */
  total: number
  view: ItemView
  /** Items in the view, before the type filter and the search. */
  inView: number
  /** Value of everything in the view. */
  viewValue: number
  filtered: number
  page: number
  pageSize: number
  items: FortItem[]
  /** View -> how many items it holds, over the whole dump. */
  views: Record<ItemView, number>
  /** Item type -> count, within the view (for the type filter). */
  types: Record<string, number>
  /** Item type -> total value, within the view. */
  valueByType: Record<string, number>
  /** Item type -> its most valuable item in the view, to draw the type with. */
  samples: Record<string, FortItem>
}

export const getFortItems = createServerFn({ method: 'GET' })
  .inputValidator((input: ItemsQuery) => input)
  .handler(async ({ data }): Promise<FortItemsResult> => {
    const rows = await postgres_db
      .select({
        captured_at: schema.fort_dump.captured_at,
        items: schema.fort_dump.items,
        buildings: schema.fort_dump.buildings,
      })
      .from(schema.fort_dump)
      .where(eq(schema.fort_dump.id, SINGLETON_ID))
      .limit(1)
    const row = rows[0]
    const all = decodeTable<FortItem>(row?.items)
    const inPile = stockpileTest(decodeTable<FortBuilding>(row?.buildings))
    const view: ItemView = isItemView(data.view) ? data.view : 'fortress'
    const views = Object.fromEntries(ITEM_VIEWS.map((v) => [v, 0])) as Record<ItemView, number>
    const inView: FortItem[] = []
    for (const item of all) {
      const memberOf = itemViews(item, inPile)
      for (const v of memberOf) views[v]++
      if (memberOf.includes(view)) inView.push(item)
    }
    const types: Record<string, number> = {}
    const valueByType: Record<string, number> = {}
    const samples: Record<string, FortItem> = {}
    let viewValue = 0
    for (const item of inView) {
      types[item.type] = (types[item.type] ?? 0) + 1
      valueByType[item.type] = (valueByType[item.type] ?? 0) + (item.value ?? 0)
      viewValue += item.value ?? 0
      const sample = samples[item.type]
      if (!sample || item.value > sample.value) samples[item.type] = item
    }
    const q = (data.q ?? '').trim().toLowerCase()
    let filtered = inView
    if (data.type) filtered = filtered.filter((i) => i.type === data.type)
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
      view,
      inView: inView.length,
      viewValue,
      filtered: filtered.length,
      page,
      pageSize,
      items: filtered.slice(page * pageSize, (page + 1) * pageSize),
      views,
      types,
      valueByType,
      samples,
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
