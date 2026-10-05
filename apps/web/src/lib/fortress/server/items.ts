import type {
  FortArtifact,
  FortBuilding,
  FortFigure,
  FortItem,
  FortUnit,
} from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'

import {
  COAL_STONES,
  FLUX_STONES,
  GEAR_TYPES,
  ITEM_VIEWS,
  type ItemView,
  ORE_METALS,
  REFUSE_TYPES,
  isFuelBar,
  isItemView,
  isLooseItem,
  itemViews,
  stockpileTest,
} from '../advice/stores'
import type { FortSupplies } from '../types'
import { type CachedDump, dumpTable, readDump } from './dump'

/*
 * Server functions for the stores: what they hold beyond the headline
 * counts, one item with everyone it names, and the paged, filtered and sorted
 * item list. The views of the list follow the rules in advice/stores.ts.
 */

// ---------------------------------------------------------------------------
// What the stores hold

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

async function readFortSupplies(): Promise<FortSupplies> {
  const dump = await readDump()
  return dump ? dump.memo('supplies', () => fortSupplies(dump)) : fortSupplies(null)
}

function fortSupplies(dump: CachedDump | null): FortSupplies {
  const row = dump?.row
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
    fluxBoulders: 0,
    fuelBars: 0,
    bars: {},
    otherBars: {},
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
  if (!dump) return out

  const inPile = stockpileTest(dump.table<FortBuilding>('buildings'))
  const items = dump.table<FortItem>('items')
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
        if (FLUX_STONES.has(material)) out.fluxBoulders += item.stack || 1
        for (const metal of ORE_METALS[material] ?? []) {
          const bySource = ores.get(metal) ?? new Map<string, number>()
          bySource.set(material, (bySource.get(material) ?? 0) + (item.stack || 1))
          ores.set(metal, bySource)
        }
        break
      }
      case 'BAR':
        if (/soap/.test(material)) out.soap += item.stack || 1
        else if (isFuelBar(material)) out.fuelBars += item.stack || 1
        else if (item.mat_class === 'METAL') count(out.bars, material, item.stack || 1)
        else count(out.otherBars, material, item.stack || 1)
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

// ---------------------------------------------------------------------------
// One item

export interface FortItemQuery {
  id: number
}

type UnitRef = Pick<FortUnit, 'id' | 'name' | 'readable'>

/** Someone an item names: a unit on the map when there is one, else the historical figure. */
export interface ItemPerson {
  unit: UnitRef | null
  name: string | null
  race: string | null
  alive: boolean | null
}

export interface FortItemDetail {
  capturedAt: string | null
  item: FortItem | null
  holder: UnitRef | null
  building: FortBuilding | null
  container: Pick<FortItem, 'id' | 'description'> | null
  contents: FortItem[]
  /** Who made it; only crafted items record it. */
  maker: ItemPerson | null
  owner: UnitRef | null
  artifact: (FortArtifact & { holder: ItemPerson | null; owner: ItemPerson | null }) | null
}

const unitRef = (unit: FortUnit): UnitRef => ({
  id: unit.id,
  name: unit.name,
  readable: unit.readable,
})

export const getFortItem = createServerFn({ method: 'GET' })
  .inputValidator((input: FortItemQuery) => input)
  .handler(async ({ data }): Promise<FortItemDetail> => {
    const dump = await readDump()
    const row = dump?.row
    const empty: FortItemDetail = {
      capturedAt: row?.captured_at ?? null,
      item: null,
      holder: null,
      building: null,
      container: null,
      contents: [],
      maker: null,
      owner: null,
      artifact: null,
    }
    if (!row) return empty
    const items = dumpTable<FortItem>(dump, 'items')
    const item = items.find((entry) => entry.id === data.id) ?? null
    if (!item) return empty

    const units = dumpTable<FortUnit>(dump, 'units')
    const unitById = new Map(units.map((unit) => [unit.id, unit]))
    const unitByFigure = new Map(
      units.filter((unit) => unit.hist_figure_id >= 0).map((unit) => [unit.hist_figure_id, unit]),
    )
    const figures = new Map(dumpTable<FortFigure>(dump, 'figures').map((f) => [f.hf, f]))
    const personOf = (hf: number | null | undefined): ItemPerson | null => {
      if (hf === null || hf === undefined || hf < 0) return null
      const figure = figures.get(hf)
      const unit =
        unitByFigure.get(hf) ?? (figure?.unit_id != null ? unitById.get(figure.unit_id) : undefined)
      if (!unit && !figure) return null
      return {
        unit: unit ? unitRef(unit) : null,
        name: figure?.name ?? unit?.name ?? null,
        race: figure?.race ?? unit?.race ?? null,
        alive: figure?.alive ?? (unit ? !unit.flags.includes('dead') : null),
      }
    }
    const record =
      item.artifact_id != null
        ? (dumpTable<FortArtifact>(dump, 'artifacts').find((a) => a.id === item.artifact_id) ??
          null)
        : null
    const ownerUnit = item.owner_id != null ? unitById.get(item.owner_id) : undefined

    const holderUnit =
      item.holder_unit_id !== null ? (unitById.get(item.holder_unit_id) ?? null) : null
    const building =
      item.holder_building_id !== null
        ? (dumpTable<FortBuilding>(dump, 'buildings').find(
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
      holder: holderUnit ? unitRef(holderUnit) : null,
      building,
      container: container ? { id: container.id, description: container.description } : null,
      contents: items.filter((entry) => entry.container_id === item.id),
      maker: personOf(item.maker_hf ?? record?.maker_hf),
      owner: ownerUnit ? unitRef(ownerUnit) : null,
      artifact: record
        ? { ...record, holder: personOf(record.holder_hf), owner: personOf(record.owner_hf) }
        : null,
    }
  })

// ---------------------------------------------------------------------------
// The item list

export type SortDirection = 'asc' | 'desc'

export type SortValue = string | number | null

/**
 * Compare two cell values. Missing values stay at the bottom in both directions
 * so a column of blanks does not jump above real data when the sort flips.
 * The list sorts before it pages, so this runs over every item in the view.
 */
export function compareSortValues(a: SortValue, b: SortValue, direction: SortDirection): number {
  const aMissing = a === null || a === undefined
  const bMissing = b === null || b === undefined
  if (aMissing && bMissing) return 0
  if (aMissing) return 1
  if (bMissing) return -1
  const cmp =
    typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
  return direction === 'asc' ? cmp : -cmp
}

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
    const dump = await readDump()
    const row = dump?.row
    const all = dumpTable<FortItem>(dump, 'items')
    const inPile = stockpileTest(dumpTable<FortBuilding>(dump, 'buildings'))
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
