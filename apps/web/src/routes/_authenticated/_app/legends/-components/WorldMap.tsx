import { Button, cn } from '@fortress/ui'
import { ArrowRightIcon, XIcon } from 'lucide-react'
import * as React from 'react'

import {
  type DfAssetIndex,
  type SpriteSheets,
  drawTile,
  tileSprite,
  useDfAssets,
  useSpriteSheets,
} from '~/lib/df-assets'
import { TerrainChip, TileChip } from '~/lib/df-assets/legends'
import type { SiteHistory } from '~/lib/legends/chronicle'
import {
  RACE_COLORS,
  raceColor,
  regionColor,
  siteGroup,
  titleCase,
  words,
} from '~/lib/legends/model'
import type { LegendsMapData, MapRegion, MapSite } from '~/lib/legends/server'
import { type SiteSnapshot, changesBySite, siteStatesAt } from '~/lib/legends/timeline'
import {
  type TerrainPlan,
  WORLD_MAP_PAGES,
  planTerrain,
  siteSpriteNameFor,
} from '~/lib/legends/worldTiles'
import { MapMinimap, MapZoomControls } from '~/lib/map/MapControls'
import { type Size, type View, centredView, usePanZoom } from '~/lib/map/usePanZoom'

export interface WorldMapProps {
  data: LegendsMapData
  /** Site ids to emphasise; everything else is dimmed. */
  highlightSites?: ReadonlySet<number> | null
  /** Region id to outline; everything else is dimmed. */
  highlightRegion?: number | null
  /** Tile to ring, e.g. the site being viewed. */
  focus?: { x: number; y: number } | null
  /** Open a site's page; offered from the selection card. */
  onSelectSite?: (site: MapSite) => void
  /** Open a region's page; offered from the selection card. */
  onSelectRegion?: (region: MapRegion) => void
  showLegend?: boolean
  /** `inset` is the small map on record pages: no minimap or labels, page scrolling left alone. */
  variant?: 'full' | 'inset'
  className?: string
  /**
   * Show the world as it stood in this year: sites appear when founded, fall
   * to ruin, and take the colour of whoever held them. Needs `history`.
   */
  year?: number | null
  history?: SiteHistory | null
}

const OCEAN = '#28527f'
const MAX_SCALE = 72

type Selection = { kind: 'site'; site: MapSite } | { kind: 'region'; region: MapRegion }

interface Hover {
  x: number
  y: number
  px: number
  py: number
  region: MapRegion | null
  sites: MapSite[]
}

interface Sprites {
  index: DfAssetIndex
  sheets: SpriteSheets
}

