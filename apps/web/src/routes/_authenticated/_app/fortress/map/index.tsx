import { Badge, Button, Card, cn } from '@fortress/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import * as React from 'react'

import { FORT_SLOW_REFRESH_MS, useFortOverview } from '~/lib/fortress/queries'
import { type FortMapLevel, getFortMapLevel } from '~/lib/fortress/server'
import {
  DIG_LABELS,
  type LevelGrid,
  decodeLevel,
  digDesignation,
  isHidden,
  tileStyle,
} from '~/lib/fortress/tiles'
import { MapHint, MapMinimap, MapZoomControls } from '~/lib/map/MapControls'
import { usePanZoom } from '~/lib/map/usePanZoom'
import { EmptyState, PageHeader, StatusBanner } from '../-components/FortChrome'

const UNIT_COLORS = {
  citizen: '#facc15',
  animal: '#a3e635',
  hostile: '#ef4444',
  other: '#e5e7eb',
} as const

function MapPage() {
  const overview = useFortOverview()
  const [z, setZ] = React.useState<number | null>(null)
  const [reveal, setReveal] = React.useState(false)
  const [showBuildings, setShowBuildings] = React.useState(true)
  const [hover, setHover] = React.useState<{ x: number; y: number; label: string } | null>(null)

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['fort', 'map', z],
    queryFn: () => getFortMapLevel({ data: { z: z ?? undefined } }),
    refetchInterval: FORT_SLOW_REFRESH_MS,
    placeholderData: keepPreviousData,
  })

  const levels = data?.levels ?? []
  const currentZ = data?.z ?? z
  const levelIndex = currentZ !== null ? levels.indexOf(currentZ) : -1
  const step = (delta: number) => {
    if (levelIndex === -1) return
    const next = levels[levelIndex + delta]
    if (next !== undefined) setZ(next)
  }

  const citizens = data?.units.filter((u) => u.kind === 'citizen').length ?? 0
  const hostiles = data?.units.filter((u) => u.kind === 'hostile').length ?? 0

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        eyebrow="Fortress"
        title="Map"
        description="One z-level at a time, drawn from the last map dump. Scroll or pinch to zoom, drag to pan, double-click to zoom in, and use < and > to change level like in the game. Unrevealed rock stays dark unless you choose to see it."
        updatedAt={data?.capturedAt}
        isFetching={isFetching}
        onRefresh={() => refetch()}
      />
      <StatusBanner state={overview.data?.state} />

      {!data ? (
        <EmptyState title="No map yet">
          The map is dumped on its own schedule (every few minutes). Give the worker a moment.
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
          <Card className="overflow-hidden p-0">
            {/* Remount (and refit) if the embark size ever changes. */}
            <MapCanvas
              key={`${data.xCount}x${data.yCount}`}
              data={data}
              reveal={reveal}
              showBuildings={showBuildings}
              onHover={setHover}
              onStepLevel={step}
            />
          </Card>
          <div className="flex flex-col gap-4">
            <Card className="flex flex-col gap-3 p-4">
              <div className="text-sm font-medium text-muted-foreground">Level</div>
              <div className="flex items-center justify-between">
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => step(-1)}
                  disabled={levelIndex <= 0}
                >
                  <ChevronDownIcon className="size-4" />
                </Button>
                <div className="text-center">
                  <div className="text-2xl font-semibold tabular-nums">z {currentZ}</div>
                  <div className="text-xs text-muted-foreground">
                    {levelIndex + 1} of {levels.length}
                    {data.suggestedZ !== null && data.suggestedZ !== currentZ ? (
                      <>
                        {' · '}
                        <button
                          type="button"
                          className="underline-offset-4 hover:underline"
                          onClick={() => setZ(data.suggestedZ)}
                        >
                          go to the dwarves (z {data.suggestedZ})
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => step(1)}
                  disabled={levelIndex === -1 || levelIndex >= levels.length - 1}
                >
                  <ChevronUpIcon className="size-4" />
                </Button>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(levels.length - 1, 0)}
                value={Math.max(levelIndex, 0)}
                onChange={(e) => setZ(levels[Number(e.target.value)] ?? null)}
                className="w-full"
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={reveal}
                  onChange={(e) => setReveal(e.target.checked)}
                />
                Show unrevealed tiles
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showBuildings}
                  onChange={(e) => setShowBuildings(e.target.checked)}
                />
                Outline buildings
              </label>
            </Card>
            <Card className="flex flex-col gap-2 p-4 text-sm">
              <div className="text-sm font-medium text-muted-foreground">On this level</div>
              <div className="flex flex-wrap gap-1">
                <Badge
                  style={{ backgroundColor: UNIT_COLORS.citizen, color: '#000' }}
                  className="border-transparent"
                >
                  {citizens} citizens
                </Badge>
                <Badge
                  style={{ backgroundColor: UNIT_COLORS.hostile }}
                  className="border-transparent text-white"
                >
                  {hostiles} hostiles
                </Badge>
                <Badge variant="outline">
                  {data.units.length - citizens - hostiles} other creatures
                </Badge>
                <Badge variant="outline">{data.buildings.length} buildings</Badge>
              </div>
              <div className="min-h-[3rem] text-sm leading-relaxed text-muted-foreground">
                {hover ? (
                  <>
                    <span className="font-mono">
                      {hover.x},{hover.y}
                    </span>{' '}
                    · {hover.label}
                  </>
                ) : (
                  'Move the mouse over the map.'
                )}
              </div>
              <Legend />
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

