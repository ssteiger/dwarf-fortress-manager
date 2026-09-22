import type { FortUnit } from '@fortress/db-drizzle'
import { useQuery } from '@tanstack/react-query'
import * as React from 'react'

import type { DfAssetIndex, LayerSprite, TilePage, TileSprite } from './types'

export type { DfAssetIndex, LayerSprite, TilePage, TileSprite } from './types'

export const DF_ASSETS_BASE = '/df-assets'

async function fetchIndex(): Promise<DfAssetIndex | null> {
  try {
    const res = await fetch(`${DF_ASSETS_BASE}/index.json`)
    if (!res.ok) return null
    return (await res.json()) as DfAssetIndex
  } catch {
    return null
  }
}

/**
 * The extracted sprite index, or null when `bun run assets:extract` has not
 * been run on this machine. Callers render their sprite-less UI on null.
 */
export function useDfAssets(): DfAssetIndex | null {
  const { data } = useQuery({
    queryKey: ['df-assets', 'index'],
    queryFn: fetchIndex,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
    // Fetched in the browser only; the server render shows the fallback UI.
    enabled: typeof window !== 'undefined',
  })
  return data ?? null
}

export function pageUrl(page: TilePage): string {
  return `${DF_ASSETS_BASE}/${page.file}`
}

/** A named tile. Numbered variants ("GRASSLAND_TEMP:3") are picked with `variant`. */
export function tileSprite(index: DfAssetIndex, name: string, variant?: number): TileSprite | null {
  if (variant !== undefined) return index.tiles[`${name}:${variant}`] ?? null
  return index.tiles[name] ?? index.tiles[`${name}:1`] ?? null
}

/** How many numbered variants a tile has (0 when it is a single unnumbered tile). */
export function tileVariantCount(index: DfAssetIndex, name: string): number {
  let n = 0
  while (index.tiles[`${name}:${n + 1}`]) n++
  return n
}

/** Deterministic variant for a map position, so the terrain does not shimmer between renders. */
export function tileVariantAt(
  index: DfAssetIndex,
  name: string,
  x: number,
  y: number,
): TileSprite | null {
  const count = tileVariantCount(index, name)
  if (count === 0) return tileSprite(index, name)
  const h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) >>> 0
  return index.tiles[`${name}:${(h % count) + 1}`] ?? null
}

// ---------------------------------------------------------------------------
// Creatures

export type UnitLook = Pick<FortUnit, 'race_id' | 'caste_id' | 'flags'>

/** Graphics states to try, most specific first, for both simple and layered creatures. */
function lookStates(unit: UnitLook): { simple: string[]; layered: string[] } {
  const f = unit.flags
  if (f.includes('dead')) return { simple: ['CORPSE', 'DEFAULT'], layered: ['CORPSE', 'DEFAULT'] }
  if (f.includes('undead')) {
    return { simple: ['ANIMATED', 'DEFAULT'], layered: ['ANIMATED', 'DEFAULT'] }
  }
  if (f.includes('baby')) {
    return {
      simple: ['BABY', 'CHILD', 'DEFAULT'],
      layered: ['BABY:DEFAULT', 'CHILD:DEFAULT', 'DEFAULT'],
    }
  }
  if (f.includes('child')) {
    return { simple: ['CHILD', 'DEFAULT'], layered: ['CHILD:DEFAULT', 'DEFAULT'] }
  }
  if (f.includes('war')) return { simple: ['TRAINED_WAR', 'DEFAULT'], layered: ['DEFAULT'] }
  if (f.includes('hunter')) return { simple: ['TRAINED_HUNTER', 'DEFAULT'], layered: ['DEFAULT'] }
  return { simple: ['DEFAULT'], layered: ['DEFAULT'] }
}

function creatureKeys(unit: UnitLook): string[] {
  if (!unit.race_id) return []
  return unit.caste_id ? [`${unit.race_id}:${unit.caste_id}`, unit.race_id] : [unit.race_id]
}

export type CreatureLook =
  | { kind: 'sprite'; sprite: TileSprite }
  | { kind: 'layers'; layers: LayerSprite[] }

/**
 * What the game would draw for this unit: a single sprite for most creatures,
 * a stack of layers for civilized races. Null when the race has no graphics
 * in the index or the dump predates the race_id column.
 */
export function creatureLook(index: DfAssetIndex, unit: UnitLook): CreatureLook | null {
  const keys = creatureKeys(unit)
  if (!keys.length) return null
  const states = lookStates(unit)
  for (const state of states.simple) {
    for (const key of keys) {
      const sprite = index.creatures[key]?.[state]
      if (sprite && index.pages[sprite.page]) return { kind: 'sprite', sprite }
    }
  }
  for (const set of states.layered) {
    for (const key of keys) {
      const layers = index.layered[key]?.[set]
      if (layers?.length) return { kind: 'layers', layers }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Canvas helpers

export type SpriteSheets = Map<string, HTMLImageElement>

/**
 * Load the PNGs behind the given pages for canvas drawing. Resolves to null
 * until every sheet has loaded (or the index is missing).
 */
export function useSpriteSheets(
  index: DfAssetIndex | null,
  pageNames: readonly string[],
): SpriteSheets | null {
  const [sheets, setSheets] = React.useState<SpriteSheets | null>(null)
  const key = pageNames.join(',')
  React.useEffect(() => {
    if (!index) {
      setSheets(null)
      return
    }
    let cancelled = false
    const entries = key
      .split(',')
      .filter(Boolean)
      .map((name) => index.pages[name])
      .filter((page): page is TilePage => !!page)
    Promise.all(
      entries.map(
        (page) =>
          new Promise<[string, HTMLImageElement] | null>((resolve) => {
            const img = new Image()
            img.onload = () => resolve([page.name, img])
            img.onerror = () => resolve(null)
            img.src = pageUrl(page)
          }),
      ),
    ).then((loaded) => {
      if (cancelled) return
      const map: SpriteSheets = new Map()
      for (const entry of loaded) if (entry) map.set(entry[0], entry[1])
      setSheets(map)
    })
    return () => {
      cancelled = true
    }
  }, [index, key])
  return sheets
}

/** Draw one tile from a loaded sheet into a canvas rectangle. */
export function drawTile(
  ctx: CanvasRenderingContext2D,
  index: DfAssetIndex,
  sheets: SpriteSheets,
  sprite: TileSprite | null,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): boolean {
  if (!sprite) return false
  const page = index.pages[sprite.page]
  const img = sheets.get(sprite.page)
  if (!page || !img) return false
  ctx.drawImage(
    img,
    sprite.x * page.tileWidth,
    sprite.y * page.tileHeight,
    page.tileWidth,
    page.tileHeight,
    dx,
    dy,
    dw,
    dh,
  )
  return true
}
