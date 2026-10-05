import {
  type FortBuilding,
  type FortMapBlock,
  type FortMineral,
  type FortTiletype,
  type FortUnit,
  postgres_db,
  schema,
} from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'

import { dumpTable, readDump } from './dump'

/*
 * Server function for the map: one z-level of the map the worker stored,
 * with the units and buildings on it.
 */

const SINGLETON_ID = 1

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
  /** Blocks on this level only: [z, bx, by, tilesRle, flagsRle, veinsRle?]. */
  blocks: FortMapBlock[]
  tiletypes: Record<string, FortTiletype>
  /** Inorganic index -> what the veins in `blocks` are made of; empty in maps older than version 9. */
  minerals: Record<string, FortMineral>
  units: MapLevelUnit[]
  buildings: MapLevelBuilding[]
  /** Highest z on which a citizen currently stands, a good default level. */
  suggestedZ: number | null
}

export const getFortMapLevel = createServerFn({ method: 'GET' })
  .inputValidator((input: MapLevelQuery) => input)
  .handler(async ({ data }): Promise<FortMapLevel | null> => {
    const [mapRows, dump] = await Promise.all([
      postgres_db
        .select()
        .from(schema.fort_map)
        .where(eq(schema.fort_map.id, SINGLETON_ID))
        .limit(1),
      readDump(),
    ])
    const map = mapRows[0]
    if (!map) return null
    const units = dumpTable<FortUnit>(dump, 'units')
    const buildings = dumpTable<FortBuilding>(dump, 'buildings')

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
      minerals: map.minerals ?? {},
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
