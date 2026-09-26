import { DF_ASSETS_BASE, pageUrl } from './index'
import type { Recolor, ResolvedLayer } from './layers'
import type { DfAssetIndex } from './types'

/**
 * Turns a resolved layer stack into pixels the way the game does: cut each
 * layer from its sheet, swap its colours from the palette's default row to
 * the row the rule asks for, and stack the results on one tile.
 *
 * Palette PNGs hold one colour per column and one variant per row; a sheet
 * is painted in the default row, so a pixel that equals column c of that row
 * becomes column c of the target row. Matching is exact, like the game.
 *
 * Browser only: uses canvases. Everything is cached, so a table of dwarves
 * sharing sprites composites quickly.
 */

const images = new Map<string, Promise<HTMLImageElement>>()

function loadImage(url: string): Promise<HTMLImageElement> {
  let pending = images.get(url)
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error(`Could not load ${url}`))
      img.src = url
    })
    images.set(url, pending)
  }
  return pending
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, width)
  canvas.height = Math.max(1, height)
  return canvas
}

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('2d canvas context unavailable')
  ctx.imageSmoothingEnabled = false
  return ctx
}

// Whole sheets drawn once so layers can be read back as pixels.
const sheets = new Map<string, Promise<CanvasRenderingContext2D>>()

function sheetContext(url: string): Promise<CanvasRenderingContext2D> {
  let pending = sheets.get(url)
  if (!pending) {
    pending = loadImage(url).then((img) => {
      const canvas = makeCanvas(img.naturalWidth, img.naturalHeight)
      const ctx = context2d(canvas)
      ctx.drawImage(img, 0, 0)
      return ctx
    })
    sheets.set(url, pending)
  }
  return pending
}

/** Palette rows as packed 0xRRGGBB per column (-1 for transparent cells). */
const palettes = new Map<string, Promise<number[][]>>()

function loadPalette(file: string): Promise<number[][]> {
  let pending = palettes.get(file)
  if (!pending) {
    pending = sheetContext(`${DF_ASSETS_BASE}/${file}`).then((ctx) => {
      const { width, height } = ctx.canvas
      const data = ctx.getImageData(0, 0, width, height).data
      const rows: number[][] = []
      for (let y = 0; y < height; y++) {
        const row: number[] = []
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4
          row.push(data[i + 3] === 0 ? -1 : (data[i] << 16) | (data[i + 1] << 8) | data[i + 2])
        }
        rows.push(row)
      }
      return rows
    })
    palettes.set(file, pending)
  }
  return pending
}

function recolorKey(recolor: Recolor | null): string {
  if (!recolor) return ''
  const target = recolor.match
    ? `~${recolor.match.file}#${recolor.match.row}`
    : String(recolor.toRow)
  return `${recolor.file}#${recolor.fromRow}>${target}`
}

/** Mean colour of a palette row's opaque cells, as [r, g, b]. */
function rowMean(row: number[]): [number, number, number] {
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (const c of row) {
    if (c < 0) continue
    r += (c >> 16) & 255
    g += (c >> 8) & 255
    b += c & 255
    n++
  }
  return n ? [r / n, g / n, b / n] : [0, 0, 0]
}

/** The row of `rows` whose mean colour is nearest to `target`, skipping the template row. */
function nearestRow(rows: number[][], target: [number, number, number], skip: number): number {
  let best = -1
  let bestDist = Number.POSITIVE_INFINITY
  rows.forEach((row, i) => {
    if (i === skip) return
    const [r, g, b] = rowMean(row)
    const dist = (r - target[0]) ** 2 + (g - target[1]) ** 2 + (b - target[2]) ** 2
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  })
  return best
}

async function targetRow(recolor: Recolor): Promise<number> {
  if (!recolor.match) return recolor.toRow
  const [rows, source] = await Promise.all([
    loadPalette(recolor.file),
    loadPalette(recolor.match.file),
  ])
  const wanted = source[recolor.match.row]
  if (!wanted) return -1
  return nearestRow(rows, rowMean(wanted), recolor.fromRow)
}

const layerCanvases = new Map<string, Promise<HTMLCanvasElement | null>>()