function mix(hex: string, tint: string, amount: number): string {
  const a = Number.parseInt(hex.slice(1), 16)
  const b = Number.parseInt(tint.slice(1), 16)
  const ch = (shift: number) => {
    const x = (a >> shift) & 255
    const y = (b >> shift) & 255
    return Math.round(x + (y - x) * amount)
  }
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`
}

function flatColor(region: MapRegion | null): string {
  if (!region) return OCEAN
  const base = regionColor(region.type)
  if (region.evilness === 'evil') return mix(base, '#5b21b6', 0.35)
  if (region.evilness === 'good') return mix(base, '#fef3c7', 0.3)
  return base
}

function markerSize(type: string | null, scale: number): number {
  const t = words(type)
  const big = ['dark fortress', 'fortress', 'town', 'castle', 'tower', 'vault', 'mountain halls']
  const base = Math.min(Math.max(scale * 0.95, 11), 56)
  if (big.includes(t)) return base * 1.1
  if (siteGroup(type) === 'wild') return base * 0.8
  return base
}

/**
 * Terrain for tiles x0..x1, y0..y1 at `tile` CSS pixels per tile with cell
 * (0, 0) at (ox, oy): ground, rivers, then the 32px forests and mountains at
 * twice the tile size, bottom-anchored and in row order so they overlap the
 * way the game draws them. Flat colours stand in without sprites.
 */
function paintTerrain(
  ctx: CanvasRenderingContext2D,
  data: LegendsMapData,
  plan: TerrainPlan | null,
  sprites: Sprites | null,
  rivers: Uint8Array,
  tile: number,
  ox: number,
  oy: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  const { width, height } = data
  const blit = (sprite: TerrainPlan['base'][number], x: number, y: number, w: number, h: number) =>
    sprite && sprites ? drawTile(ctx, sprites.index, sprites.sheets, sprite, x, y, w, h) : false
  const pad = tile < 8 ? 0.6 : 0.3
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * width + x
      if (plan && blit(plan.base[i], ox + x * tile, oy + y * tile, tile + pad, tile + pad)) continue
      const r = data.tiles[i]
      ctx.fillStyle = flatColor(r >= 0 ? data.regions[r] : null)
      ctx.fillRect(ox + x * tile, oy + y * tile, tile + pad, tile + pad)
    }
  }
  if (!plan) {
    // Seams keep neighbouring regions of one type apart in flat colours.
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const here = data.tiles[y * width + x]
        if (x + 1 < width && data.tiles[y * width + x + 1] !== here) {
          ctx.moveTo(ox + (x + 1) * tile, oy + y * tile)
          ctx.lineTo(ox + (x + 1) * tile, oy + (y + 1) * tile)
        }
        if (y + 1 < height && data.tiles[(y + 1) * width + x] !== here) {
          ctx.moveTo(ox + x * tile, oy + (y + 1) * tile)
          ctx.lineTo(ox + (x + 1) * tile, oy + (y + 1) * tile)
        }
      }
    }
    ctx.stroke()
  }
  ctx.fillStyle = 'rgba(56, 132, 214, 0.95)'
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = y * width + x
      const size = rivers[i]
      if (!size) continue
      if (plan && blit(plan.river[i], ox + x * tile, oy + y * tile, tile + pad, tile + pad))
        continue
      const w = Math.max(1, tile * (size === 3 ? 0.7 : size === 2 ? 0.5 : 0.32))
      ctx.fillRect(ox + x * tile + (tile - w) / 2, oy + y * tile + (tile - w) / 2, w, w)
    }
  }
  if (plan) {
    // Overlays reach a tile up and half a tile sideways, so include the rows and columns around.
    for (let y = Math.max(0, y0); y <= Math.min(height - 1, y1 + 1); y++) {
      for (let x = Math.max(0, x0 - 1); x <= Math.min(width - 1, x1 + 1); x++) {
        const sprite = plan.overlay[y * width + x]
        if (sprite) blit(sprite, ox + x * tile - tile / 2, oy + y * tile - tile, tile * 2, tile * 2)
      }
    }
  } else {
    for (const peak of data.peaks) {
      if (peak.x < x0 || peak.x > x1 || peak.y < y0 || peak.y > y1) continue
      const cx = ox + peak.x * tile + tile / 2
      const cy = oy + peak.y * tile + tile / 2
      const r = tile * 0.45
      ctx.beginPath()
      ctx.moveTo(cx, cy - r)
      ctx.lineTo(cx + r, cy + r * 0.8)
      ctx.lineTo(cx - r, cy + r * 0.8)
      ctx.closePath()
      ctx.fillStyle = peak.volcano ? '#dc2626' : '#f5f5f4'
      ctx.fill()
    }
  }
}

interface TerrainCache {
  canvas: HTMLCanvasElement
  /** Pixels per tile in the cache. */
  res: number
}

/** The whole world painted once, with a tile of margin all round for overhanging sprites. */
function buildCache(
  data: LegendsMapData,
  plan: TerrainPlan | null,
  sprites: Sprites | null,
  rivers: Uint8Array,
): TerrainCache | null {
  if (typeof document === 'undefined') return null
  const longest = Math.max(data.width, data.height) + 2
  const res = Math.min(16, Math.max(plan ? 4 : 2, Math.floor(4096 / longest)))
  const canvas = document.createElement('canvas')
  canvas.width = (data.width + 2) * res
  canvas.height = (data.height + 2) * res
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = OCEAN
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  paintTerrain(
    ctx,
    data,
    plan,
    sprites,
    rivers,
    res,
    res,
    res,
    0,
    0,
    data.width - 1,
    data.height - 1,
  )
  return { canvas, res }
}

function regionCells(data: LegendsMapData, regionId: number | null | undefined): number[] {
  if (regionId === null || regionId === undefined) return []
  const index = data.regions.findIndex((r) => r.id === regionId)
  if (index < 0) return []
  const out: number[] = []
  for (let i = 0; i < data.tiles.length; i++) if (data.tiles[i] === index) out.push(i)
  return out
}

/** One pixel per tile: dark everywhere except the region, drawn scaled over the map. */
function dimMask(data: LegendsMapData, cells: number[]): HTMLCanvasElement | null {
  if (!cells.length || typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = data.width
  canvas.height = data.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const image = ctx.createImageData(data.width, data.height)
  for (let i = 0; i < data.tiles.length; i++) {
    image.data[i * 4] = 15
    image.data[i * 4 + 1] = 23
    image.data[i * 4 + 2] = 42
    image.data[i * 4 + 3] = 140
  }
  for (const i of cells) image.data[i * 4 + 3] = 0
  ctx.putImageData(image, 0, 0)
  return canvas
}

/** Region border as tile-edge segments [x1, y1, x2, y2]. */
function outline(data: LegendsMapData, cells: number[]): number[][] {
  const inside = new Set(cells)
  const w = data.width
  const out: number[][] = []
  for (const i of cells) {
    const x = i % w
    const y = (i - x) / w
    if (x === 0 || !inside.has(i - 1)) out.push([x, y, x, y + 1])
    if (x === w - 1 || !inside.has(i + 1)) out.push([x + 1, y, x + 1, y + 1])
    if (y === 0 || !inside.has(i - w)) out.push([x, y, x + 1, y])
    if (y === data.height - 1 || !inside.has(i + w)) out.push([x, y + 1, x + 1, y + 1])
  }
  return out
}

/** Where to write each sizeable region's name: its tile nearest the centre of mass. */
function regionLabels(data: LegendsMapData): { region: MapRegion; x: number; y: number }[] {
  const sums = data.regions.map(() => ({ x: 0, y: 0, n: 0 }))
  for (let i = 0; i < data.tiles.length; i++) {
    const r = data.tiles[i]
    if (r < 0) continue
    sums[r].x += i % data.width
    sums[r].y += Math.floor(i / data.width)
    sums[r].n++
  }
  const best = data.regions.map(() => ({ i: -1, d: Number.POSITIVE_INFINITY }))
  for (let i = 0; i < data.tiles.length; i++) {
    const r = data.tiles[i]
    if (r < 0 || sums[r].n < 18 || !data.regions[r].name) continue
    const cx = sums[r].x / sums[r].n
    const cy = sums[r].y / sums[r].n
    const d = ((i % data.width) - cx) ** 2 + (Math.floor(i / data.width) - cy) ** 2
    if (d < best[r].d) best[r] = { i, d }
  }
  return data.regions
    .map((region, r) => ({ region, i: best[r].i }))
    .filter((l) => l.i >= 0)
    .sort((a, b) => b.region.tiles - a.region.tiles)
    .map((l) => ({ region: l.region, x: l.i % data.width, y: Math.floor(l.i / data.width) }))
}

function boundsView(
  size: Size,
  fit: View,
  cells: { x: number; y: number }[],
  margin: number,
): View {
  if (!cells.length) return fit
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const c of cells) {
    minX = Math.min(minX, c.x)
    minY = Math.min(minY, c.y)
    maxX = Math.max(maxX, c.x + 1)
    maxY = Math.max(maxY, c.y + 1)
  }
  const w = maxX - minX + margin * 2
  const h = maxY - minY + margin * 2
  const scale = Math.min(Math.max(Math.min(size.width / w, size.height / h), fit.scale), 40)
  return centredView(size, (minX + maxX) / 2, (minY + maxY) / 2, scale)
}

/**
 * The surface of the world in the game's own world-map tiles (flat colours
 * when the sprites are not extracted): terrain, rivers, peaks, and every
 * site as its marker or a dot in its civilization's colour. Scroll or pinch
 * to zoom, drag to pan; click a site or region for details.
 */
export function WorldMap({
  data,
  highlightSites,
  highlightRegion,
  focus,
  onSelectSite,
  onSelectRegion,
  showLegend = true,
  variant,
  className,
  year = null,
  history = null,
}: WorldMapProps) {
  const inset = (variant ?? (showLegend ? 'full' : 'inset')) === 'inset'
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const assets = useDfAssets()
  const sheets = useSpriteSheets(assets, WORLD_MAP_PAGES)
  const sprites = React.useMemo<Sprites | null>(
    () => (assets && sheets && sheets.size > 0 ? { index: assets, sheets } : null),
    [assets, sheets],
  )
  const rivers = React.useMemo(() => {
    const out = new Uint8Array(data.width * data.height)
    for (const r of data.rivers) out[r.tile] = Math.max(out[r.tile], r.size)
    return out
  }, [data])
  const plan = React.useMemo(
    () => (sprites ? planTerrain(sprites.index, data) : null),
    [sprites, data],
  )
  const cache = React.useMemo(
    () => buildCache(data, plan, sprites, rivers),
    [data, plan, sprites, rivers],
  )

  const [selected, setSelected] = React.useState<Selection | null>(null)
  const [hover, setHover] = React.useState<Hover | null>(null)

  const outlinedRegion =
    highlightRegion ?? (selected?.kind === 'region' ? selected.region.id : null)
  const cells = React.useMemo(() => regionCells(data, outlinedRegion), [data, outlinedRegion])
  const mask = React.useMemo(() => dimMask(data, cells), [data, cells])
  const border = React.useMemo(() => outline(data, cells), [data, cells])
  const labels = React.useMemo(() => (inset ? [] : regionLabels(data)), [data, inset])

  const sitesByTile = React.useMemo(() => {
    const map = new Map<number, MapSite[]>()
    for (const site of data.sites) {
      const key = site.y * data.width + site.x
      const list = map.get(key) ?? []
      list.push(site)
      map.set(key, list)
    }
    return map
  }, [data])

  const bySite = React.useMemo(() => (history ? changesBySite(history) : null), [history])
  const states = React.useMemo<Map<number, SiteSnapshot> | null>(
    () => (bySite && year !== null ? siteStatesAt(data.sites, bySite, year) : null),
    [bySite, data.sites, year],
  )
  const civs = React.useMemo(() => ({ ...history?.civs, ...data.civs }), [history, data.civs])
  /** Battles, conquests and ruinings of the last few years, newest last. */
  const flares = React.useMemo(() => {
    if (!history || year === null) return []
    const out: {
      x: number
      y: number
      age: number
      kind: 'battle' | 'conquered' | 'ruined' | 'founded'
      strength: number
    }[] = []
    for (const b of history.battles) {
      const age = year - b.year
      if (age >= 0 && age <= 3)
        out.push({
          x: b.x,
          y: b.y,
          age,
          kind: 'battle',
          strength: Math.min(1, 0.5 + b.casualties / 60),
        })
    }
    const at = new Map(data.sites.map((s) => [s.id, s]))
    for (const c of history.changes) {
      const age = year - c.year
      if (age < 0 || age > 3 || c.state === 'reclaimed') continue
      const site = at.get(c.site)
      if (site) out.push({ x: site.x, y: site.y, age, kind: c.state, strength: 1 })
    }
    return out
  }, [history, year, data.sites])

  const orderedSites = React.useMemo(
    () =>
      [...data.sites].sort(
        (a, b) => (siteGroup(a.type) === 'wild' ? 0 : 1) - (siteGroup(b.type) === 'wild' ? 0 : 1),
      ),
    [data],
  )

  const pz = usePanZoom({
    width: data.width,
    height: data.height,
    maxScale: MAX_SCALE,
    wheel: inset ? 'modifier' : 'always',
    initialView: (size, fit) => {
      if (highlightRegion !== null && highlightRegion !== undefined && cells.length) {
        return boundsView(
          size,
          fit,
          cells.map((i) => ({ x: i % data.width, y: Math.floor(i / data.width) })),
          3,
        )
      }
      if (focus) {
        return centredView(
          size,
          focus.x + 0.5,
          focus.y + 0.5,
          Math.max(fit.scale, Math.min(size.width, size.height) / 26),
        )
      }
      if (inset && highlightSites?.size) {
        return boundsView(
          size,
          fit,
          data.sites.filter((s) => highlightSites.has(s.id)),
          4,
        )
      }
      return fit
    },
    onTap: (clientX, clientY) => {
      const hit = hitTest(clientX, clientY)
      if (!hit) {
        setSelected(null)
        return
      }
      if (hit.sites.length) setSelected({ kind: 'site', site: hit.sites[0] })
      else if (hit.region) setSelected({ kind: 'region', region: hit.region })
      else setSelected(null)
    },
  })
  const { view, size } = pz

  function hitTest(clientX: number, clientY: number): Hover | null {
    const canvas = canvasRef.current
    if (!canvas || !view) return null
    const rect = canvas.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    const fx = (px - view.x) / view.scale
    const fy = (py - view.y) / view.scale
    const x = Math.floor(fx)
    const y = Math.floor(fy)
    if (x < 0 || y < 0 || x >= data.width || y >= data.height) return null
    const index = data.tiles[y * data.width + x]
    const region = index >= 0 ? data.regions[index] : null
    // Markers are drawn bigger than a tile when zoomed out: search as far as they reach.
    const reach = Math.max(0, Math.ceil((markerSize(null, view.scale) / view.scale - 1) / 2))
    let sites: MapSite[] = []
    let best = Number.POSITIVE_INFINITY
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const list = sitesByTile
          .get((y + dy) * data.width + x + dx)
          ?.filter((site) => states?.get(site.id)?.exists !== false)
        if (!list?.length) continue
        const d = (x + dx + 0.5 - fx) ** 2 + (y + dy + 0.5 - fy) ** 2
        if (d < best) {
          best = d
          sites = list
        }
      }
    }
    return { x, y, px, py, region, sites }
  }

  // Draw. Pure canvas output from the current view.
  React.useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !view || !cache || size.width === 0) return
    const dpr = window.devicePixelRatio || 1
    const pw = Math.round(size.width * dpr)
    const ph = Math.round(size.height * dpr)
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw
      canvas.height = ph
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = OCEAN
    ctx.fillRect(0, 0, size.width, size.height)
    const { scale, x: ox, y: oy } = view

    if (!plan || scale <= cache.res * 1.5) {
      // Zoomed out: the cached painting, smoothed when shrunk, crisp when enlarged.
      ctx.imageSmoothingEnabled = !!plan && scale < cache.res
      ctx.imageSmoothingQuality = 'high'
      const k = scale / cache.res
      ctx.drawImage(
        cache.canvas,
        ox - scale,
        oy - scale,
        cache.canvas.width * k,
        cache.canvas.height * k,
      )
    } else {
      // Zoomed in past the cache: paint the visible tiles straight from the sprites.
      ctx.imageSmoothingEnabled = false
      const x0 = Math.max(0, Math.floor(-ox / scale) - 1)
      const y0 = Math.max(0, Math.floor(-oy / scale) - 1)
      const x1 = Math.min(data.width - 1, Math.ceil((size.width - ox) / scale) + 1)
      const y1 = Math.min(data.height - 1, Math.ceil((size.height - oy) / scale) + 1)
      paintTerrain(ctx, data, plan, sprites, rivers, scale, ox, oy, x0, y0, x1, y1)
    }

    if (mask) {
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(mask, ox, oy, data.width * scale, data.height * scale)
      ctx.strokeStyle = '#fde68a'
      ctx.lineWidth = Math.min(Math.max(scale * 0.18, 1.5), 4)
      ctx.lineCap = 'round'
      ctx.beginPath()
      for (const [x1, y1, x2, y2] of border) {
        ctx.moveTo(ox + x1 * scale, oy + y1 * scale)
        ctx.lineTo(ox + x2 * scale, oy + y2 * scale)
      }
      ctx.stroke()
    }

    // Sites: the game's markers kept legible when zoomed out, dots without sprites.
    const emphasis = highlightSites && highlightSites.size > 0 ? highlightSites : null
    ctx.imageSmoothingEnabled = false
    const visible = (x: number, y: number, m: number) =>
      x + m >= 0 && y + m >= 0 && x - m <= size.width && y - m <= size.height
    for (const site of orderedSites) {
      const state = states?.get(site.id)
      if (state && !state.exists) continue
      const cx = ox + (site.x + 0.5) * scale
      const cy = oy + (site.y + 0.5) * scale
      const s = markerSize(site.type, scale)
      if (!visible(cx, cy, s)) continue
      const strong = !emphasis || emphasis.has(site.id)
      ctx.globalAlpha = strong ? 1 : 0.22
      const holder = state ? state.civ : site.civ
      const abandoned = state
        ? state.ruined || state.civ === null
        : site.civ === null && site.owner === null
      const spriteName = siteSpriteNameFor(site.type, site.id, abandoned)
      const sprite = sprites && spriteName ? tileSprite(sprites.index, spriteName) : null
      if (
        sprite &&
        sprites &&
        drawTile(ctx, sprites.index, sprites.sheets, sprite, cx - s / 2, cy - s / 2, s, s)
      ) {
        if (strong && emphasis) {
          ctx.strokeStyle = '#fde68a'
          ctx.lineWidth = 1.5
          ctx.strokeRect(cx - s / 2 - 1, cy - s / 2 - 1, s + 2, s + 2)
        }
      } else {
        const civ = holder !== null ? civs[holder] : null
        const r = s * 0.32
        ctx.beginPath()
        if (siteGroup(site.type) === 'wild') {
          ctx.rect(cx - r, cy - r, r * 2, r * 2)
          ctx.fillStyle = '#1c1917'
        } else {
          ctx.arc(cx, cy, r, 0, Math.PI * 2)
          ctx.fillStyle = abandoned ? '#78716c' : civ ? raceColor(civ.race) : '#e7e5e4'
        }
        ctx.fill()
        ctx.strokeStyle = strong && emphasis ? '#fde68a' : 'rgba(0,0,0,0.7)'
        ctx.lineWidth = strong && emphasis ? 2 : 1
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    // Flares: what just happened, fading over a few years.
    const flareColour = {
      battle: '239,68,68',
      ruined: '127,29,29',
      conquered: '245,158,11',
      founded: '52,211,153',
    }
    for (const flare of flares) {
      const cx = ox + (flare.x + 0.5) * scale
      const cy = oy + (flare.y + 0.5) * scale
      const r = Math.max(scale, 8) * (0.9 + flare.age * 0.55)
      if (!visible(cx, cy, r)) continue
      const alpha = (1 - flare.age / 4) * flare.strength
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(${flareColour[flare.kind]},${alpha.toFixed(3)})`
      ctx.lineWidth = Math.max(1.5, scale * 0.12)
      ctx.stroke()
      if (flare.age === 0) {
        ctx.fillStyle = `rgba(${flareColour[flare.kind]},${(alpha * 0.25).toFixed(3)})`
        ctx.fill()
      }
    }

    // Names: regions when zoomed out a little, sites once there is room.
    if (!inset) {
      const taken: [number, number, number, number][] = []
      const free = (x: number, y: number, w: number, h: number) =>
        !taken.some(([tx, ty, tw, th]) => x < tx + tw && x + w > tx && y < ty + th && y + h > ty)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.lineJoin = 'round'
      const write = (text: string, x: number, y: number, font: string, fill: string) => {
        ctx.font = font
        const w = ctx.measureText(text).width + 8
        const h = 16
        if (!visible(x, y, w) || !free(x - w / 2, y - h / 2, w, h)) return
        taken.push([x - w / 2, y - h / 2, w, h])
        ctx.strokeStyle = 'rgba(0,0,0,0.75)'
        ctx.lineWidth = 3
        ctx.strokeText(text, x, y)
        ctx.fillStyle = fill
        ctx.fillText(text, x, y)
      }
      if (scale >= 18) {
        for (const site of [...orderedSites].reverse()) {
          if (!site.name || siteGroup(site.type) === 'wild') continue
          if (states?.get(site.id)?.exists === false) continue
          const s = markerSize(site.type, scale)
          write(
            titleCase(site.name),
            ox + (site.x + 0.5) * scale,
            oy + (site.y + 0.5) * scale + s / 2 + 8,
            '600 12px ui-sans-serif, system-ui, sans-serif',
            '#fef3c7',
          )
        }
      }
      if (scale >= 3.5 && scale < 26) {
        const minTiles = scale < 6 ? 60 : scale < 12 ? 30 : 18
        for (const label of labels) {
          if (label.region.tiles < minTiles || !label.region.name) continue
          write(
            titleCase(label.region.name),
            ox + (label.x + 0.5) * scale,
            oy + (label.y + 0.5) * scale,
            `italic 500 ${label.region.tiles > 400 ? 14 : 12}px ui-serif, Georgia, serif`,
            'rgba(255,255,255,0.88)',
          )
        }
      }
    }

    const ring = (x: number, y: number, colour: string) => {
      const cx = ox + (x + 0.5) * scale
      const cy = oy + (y + 0.5) * scale
      const r = Math.max(scale * 0.9, 9)
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.strokeStyle = colour
      ctx.lineWidth = 2.5
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(cx, cy, r + 3, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(0,0,0,0.7)'
      ctx.lineWidth = 1
      ctx.stroke()
    }
    if (focus) ring(focus.x, focus.y, '#fde68a')
    if (selected?.kind === 'site') ring(selected.site.x, selected.site.y, '#ffffff')
  }, [
    view,
    size,
    cache,
    plan,
    sprites,
    rivers,
    data,
    mask,
    border,
    highlightSites,
    orderedSites,
    labels,
    inset,
    focus,
    selected,
    states,
    civs,
    flares,
  ])

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pz.handlers.onPointerMove(e)
    if (pz.isPressed()) {
      if (hover) setHover(null)
      return
    }
    setHover(hitTest(e.clientX, e.clientY))
  }

  const legendTypes = React.useMemo(() => {
    const seen = new Map<string, number>()
    for (const r of data.regions)
      seen.set(r.type ?? 'unknown', (seen.get(r.type ?? 'unknown') ?? 0) + r.tiles)
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([type]) => type)
  }, [data])

  const legendRaces = React.useMemo(() => {
    const races = new Set<string>()
    for (const site of data.sites) {
      const civ = site.civ !== null ? data.civs[site.civ] : null
      if (civ?.race) races.add(words(civ.race))
    }
    return [...races].sort()
  }, [data])

  const volcanoes = data.peaks.some((p) => p.volcano)
  const plainPeaks = data.peaks.some((p) => !p.volcano)
  const zoomedIn = view && view.scale > pz.fitScale * 1.25

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div
        ref={pz.containerRef}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: focus enables the keyboard shortcuts
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setSelected(null)
          else pz.handlers.onKeyDown(e)
        }}
        className={cn(
          'relative w-full overflow-hidden rounded-lg border bg-[#28527f] outline-none focus-visible:ring-2 focus-visible:ring-ring',
          inset && 'aspect-square',
        )}
        style={
          inset ? undefined : { aspectRatio: `${data.width} / ${data.height}`, maxHeight: '78vh' }
        }
      >
        <canvas
          ref={canvasRef}
          className={cn(
            'absolute inset-0 block h-full w-full',
            pz.dragging
              ? 'cursor-grabbing'
              : hover?.sites.length
                ? 'cursor-pointer'
                : 'cursor-grab',
          )}
          style={{ touchAction: 'none' }}
          role="img"
          aria-label="Map of the world"
          onPointerDown={pz.handlers.onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={pz.handlers.onPointerUp}
          onPointerCancel={pz.handlers.onPointerCancel}
          onPointerLeave={() => setHover(null)}
          onDoubleClick={pz.handlers.onDoubleClick}
        />

        {hover && !pz.dragging ? (
          <div
            className="pointer-events-none absolute z-10 max-w-xs rounded-md border bg-popover/95 px-3 py-2 text-sm text-popover-foreground shadow-md"
            style={{
              left: Math.min(hover.px + 14, Math.max(0, size.width - 270)),
              top: Math.min(hover.py + 14, Math.max(0, size.height - 90)),
            }}
          >
            {hover.sites.map((site) => {
              const state = states?.get(site.id)
              const holder = state ? state.civ : site.civ
              const civ = holder !== null ? civs[holder] : null
              return (
                <div key={site.id} className="mb-1 last:mb-0">
                  <div className="font-medium">
                    {site.name ? titleCase(site.name) : `Site #${site.id}`}
                  </div>
                  <div className="text-muted-foreground">
                    {words(site.type)}
                    {state?.ruined ? ' · in ruins' : ''}
                    {civ
                      ? ` · ${civ.name ? titleCase(civ.name) : 'unknown'}${civ.race ? ` (${words(civ.race)})` : ''}`
                      : ''}
                  </div>
                </div>
              )
            })}
            <div
              className={cn(hover.sites.length && 'mt-1 border-t pt-1', 'text-muted-foreground')}
            >
              {hover.region
                ? `${hover.region.name ? titleCase(hover.region.name) : 'Unnamed region'} · ${words(hover.region.type)}${hover.region.evilness && hover.region.evilness !== 'neutral' ? ` · ${hover.region.evilness}` : ''}`
                : 'Open sea'}
              <span className="ml-2 tabular-nums">
                {hover.x},{hover.y}
              </span>
            </div>
          </div>
        ) : null}

        <MapZoomControls
          className="absolute top-2 right-2"
          compact={inset}
          zoomPercent={pz.zoomPercent}
          onZoomIn={pz.zoomIn}
          onZoomOut={pz.zoomOut}
          onFit={pz.fit}
        />

        {!inset && zoomedIn && view ? (
          <MapMinimap
            className="absolute top-14 right-2"
            image={cache?.canvas ?? null}
            smooth
            contentWidth={data.width + 2}
            contentHeight={data.height + 2}
            view={{ ...view, x: view.x - view.scale, y: view.y - view.scale }}
            size={size}
            onCentre={(cx, cy) => pz.centreOn(cx - 1, cy - 1)}
          />
        ) : null}

        {selected ? (
          <SelectionCard
            selection={selected}
            data={data}
            compact={inset}
            onClose={() => setSelected(null)}
            onOpenSite={onSelectSite}
            onOpenRegion={onSelectRegion}
          />
        ) : null}

        {pz.wheelHint ? (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/40 text-sm font-medium text-white">
            Hold ⌘ or Ctrl and scroll to zoom
          </div>
        ) : null}
      </div>

      {showLegend && sprites ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
          {legendTypes.map((type) => (
            <span key={type} className="inline-flex items-center gap-1.5">
              <TerrainChip index={sprites.index} type={type} />
              {type}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <TileChip index={sprites.index} name="RIVER_NS" />
            Rivers
          </span>
          <span className="mx-1 hidden border-l sm:inline" />
          <span className="inline-flex items-center gap-1.5">
            <TileChip index={sprites.index} name="SITE_CITY_1" />
            <TileChip index={sprites.index} name="SITE_FORTRESS" />
            <TileChip index={sprites.index} name="SITE_DARK_FORTRESS_1" />
            Settlements
          </span>
          <span className="inline-flex items-center gap-1.5">
            <TileChip index={sprites.index} name="SITE_RUIN_VILLAGE" />
            Ruins
          </span>
          <span className="inline-flex items-center gap-1.5">
            <TileChip index={sprites.index} name="SITE_CAVE" />
            <TileChip index={sprites.index} name="SITE_LAIR_BURROW" />
            Lairs &amp; caves
          </span>
          {plainPeaks ? (
            <span className="inline-flex items-center gap-1.5">
              <TileChip index={sprites.index} name="MOUNTAIN_PEAK:1" />
              Peaks
            </span>
          ) : null}
          {volcanoes ? (
            <span className="inline-flex items-center gap-1.5">
              <TileChip index={sprites.index} name="VOLCANO:1" />
              Volcanoes
            </span>
          ) : null}
        </div>
      ) : showLegend ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
          {legendTypes.map((type) => (
            <span key={type} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block size-3 rounded-sm border border-black/20"
                style={{ backgroundColor: regionColor(type) }}
              />
              {type}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block size-3 rounded-sm border border-black/20"
              style={{ backgroundColor: OCEAN }}
            />
            Sea
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-3 w-1.5 rounded-sm"
              style={{ backgroundColor: 'rgb(56, 132, 214)' }}
            />
            Rivers
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block size-3 rounded-sm border border-black/20"
              style={{ backgroundColor: mix('#8fb56a', '#5b21b6', 0.35) }}
            />
            Evil lands
          </span>
          <span className="mx-1 hidden border-l sm:inline" />
          {legendRaces.map((race) => (
            <span key={race} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block size-3 rounded-full border border-black/40"
                style={{ backgroundColor: RACE_COLORS[race] ?? '#0891b2' }}
              />
              {titleCase(race)} sites
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 border border-white/50 bg-[#1c1917]" /> Lairs &
            caves
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-0 border-x-[5px] border-b-[9px] border-x-transparent border-b-[#f5f5f4]" />{' '}
            Peaks
          </span>
        </div>
      ) : null}
    </div>
  )
}

function SelectionCard({
  selection,
  data,
  compact,
  onClose,
  onOpenSite,
  onOpenRegion,
}: {
  selection: Selection
  data: LegendsMapData
  compact: boolean
  onClose: () => void
  onOpenSite?: (site: MapSite) => void
  onOpenRegion?: (region: MapRegion) => void
}) {
  let title: string
  let detail: string
  let open: (() => void) | null = null
  if (selection.kind === 'site') {
    const { site } = selection
    const civ = site.civ !== null ? data.civs[site.civ] : null
    const owner = site.owner !== null && site.owner !== site.civ ? data.civs[site.owner] : null
    title = site.name ? titleCase(site.name) : `Site #${site.id}`
    detail = [
      words(site.type) || 'site',
      civ
        ? `of ${civ.name ? titleCase(civ.name) : 'unknown'}${civ.race ? ` (${words(civ.race)})` : ''}`
        : 'unclaimed',
      owner?.name ? `held by ${titleCase(owner.name)}` : null,
      `${site.x},${site.y}`,
    ]
      .filter(Boolean)
      .join(' · ')
    if (onOpenSite) open = () => onOpenSite(site)
  } else {
    const { region } = selection
    title = region.name ? titleCase(region.name) : 'Unnamed region'
    detail = [
      words(region.type) || 'region',
      region.evilness && region.evilness !== 'neutral' ? region.evilness : null,
      `${region.tiles.toLocaleString()} tiles`,
    ]
      .filter(Boolean)
      .join(' · ')
    if (onOpenRegion) open = () => onOpenRegion(region)
  }
  return (
    <div
      className={cn(
        'absolute top-2 left-2 z-10 flex max-w-[calc(100%-7rem)] items-start gap-3 rounded-md border bg-popover/95 text-popover-foreground shadow-md backdrop-blur',
        compact ? 'p-2 text-xs' : 'p-3 text-sm',
      )}
    >
      <div className="min-w-0">
        <div className="truncate font-medium">{title}</div>
        <div className="text-muted-foreground">{detail}</div>
        {open ? (
          <Button size="sm" variant="link" className="mt-1 h-auto gap-1 p-0" onClick={open}>
            Open {selection.kind}
            <ArrowRightIcon className="size-3.5" />
          </Button>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Clear selection"
        className="-m-1 rounded p-1 text-muted-foreground hover:text-foreground"
        onClick={onClose}
      >
        <XIcon className="size-4" />
      </button>
    </div>
  )
}
