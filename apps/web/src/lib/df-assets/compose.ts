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
  return recolor ? `${recolor.file}#${recolor.fromRow}>${recolor.toRow}` : ''
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
        const to = rows[layer.recolor.toRow]
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
 * Stack the layers on one tile of the first layer's sheet. Wider LARGE_IMAGE
 * layers (shields, wielded weapons) are centred on the tile; group offsets
 * shift in pixels like the game's LG_OFFSET.
 */
export async function composeLayers(
  index: DfAssetIndex,
  layers: ResolvedLayer[],
): Promise<Composite | null> {
  if (!layers.length) return null
  const base = index.pages[layers[0].page]
  if (!base) return null
  const canvases = await Promise.all(layers.map((layer) => layerCanvas(index, layer)))
  const canvas = makeCanvas(base.tileWidth, base.tileHeight)
  const ctx = context2d(canvas)
  layers.forEach((layer, i) => {
    const c = canvases[i]
    if (!c) return
    const dx = layer.offset[0] + Math.round((base.tileWidth - c.width) / 2)
    const dy = layer.offset[1] + Math.round((base.tileHeight - c.height) / 2)
    ctx.drawImage(c, dx, dy)
  })
  return { canvas, tileWidth: base.tileWidth, tileHeight: base.tileHeight }
}
