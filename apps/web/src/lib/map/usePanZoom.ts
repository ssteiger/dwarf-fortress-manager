import * as React from 'react'

/** Screen = content * scale + offset. `scale` is CSS pixels per content unit (a tile). */
export interface View {
  scale: number
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface PanZoomOptions {
  /** Content size in content units. */
  width: number
  height: number
  /** Largest zoom, in CSS pixels per content unit. */
  maxScale: number
  /** First view once the viewport has a size. Defaults to fitting everything. */
  initialView?: (size: Size, fit: View) => View
  /** A press that did not turn into a drag, in client coordinates. */
  onTap?: (clientX: number, clientY: number) => void
  /**
   * `modifier` leaves plain scrolling to the page and zooms only with ctrl or
   * cmd held (trackpad pinches count), for maps embedded in longer pages.
   */
  wheel?: 'always' | 'modifier'
}

const DRAG_THRESHOLD = 4
const ZOOM_STEP = 1.6
/** Velocity decay per second after a fling. */
const FRICTION = 5
const MIN_FLING_SPEED = 80
const KEY_PAN = 120

export function fitView(size: Size, width: number, height: number): View {
  const scale = Math.max(Math.min(size.width / width, size.height / height), 0.05)
  return {
    scale,
    x: (size.width - width * scale) / 2,
    y: (size.height - height * scale) / 2,
  }
}

/** Zoom by `factor`, keeping the screen point (px, py) over the same spot of content. */
export function zoomAt(view: View, factor: number, px: number, py: number): View {
  const scale = view.scale * factor
  return {
    scale,
    x: px - (px - view.x) * factor,
    y: py - (py - view.y) * factor,
  }
}

/** A view that centres content point (cx, cy) at `scale`. */
export function centredView(size: Size, cx: number, cy: number, scale: number): View {
  return { scale, x: size.width / 2 - cx * scale, y: size.height / 2 - cy * scale }
}

type Gesture =
  | {
      kind: 'drag'
      startX: number
      startY: number
      origin: View
      moved: boolean
      samples: { t: number; x: number; y: number }[]
    }
  | { kind: 'pinch'; startDistance: number; startCentre: { x: number; y: number }; origin: View }

/**
 * Pan and zoom for a canvas showing content in tile units. Wheel and
 * trackpad pinch zoom around the cursor, drags pan with momentum, two
 * fingers pinch, double-click zooms in (shift: out), and the keyboard does
 * + - 0 and the arrows. Button and keyboard zooms animate.
 */
export function usePanZoom(options: PanZoomOptions) {
  const optionsRef = React.useRef(options)
  optionsRef.current = options

  const containerRef = React.useRef<HTMLDivElement>(null)
  const [size, setSize] = React.useState<Size>({ width: 0, height: 0 })
  const sizeRef = React.useRef(size)
  const [view, setViewState] = React.useState<View | null>(null)
  const viewRef = React.useRef<View | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const [wheelHint, setWheelHint] = React.useState(false)
  const frame = React.useRef<number | null>(null)
  const pointers = React.useRef(new Map<number, { x: number; y: number }>())
  const gesture = React.useRef<Gesture | null>(null)

  const clamp = React.useCallback((v: View, s: Size = sizeRef.current): View => {
    const { width, height, maxScale } = optionsRef.current
    const fit = fitView(s, width, height)
    const scale = Math.min(Math.max(v.scale, fit.scale * 0.5), Math.max(maxScale, fit.scale))
    const mapW = width * scale
    const mapH = height * scale
    // Some slack past the edges, never enough to lose the map.
    const slackX = Math.min(s.width * 0.3, 160)
    const slackY = Math.min(s.height * 0.3, 160)
    const x = Math.min(
      Math.max(v.x, Math.min(0, s.width - mapW) - slackX),
      Math.max(0, s.width - mapW) + slackX,
    )
    const y = Math.min(
      Math.max(v.y, Math.min(0, s.height - mapH) - slackY),
      Math.max(0, s.height - mapH) + slackY,
    )
    return { scale, x, y }
  }, [])

  const commit = React.useCallback(
    (next: View) => {
      const clamped = clamp(next)
      viewRef.current = clamped
      setViewState(clamped)
      return clamped
    },
    [clamp],
  )

  const stop = React.useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
  }, [])

  const animate = React.useCallback(
    (step: (t: number) => View, duration: number) => {
      stop()
      const start = performance.now()
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration)
        commit(step(1 - (1 - t) ** 3))
        frame.current = t < 1 ? requestAnimationFrame(tick) : null
      }
      frame.current = requestAnimationFrame(tick)
    },
    [commit, stop],
  )

  /** Animated zoom by `factor` around a point in container coordinates. */
  const zoomAround = React.useCallback(
    (factor: number, px: number, py: number) => {
      const from = viewRef.current
      if (!from) return
      const target = clamp(zoomAt(from, factor, px, py))
      const actual = target.scale / from.scale
      animate((t) => zoomAt(from, actual ** t, px, py), 240)
    },
    [animate, clamp],
  )

  /** Animated move to any view (scale eases geometrically, the offset linearly). */
  const flyTo = React.useCallback(
    (target: View) => {
      const from = viewRef.current
      if (!from) {
        commit(target)
        return
      }
      const to = clamp(target)
      animate(
        (t) => ({
          scale: from.scale * (to.scale / from.scale) ** t,
          x: from.x + (to.x - from.x) * t,
          y: from.y + (to.y - from.y) * t,
        }),
        340,
      )
    },
    [animate, clamp, commit],
  )

  const fit = React.useCallback(() => {
    const { width, height } = optionsRef.current
    flyTo(fitView(sizeRef.current, width, height))
  }, [flyTo])

  const zoomBy = React.useCallback(
    (factor: number) => zoomAround(factor, sizeRef.current.width / 2, sizeRef.current.height / 2),
    [zoomAround],
  )

  const panBy = React.useCallback(
    (dx: number, dy: number) => {
      const from = viewRef.current
      if (!from) return
      animate((t) => ({ ...from, x: from.x + dx * t, y: from.y + dy * t }), 180)
    },
    [animate],
  )

  /** Jump (no animation) so that content point (cx, cy) is centred; for minimap drags. */
  const centreOn = React.useCallback(
    (cx: number, cy: number) => {
      const current = viewRef.current
      if (!current) return
      stop()
      commit(centredView(sizeRef.current, cx, cy, current.scale))
    },
    [commit, stop],
  )

  // Viewport size; the first measurement sets the initial view.
  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry?.contentRect
      if (!rect || rect.width === 0 || rect.height === 0) return
      const next = { width: rect.width, height: rect.height }
      sizeRef.current = next
      setSize(next)
      const { width, height, initialView } = optionsRef.current
      if (!viewRef.current) {
        const fitted = fitView(next, width, height)
        commit(initialView ? initialView(next, fitted) : fitted)
      } else {
        commit(viewRef.current)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [commit])

  // Wheel zoom must be a non-passive native listener to keep the page from scrolling.
  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let hintTimer: ReturnType<typeof setTimeout> | undefined
    const onWheel = (e: WheelEvent) => {
      const current = viewRef.current
      if (!current) return
      if (optionsRef.current.wheel === 'modifier' && !e.ctrlKey && !e.metaKey) {
        setWheelHint(true)
        clearTimeout(hintTimer)
        hintTimer = setTimeout(() => setWheelHint(false), 1400)
        return
      }
      e.preventDefault()
      stop()
      const rect = el.getBoundingClientRect()
      // Trackpad pinches arrive as ctrl+wheel with small deltas; mouse wheels
      // in line mode are large. Both zoom around the cursor.
      const delta = e.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? e.deltaY : e.deltaY * 16
      const speed = e.ctrlKey ? 0.01 : 0.002
      commit(zoomAt(current, Math.exp(-delta * speed), e.clientX - rect.left, e.clientY - rect.top))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      clearTimeout(hintTimer)
      el.removeEventListener('wheel', onWheel)
    }
  }, [commit, stop])

  React.useEffect(() => stop, [stop])

  const local = (clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) }
  }

  const startDrag = (clientX: number, clientY: number) => {
    const origin = viewRef.current
    if (!origin) return
    gesture.current = {
      kind: 'drag',
      startX: clientX,
      startY: clientY,
      origin,
      moved: false,
      samples: [{ t: performance.now(), x: clientX, y: clientY }],
    }
  }

  const startPinch = () => {
    const origin = viewRef.current
    const [a, b] = [...pointers.current.values()]
    if (!origin || !a || !b) return
    const centre = local((a.x + b.x) / 2, (a.y + b.y) / 2)
    gesture.current = {
      kind: 'pinch',
      startDistance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      startCentre: centre,
      origin,
    }
    setDragging(true)
  }

  const fling = (samples: { t: number; x: number; y: number }[]) => {
    const now = performance.now()
    const recent = samples.filter((s) => now - s.t < 100)
    if (recent.length < 2) return
    const first = recent[0]
    const last = recent[recent.length - 1]
    const dt = Math.max(0.016, (last.t - first.t) / 1000)
    let vx = (last.x - first.x) / dt
    let vy = (last.y - first.y) / dt
    if (Math.hypot(vx, vy) < MIN_FLING_SPEED) return
    stop()
    let prev = now
    const tick = (t: number) => {
      const current = viewRef.current
      if (!current) return
      const step = Math.min(0.05, (t - prev) / 1000)
      prev = t
      const next = commit({ ...current, x: current.x + vx * step, y: current.y + vy * step })
      // Stop sliding along an edge the view is pinned to.
      if (Math.abs(next.x - (current.x + vx * step)) > 0.5) vx = 0
      if (Math.abs(next.y - (current.y + vy * step)) > 0.5) vy = 0
      const decay = Math.exp(-FRICTION * step)
      vx *= decay
      vy *= decay
      frame.current = Math.hypot(vx, vy) > 12 ? requestAnimationFrame(tick) : null
    }
    frame.current = requestAnimationFrame(tick)
  }

  const handlers = {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      stop()
      e.currentTarget.setPointerCapture(e.pointerId)
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.current.size === 1) startDrag(e.clientX, e.clientY)
      else if (pointers.current.size === 2) startPinch()
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      if (!pointers.current.has(e.pointerId)) return
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      const g = gesture.current
      if (!g) return
      if (g.kind === 'pinch') {
        const [a, b] = [...pointers.current.values()]
        if (!a || !b) return
        const centre = local((a.x + b.x) / 2, (a.y + b.y) / 2)
        const factor = Math.hypot(a.x - b.x, a.y - b.y) / g.startDistance
        const zoomed = zoomAt(g.origin, factor, g.startCentre.x, g.startCentre.y)
        commit({
          ...zoomed,
          x: zoomed.x + centre.x - g.startCentre.x,
          y: zoomed.y + centre.y - g.startCentre.y,
        })
        return
      }
      const dx = e.clientX - g.startX
      const dy = e.clientY - g.startY
      if (!g.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      if (!g.moved) {
        g.moved = true
        setDragging(true)
      }
      g.samples.push({ t: performance.now(), x: e.clientX, y: e.clientY })
      if (g.samples.length > 12) g.samples.shift()
      commit({ ...g.origin, x: g.origin.x + dx, y: g.origin.y + dy })
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      if (!pointers.current.has(e.pointerId)) return
      pointers.current.delete(e.pointerId)
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }
      const g = gesture.current
      if (g?.kind === 'pinch') {
        // One finger left: carry on as a drag from where it is.
        const [rest] = [...pointers.current.values()]
        if (rest) startDrag(rest.x, rest.y)
        else {
          gesture.current = null
          setDragging(false)
        }
        return
      }
      gesture.current = null
      setDragging(false)
      if (!g) return
      if (!g.moved) optionsRef.current.onTap?.(e.clientX, e.clientY)
      else fling(g.samples)
    },
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => {
      pointers.current.delete(e.pointerId)
      if (pointers.current.size === 0) {
        gesture.current = null
        setDragging(false)
      }
    },
    onDoubleClick: (e: React.MouseEvent<HTMLElement>) => {
      const p = local(e.clientX, e.clientY)
      zoomAround(e.shiftKey ? 1 / 2 : 2, p.x, p.y)
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      const key = e.key
      if (key === '+' || key === '=') zoomBy(ZOOM_STEP)
      else if (key === '-' || key === '_') zoomBy(1 / ZOOM_STEP)
      else if (key === '0') fit()
      else if (key === 'ArrowLeft') panBy(KEY_PAN, 0)
      else if (key === 'ArrowRight') panBy(-KEY_PAN, 0)
      else if (key === 'ArrowUp') panBy(0, KEY_PAN)
      else if (key === 'ArrowDown') panBy(0, -KEY_PAN)
      else return
      e.preventDefault()
    },
  }

  const fitScale =
    size.width > 0 ? fitView(size, options.width, options.height).scale : (view?.scale ?? 1)

  return {
    containerRef,
    size,
    view,
    dragging,
    /** Briefly true after plain scrolling over a `modifier` map, to say how to zoom. */
    wheelHint,
    handlers,
    /** True while a finger or button is down on the map. */
    isPressed: () => pointers.current.size > 0,
    zoomBy,
    zoomIn: () => zoomBy(ZOOM_STEP),
    zoomOut: () => zoomBy(1 / ZOOM_STEP),
    fit,
    flyTo,
    centreOn,
    fitScale,
    zoomPercent: view ? Math.round((view.scale / fitScale) * 100) : 100,
  }
}
