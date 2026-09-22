/**
 * Shape of apps/web/public/df-assets/index.json, written by
 * apps/worker/src/scripts/extract-assets.ts. The assets are extracted from
 * the local game install and are never committed, so everything here must
 * cope with the index being absent.
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
}

/** One layer of a layered creature; w/h are in tiles (>1 only for LARGE_IMAGE). */
export interface LayerSprite extends TileSprite {
  name: string
  w: number
  h: number
}

export interface DfAssetIndex {
  gameDir: string
  extractedAt: string
  pages: Record<string, TilePage>
  /** TILE_GRAPHICS name -> sprite; numbered variants are stored as "NAME:n". */
  tiles: Record<string, TileSprite>
  /** "CREATURE" or "CREATURE:CASTE" -> state (DEFAULT, CHILD, CORPSE, ...) -> sprite. */
  creatures: Record<string, Record<string, TileSprite>>
  /** "CREATURE" or "CREATURE:CASTE" -> layer set ("DEFAULT", "CHILD:DEFAULT", "CORPSE", ...) -> layers bottom to top. */
  layered: Record<string, Record<string, LayerSprite[]>>
}
