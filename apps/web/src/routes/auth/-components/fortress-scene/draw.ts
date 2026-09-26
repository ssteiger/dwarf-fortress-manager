import { type DfAssetIndex, type SpriteSheets, type TileSprite, tileSprite } from '~/lib/df-assets'

import { type PropKind, type SceneMap, type Vein, hash, idx, isFloor } from './map'

/** Rendered tile size: the game's 32px sprites at 2x, so pixels stay square. */
export const TILE = 64

export const VEIN_COLORS: Record<Vein, string> = {
  gold: '#e8b93a',
  copper: '#d6783e',
  silver: '#cdd6e0',
  emerald: '#3fcf7a',
  sapphire: '#4a7df0',
  ruby: '#e0435a',
  amethyst: '#b061e8',
}

const ROCK_TINT = '#bfae9c'
const FLOOR_TINT = '#b8a58e'
const HIDDEN_ROCK = [
  'HIDDEN_ROCK_1',
  'HIDDEN_ROCK_2',
  'HIDDEN_ROCK_3',
  'HIDDEN_ROCK_4',
  'HIDDEN_ROCK_5',
]
const GEM_OVERLAYS = ['GEM_A', 'GEM_B', 'GEM_C', 'GEM_D'].map((g) => `${g}_WALL_N_S_W_E`)
const DIAGONALS: [string, number, number][] = [
  ['NW', -1, -1],
  ['NE', 1, -1],
  ['SW', -1, 1],
  ['SE', 1, 1],
]

const PROP_TILES: Record<PropKind, string> = {
  barrel: 'ITEM_BARREL_WOOD_ITEM',
  bin: 'ITEM_BIN',
  anvil: 'ITEM_ANVIL',
  coins: 'ITEM_COINS_PILE_4',
  boulder: 'BOULDER',
}

export const FIRE_FRAMES = ['CAMPFIRE:1', 'CAMPFIRE:2', 'CAMPFIRE:3', 'CAMPFIRE:4']
export const FIRE_TOP_FRAMES = [
  'CAMPFIRE_TOP:1',
  'CAMPFIRE_TOP:2',
  'CAMPFIRE_TOP:3',
  'CAMPFIRE_TOP:4',
]

const SCENE_TILES = [
  'STONE_FLOOR_5',
  'STONE_WALL_N_S_W_E_1',
  'STONE_WALL_S_1',
  ...HIDDEN_ROCK,
  ...GEM_OVERLAYS,
  ...Object.values(PROP_TILES),
  ...FIRE_FRAMES,
  ...FIRE_TOP_FRAMES,
]

/** Sheet pages the scene draws from. */
export function scenePages(index: DfAssetIndex): string[] {
  const pages = new Set<string>()
  for (const name of SCENE_TILES) {
    const sprite = index.tiles[name]
    if (sprite) pages.add(sprite.page)
  }
  return [...pages].sort()
}

export interface Layout {
  /** Pixel offset of cell (0, 0); the grid is centred horizontally and anchored to the bottom. */
  ox: number
  oy: number
}

// Tinted copies of single tiles, keyed by sprite, tint and flips.
const tinted = new Map<string, HTMLCanvasElement>()

function tintedTile(
  index: DfAssetIndex,
  sheets: SpriteSheets,
  sprite: TileSprite,
  tint: string | null,
  flipX = false,
  flipY = false,
): CanvasImageSource | null {
  const page = index.pages[sprite.page]
  const img = sheets.get(sprite.page)
  if (!page || !img) return null
  const key = `${sprite.page}:${sprite.x}:${sprite.y}:${tint}:${flipX}:${flipY}`
  const cached = tinted.get(key)
  if (cached) return cached
  const { tileWidth: w, tileHeight: h } = page
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d')
  if (!g) return null
  g.imageSmoothingEnabled = false
  g.translate(flipX ? w : 0, flipY ? h : 0)
  g.scale(flipX ? -1 : 1, flipY ? -1 : 1)
  const blit = () => g.drawImage(img, sprite.x * w, sprite.y * h, w, h, 0, 0, w, h)
  blit()
  if (tint) {
    // Multiply keeps the shading; drawing the tile again with destination-in
    // restores its transparency.
    g.globalCompositeOperation = 'multiply'
    g.fillStyle = tint
    g.fillRect(0, 0, w, h)
    g.globalCompositeOperation = 'destination-in'
    blit()
  }
  tinted.set(key, canvas)
  return canvas
}

