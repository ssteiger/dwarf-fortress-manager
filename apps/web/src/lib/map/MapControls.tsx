import { Button, cn } from '@fortress/ui'
import { Maximize2Icon, ZoomInIcon, ZoomOutIcon } from 'lucide-react'
import * as React from 'react'

import type { Size, View } from './usePanZoom'

/** Zoom out, level, zoom in, fit: the floating toolbar in a map's corner. */
export function MapZoomControls({
  zoomPercent,
  onZoomIn,
  onZoomOut,
  onFit,
  compact = false,
  className,
}: {
  zoomPercent: number
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  compact?: boolean
  className?: string
}) {
  const buttonClass = compact ? 'size-7' : 'size-8'
  return (
    <div
      className={cn(
        'flex items-center gap-0.5 rounded-md border border-white/10 bg-background/80 p-1 shadow-sm backdrop-blur',
        className,
      )}
    >
      <Button
        size="icon"
        variant="ghost"
        className={buttonClass}
        aria-label="Zoom out"
        title="Zoom out (−)"
        onClick={onZoomOut}
      >
        <ZoomOutIcon className="size-4" />
      </Button>
      {compact ? null : (
        <span className="min-w-[3.25rem] text-center text-xs tabular-nums text-muted-foreground">
          {zoomPercent}%
        </span>
      )}
      <Button
        size="icon"
        variant="ghost"
        className={buttonClass}
        aria-label="Zoom in"
        title="Zoom in (+)"
        onClick={onZoomIn}
      >
        <ZoomInIcon className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className={buttonClass}
        aria-label="Show everything"
        title="Show everything (0)"
        onClick={onFit}
      >
        <Maximize2Icon className="size-4" />
      </Button>
    </div>
  )
}

/**
 * The whole map in miniature with the visible part outlined. Press or drag
 * on it to move there. `image` is drawn stretched over the content area.
 */
export function MapMinimap({
  image,
  contentWidth,
  contentHeight,
  view,
  size,
  onCentre,
  smooth = false,
  className,
}: {
  image: CanvasImageSource | null
  contentWidth: number
  contentHeight: number
  view: View
  size: Size
  onCentre: (cx: number, cy: number) => void
  /** Smooth scaling for detailed images; off keeps one-pixel-per-tile images crisp. */
  smooth?: boolean
  className?: string
}) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  const longest = 148
  const ratio = contentWidth / contentHeight
  const w = Math.round(ratio >= 1 ? longest : longest * ratio)
  const h = Math.round(ratio >= 1 ? longest / ratio : longest)

  React.useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.imageSmoothingEnabled = smooth
    if (image) ctx.drawImage(image, 0, 0, w, h)
    const k = w / contentWidth
    const x = (-view.x / view.scale) * k
    const y = (-view.y / view.scale) * k
    const vw = (size.width / view.scale) * k
    const vh = (size.height / view.scale) * k
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    // Darken everything outside the viewport rectangle.
    ctx.beginPath()
    ctx.rect(0, 0, w, h)
    ctx.rect(x, y, vw, vh)
    ctx.fill('evenodd')
    ctx.strokeStyle = '#fde68a'
    ctx.lineWidth = 1.5
    ctx.strokeRect(x + 0.75, y + 0.75, Math.max(2, vw - 1.5), Math.max(2, vh - 1.5))
  }, [image, w, h, contentWidth, view, size, smooth])

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    onCentre(
      ((e.clientX - rect.left) / rect.width) * contentWidth,
      ((e.clientY - rect.top) / rect.height) * contentHeight,
    )
  }

  return (
    <canvas
      ref={ref}
      aria-label="Overview map"
      className={cn(
        'cursor-pointer rounded-md border border-white/20 bg-black/60 shadow-md',
        className,
      )}
      style={{ width: w, height: h, touchAction: 'none' }}
      onPointerDown={(e) => {
        e.stopPropagation()
        e.currentTarget.setPointerCapture(e.pointerId)
        move(e)
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e)
      }}
      onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  )
}

/** One-line reminder of what the mouse and keyboard do, shown on focus or hover. */
export function MapHint({
  children,
  className,
}: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'pointer-events-none rounded bg-background/75 px-2 py-1 text-[11px] text-muted-foreground backdrop-blur',
        className,
      )}
    >
      {children}
    </div>
  )
}
