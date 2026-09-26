import {
  type FortBuilding,
  type FortItem,
  type FortUnit,
  decodeTable,
  postgres_db,
  schema,
} from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm'

import { formatGameTick, humanize, isLiving, splitPascal, unitGroup } from '../fortress/format'
import { searchRecordsByName } from '../legends/records'
import {
  type DwarfHit,
  EMPTY_RESULTS,
  type EventHit,
  type ItemHit,
  MIN_QUERY,
  type PlaceHit,
  type SearchResults,
  rankMatch,
} from './model'

/*
 * One search across everything the app holds: the dwarves, items and
 * buildings of the last dump, the chronicle, and the legends export. The
 * dump is stored as JSON blobs rather than rows, so those three are matched
 * in memory here; the chronicle and the legends records are matched in
 * Postgres.
 */

const SINGLETON_ID = 1
/** Hits shown per group. Anything beyond is counted, so the UI can say there is more. */
const PER_GROUP = 6

interface Scored<T> {
  rank: number
  /** Breaks a tie within a rank; higher wins. */
  tie?: number
  value: T
}

/** Keep the best `PER_GROUP`, and count the rest. */
function best<T>(scored: Scored<T>[]): { hits: T[]; more: number } {
  scored.sort((a, b) => a.rank - b.rank || (b.tie ?? 0) - (a.tie ?? 0))
  return {
    hits: scored.slice(0, PER_GROUP).map((s) => s.value),
    more: Math.max(0, scored.length - PER_GROUP),
  }
}

function unitName(unit: FortUnit): string {
  return unit.nickname || unit.name || unit.readable
}

function unitDetail(unit: FortUnit): string {
  const group = unitGroup(unit)
  const state = !isLiving(unit)
    ? unit.flags.includes('ghost')
      ? 'ghost'
      : 'dead'
    : group === 'citizen'
      ? null
      : group
  return [unit.profession, unit.race, state].filter(Boolean).join(' · ')
}

function itemDetail(item: FortItem): string {
  return [
    humanize(item.type),
    item.material,
    item.quality !== 'Ordinary' ? splitPascal(item.quality) : null,
    item.flags.includes('artifact') ? 'artifact' : null,
    item.flags.includes('forbid') ? 'forbidden' : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

function buildingLabel(b: FortBuilding): string {
  if (b.custom) return b.custom
  if (b.name) return b.name
  if (b.type === 'Civzone') return `${splitPascal(b.subtype)} zone`
  if (b.subtype) {
    const suffix = b.type === 'Workshop' || b.type === 'Furnace' ? ` ${b.type.toLowerCase()}` : ''
    return `${splitPascal(b.subtype)}${suffix}`
  }
  return splitPascal(b.type)
}

function buildingDetail(b: FortBuilding): string {
  const kind = b.type === 'Civzone' ? 'Zone' : splitPascal(b.type)
  return [kind, b.room, `${b.cx},${b.cy} z${b.z}`].filter(Boolean).join(' · ')
}

/**
 * The world the legends hits should come from: the one the running fortress
 * stands in, else the most recently imported.
 */
async function currentWorldId(): Promise<number | null> {
  const [worlds, state] = await Promise.all([
    postgres_db
      .select({
        id: schema.legends_worlds.id,
        name: schema.legends_worlds.name,
        alt_name: schema.legends_worlds.alt_name,
      })
      .from(schema.legends_worlds)
      .orderBy(desc(schema.legends_worlds.imported_at)),
    postgres_db
      .select({ world_name: schema.fort_state.world_name })
      .from(schema.fort_state)
      .where(eq(schema.fort_state.id, SINGLETON_ID))
      .limit(1),
  ])
  if (!worlds.length) return null
  const live = state[0]?.world_name?.trim().toLowerCase()
  const matches = (value: string | null) => !!live && value?.trim().toLowerCase() === live
  return (worlds.find((w) => matches(w.name) || matches(w.alt_name)) ?? worlds[0]).id
}

export const globalSearch = createServerFn({ method: 'GET' })
  .inputValidator((input: { q: string }) => input)
  .handler(async ({ data }): Promise<SearchResults> => {
    const q = data.q.trim()
    if (q.length < MIN_QUERY) return EMPTY_RESULTS

    const [dumpRows, eventRows, worldId] = await Promise.all([
      postgres_db
        .select({
          units: schema.fort_dump.units,
          items: schema.fort_dump.items,
          buildings: schema.fort_dump.buildings,
        })
        .from(schema.fort_dump)
        .where(eq(schema.fort_dump.id, SINGLETON_ID))
        .limit(1),
      postgres_db
        .select({
          id: schema.fort_events.id,
          text: schema.fort_events.text,
          game_year: schema.fort_events.game_year,
          game_tick: schema.fort_events.game_tick,
          total: sql<number>`count(*) over ()`,
        })
        .from(schema.fort_events)
        .where(
          and(
            ilike(schema.fort_events.text, `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`),
            or(
              sql`${schema.fort_events.type} is null`,
              sql`${schema.fort_events.type} <> 'CANCEL_JOB'`,
            ),
          ),
        )
        .orderBy(desc(schema.fort_events.game_year), desc(schema.fort_events.game_tick))
        .limit(PER_GROUP),
      currentWorldId(),
    ])

    const dump = dumpRows[0]
    const scoredDwarves: Scored<DwarfHit>[] = []
    for (const unit of decodeTable<FortUnit>(dump?.units)) {
      const extra = [unit.name, unit.readable, unit.profession, unit.race, ...unit.positions].join(
        ' ',
      )
      const rank = rankMatch(unitName(unit), extra, q)
      if (rank === null) continue
      scoredDwarves.push({
        rank,
        value: {
          unit: {
            id: unit.id,
            name: unit.name,
            nickname: unit.nickname,
            readable: unit.readable,
            profession: unit.profession,
            flags: unit.flags,
            race_id: unit.race_id,
            caste_id: unit.caste_id,
            look: unit.look,
          },
          detail: unitDetail(unit),
        },
      })
    }

    const scoredItems: Scored<ItemHit>[] = []
    for (const item of decodeTable<FortItem>(dump?.items)) {
      const extra = [item.type, item.subtype, item.material, item.quality].filter(Boolean).join(' ')
      const rank = rankMatch(item.description, extra, q)
      if (rank === null) continue
      // Of a hundred identical mugs, show the one worth the most.
      scoredItems.push({ rank, tie: item.value, value: { item, detail: itemDetail(item) } })
    }

    const scoredPlaces: Scored<PlaceHit>[] = []
    for (const b of decodeTable<FortBuilding>(dump?.buildings)) {
      const label = buildingLabel(b)
      const rank = rankMatch(
        label,
        [b.type, b.subtype, b.name, b.room].filter(Boolean).join(' '),
        q,
      )
      if (rank === null) continue
      scoredPlaces.push({ rank, value: { id: b.id, label, detail: buildingDetail(b) } })
    }

    const events: EventHit[] = eventRows.map((row) => ({
      id: row.id,
      text: row.text,
      when: formatGameTick(row.game_year, row.game_tick),
    }))

    const dwarves = best(scoredDwarves)
    const items = best(scoredItems)
    const places = best(scoredPlaces)
    return {
      dwarves: dwarves.hits,
      items: items.hits,
      places: places.hits,
      events,
      legends: worldId === null ? [] : await searchRecordsByName(worldId, q, undefined, PER_GROUP),
      worldId,
      more: {
        dwarves: dwarves.more,
        items: items.more,
        places: places.more,
        events: Math.max(0, Number(eventRows[0]?.total ?? 0) - events.length),
      },
    }
  })
