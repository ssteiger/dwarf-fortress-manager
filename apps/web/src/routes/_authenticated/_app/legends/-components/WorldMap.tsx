import { cn } from '@fortress/ui'
import * as React from 'react'

import { type TileSprite, drawTile, useDfAssets, useSpriteSheets } from '~/lib/df-assets'
import { TerrainChip, TileChip } from '~/lib/df-assets/legends'
import {
  RACE_COLORS,
  raceColor,
  regionColor,
  siteGroup,
  titleCase,
  words,
} from '~/lib/legends/model'
import type { LegendsMapData, MapRegion, MapSite } from '~/lib/legends/server'
import {
  WORLD_MAP_PAGES,
  peakSprite,
  riverSprite,
  siteSprite,
  terrainSprites,
} from '~/lib/legends/worldTiles'

export interface WorldMapProps {
  data: LegendsMapData
  /** Site ids to emphasise; everything else is dimmed. */
  highlightSites?: ReadonlySet<number> | null
  /** Region id to outline; everything else is dimmed. */
  highlightRegion?: number | null
  /** Tile to ring, e.g. the site being viewed. */
  focus?: { x: number; y: number } | null
  onSelectSite?: (site: MapSite) => void
  onSelectRegion?: (region: MapRegion) => void
  showLegend?: boolean
  className?: string
}

const OCEAN = '#28527f'

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

function tileColor(region: MapRegion): string {
  const base = regionColor(region.type)
  if (region.evilness === 'evil') return mix(base, '#5b21b6', 0.35)
  if (region.evilness === 'good') return mix(base, '#fef3c7', 0.3)
  return base
}

function siteRadius(type: string | null, tile: number): number {
  const t = words(type)
  if (['dark fortress', 'fortress', 'town', 'castle', 'tower', 'vault'].includes(t))
    return tile * 0.42
  if (siteGroup(type) === 'wild') return tile * 0.22
  return tile * 0.32
}

/**
 * The surface of the world: regions drawn with the game's world-map tiles
 * when the sprites have been extracted (flat terrain colours otherwise),
 * rivers, mountain peaks, and every site as the game's marker or a dot in
 * the colour of the civilization that holds it. Hover for names, click to
 * open a site or region.
 */