/** One layer as its own canvas, recoloured when the rule asks for it. */
function layerCanvas(index: DfAssetIndex, layer: ResolvedLayer): Promise<HTMLCanvasElement | null> {
  const page = index.pages[layer.page]
  if (!page) return Promise.resolve(null)
  const key = `${layer.page}:${layer.x}:${layer.y}:${layer.w}:${layer.h}:${recolorKey(layer.recolor)}`
  let pending = layerCanvases.get(key)
  if (!pending) {
    pending = (async () => {
      const sheet = await sheetContext(pageUrl(page))
      const width = page.tileWidth * layer.w
      const height = page.tileHeight * layer.h
      const sx = layer.x * page.tileWidth
      const sy = layer.y * page.tileHeight
      if (sx + width > sheet.canvas.width || sy + height > sheet.canvas.height) return null
      const pixels = sheet.getImageData(sx, sy, width, height)

      if (layer.recolor) {
        const rows = await loadPalette(layer.recolor.file)
        const from = rows[layer.recolor.fromRow]
        const to = rows[await targetRow(layer.recolor)]
        if (from && to) {
          const swap = new Map<number, number>()
          for (let c = 0; c < from.length; c++) {
            if (from[c] >= 0 && to[c] !== undefined && to[c] >= 0) swap.set(from[c], to[c])
          }
          const d = pixels.data
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] === 0) continue
            const replacement = swap.get((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
            if (replacement === undefined) continue
            d[i] = (replacement >> 16) & 255
            d[i + 1] = (replacement >> 8) & 255
            d[i + 2] = replacement & 255
          }
        }
      }

      const canvas = makeCanvas(width, height)
      context2d(canvas).putImageData(pixels, 0, 0)
      return canvas
    })()
    layerCanvases.set(key, pending)
  }
  return pending
}

export interface Composite {
  canvas: HTMLCanvasElement
  /** Native size of one tile of the base sheet (32 for sprites, 96 for portraits). */
  tileWidth: number
  tileHeight: number
}

/**
 * Stack the layers around one tile of the first layer's sheet. The canvas
 * grows to fit wider or taller pieces (a wielded pick, a beast's wings):
 * everything is centred horizontally and bottom-aligned, so a two-tile-tall
 * wing rises above the body it belongs to. Group offsets shift in pixels
 * like the game's LG_OFFSET.
 */
export async function composeLayers(
  index: DfAssetIndex,
  layers: ResolvedLayer[],
): Promise<Composite | null> {
  if (!layers.length) return null
  const base = index.pages[layers[0].page]
  if (!base) return null
  const canvases = await Promise.all(layers.map((layer) => layerCanvas(index, layer)))
  let width = base.tileWidth
  let height = base.tileHeight
  for (const c of canvases) {
    if (!c) continue
    width = Math.max(width, c.width)
    height = Math.max(height, c.height)
  }
  const canvas = makeCanvas(width, height)
  const ctx = context2d(canvas)
  layers.forEach((layer, i) => {
    const c = canvases[i]
    if (!c) return
    const dx = layer.offset[0] + Math.round((width - c.width) / 2)
    const dy = layer.offset[1] + (height - c.height)
    ctx.drawImage(c, dx, dy)
  })
  return trimToBase(canvas, base.tileWidth, base.tileHeight)
}

/**
 * Drop the empty part of oversized layers. A two-tile pony tail with three
 * rows of hair above the head would otherwise double the stack's height,
 * and whoever draws it at a fixed size would get a dwarf half as tall. The
 * base tile always stays; the crop grows only as far as there are pixels,
 * evenly on both sides so the body stays centred.
 */
function trimToBase(canvas: HTMLCanvasElement, baseWidth: number, baseHeight: number): Composite {
  const { width, height } = canvas
  if (width === baseWidth && height === baseHeight) {
    return { canvas, tileWidth: width, tileHeight: height }
  }
  const data = context2d(canvas).getImageData(0, 0, width, height).data
  let left = width
  let right = -1
  let top = height
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] === 0) continue
      if (x < left) left = x
      if (x > right) right = x
      if (y < top) top = y
    }
  }
  if (right < 0) return { canvas, tileWidth: width, tileHeight: height }
  const baseLeft = Math.round((width - baseWidth) / 2)
  const spill = Math.max(0, baseLeft - left, right + 1 - (baseLeft + baseWidth))
  const x0 = baseLeft - spill
  const y0 = Math.min(height - baseHeight, top)
  const w = baseWidth + spill * 2
  const h = height - y0
  if (w === width && h === height) return { canvas, tileWidth: width, tileHeight: height }
  const trimmed = makeCanvas(w, h)
  context2d(trimmed).drawImage(canvas, x0, y0, w, h, 0, 0, w, h)
  return { canvas: trimmed, tileWidth: w, tileHeight: h }
}
