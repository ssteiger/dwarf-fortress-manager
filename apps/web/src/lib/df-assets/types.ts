/**
 * Shape of apps/web/public/df-assets/index.json and layers/<CREATURE>.json,
 * written by apps/worker/src/scripts/extract-assets.ts. The assets are
 * extracted from the local game install and are never committed, so
 * everything here must cope with the index being absent.
 */

export interface TilePage {
  /** TILE_PAGE name, e.g. CREATURES_DOMESTIC. */
  name: string
  /** Path of the PNG relative to /df-assets/. */
  file: string
  tileWidth: number
  tileHeight: number
  pageWidth: number
  pageHeight: number
}

export interface TileSprite {
  page: string
  x: number
  y: number
  /** Size in tiles; present (>1) only for LARGE_IMAGE sprites. */
  w?: number
  h?: number
}

export interface NamedPalette {
  /** Palette PNG relative to /df-assets/; one colour per column, one variant per row. */
  file: string
  /** Row the sprite sheets are painted in. */
  defaultRow: number
  /** Colour token (DARK_BROWN) -> row; used by USE_STANDARD_PALETTE_FROM_ITEM. */
  colors: Record<string, number>
}

export interface DfAssetIndex {
  gameDir: string
  extractedAt: string
  pages: Record<string, TilePage>
  /** TILE_GRAPHICS name -> sprite; numbered variants are stored as "NAME:n". */
  tiles: Record<string, TileSprite>
  /** "CREATURE" or "CREATURE:CASTE" -> state (DEFAULT, CHILD, CORPSE, ...) -> sprite. */
  creatures: Record<string, Record<string, TileSprite>>
  /** Creatures with a layers/<CREATURE>.json rule file. */
  layeredCreatures: string[]
  /** [PALETTE:NAME] blocks; "DEFAULT" is the one item colours refer to. */
  palettes: Record<string, NamedPalette>
  /** Item subtype token (ITEM_WEAPON_PICK) -> sprite, with the artifact variant when the raws have one. */
  items: Record<string, { default: TileSprite; artifact?: TileSprite }>
  /** Plant token -> seed, harvested plant, shrub, and picked growth sprites. */
  plants: Record<
    string,
    { seed?: TileSprite; picked?: TileSprite; shrub?: TileSprite; growth?: TileSprite }
  >
}

// ---------------------------------------------------------------------------
// Layer rules: the game's layered graphics raws, verbatim

export interface LayerRule {
  name: string
  page: string
  x: number
  y: number
  w: number
  h: number
  /**
   * Condition tags in raw order, tag first, e.g.
   * ["CONDITION_TISSUE_LAYER","BY_CATEGORY","HEAD","HAIR"] followed by
   * ["TISSUE_MIN_LENGTH","50"]. TISSUE_* and item tags refer to the tissue or
   * item selected by the tag before them.
   */
  conditions: string[][]
  /** [USE_PALETTE:NAME:row]: recolour from the palette's default row to `row`. */
  palette?: { name: string; row: number }
  /** [USE_STANDARD_PALETTE_FROM_ITEM]: recolour with the worn item's material colour. */
  itemPalette?: boolean
}

export interface LayerGroupRule {
  /** Opened by [LAYER_GROUP]; false for a layer that stands on its own. */
  explicit: boolean
  /** [LG_OFFSET:x:y] in pixels. */
  offset?: [number, number]
  /** Group-level conditions ([LG_CONDITION_BP:...] + [BP_PRESENT] ...). */
  conditions: string[][]
  layers: LayerRule[]
}

export interface LayerSetRule {
  /** "DEFAULT", "CHILD:DEFAULT", "BABY:DEFAULT", "CORPSE", "ANIMATED", "PORTRAIT", "CHILD:PORTRAIT", ... */
  key: string
  /** Set when the set came from [CREATURE_CASTE_GRAPHICS:ID:CASTE]. */
  caste: string | null
  /** LS_PALETTE name -> palette image and the row the sheets are painted in. */
  palettes: Record<string, { file: string; defaultRow: number }>
  groups: LayerGroupRule[]
}

export interface CreatureLayerRules {
  creature: string
  sets: LayerSetRule[]
}
