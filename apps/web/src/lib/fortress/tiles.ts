import type { FortMapBlock, FortTiletype } from '@fortress/db-drizzle'
// Client-safe subpath: the package entry also creates the Postgres client.
import { FORT_FLAG } from '@fortress/db-drizzle/fortress-types'

/**
 * Turn one z-level worth of run-length encoded blocks into flat arrays the
 * map canvas can paint. Blocks are walked x-major (x = 0..15, y = 0..15).
 */
export interface LevelGrid {
  width: number
  height: number
  tiles: Int32Array
  flags: Int32Array
}

export function decodeLevel(blocks: FortMapBlock[], width: number, height: number): LevelGrid {
  const tiles = new Int32Array(width * height).fill(-1)
  const flags = new Int32Array(width * height)
  for (const [, bx, by, tileRle, flagRle] of blocks) {
    const x0 = bx * 16
    const y0 = by * 16
    fillRle(tiles, tileRle, x0, y0, width)
    fillRle(flags, flagRle, x0, y0, width)
  }
  return { width, height, tiles, flags }
}

function fillRle(target: Int32Array, rle: number[], x0: number, y0: number, width: number) {
  let index = 0 // 0..255 inside the block, x-major
  for (let i = 0; i < rle.length; i += 2) {
    const value = rle[i]
    let count = rle[i + 1]
    while (count-- > 0 && index < 256) {
      const x = x0 + Math.floor(index / 16)
      const y = y0 + (index % 16)
      target[y * width + x] = value
      index++
    }
  }
}

export interface TileStyle {
  color: string
  label: string
}

const SHAPE_LABEL: Record<string, string> = {
  EMPTY: 'open air',
  FLOOR: 'floor',
  BOULDER: 'boulder',
  PEBBLES: 'pebbles',
  WALL: 'wall',
  FORTIFICATION: 'fortification',
  STAIR_UP: 'up stair',
  STAIR_DOWN: 'down stair',
  STAIR_UPDOWN: 'up/down stair',
  RAMP: 'ramp',
  RAMP_TOP: 'ramp top',
  BROOK_BED: 'brook bed',
  BROOK_TOP: 'brook',
  TREE_SHAPE: 'tree',
  SAPLING: 'sapling',
  SHRUB: 'shrub',
  ENDLESS_PIT: 'endless pit',
  BRANCH: 'branches',
  TRUNK_BRANCH: 'trunk',
  TWIG: 'twigs',
}

/** Colour and label for a tile, given its tiletype attributes and packed flags. */
export function tileStyle(tt: FortTiletype | undefined, flags: number): TileStyle {
  const liquid = flags & FORT_FLAG.LIQUID_MASK
  if (liquid > 0) {
    const magma = (flags & FORT_FLAG.MAGMA) !== 0
    const depth = liquid / 7
    return magma
      ? { color: mix('#7f1d1d', '#f97316', depth), label: `magma ${liquid}/7` }
      : { color: mix('#1e3a8a', '#38bdf8', depth), label: `water ${liquid}/7` }
  }
  if (!tt) return { color: '#000000', label: 'unknown' }
  const shape = tt.shape
  const material = tt.material
  const label = `${SHAPE_LABEL[shape] ?? shape.toLowerCase()} · ${material.toLowerCase().replace(/_/g, ' ')}`
  if (material === 'AIR' || shape === 'EMPTY') return { color: '#0b0f14', label: 'open air' }
  if (shape === 'RAMP_TOP') return { color: '#111827', label }
  if (material === 'MAGMA') return { color: '#ea580c', label }
  if (material === 'POOL' || material === 'RIVER' || material === 'BROOK')
    return { color: '#0284c7', label }
  if (material === 'FROZEN_LIQUID') return { color: '#bae6fd', label }
  if (material === 'CONSTRUCTION') {
    return shape === 'WALL' || shape === 'FORTIFICATION'
      ? { color: '#cbd5e1', label }
      : { color: '#94a3b8', label }
  }
  if (material.startsWith('GRASS'))
    return {
      color: material === 'GRASS_DEAD' || material === 'GRASS_DRY' ? '#a3a06a' : '#4d7c0f',
      label,
    }
  if (
    material === 'PLANT' ||
    material === 'MUSHROOM' ||
    material === 'TREE_MATERIAL' ||
    material === 'ROOT'
  ) {
    return { color: shape === 'WALL' ? '#3f6212' : '#65a30d', label }
  }
  if (material === 'DRIFTWOOD') return { color: '#a16207', label }
  if (material === 'FIRE' || material === 'CAMPFIRE') return { color: '#f59e0b', label }
  if (material === 'ASHES') return { color: '#525252', label }
  if (material === 'HFS' || material === 'UNDERWORLD_GATE') return { color: '#7e22ce', label }
  if (material === 'MINERAL') {
    return shape === 'WALL' ? { color: '#b45309', label } : { color: '#78350f', label }
  }
  if (material === 'FEATURE') return { color: '#0891b2', label }
  if (material === 'LAVA_STONE')
    return shape === 'WALL' ? { color: '#57534e', label } : { color: '#3f3f46', label }
  if (material === 'SOIL')
    return shape === 'WALL' ? { color: '#6b4f2a', label } : { color: '#8b6b3d', label }
  // STONE and anything else
  switch (shape) {
    case 'WALL':
      return { color: '#7c7c84', label }
    case 'FORTIFICATION':
      return { color: '#9ca3af', label }
    case 'STAIR_UP':
    case 'STAIR_DOWN':
    case 'STAIR_UPDOWN':
      return { color: '#fde68a', label }
    case 'RAMP':
      return { color: '#a8a29e', label }
    case 'BOULDER':
    case 'PEBBLES':
      return { color: '#57534e', label }
    default:
      return { color: '#3f3f46', label }
  }
}

export const DIG_LABELS = ['', 'dig', 'up/down stair', 'channel', 'ramp', 'down stair', 'up stair']

export function digDesignation(flags: number): number {
  return (flags >> FORT_FLAG.DIG_SHIFT) & FORT_FLAG.DIG_MASK
}

export function isHidden(flags: number): boolean {
  return (flags & FORT_FLAG.HIDDEN) !== 0
}

function mix(from: string, to: string, t: number): string {
  const a = hex(from)
  const b = hex(to)
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

function hex(color: string): number[] {
  const n = Number.parseInt(color.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
