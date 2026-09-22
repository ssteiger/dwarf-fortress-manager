import { type DfAssetIndex, type TileSprite, tileSprite, tileVariantAt } from '~/lib/df-assets'
import { words } from './model'
import type { MapRegion, MapSite } from './server'

/**
 * Which of the game's world-map sprites stand for the legends export's
 * coarse region and site types. The export only says "Forest" or "Desert"
 * where the game knows the exact biome, so each type maps to the closest
 * vanilla tile family; evil and good lands use the game's own variants.
 */

/** Sprite sheets the world map draws from. */
export const WORLD_MAP_PAGES = [
  'WORLD_MAP_TILES',
  'WORLD_MAP_MOUNTAINS',
  'WORLD_MAP_FORESTS',
  'WORLD_MAP_DETAILS',
  'WORLD_MAP_EL_CLIFF',
] as const

interface TerrainLook {
  /** Base tile family on WORLD_MAP_TILES (or the elevation sheet for mountains). */
  base: string
  /** Optional 32px overlay family (forests, mountains). */
  overlay?: string
  /** Whether the family has _EVIL/_GOOD variants worth trying. */
  aligned?: boolean
}

const TERRAIN: Record<string, TerrainLook> = {
  Grassland: { base: 'GRASSLAND_TEMP', aligned: true },
  Hills: { base: 'HILLS', aligned: true },
  Forest: { base: 'GRASSLAND_TEMP', overlay: 'FOREST_BROADLEAF_TEMP', aligned: true },
  Mountains: { base: 'WORLD_EL_MOUNTAINS', overlay: 'MOUNTAIN_MID', aligned: true },
  Lake: { base: 'LAKE', aligned: true },
  Wetland: { base: 'MARSH', aligned: true },
  Tundra: { base: 'TUNDRA', aligned: true },
  Desert: { base: 'SAND_DESERT', aligned: true },
  Glacier: { base: 'GLACIER', aligned: true },
  Ocean: { base: 'OCEAN', aligned: true },
}

const OPEN_SEA: TerrainLook = { base: 'OCEAN' }

function alignmentSuffix(evilness: string | null): string {
  if (evilness === 'evil') return '_EVIL'
  if (evilness === 'good') return '_GOOD'
  return ''
}

/** A family with the alignment suffix when the sheet has it, else the plain family. */
function alignedFamily(
  index: DfAssetIndex,
  family: string,
  region: MapRegion | null,
  aligned: boolean | undefined,
): string {
  if (!aligned || !region) return family
  const suffixed = `${family}${alignmentSuffix(region.evilness)}`
  return index.tiles[suffixed] || index.tiles[`${suffixed}:1`] ? suffixed : family
}

export interface TerrainSprites {
  base: TileSprite | null
  overlay: TileSprite | null
}

/** The sprites for one world tile, chosen deterministically from its position. */
export function terrainSprites(
  index: DfAssetIndex,
  region: MapRegion | null,
  x: number,
  y: number,
): TerrainSprites {
  const look = (region?.type && TERRAIN[region.type]) || (region ? TERRAIN.Grassland : OPEN_SEA)
  const base = tileVariantAt(index, alignedFamily(index, look.base, region, look.aligned), x, y)
  const overlay = look.overlay
    ? tileVariantAt(index, alignedFamily(index, look.overlay, region, look.aligned), x, y)
    : null
  return { base, overlay }
}

/** The 32px overlay for a mountain peak or volcano. */
export function peakSprite(
  index: DfAssetIndex,
  volcano: boolean,
  x: number,
  y: number,
): TileSprite | null {
  return tileVariantAt(index, volcano ? 'VOLCANO' : 'MOUNTAIN_PEAK', x, y)
}

/**
 * Directional river tile from which neighbours also carry water, e.g.
 * RIVER_NS for a straight stretch. `size` 1 is a brook, 3 a major river.
 */
export function riverSprite(
  index: DfAssetIndex,
  size: 1 | 2 | 3,
  neighbours: { n: boolean; s: boolean; w: boolean; e: boolean },
): TileSprite | null {
  const family = size === 1 ? 'BROOK' : size === 2 ? 'RIVER' : 'RIVER_MAJOR'
  const dirs = `${neighbours.n ? 'N' : ''}${neighbours.s ? 'S' : ''}${neighbours.w ? 'W' : ''}${neighbours.e ? 'E' : ''}`
  return tileSprite(index, dirs ? `${family}_${dirs}` : `${family}_0`)
}

/** The game's world-map marker for a site; unclaimed settlements show as ruins. */
export function siteSpriteName(site: MapSite): string | null {
  const t = words(site.type)
  const abandoned = site.civ === null && site.owner === null
  switch (t) {
    case 'town':
      return abandoned ? 'SITE_RUIN_CITY' : `SITE_CITY_${1 + (site.id % 4)}`
    case 'hamlet':
      return abandoned ? 'SITE_RUIN_VILLAGE' : 'SITE_VILLAGE'
    case 'fortress':
      return abandoned ? 'SITE_RUIN_DWARF' : 'SITE_FORTRESS'
    case 'mountain halls':
      return abandoned ? 'SITE_RUIN_DWARF' : 'SITE_MOUNTAINHOME'
    case 'hillocks':
      return abandoned ? 'SITE_RUIN_DWARF' : 'SITE_HILLOCKS'
    case 'dark fortress':
      return abandoned ? 'SITE_RUIN_GOBLIN' : 'SITE_DARK_FORTRESS_1'
    case 'dark pits':
      return abandoned ? 'SITE_RUIN_GOBLIN' : 'SITE_DARK_FORTRESS_2'
    case 'forest retreat':
      return `${abandoned ? 'SITE_RUIN_FOREST_RETREAT_' : 'SITE_FOREST_RETREAT_'}${1 + (site.id % 2)}`
    case 'castle':
      return abandoned ? 'SITE_RUIN_CASTLE' : 'SITE_CASTLE'
    case 'fort':
      return 'SITE_FORT'
    case 'cave':
      return 'SITE_CAVE'
    case 'lair':
    case 'mysterious lair':
      return 'SITE_LAIR_BURROW'
    case 'labyrinth':
      return 'SITE_LABYRINTH'
    case 'shrine':
      return 'SITE_SHRINE_TITAN'
    case 'tower':
      return 'SITE_NECROTOWER'
    case 'monastery':
      return 'SITE_MONASTERY'
    case 'camp':
      return 'SITE_CAMP'
    case 'vault':
      return 'SITE_VAULT'
    case 'tomb':
      return 'SITE_TOMB'
    default:
      return t.includes('ruin') ? 'SITE_RUIN' : null
  }
}

export function siteSprite(index: DfAssetIndex, site: MapSite): TileSprite | null {
  const name = siteSpriteName(site)
  return name ? tileSprite(index, name) : null
}

/** Sample sprites for the legend under the map. */
export function legendTerrain(index: DfAssetIndex, type: string): TerrainSprites {
  return terrainSprites(index, { id: -1, name: null, type, evilness: null, tiles: 0 }, 0, 0)
}

export function tileSpriteByName(index: DfAssetIndex, name: string): TileSprite | null {
  return tileSprite(index, name)
}
