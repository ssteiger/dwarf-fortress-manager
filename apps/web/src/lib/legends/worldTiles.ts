import { type DfAssetIndex, type TileSprite, tileSprite, tileVariantAt } from '~/lib/df-assets'
import { words } from './model'
import type { LegendsMapData, MapSite } from './server'

/** The game's world-map sprites for legends data: terrain, rivers, sites and artifacts. */

/** Sprite sheets the world map draws from. */
export const WORLD_MAP_PAGES = [
  'WORLD_MAP_TILES',
  'WORLD_MAP_MOUNTAINS',
  'WORLD_MAP_FORESTS',
  'WORLD_MAP_DETAILS',
  'WORLD_MAP_EL_CLIFF',
] as const

/*
 * Legends only records a region's coarse type ("Forest", "Wetland"), not the
 * game's biome, so the plan below picks the closest vanilla families and
 * fills in what the type leaves out from the neighbourhood: forests turn to
 * conifers and then taiga towards the tundra, mountains rise from foothills
 * at a range's edge to high peaks inside it, open sea deepens away from the
 * coast, and each region keeps one of its type's looks (swamp or marsh,
 * grassland or savanna) so neighbouring regions read as separate places.
 * Evil and good regions use the game's own variants of every family.
 */

export interface TerrainSprites {
  base: TileSprite | null
  overlay: TileSprite | null
}

export interface TerrainPlan {
  /** Ground per world tile (16px). */
  base: (TileSprite | null)[]
  /** 32px forest, mountain or peak sprite per tile; drawn at twice the tile size, bottom-anchored. */
  overlay: (TileSprite | null)[]
  /** River piece per tile, null where no river runs. */
  river: (TileSprite | null)[]
}

const COLD_TAIGA = 5
const COLD_CONIFER = 14