function draw(
  ctx: CanvasRenderingContext2D,
  index: DfAssetIndex,
  sheets: SpriteSheets,
  name: string,
  x: number,
  y: number,
  opts: { tint?: string | null; flipX?: boolean; flipY?: boolean; alpha?: number } = {},
) {
  const sprite = tileSprite(index, name)
  if (!sprite) return
  const source = tintedTile(index, sheets, sprite, opts.tint ?? null, opts.flipX, opts.flipY)
  if (!source) return
  ctx.globalAlpha = opts.alpha ?? 1
  ctx.drawImage(source, x, y, TILE, TILE)
  ctx.globalAlpha = 1
}

/**
 * Wall rims the way the game draws them: the sprite suffix names the sides
 * that face open floor (STONE_WALL_S is a wall with floor to its south), and
 * the corner pieces fill in where floor only touches diagonally.
 */
function wallRims(map: SceneMap, index: DfAssetIndex, c: number, r: number): string[] {
  const open = {
    N: isFloor(map, c, r - 1),
    S: isFloor(map, c, r + 1),
    W: isFloor(map, c - 1, r),
    E: isFloor(map, c + 1, r),
  }
  const out: string[] = []
  const sides = (['N', 'S', 'W', 'E'] as const).filter((side) => open[side])
  if (sides.length) {
    const base = `STONE_WALL_${sides.join('_')}`
    const variants = index.tiles[`${base}_1`] ? 4 : 0
    out.push(variants ? `${base}_${1 + Math.floor(hash(c, r, 22) * variants)}` : base)
  }
  for (const [name, dc, dr] of DIAGONALS) {
    const vertical = name[0] as 'N' | 'S'
    const horizontal = name[1] as 'W' | 'E'
    if (isFloor(map, c + dc, r + dr) && !open[vertical] && !open[horizontal]) {
      out.push(`STONE_WALL_${name}`)
    }
  }
  return out
}

function nearFloor(map: SceneMap, c: number, r: number): boolean {
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if ((dc || dr) && isFloor(map, c + dc, r + dr)) return true
    }
  }
  return false
}

/** The static part of the scene: rock, floor, wall rims, veins and stores. */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  index: DfAssetIndex,
  sheets: SpriteSheets,
  map: SceneMap,
  layout: Layout,
) {
  ctx.imageSmoothingEnabled = false
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      const x = layout.ox + c * TILE
      const y = layout.oy + r * TILE
      if (isFloor(map, c, r)) {
        draw(ctx, index, sheets, 'STONE_FLOOR_5', x, y, {
          tint: FLOOR_TINT,
          flipX: hash(c, r, 20) > 0.5,
          flipY: hash(c, r, 21) > 0.5,
        })
        continue
      }
      draw(ctx, index, sheets, HIDDEN_ROCK[Math.floor(hash(c, r, 25) * HIDDEN_ROCK.length)], x, y)
      const revealed = nearFloor(map, c, r)
      if (revealed) {
        for (const rim of wallRims(map, index, c, r)) {
          draw(ctx, index, sheets, rim, x, y, { tint: ROCK_TINT })
        }
      }
      const vein = map.veins.get(idx(map, c, r))
      if (vein) {
        draw(
          ctx,
          index,
          sheets,
          GEM_OVERLAYS[Math.floor(hash(c, r, 24) * GEM_OVERLAYS.length)],
          x,
          y,
          {
            tint: VEIN_COLORS[vein],
            alpha: revealed ? 1 : 0.28,
          },
        )
      }
    }
  }

  // Soft shadow where a wall meets the floor below it.
  for (let r = 0; r < map.rows; r++) {
    for (let c = 0; c < map.cols; c++) {
      if (!isFloor(map, c, r) || isFloor(map, c, r - 1)) continue
      const x = layout.ox + c * TILE
      const y = layout.oy + r * TILE
      const shade = ctx.createLinearGradient(0, y, 0, y + TILE * 0.2)
      shade.addColorStop(0, 'rgba(0,0,0,0.3)')
      shade.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = shade
      ctx.fillRect(x, y, TILE, TILE * 0.2)
    }
  }

  for (const prop of map.props) {
    draw(
      ctx,
      index,
      sheets,
      PROP_TILES[prop.kind],
      layout.ox + prop.c * TILE,
      layout.oy + prop.r * TILE,
    )
  }
}

/** One frame of an animated tile, drawn onto its own small canvas. */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  index: DfAssetIndex,
  sheets: SpriteSheets,
  name: string,
) {
  ctx.clearRect(0, 0, TILE, TILE)
  ctx.imageSmoothingEnabled = false
  draw(ctx, index, sheets, name, 0, 0)
}