function Legend() {
  const swatches: [string, string][] = [
    ['#7c7c84', 'stone wall'],
    ['#3f3f46', 'stone floor'],
    ['#6b4f2a', 'soil'],
    ['#b45309', 'ore / mineral'],
    ['#cbd5e1', 'constructed wall'],
    ['#94a3b8', 'constructed floor'],
    ['#4d7c0f', 'grass'],
    ['#65a30d', 'plants & trees'],
    ['#38bdf8', 'water'],
    ['#f97316', 'magma'],
    ['#fde68a', 'stairs'],
    ['#0b0f14', 'open air'],
  ]
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
      {swatches.map(([color, label]) => (
        <div key={label} className="flex items-center gap-1.5">
          <span
            className="inline-block size-3 rounded-sm border border-white/10"
            style={{ backgroundColor: color }}
          />
          {label}
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <span className="inline-block size-3 rounded-sm border border-dashed border-amber-400" />
        dig designation
      </div>
    </div>
  )
}

const MAX_SCALE = 64

/** Paint the level once at one pixel per tile; the viewport scales this image. */
function paintBase(
  grid: LevelGrid,
  tiletypes: FortMapLevel['tiletypes'],
  reveal: boolean,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = grid.width
  canvas.height = grid.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const image = ctx.createImageData(grid.width, grid.height)
  const px = image.data
  const colorCache = new Map<string, [number, number, number]>()
  const rgb = (color: string): [number, number, number] => {
    const cached = colorCache.get(color)
    if (cached) return cached
    const parsed = parseColor(color)
    colorCache.set(color, parsed)
    return parsed
  }
  for (let i = 0; i < grid.tiles.length; i++) {
    const tt = grid.tiles[i]
    if (tt < 0) continue // outside the map: leave transparent
    const f = grid.flags[i]
    const color = !reveal && isHidden(f) ? '#15171c' : tileStyle(tiletypes[String(tt)], f).color
    const [r, g, b] = rgb(color)
    const o = i * 4
    px[o] = r
    px[o + 1] = g
    px[o + 2] = b
    px[o + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

function parseColor(color: string): [number, number, number] {
  if (color.startsWith('#')) {
    const n = Number.parseInt(color.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(color)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0]
}

function MapCanvas({
  data,
  reveal,
  showBuildings,
  onHover,
  onStepLevel,
}: {
  data: FortMapLevel
  reveal: boolean
  showBuildings: boolean
  onHover: (info: { x: number; y: number; label: string } | null) => void
  /** +1 for the level above, -1 for the one below. */
  onStepLevel: (delta: number) => void
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [pointer, setPointer] = React.useState<{ px: number; py: number; label: string } | null>(
    null,
  )

  const grid = React.useMemo(
    () => decodeLevel(data.blocks, data.xCount, data.yCount),
    [data.blocks, data.xCount, data.yCount],
  )
  const base = React.useMemo(
    () => paintBase(grid, data.tiletypes, reveal),
    [grid, data.tiletypes, reveal],
  )
  const designated = React.useMemo(() => {
    const out: number[] = []
    for (let i = 0; i < grid.flags.length; i++) {
      if (grid.tiles[i] >= 0 && digDesignation(grid.flags[i]) > 0) out.push(i)
    }
    return out
  }, [grid])

  const pz = usePanZoom({ width: grid.width, height: grid.height, maxScale: MAX_SCALE })
  const { view, size } = pz

  // Draw. Everything here is pure canvas output, no React state.
  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !view || !base || size.width === 0 || size.height === 0) return
    const dpr = window.devicePixelRatio || 1
    const pw = Math.round(size.width * dpr)
    const ph = Math.round(size.height * dpr)
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw
      canvas.height = ph
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, size.width, size.height)
    ctx.imageSmoothingEnabled = false

    const { scale, x: ox, y: oy } = view
    ctx.drawImage(base, ox, oy, grid.width * scale, grid.height * scale)

    // Visible tile range, used to skip overlays that are off screen.
    const tx0 = Math.max(0, Math.floor(-ox / scale))
    const ty0 = Math.max(0, Math.floor(-oy / scale))
    const tx1 = Math.min(grid.width - 1, Math.ceil((size.width - ox) / scale))
    const ty1 = Math.min(grid.height - 1, Math.ceil((size.height - oy) / scale))
    const visible = (x: number, y: number) => x >= tx0 && x <= tx1 && y >= ty0 && y <= ty1

    // A faint grid once tiles are big enough to count.
    if (scale >= 14) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = tx0; x <= tx1 + 1; x++) {
        const sx = Math.round(ox + x * scale) + 0.5
        ctx.moveTo(sx, oy + ty0 * scale)
        ctx.lineTo(sx, oy + (ty1 + 1) * scale)
      }
      for (let y = ty0; y <= ty1 + 1; y++) {
        const sy = Math.round(oy + y * scale) + 0.5
        ctx.moveTo(ox + tx0 * scale, sy)
        ctx.lineTo(ox + (tx1 + 1) * scale, sy)
      }
      ctx.stroke()
    }

    // Dig designations: outlines when tiles are big enough, a tint when they are not.
    if (scale >= 3) {
      ctx.strokeStyle = '#fbbf24'
      ctx.lineWidth = 1
    } else {
      ctx.fillStyle = 'rgba(251,191,36,0.6)'
    }
    for (const i of designated) {
      const x = i % grid.width
      const y = Math.floor(i / grid.width)
      if (!visible(x, y)) continue
      if (scale >= 3) {
        ctx.strokeRect(ox + x * scale + 0.5, oy + y * scale + 0.5, scale - 1, scale - 1)
      } else {
        ctx.fillRect(ox + x * scale, oy + y * scale, Math.max(scale, 1), Math.max(scale, 1))
      }
    }

    if (showBuildings) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      ctx.lineWidth = 1
      for (const b of data.buildings) {
        if (b.x2 < tx0 || b.x1 > tx1 || b.y2 < ty0 || b.y1 > ty1) continue
        ctx.strokeRect(
          ox + b.x1 * scale + 0.5,
          oy + b.y1 * scale + 0.5,
          (b.x2 - b.x1 + 1) * scale - 1,
          (b.y2 - b.y1 + 1) * scale - 1,
        )
      }
      // Names on buildings once there is room for them.
      if (scale >= 22) {
        ctx.font = '500 11px ui-sans-serif, system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.lineJoin = 'round'
        for (const b of data.buildings) {
          if (b.x2 < tx0 || b.x1 > tx1 || b.y2 < ty0 || b.y1 > ty1) continue
          const w = (b.x2 - b.x1 + 1) * scale
          const label = b.name || b.type
          if (!label || ctx.measureText(label).width > w - 4) continue
          const cx = ox + ((b.x1 + b.x2 + 1) / 2) * scale
          const cy = oy + ((b.y1 + b.y2 + 1) / 2) * scale
          ctx.strokeStyle = 'rgba(0,0,0,0.8)'
          ctx.lineWidth = 3
          ctx.strokeText(label, cx, cy)
          ctx.fillStyle = 'rgba(255,255,255,0.9)'
          ctx.fillText(label, cx, cy)
        }
      }
    }

    // Units stay visible at any zoom: never smaller than a few pixels.
    const radius = Math.max(scale * 0.45, 2.5)
    for (const u of data.units) {
      if (!visible(u.x, u.y)) continue
      ctx.fillStyle = UNIT_COLORS[u.kind]
      ctx.beginPath()
      ctx.arc(ox + (u.x + 0.5) * scale, oy + (u.y + 0.5) * scale, radius, 0, Math.PI * 2)
      ctx.fill()
      if (scale >= 8) {
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'
        ctx.lineWidth = 1
        ctx.stroke()
      }
    }
  }, [view, size, base, grid, designated, data.buildings, data.units, showBuildings])

  const tileAt = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas || !view) return null
    const rect = canvas.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    const x = Math.floor((px - view.x) / view.scale)
    const y = Math.floor((py - view.y) / view.scale)
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return null
    return { x, y, px, py }
  }

  const describe = (x: number, y: number): string => {
    const i = y * grid.width + x
    const f = grid.flags[i]
    const tt = grid.tiles[i]
    const unit = data.units.find((u) => u.x === x && u.y === y)
    const building = data.buildings.find((b) => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2)
    const parts: string[] = []
    if (tt < 0) parts.push('outside the map')
    else if (!reveal && isHidden(f)) parts.push('unrevealed')
    else parts.push(tileStyle(data.tiletypes[String(tt)], f).label)
    const dig = digDesignation(f)
    if (dig > 0) parts.push(`designated: ${DIG_LABELS[dig]}`)
    if (building) parts.push(building.name || building.type)
    if (unit) parts.push(unit.name)
    return parts.join(' · ')
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pz.handlers.onPointerMove(e)
    if (pz.isPressed()) {
      if (pointer) setPointer(null)
      onHover(null)
      return
    }
    const tile = tileAt(e.clientX, e.clientY)
    if (!tile) {
      setPointer(null)
      onHover(null)
      return
    }
    const label = describe(tile.x, tile.y)
    setPointer({ px: tile.px, py: tile.py, label: `${tile.x},${tile.y} · ${label}` })
    onHover({ x: tile.x, y: tile.y, label })
  }

  const zoomedIn = view ? view.scale > pz.fitScale * 1.25 : false

  return (
    <div
      ref={pz.containerRef}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: focus enables the keyboard shortcuts
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === '<' || e.key === 'PageUp') onStepLevel(1)
        else if (e.key === '>' || e.key === 'PageDown') onStepLevel(-1)
        else {
          pz.handlers.onKeyDown(e)
          return
        }
        e.preventDefault()
      }}
      className="relative h-[70vh] min-h-[420px] w-full select-none bg-black outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <canvas
        ref={canvasRef}
        onPointerDown={pz.handlers.onPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={pz.handlers.onPointerUp}
        onPointerCancel={pz.handlers.onPointerCancel}
        onPointerLeave={() => {
          setPointer(null)
          onHover(null)
        }}
        onDoubleClick={pz.handlers.onDoubleClick}
        className={cn(
          'absolute inset-0 h-full w-full',
          pz.dragging ? 'cursor-grabbing' : 'cursor-crosshair',
        )}
        style={{ imageRendering: 'pixelated', touchAction: 'none' }}
      />
      {pointer && !pz.dragging ? (
        <div
          className="pointer-events-none absolute z-10 max-w-xs rounded-md border bg-popover/95 px-2 py-1 text-xs text-popover-foreground shadow-md"
          style={{
            left: Math.min(pointer.px + 14, Math.max(0, size.width - 260)),
            top: Math.min(pointer.py + 14, Math.max(0, size.height - 40)),
          }}
        >
          {pointer.label}
        </div>
      ) : null}
      <MapZoomControls
        className="absolute top-2 right-2"
        zoomPercent={pz.zoomPercent}
        onZoomIn={pz.zoomIn}
        onZoomOut={pz.zoomOut}
        onFit={pz.fit}
      />
      {zoomedIn && view ? (
        <MapMinimap
          className="absolute top-14 right-2"
          image={base}
          contentWidth={grid.width}
          contentHeight={grid.height}
          view={view}
          size={size}
          onCentre={pz.centreOn}
        />
      ) : null}
      {view ? (
        <MapHint className="absolute bottom-2 left-2 tabular-nums">
          {view.scale.toFixed(view.scale < 4 ? 1 : 0)} px / tile · &lt; &gt; change level · 0 fits
        </MapHint>
      ) : null}
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/_app/fortress/map/')({
  component: MapPage,
})