export function WorldMap({
  data,
  highlightSites,
  highlightRegion,
  focus,
  onSelectSite,
  onSelectRegion,
  showLegend = true,
  className,
}: WorldMapProps) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const wrapRef = React.useRef<HTMLDivElement>(null)
  const [size, setSize] = React.useState(0)

  // The game's own world-map sprites, when they have been extracted locally.
  // Until then (or without them) the map is drawn with flat colours.
  const assets = useDfAssets()
  const sheets = useSpriteSheets(assets, WORLD_MAP_PAGES)
  const sprites = React.useMemo(
    () => (assets && sheets && sheets.size > 0 ? { index: assets, sheets } : null),
    [assets, sheets],
  )
  const [hover, setHover] = React.useState<{
    x: number
    y: number
    px: number
    py: number
    region: MapRegion | null
    sites: MapSite[]
  } | null>(null)

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

  const regionIndexById = React.useMemo(() => {
    const map = new Map<number, number>()
    data.regions.forEach((r, i) => map.set(r.id, i))
    return map
  }, [data])

  React.useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0
      setSize(Math.floor(w))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !size) return
    const dpr = window.devicePixelRatio || 1
    const tile = size / data.width
    const cssHeight = tile * data.height
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(cssHeight * dpr)
    canvas.style.height = `${cssHeight}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const dimmed = highlightRegion !== null && highlightRegion !== undefined
    const highlightIndex = dimmed ? (regionIndexById.get(highlightRegion) ?? -1) : -1

    // Pixel art stays crisp when tiles are drawn at or above their native
    // 16px; below that, smoothing reads better than dropped pixels.
    ctx.imageSmoothingEnabled = tile < 16
    const blit = (sprite: TileSprite | null, x: number, y: number, w = tile, h = tile) =>
      sprites ? drawTile(ctx, sprites.index, sprites.sheets, sprite, x, y, w, h) : false

    // Terrain.
    ctx.fillStyle = OCEAN
    ctx.fillRect(0, 0, size, cssHeight)
    const colors = data.regions.map(tileColor)
    if (sprites) {
      // Base tiles first, then the 32px forest and mountain overlays so
      // they sit above neighbouring ground.
      const overlays: { sprite: TileSprite; x: number; y: number }[] = []
      for (let y = 0; y < data.height; y++) {
        for (let x = 0; x < data.width; x++) {
          const index = data.tiles[y * data.width + x]
          const region = index >= 0 ? data.regions[index] : null
          const look = terrainSprites(sprites.index, region, x, y)
          if (!blit(look.base, x * tile, y * tile, tile + 0.5, tile + 0.5) && region) {
            ctx.fillStyle = colors[index]
            ctx.fillRect(x * tile, y * tile, tile + 0.5, tile + 0.5)
          }
          if (look.overlay) overlays.push({ sprite: look.overlay, x, y })
        }
      }
      for (const o of overlays) blit(o.sprite, o.x * tile, o.y * tile, tile + 0.5, tile + 0.5)
    } else {
      for (let y = 0; y < data.height; y++) {
        for (let x = 0; x < data.width; x++) {
          const index = data.tiles[y * data.width + x]
          if (index < 0) continue
          ctx.fillStyle = colors[index]
          ctx.fillRect(x * tile, y * tile, tile + 0.5, tile + 0.5)
        }
      }

      // Region seams, so neighbouring biomes of the same type still read as separate.
      ctx.strokeStyle = 'rgba(0,0,0,0.12)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let y = 0; y < data.height; y++) {
        for (let x = 0; x < data.width; x++) {
          const here = data.tiles[y * data.width + x]
          if (x + 1 < data.width && data.tiles[y * data.width + x + 1] !== here) {
            ctx.moveTo((x + 1) * tile, y * tile)
            ctx.lineTo((x + 1) * tile, (y + 1) * tile)
          }
          if (y + 1 < data.height && data.tiles[(y + 1) * data.width + x] !== here) {
            ctx.moveTo(x * tile, (y + 1) * tile)
            ctx.lineTo((x + 1) * tile, (y + 1) * tile)
          }
        }
      }
      ctx.stroke()
    }

    // Rivers: the game's directional tiles when sprites are on, else squares
    // that widen as the river grows.
    const riverTiles = new Set(data.rivers.map((r) => r.tile))
    ctx.fillStyle = 'rgba(56, 132, 214, 0.95)'
    for (const river of data.rivers) {
      const x = river.tile % data.width
      const y = Math.floor(river.tile / data.width)
      if (sprites) {
        const sprite = riverSprite(sprites.index, river.size, {
          n: y > 0 && riverTiles.has(river.tile - data.width),
          s: y + 1 < data.height && riverTiles.has(river.tile + data.width),
          w: x > 0 && riverTiles.has(river.tile - 1),
          e: x + 1 < data.width && riverTiles.has(river.tile + 1),
        })
        if (blit(sprite, x * tile, y * tile, tile + 0.5, tile + 0.5)) continue
      }
      const riverSize = Math.max(1, tile * (river.size === 3 ? 0.7 : river.size === 2 ? 0.5 : 0.32))
      ctx.fillRect(
        x * tile + (tile - riverSize) / 2,
        y * tile + (tile - riverSize) / 2,
        riverSize,
        riverSize,
      )
    }

    // Dim everything outside the highlighted region.
    if (dimmed) {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.55)'
      for (let y = 0; y < data.height; y++) {
        for (let x = 0; x < data.width; x++) {
          if (data.tiles[y * data.width + x] !== highlightIndex)
            ctx.fillRect(x * tile, y * tile, tile + 0.5, tile + 0.5)
        }
      }
      ctx.strokeStyle = '#fde68a'
      ctx.lineWidth = Math.max(1.5, tile * 0.25)
      ctx.beginPath()
      for (let y = 0; y < data.height; y++) {
        for (let x = 0; x < data.width; x++) {
          if (data.tiles[y * data.width + x] !== highlightIndex) continue
          const left = x === 0 || data.tiles[y * data.width + x - 1] !== highlightIndex
          const right = x + 1 >= data.width || data.tiles[y * data.width + x + 1] !== highlightIndex
          const up = y === 0 || data.tiles[(y - 1) * data.width + x] !== highlightIndex
          const down =
            y + 1 >= data.height || data.tiles[(y + 1) * data.width + x] !== highlightIndex
          if (left) {
            ctx.moveTo(x * tile, y * tile)
            ctx.lineTo(x * tile, (y + 1) * tile)
          }
          if (right) {
            ctx.moveTo((x + 1) * tile, y * tile)
            ctx.lineTo((x + 1) * tile, (y + 1) * tile)
          }
          if (up) {
            ctx.moveTo(x * tile, y * tile)
            ctx.lineTo((x + 1) * tile, y * tile)
          }
          if (down) {
            ctx.moveTo(x * tile, (y + 1) * tile)
            ctx.lineTo((x + 1) * tile, (y + 1) * tile)
          }
        }
      }
      ctx.stroke()
    }

    // Peaks.
    for (const peak of data.peaks) {
      const cx = peak.x * tile + tile / 2
      const cy = peak.y * tile + tile / 2
      if (sprites) {
        const s = Math.max(tile, 8)
        const sprite = peakSprite(sprites.index, peak.volcano, peak.x, peak.y)
        if (blit(sprite, cx - s / 2, cy - s / 2, s, s)) continue
      }
      const r = tile * 0.45
      ctx.beginPath()
      ctx.moveTo(cx, cy - r)
      ctx.lineTo(cx + r, cy + r * 0.8)
      ctx.lineTo(cx - r, cy + r * 0.8)
      ctx.closePath()
      ctx.fillStyle = peak.volcano ? '#dc2626' : '#f5f5f4'
      ctx.fill()
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'
      ctx.lineWidth = 0.75
      ctx.stroke()
    }

    // Sites: wild places first so settlements draw on top.
    const emphasis = highlightSites && highlightSites.size > 0 ? highlightSites : null
    const ordered = [...data.sites].sort((a, b) => {
      const ga = siteGroup(a.type) === 'wild' ? 0 : 1
      const gb = siteGroup(b.type) === 'wild' ? 0 : 1
      return ga - gb
    })
    for (const site of ordered) {
      const cx = site.x * tile + tile / 2
      const cy = site.y * tile + tile / 2
      const r = siteRadius(site.type, tile)
      const group = siteGroup(site.type)
      const civ = site.civ !== null ? data.civs[site.civ] : null
      const strong = !emphasis || emphasis.has(site.id)
      ctx.globalAlpha = strong ? 1 : 0.2
      if (sprites) {
        // The game's marker, kept legible on small maps; emphasised sites get a ring.
        const s = Math.max(tile, 11)
        if (blit(siteSprite(sprites.index, site), cx - s / 2, cy - s / 2, s, s)) {
          if (strong && emphasis) {
            ctx.strokeStyle = '#fde68a'
            ctx.lineWidth = 1.5
            ctx.strokeRect(cx - s / 2 - 1, cy - s / 2 - 1, s + 2, s + 2)
          }
          ctx.globalAlpha = 1
          continue
        }
      }
      ctx.beginPath()
      if (group === 'wild') {
        ctx.rect(cx - r, cy - r, r * 2, r * 2)
        ctx.fillStyle = '#1c1917'
        ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'
        ctx.lineWidth = 0.75
        ctx.stroke()
      } else {
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fillStyle = civ ? raceColor(civ.race) : '#e7e5e4'
        ctx.fill()
        ctx.strokeStyle = strong && emphasis ? '#fde68a' : 'rgba(0,0,0,0.7)'
        ctx.lineWidth = strong && emphasis ? 2 : 1
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    // Focus ring.
    if (focus) {
      const cx = focus.x * tile + tile / 2
      const cy = focus.y * tile + tile / 2
      ctx.beginPath()
      ctx.arc(cx, cy, Math.max(tile * 1.4, 7), 0, Math.PI * 2)
      ctx.strokeStyle = '#fde68a'
      ctx.lineWidth = 2.5
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(cx, cy, Math.max(tile * 1.4, 7) + 3, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(0,0,0,0.7)'
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }, [data, size, highlightSites, highlightRegion, focus, regionIndexById, sprites])

  const tileAt = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas || !size) return null
    const rect = canvas.getBoundingClientRect()
    const tile = size / data.width
    const x = Math.floor((event.clientX - rect.left) / tile)
    const y = Math.floor((event.clientY - rect.top) / tile)
    if (x < 0 || y < 0 || x >= data.width || y >= data.height) return null
    return { x, y, px: event.clientX - rect.left, py: event.clientY - rect.top }
  }

  const onMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const t = tileAt(event)
    if (!t) {
      setHover(null)
      return
    }
    const index = data.tiles[t.y * data.width + t.x]
    const region = index >= 0 ? data.regions[index] : null
    // Accept a neighbouring tile so small markers are easy to hit.
    let sites = sitesByTile.get(t.y * data.width + t.x) ?? []
    if (!sites.length) {
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = t.x + dx
        const ny = t.y + dy
        if (nx < 0 || ny < 0 || nx >= data.width || ny >= data.height) continue
        const near = sitesByTile.get(ny * data.width + nx)
        if (near?.length) {
          sites = near
          break
        }
      }
    }
    setHover({ ...t, region, sites })
  }

  const onClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!hover) return
    if (hover.sites.length && onSelectSite) onSelectSite(hover.sites[0])
    else if (hover.region && onSelectRegion) onSelectRegion(hover.region)
    event.preventDefault()
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

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div ref={wrapRef} className="relative w-full overflow-hidden rounded-lg border bg-[#28527f]">
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: the map is a shortcut; every site and region is reachable from the lists and archive */}
        <canvas
          ref={canvasRef}
          className={cn('block w-full', (onSelectSite || onSelectRegion) && 'cursor-crosshair')}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          onClick={onClick}
          role="img"
          aria-label="Map of the world"
        />
        {hover ? (
          <div
            className="pointer-events-none absolute z-10 max-w-xs rounded-md border bg-popover/95 px-3 py-2 text-sm text-popover-foreground shadow-md"
            style={{
              left: Math.min(hover.px + 12, Math.max(0, size - 260)),
              top: hover.py + 12,
            }}
          >
            {hover.sites.map((site) => {
              const civ = site.civ !== null ? data.civs[site.civ] : null
              return (
                <div key={site.id} className="mb-1 last:mb-0">
                  <div className="font-medium">
                    {site.name ? titleCase(site.name) : `Site #${site.id}`}
                  </div>
                  <div className="text-muted-foreground">
                    {words(site.type)}
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
            <TerrainChip index={sprites.index} type="Ocean" />
            Sea
          </span>
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
          <span className="inline-flex items-center gap-1.5">
            <TileChip index={sprites.index} name="MOUNTAIN_PEAK:1" />
            Peaks
          </span>
          <span className="ml-auto text-xs">Drawn with the game's own world-map tiles.</span>
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