function hash(a: number, b: number, salt: number): number {
  let h =
    Math.imul(a + 1, 374761393) ^ Math.imul(b + 1, 668265263) ^ Math.imul(salt + 1, 2246822519)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function alignedFamily(index: DfAssetIndex, family: string, evilness: string | null): string {
  const suffix = evilness === 'evil' ? '_EVIL' : evilness === 'good' ? '_GOOD' : ''
  if (!suffix) return family
  const suffixed = `${family}${suffix}`
  return index.tiles[suffixed] || index.tiles[`${suffixed}:1`] ? suffixed : family
}

/** Steps (4-neighbour) from each tile to the nearest source, through passable tiles. */
function distanceField(
  width: number,
  height: number,
  isSource: (i: number) => boolean,
  passable: (i: number) => boolean,
): Int32Array {
  const far = width + height
  const dist = new Int32Array(width * height).fill(far)
  const queue: number[] = []
  for (let i = 0; i < dist.length; i++) {
    if (isSource(i)) {
      dist[i] = 0
      queue.push(i)
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]
    const x = cur % width
    const y = (cur - x) / width
    const next = dist[cur] + 1
    const visit = (n: number) => {
      if (dist[n] > next && passable(n)) {
        dist[n] = next
        queue.push(n)
      }
    }
    if (x > 0) visit(cur - 1)
    if (x < width - 1) visit(cur + 1)
    if (y > 0) visit(cur - width)
    if (y < height - 1) visit(cur + width)
  }
  return dist
}

/** Ground family for a tile; `pick` is the region's own 0..1 roll, `cold` steps to tundra or glacier. */
function groundFamily(type: string | null, pick: number, cold: number, fromLand: number): string {
  switch (type) {
    case null:
    case 'Ocean':
      return fromLand >= 3 ? 'OCEAN_DEEP' : 'OCEAN'
    case 'Mountains':
      return 'ROCKY_HILLS'
    case 'Forest':
      return cold < COLD_TAIGA ? 'TUNDRA' : 'GRASSLAND_TEMP'
    case 'Grassland':
      if (cold < 2) return 'TUNDRA'
      if (cold < COLD_TAIGA) return 'GRASSLAND_TEMP'
      return pick < 0.25 ? 'SAVANNA_TEMP' : pick < 0.4 ? 'SHRUBLAND' : 'GRASSLAND_TEMP'
    case 'Hills':
      return pick < 0.3 ? 'ROCKY_HILLS' : 'HILLS'
    case 'Wetland':
      return pick < 0.5 ? 'SWAMP' : 'MARSH'
    case 'Desert':
      return pick < 0.5 ? 'SAND_DESERT' : pick < 0.75 ? 'ROCKY_PLAINS' : 'BADLANDS'
    case 'Tundra':
      return 'TUNDRA'
    case 'Glacier':
      return 'GLACIER'
    case 'Lake':
      return 'LAKE'
    default:
      return 'GRASSLAND_TEMP'
  }
}

/** Forest or mountain sprite family; `depth` is steps inside a mountain range. */
function overlayFamily(type: string | null, cold: number, depth: number): string | null {
  if (type === 'Mountains') {
    return depth <= 1 ? 'MOUNTAIN_LOW' : depth === 2 ? 'MOUNTAIN_MID' : 'MOUNTAIN_HIGH'
  }
  if (type === 'Forest') {
    return cold < COLD_TAIGA
      ? 'FOREST_TAIGA'
      : cold < COLD_CONIFER
        ? 'FOREST_CONIFER_TEMP'
        : 'FOREST_BROADLEAF_TEMP'
  }
  return null
}

const RIVER_FAMILY = { 1: 'BROOK', 2: 'RIVER', 3: 'RIVER_MAJOR' } as const

/**
 * Directional river piece from which neighbours also carry water, e.g.
 * RIVER_NS for a straight stretch. A river's last tile turns towards the
 * lake or sea beside it so it visibly flows in.
 */
function riverPiece(
  index: DfAssetIndex,
  data: LegendsMapData,
  sizes: Uint8Array,
  types: (string | null)[],
  i: number,
): TileSprite | null {
  const { width, height } = data
  const x = i % width
  const y = (i - x) / width
  const inside = (nx: number, ny: number) => nx >= 0 && ny >= 0 && nx < width && ny < height
  const flows = (nx: number, ny: number) => inside(nx, ny) && sizes[ny * width + nx] > 0
  const open = { N: flows(x, y - 1), S: flows(x, y + 1), W: flows(x - 1, y), E: flows(x + 1, y) }
  if (Number(open.N) + Number(open.S) + Number(open.W) + Number(open.E) <= 1) {
    const sides: ['N' | 'S' | 'W' | 'E', number, number][] = [
      ['N', 0, -1],
      ['S', 0, 1],
      ['W', -1, 0],
      ['E', 1, 0],
    ]
    for (const [side, dx, dy] of sides) {
      if (open[side] || !inside(x + dx, y + dy)) continue
      const t = types[(y + dy) * width + x + dx]
      if (t === null || t === 'Lake' || t === 'Ocean') {
        open[side] = true
        break
      }
    }
  }
  const family = RIVER_FAMILY[sizes[i] as 1 | 2 | 3] ?? 'BROOK'
  const dirs = `${open.N ? 'N' : ''}${open.S ? 'S' : ''}${open.W ? 'W' : ''}${open.E ? 'E' : ''}`
  if (dirs === 'NS' || dirs === 'WE') return tileVariantAt(index, `${family}_${dirs}`, x, y)
  return tileSprite(index, dirs ? `${family}_${dirs}` : `${family}_0`)
}

/** Every tile's sprites, worked out once per map. */
export function planTerrain(index: DfAssetIndex, data: LegendsMapData): TerrainPlan {
  const { width, height } = data
  const count = width * height
  const types = Array.from({ length: count }, (_, i) => {
    const r = data.tiles[i]
    return r >= 0 ? (data.regions[r]?.type ?? null) : null
  })
  const cold = distanceField(
    width,
    height,
    (i) => types[i] === 'Tundra' || types[i] === 'Glacier',
    () => true,
  )
  const depth = distanceField(
    width,
    height,
    (i) => types[i] !== 'Mountains',
    (i) => types[i] === 'Mountains',
  )
  const fromLand = distanceField(
    width,
    height,
    (i) => types[i] !== null && types[i] !== 'Ocean',
    () => true,
  )
  const sizes = new Uint8Array(count)
  for (const r of data.rivers) sizes[r.tile] = Math.max(sizes[r.tile], r.size)
  const peaks = new Map(data.peaks.map((p) => [p.y * width + p.x, p.volcano]))

  const base: (TileSprite | null)[] = new Array(count)
  const overlay: (TileSprite | null)[] = new Array(count)
  const river: (TileSprite | null)[] = new Array(count)
  for (let i = 0; i < count; i++) {
    const x = i % width
    const y = (i - x) / width
    const r = data.tiles[i]
    const region = r >= 0 ? data.regions[r] : null
    const evilness = region?.evilness ?? null
    const pick = region ? hash(region.id, 0, 77) : 0
    const ground = groundFamily(types[i], pick, cold[i], fromLand[i])
    base[i] = tileVariantAt(index, alignedFamily(index, ground, evilness), x, y)
    const peak = peaks.get(i)
    // Trees and rocks stay off rivers so the water shows; peaks always stand.
    const family =
      peak !== undefined
        ? peak
          ? 'VOLCANO'
          : 'MOUNTAIN_PEAK'
        : sizes[i]
          ? null
          : overlayFamily(types[i], cold[i], depth[i])
    overlay[i] = family
      ? tileVariantAt(index, alignedFamily(index, family, evilness), x * 7 + 3, y * 13 + 5)
      : null
    river[i] = sizes[i] ? riverPiece(index, data, sizes, types, i) : null
  }
  return { base, overlay, river }
}

const LEGEND_LOOK: Record<string, [string, string | null]> = {
  Grassland: ['GRASSLAND_TEMP', null],
  Hills: ['HILLS', null],
  Forest: ['GRASSLAND_TEMP', 'FOREST_BROADLEAF_TEMP'],
  Mountains: ['ROCKY_HILLS', 'MOUNTAIN_MID'],
  Lake: ['LAKE', null],
  Wetland: ['SWAMP', null],
  Tundra: ['TUNDRA', null],
  Desert: ['SAND_DESERT', null],
  Glacier: ['GLACIER', null],
  Ocean: ['OCEAN', null],
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

/** Representative sprites for a region type, for legends and chips. */
export function legendTerrain(index: DfAssetIndex, type: string): TerrainSprites {
  const [ground, over] = LEGEND_LOOK[type] ?? LEGEND_LOOK.Grassland
  return { base: tileSprite(index, ground), overlay: over ? tileSprite(index, over) : null }
}

export function tileSpriteByName(index: DfAssetIndex, name: string): TileSprite | null {
  return tileSprite(index, name)
}
