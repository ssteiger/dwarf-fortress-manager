import { Badge, Button, Card, cn } from '@fortress/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  Maximize2Icon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react'
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
        description="One z-level at a time, drawn from the last map dump. Scroll to zoom, drag to pan, double-click to zoom in. Unrevealed rock stays dark unless you choose to see it."
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

/** Screen = tile * scale + offset. `scale` is CSS pixels per tile. */
interface View {
  scale: number
  x: number
  y: number
}

interface Size {
  width: number
  height: number
}

const MAX_SCALE = 64
const ZOOM_STEP = 1.5
/** Keep at least this many CSS pixels of map inside the viewport when panning. */
const PAN_MARGIN = 96
/** Pointer movement below this is a click, not a drag. */
const DRAG_THRESHOLD = 3

function fitView(grid: LevelGrid, size: Size): View {
  const scale = Math.max(Math.min(size.width / grid.width, size.height / grid.height), 0.5)
  return {
    scale,
    x: (size.width - grid.width * scale) / 2,
    y: (size.height - grid.height * scale) / 2,
  }
}

function clampView(view: View, grid: LevelGrid, size: Size): View {
  const minScale = fitView(grid, size).scale / 2
  const scale = Math.min(Math.max(view.scale, minScale), MAX_SCALE)
  const mapW = grid.width * scale
  const mapH = grid.height * scale
  const x = Math.min(Math.max(view.x, PAN_MARGIN - mapW), size.width - PAN_MARGIN)
  const y = Math.min(Math.max(view.y, PAN_MARGIN - mapH), size.height - PAN_MARGIN)
  return { scale, x, y }
}

/** Zoom by `factor` keeping the screen point (px, py) fixed. */
function zoomAt(view: View, factor: number, px: number, py: number): View {
  const scale = view.scale * factor
  const ratio = scale / view.scale
  return {
    scale,
    x: px - (px - view.x) * ratio,
    y: py - (py - view.y) * ratio,
  }
}

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
}: {
  data: FortMapLevel
  reveal: boolean
  showBuildings: boolean
  onHover: (info: { x: number; y: number; label: string } | null) => void
}) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const [size, setSize] = React.useState<Size>({ width: 0, height: 0 })
  const [view, setView] = React.useState<View | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const dragRef = React.useRef<{
    pointerId: number
    startX: number
    startY: number
    origin: View
    moved: boolean
  } | null>(null)

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

  // Track the viewport size. The first measurement also sets the initial (fitted) view.
  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect || rect.width === 0 || rect.height === 0) return
      const next = { width: rect.width, height: rect.height }
      setSize(next)
      setView((current) => (current ? clampView(current, grid, next) : fitView(grid, next)))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [grid])

  // Wheel zoom has to be a native, non-passive listener so we can stop the page scrolling.
  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      // Pixel-mode deltas (trackpads) are small and frequent; line-mode (mouse wheels) are large.
      const delta = e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? e.deltaY : e.deltaY * 16
      const factor = Math.exp(-delta * 0.002)
      setView((current) =>
        current ? clampView(zoomAt(current, factor, px, py), grid, size) : current,
      )
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [grid, size])

  // Draw. Everything here is pure canvas output, no React state.
  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !view || !base || size.width === 0 || size.height === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.width * dpr)
    canvas.height = Math.round(size.height * dpr)
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

  const tileAt = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const canvas = canvasRef.current
    if (!canvas || !view) return null
    const rect = canvas.getBoundingClientRect()
    const x = Math.floor((clientX - rect.left - view.x) / view.scale)
    const y = Math.floor((clientY - rect.top - view.y) / view.scale)
    if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return null
    return { x, y }
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

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!view || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origin: view,
      moved: false,
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (drag && drag.pointerId === e.pointerId) {
      const dx = e.clientX - drag.startX
      const dy = e.clientY - drag.startY
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      if (!drag.moved) {
        drag.moved = true
        setDragging(true)
        onHover(null)
      }
      setView(
        clampView({ ...drag.origin, x: drag.origin.x + dx, y: drag.origin.y + dy }, grid, size),
      )
      return
    }
    const tile = tileAt(e.clientX, e.clientY)
    onHover(tile ? { ...tile, label: describe(tile.x, tile.y) } : null)
  }

  const endDrag = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    dragRef.current = null
    setDragging(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!view) return
    const rect = e.currentTarget.getBoundingClientRect()
    setView(clampView(zoomAt(view, 2, e.clientX - rect.left, e.clientY - rect.top), grid, size))
  }

  const zoomCenter = (factor: number) => {
    if (!view) return
    setView(clampView(zoomAt(view, factor, size.width / 2, size.height / 2), grid, size))
  }

  const fitScale = size.width > 0 ? fitView(grid, size).scale : 1
  const zoomPercent = view ? Math.round((view.scale / fitScale) * 100) : 100

  return (
    <div ref={containerRef} className="relative h-[70vh] min-h-[420px] w-full select-none bg-black">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={(e) => {
          if (!dragRef.current) onHover(null)
          endDrag(e)
        }}
        onDoubleClick={handleDoubleClick}
        className={cn(
          'absolute inset-0 h-full w-full',
          dragging ? 'cursor-grabbing' : 'cursor-grab',
        )}
        style={{ imageRendering: 'pixelated', touchAction: 'none' }}
      />
      <div className="absolute top-2 right-2 flex items-center gap-1 rounded-md border border-white/10 bg-background/80 p-1 shadow-sm backdrop-blur">
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label="Zoom out"
          onClick={() => zoomCenter(1 / ZOOM_STEP)}
        >
          <ZoomOutIcon className="size-4" />
        </Button>
        <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-muted-foreground">
          {zoomPercent}%
        </span>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label="Zoom in"
          onClick={() => zoomCenter(ZOOM_STEP)}
        >
          <ZoomInIcon className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label="Fit the whole level"
          onClick={() => setView(fitView(grid, size))}
        >
          <Maximize2Icon className="size-4" />
        </Button>
      </div>
      {view && view.scale >= 1 ? (
        <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-background/70 px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
          {view.scale.toFixed(view.scale < 4 ? 1 : 0)} px / tile
        </div>
      ) : null}
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/_app/fortress/map/')({
  component: MapPage,
})
