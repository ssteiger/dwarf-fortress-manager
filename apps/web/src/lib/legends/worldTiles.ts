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
  return siteSpriteNameFor(site.type, site.id, site.civ === null && site.owner === null)
}

export function siteSpriteNameFor(
  type: string | null,
  id: number,
  abandoned: boolean,
): string | null {
  const t = words(type)
  switch (t) {
    case 'town':
      return abandoned ? 'SITE_RUIN_CITY' : `SITE_CITY_${1 + (id % 4)}`
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
      return `${abandoned ? 'SITE_RUIN_FOREST_RETREAT_' : 'SITE_FOREST_RETREAT_'}${1 + (id % 2)}`
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
    case 'mysterious dungeon':
      return 'SITE_MYTHICAL_1'
    case 'mysterious palace':
      return 'SITE_MYTHICAL_2'
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

/** Site marker for a legends record that is not on the map (lists, headers). */
export function siteSpriteFor(
  index: DfAssetIndex,
  type: string | null,
  id: number,
): TileSprite | null {
  const name = siteSpriteNameFor(type, id, false)
  return name ? tileSprite(index, name) : null
}

/**
 * The sprite for an artifact from its legends_plus item type and subtype
 * names. Subtype names are matched against the raws' subtype tokens in both
 * word orders ("war hammer" -> ITEM_WEAPON_HAMMER_WAR); when nothing matches,
 * a representative tile for the type is used (books, slabs, jewellery, ...).
 */
export function artifactSprite(
  index: DfAssetIndex,
  item: { type: string | null; subtype: string | null } | null | undefined,
): TileSprite | null {
  if (!item?.type) return null
  const type = item.type
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
  const subtype = (item.subtype ?? '').trim().toLowerCase()
  const subtypeWords = subtype
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
  const candidates: string[] = []
  const alias = SUBTYPE_ALIASES[subtype]
  if (alias) candidates.push(alias)
  if (subtypeWords.length) {
    const joined = subtypeWords.join('_')
    const reversed = [...subtypeWords].reverse().join('_')
    candidates.push(`ITEM_${type}_${joined}`, `ITEM_${type}_${reversed}`)
    candidates.push(`ITEM_${type}_${joined}S`, `ITEM_${type}_${reversed}S`)
  }
  candidates.push(...(ARTIFACT_TYPE_TILES[type] ?? [`ITEM_${type}`]))
  for (const token of candidates) {
    const entry = index.items[token]
    if (entry) return entry.artifact ?? entry.default
    const tile = tileSprite(index, token)
    if (tile) return tile
  }
  return null
}

/** Legends subtype names whose raw token is not a word-order permutation. */
const SUBTYPE_ALIASES: Record<string, string> = {
  trousers: 'ITEM_PANTS_PANTS',
  mitten: 'ITEM_GLOVES_MITTENS',
  glove: 'ITEM_GLOVES_GLOVES',
  gauntlet: 'ITEM_GLOVES_GAUNTLETS',
  'two-handed sword': 'ITEM_WEAPON_SWORD_2H',
  'high boot': 'ITEM_SHOES_BOOTS',
  'low boot': 'ITEM_SHOES_BOOTS_LOW',
  shoe: 'ITEM_SHOES_SHOES',
  sock: 'ITEM_SHOES_SOCKS',
  sandal: 'ITEM_SHOES_SANDAL',
  chausse: 'ITEM_SHOES_CHAUSSE',
  armor: 'ITEM_ARMOR_BREASTPLATE',
  'leather armor': 'ITEM_ARMOR_LEATHER',
  'mail shirt': 'ITEM_ARMOR_MAIL_SHIRT',
  'large dagger': 'ITEM_WEAPON_DAGGER_LARGE',
  'great axe': 'ITEM_WEAPON_AXE_GREAT',
  'battle axe': 'ITEM_WEAPON_AXE_BATTLE',
  'short sword': 'ITEM_WEAPON_SWORD_SHORT',
  'long sword': 'ITEM_WEAPON_SWORD_LONG',
  'war hammer': 'ITEM_WEAPON_HAMMER_WAR',
  'training axe': 'ITEM_WEAPON_AXE_TRAINING',
  'training sword': 'ITEM_WEAPON_SWORD_SHORT_TRAINING',
  'training spear': 'ITEM_WEAPON_SPEAR_TRAINING',
}

/** Representative tiles per artifact item type, first available wins. */
const ARTIFACT_TYPE_TILES: Record<string, string[]> = {
  WEAPON: ['ITEM_WEAPON_SWORD_SHORT'],
  ARMOR: ['ITEM_ARMOR_BREASTPLATE'],
  HELM: ['ITEM_HELM_HELM'],
  GLOVES: ['ITEM_GLOVES_GAUNTLETS'],
  SHOES: ['ITEM_SHOES_BOOTS'],
  PANTS: ['ITEM_PANTS_PANTS'],
  SHIELD: ['ITEM_SHIELD_SHIELD'],
  BOOK: ['ITEM_BOOK_METAL', 'ITEM_BOOK_WOOD'],
  SLAB: ['ITEM_SLAB_ENGRAVED_SECRET', 'ITEM_SLAB_BLANK'],
  BRACELET: ['ITEM_BRACELET_METAL_ENCRUSTED', 'ITEM_BRACELET_METAL'],
  AMULET: ['ITEM_AMULET_METAL_ENCRUSTED', 'ITEM_AMULET_METAL'],
  RING: ['ITEM_RING_METAL_ENCRUSTED', 'ITEM_RING_METAL'],
  EARRING: ['ITEM_EARRING_METAL_ENCRUSTED', 'ITEM_EARRING_METAL'],
  CROWN: ['ITEM_CROWN_METAL_ENCRUSTED', 'ITEM_CROWN_METAL'],
  SCEPTER: ['ITEM_SCEPTER_METAL_ENCRUSTED', 'ITEM_SCEPTER_METAL'],
  FIGURINE: ['ITEM_FIGURINE_METAL_ENCRUSTED', 'ITEM_FIGURINE_METAL'],
  TOTEM: ['ITEM_TOTEM_ENCRUSTED', 'ITEM_TOTEM'],
  GOBLET: ['ITEM_GOBLET_METAL_ENCRUSTED', 'ITEM_GOBLET_METAL'],
  STATUE: ['ITEM_STATUE_ARTIFACT', 'ITEM_STATUE'],
  COIN: ['ITEM_COINS_SINGLE'],
  GEM: ['ITEM_GEMS'],
  SMALLGEM: ['ITEM_GEMS'],
  FLASK: ['ITEM_FLASK_METAL'],
  TOY: ['ITEM_TOY'],
  TOOL: ['ITEM_TOOL'],
  INSTRUMENT: ['ITEM_INSTRUMENT_STRINGED_HANDHELD'],
  QUIVER: ['ITEM_QUIVER'],
  BACKPACK: ['ITEM_BACKPACK'],
}

/** Sample sprites for the legend under the map. */
export function legendTerrain(index: DfAssetIndex, type: string): TerrainSprites {
  return terrainSprites(index, { id: -1, name: null, type, evilness: null, tiles: 0 }, 0, 0)
}

export function tileSpriteByName(index: DfAssetIndex, name: string): TileSprite | null {
  return tileSprite(index, name)
}
