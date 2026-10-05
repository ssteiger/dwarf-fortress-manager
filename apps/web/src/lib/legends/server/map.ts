import { postgres_db, schema } from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'

/*
 * Server function: what the world map draws. That is the regions tile by
 * tile, the rivers, sites and peaks, and the civilizations holding the sites.
 */

const R = schema.legends_records

export interface MapRegion {
  id: number
  name: string | null
  type: string | null
  evilness: string | null
  tiles: number
}

export interface MapSite {
  id: number
  name: string | null
  type: string | null
  x: number
  y: number
  civ: number | null
  owner: number | null
}

export interface MapPeak {
  id: number
  name: string | null
  x: number
  y: number
  volcano: boolean
}

export interface LegendsMapData {
  width: number
  height: number
  regions: MapRegion[]
  /** Index into `regions` per tile (row-major), -1 where no region claims the tile. */
  tiles: number[]
  /** Tiles with a stream or river; size 1 is a stream, 3 a major river. Brooks are left out. */
  rivers: { tile: number; size: 1 | 2 | 3 }[]
  sites: MapSite[]
  peaks: MapPeak[]
  civs: Record<number, { name: string | null; race: string | null }>
}

function parseCoord(s: string | null | undefined): [number, number] | null {
  if (!s) return null
  const [x, y] = s.split(',').map((v) => Number.parseInt(v, 10))
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return null
  return [x, y]
}

function parseCoordList(s: string | null | undefined): [number, number][] {
  if (!s) return []
  const out: [number, number][] = []
  for (const part of s.split('|')) {
    const c = parseCoord(part)
    if (c) out.push(c)
  }
  return out
}

export const getLegendsMap = createServerFn({ method: 'GET' })
  .inputValidator((input: { worldId: number }) => input)
  .handler(async ({ data }): Promise<LegendsMapData> => {
    const W = eq(R.world_id, data.worldId)
    const [regionRows, siteRows, peakRows, riverRows] = await Promise.all([
      postgres_db
        .select({
          id: R.id,
          name: R.name,
          type: R.type,
          coords: sql<string | null>`${R.payload}->'plus'->>'coords'`,
          evilness: sql<string | null>`${R.payload}->'plus'->>'evilness'`,
        })
        .from(R)
        .where(and(W, eq(R.kind, 'region')))
        .orderBy(asc(R.id)),
      postgres_db
        .select({
          id: R.id,
          name: R.name,
          type: R.type,
          coords: sql<string | null>`${R.payload}->>'coords'`,
          civ: sql<number | null>`(${R.payload}->'plus'->>'civ_id')::int`,
          owner: sql<number | null>`(${R.payload}->'plus'->>'cur_owner_id')::int`,
        })
        .from(R)
        .where(and(W, eq(R.kind, 'site'))),
      postgres_db
        .select({
          id: R.id,
          name: R.name,
          coords: sql<string | null>`${R.payload}->'plus'->>'coords'`,
          volcano: sql<boolean | null>`(${R.payload}->'plus'->>'is_volcano')::boolean`,
        })
        .from(R)
        .where(and(W, eq(R.kind, 'mountain_peak'))),
      postgres_db
        .select({ path: sql<string | null>`${R.payload}->'plus'->>'path'` })
        .from(R)
        .where(and(W, eq(R.kind, 'river'))),
    ])

    const regionCoords = regionRows.map((row) => parseCoordList(row.coords))
    let maxX = 0
    let maxY = 0
    for (const list of regionCoords)
      for (const [x, y] of list) {
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    const sites: MapSite[] = []
    for (const row of siteRows) {
      const c = parseCoord(row.coords)
      if (!c) continue
      if (c[0] > maxX) maxX = c[0]
      if (c[1] > maxY) maxY = c[1]
      sites.push({
        id: row.id,
        name: row.name,
        type: row.type,
        x: c[0],
        y: c[1],
        civ: row.civ !== null && row.civ >= 0 ? Number(row.civ) : null,
        owner: row.owner !== null && row.owner >= 0 ? Number(row.owner) : null,
      })
    }
    const width = maxX + 1
    const height = maxY + 1
    const tiles = new Array<number>(width * height).fill(-1)
    regionCoords.forEach((list, index) => {
      for (const [x, y] of list) tiles[y * width + x] = index
    })

    // Path segments are "x,y,flow,exit,elevation". Nearly every tile carries a
    // brook, so only streams and rivers (flow >= 5000) make it onto the map.
    const riverTiles = new Map<number, 1 | 2 | 3>()
    for (const row of riverRows) {
      if (!row.path) continue
      for (const part of row.path.split('|')) {
        const [x, y, flow] = part.split(',').map((v) => Number.parseInt(v, 10))
        if (
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          x < 0 ||
          y < 0 ||
          x >= width ||
          y >= height
        )
          continue
        if (!Number.isFinite(flow) || flow < 5000) continue
        const size: 1 | 2 | 3 = flow >= 40_000 ? 3 : flow >= 20_000 ? 2 : 1
        const tile = y * width + x
        if ((riverTiles.get(tile) ?? 0) < size) riverTiles.set(tile, size)
      }
    }

    const peaks: MapPeak[] = []
    for (const row of peakRows) {
      const c = parseCoord(row.coords)
      if (!c) continue
      peaks.push({ id: row.id, name: row.name, x: c[0], y: c[1], volcano: row.volcano === true })
    }

    const civIds = new Set<number>()
    for (const site of sites) {
      if (site.civ !== null) civIds.add(site.civ)
      if (site.owner !== null) civIds.add(site.owner)
    }
    const civRows = civIds.size
      ? await postgres_db
          .select({
            id: R.id,
            name: R.name,
            race: sql<string | null>`${R.payload}->'plus'->>'race'`,
          })
          .from(R)
          .where(and(W, eq(R.kind, 'entity'), inArray(R.id, [...civIds])))
      : []

    return {
      width,
      height,
      regions: regionRows.map((row, index) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        evilness: row.evilness,
        tiles: regionCoords[index].length,
      })),
      tiles,
      rivers: [...riverTiles.entries()].map(([tile, size]) => ({ tile, size })),
      sites,
      peaks,
      civs: Object.fromEntries(civRows.map((row) => [row.id, { name: row.name, race: row.race }])),
    }
  })
