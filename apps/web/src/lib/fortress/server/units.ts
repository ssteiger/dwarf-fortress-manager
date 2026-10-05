import {
  type FortBuilding,
  type FortItem,
  type FortJob,
  type FortSquad,
  type FortUnit,
  fortKeyOf,
  postgres_db,
  schema,
} from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { and, eq } from 'drizzle-orm'

import { isLiving } from '../format'
import { relationOf } from '../people/character'
import { type CachedDump, dumpTable, readDump } from './dump'
import { currentState } from './fortState'

/*
 * Server functions for the units: every unit in the dump without its
 * sheet, the bonds and wasted talents the dwarf list shows, and one unit
 * in full (from the archive once they have died or left).
 */

export interface FortUnitsResult {
  capturedAt: string | null
  units: FortUnit[]
}

export const getFortUnits = createServerFn({ method: 'GET' }).handler(
  async (): Promise<FortUnitsResult> => {
    const dump = await readDump()
    if (!dump) return { capturedAt: null, units: [] }
    return dump.memo('units', () => ({
      capturedAt: dump.row.captured_at,
      // The sheet is for one unit's page; the lists show many units at once.
      units: dump.table<FortUnit>('units').map(({ sheet: _sheet, ...unit }) => unit),
    }))
  },
)

/** One citizen's tie to someone else on the map, as the citizen's own sheet records it. */
export interface FortBond {
  from: number
  to: number
  group: 'family' | 'friends' | 'foes'
  /** How `to` stands to `from`: "Wife", "Close friend", "Grudge". */
  label: string
  /** The special bond, when the game records one: "childhood friend", "lover". */
  detail: string | null
}

/** A skill a citizen is good at while its labor is off. */
export interface FortWastedTalent {
  unitId: number
  skill: string
  rating: number
}

export interface FortPeopleResult {
  capturedAt: string | null
  bonds: FortBond[]
  wasted: FortWastedTalent[]
  /** The fortress's squads; empty in dumps older than version 9. */
  squads: FortSquad[]
}

/** Proficient: the level from which a disabled labor reads as a waste. */
const WASTED_RATING = 5
/** Trades and medicine; weapon skills and hunting stealth are not work a labor switches on. */
const WORK_SKILL_CLASSES = new Set(['Normal', 'Medical'])
const NOT_WORK_SKILLS = new Set(['SNEAK', 'TRACKING'])

/**
 * What the dwarf list needs from the sheets without shipping them: the family,
 * friends and foes each citizen has on the map, and the talents they may not use.
 */
export const getFortPeople = createServerFn({ method: 'GET' }).handler(
  async (): Promise<FortPeopleResult> => {
    const dump = await readDump()
    if (!dump) return { capturedAt: null, bonds: [], wasted: [], squads: [] }
    return dump.memo('people', () => readFortPeople(dump))
  },
)

function readFortPeople(dump: CachedDump): FortPeopleResult {
  const units = dump.table<FortUnit>('units')
  const onMap = new Set(units.filter(isLiving).map((unit) => unit.id))
  const bonds: FortBond[] = []
  const wasted: FortWastedTalent[] = []
  for (const unit of units) {
    if (!isLiving(unit) || !unit.flags.includes('citizen')) continue
    const sheet = unit.sheet && !unit.sheet.error ? unit.sheet : null
    if (!sheet) continue
    for (const [skill, rating, , , skillClass, enabled] of sheet.skills)
      if (
        enabled === false &&
        rating >= WASTED_RATING &&
        skillClass !== null &&
        WORK_SKILL_CLASSES.has(skillClass) &&
        !NOT_WORK_SKILLS.has(skill)
      )
        wasted.push({ unitId: unit.id, skill, rating })
    for (const person of sheet.people) {
      if (person.unit === null || person.unit === unit.id || !onMap.has(person.unit)) continue
      const relation = relationOf(person)
      if (relation.group === 'acquaintances') continue
      bonds.push({
        from: unit.id,
        to: person.unit,
        group: relation.group,
        label: relation.label,
        detail: relation.detail,
      })
    }
  }
  return {
    capturedAt: dump.row.captured_at,
    bonds,
    wasted,
    squads: dump.table<FortSquad>('squads'),
  }
}

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
  /** The workshop a strange mood has claimed. */
  moodWorkshop: FortBuilding | null
  /** Set when `unit` is the last sheet read before they died or left the map. */
  archived: { reason: 'died' | 'left'; year: number; tick: number } | null
}

async function archivedUnit(id: number): Promise<FortUnitDetail | null> {
  const fortKey = fortKeyOf((await currentState())?.world ?? null)
  if (!fortKey) return null
  const rows = await postgres_db
    .select()
    .from(schema.fort_unit_archive)
    .where(
      and(eq(schema.fort_unit_archive.fort_key, fortKey), eq(schema.fort_unit_archive.unit_id, id)),
    )
    .limit(1)
  const row = rows[0]
  if (!row) return null
  const gone = { job: null, job_id: null, x: null, y: null, z: null }
  const unit: FortUnit =
    row.reason === 'died' && !row.unit.flags.includes('dead')
      ? { ...row.unit, ...gone, flags: [...row.unit.flags, 'dead'] }
      : { ...row.unit, ...gone }
  return {
    capturedAt: row.updated_at,
    unit,
    inventory: [],
    buildings: [],
    job: null,
    moodWorkshop: null,
    archived: { reason: row.reason, year: row.game_year, tick: row.game_tick },
  }
}

export const getFortUnit = createServerFn({ method: 'GET' })
  .inputValidator((input: FortUnitQuery) => input)
  .handler(async ({ data }): Promise<FortUnitDetail> => {
    const dump = await readDump()
    const row = dump?.row
    const empty: FortUnitDetail = {
      capturedAt: row?.captured_at ?? null,
      unit: null,
      inventory: [],
      buildings: [],
      job: null,
      moodWorkshop: null,
      archived: null,
    }
    const unit = row
      ? (dumpTable<FortUnit>(dump, 'units').find((u) => u.id === data.id) ?? null)
      : null
    if (!row || !unit) return (await archivedUnit(data.id)) ?? empty

    const items = dumpTable<FortItem>(dump, 'items')
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

    const buildings = dumpTable<FortBuilding>(dump, 'buildings')
    const moodWorkshopId = unit.strange_mood?.building_id ?? null
    return {
      capturedAt: row.captured_at ?? null,
      unit,
      inventory,
      buildings: buildings.filter((b) => b.assigned_units.includes(unit.id)),
      job:
        unit.job_id !== null
          ? (dumpTable<FortJob>(dump, 'jobs').find((j) => j.id === unit.job_id) ?? null)
          : null,
      moodWorkshop:
        moodWorkshopId !== null ? (buildings.find((b) => b.id === moodWorkshopId) ?? null) : null,
      archived: null,
    }
  })
