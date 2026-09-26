import { cn } from '@fortress/ui'
import * as React from 'react'

import { type EdgeDwarf, EdgeDwarves } from '~/lib/components/EdgeDwarves'
import { type DfAssetIndex, type SpriteSheets, useDfAssets, useSpriteSheets } from '~/lib/df-assets'
import { CreatureSprite } from '~/lib/df-assets/components'
import { usePrefersReducedMotion } from '~/lib/utils/usePrefersReducedMotion'
import {
  FIRE_FRAMES,
  FIRE_TOP_FRAMES,
  type Layout,
  TILE,
  VEIN_COLORS,
  drawFrame,
  drawScene,
  scenePages,
} from './draw'
import { SCENE_DWARVES, type SceneDwarf } from './dwarves'
import sceneCss from './fortress-scene.css?url'
import {
  type Pos,
  type SceneMap,
  buildMap,
  diggable,
  findPath,
  hash,
  idx,
  isFloor,
  isWalkable,
  randomHallCell,
  workSpots,
} from './map'

function SceneStyles() {
  return <link rel="stylesheet" href={sceneCss} precedence="default" />
}

// ---------------------------------------------------------------------------
// The expedition: dwarves wandering the hall one tile at a time, the miner
// cutting new tunnels, now and then someone heading off down the tunnel

type Mode = 'idle' | 'walk' | 'mine' | 'away'
type Goal = 'wander' | 'fire' | 'exit' | 'dig'

interface Actor {
  dwarf: SceneDwarf
  pos: Pos
  path: Pos[]
  goal: Goal
  mode: Mode
  nextAt: number
  stepMs: number
  blocked: number
  target: Pos | null
  mineUntil: number
}

const MAX_DIGS = 16

function spawnChips(layer: HTMLElement, from: Pos, at: Pos, layout: Layout, color: string) {
  // Chips fly off the face of the rock the miner is hitting.
  const x = layout.ox + (at.c + 0.5) * TILE - (at.c - from.c) * TILE * 0.4
  const y = layout.oy + (at.r + 0.5) * TILE - (at.r - from.r) * TILE * 0.4
  for (let i = 0; i < 5; i++) {
    const chip = document.createElement('span')
    const size = 3 + Math.round(Math.random() * 3)
    const spread = (Math.random() - 0.5) * TILE * 0.9
    chip.className = 'scene-chip pointer-events-none absolute'
    chip.style.cssText = [
      `left:${x}px`,
      `top:${y}px`,
      `width:${size}px`,
      `height:${size}px`,
      `background:${color}`,
      `--chip-x:${(from.c - at.c) * TILE * 0.35 + spread}px`,
      `--chip-up:${-TILE * (0.25 + Math.random() * 0.25)}px`,
      `--chip-down:${TILE * (0.2 + Math.random() * 0.2)}px`,
      `--chip-r:${Math.round((Math.random() - 0.5) * 540)}deg`,
    ].join(';')
    chip.addEventListener('animationend', () => chip.remove())
    layer.appendChild(chip)
  }
}

function useExpedition({
  map,
  layout,
  cast,
  enabled,
  animate,
  actorEls,
  hopEls,
  chipLayer,
  onDig,
}: {
  map: SceneMap | null
  layout: Layout
  cast: SceneDwarf[]
  enabled: boolean
  animate: boolean
  actorEls: React.RefObject<(HTMLDivElement | null)[]>
  hopEls: React.RefObject<(HTMLDivElement | null)[]>
  chipLayer: React.RefObject<HTMLDivElement | null>
  onDig: () => void
}) {
  const onDigRef = React.useRef(onDig)
  onDigRef.current = onDig

  React.useEffect(() => {
    if (!enabled || !map) return
    const { ox, oy } = layout
    const taken = new Set<number>()
    const actors: Actor[] = []
    for (const dwarf of cast) {
      const pos = randomHallCell(map, taken)
      if (!pos) break
      taken.add(idx(map, pos.c, pos.r))
      actors.push({
        dwarf,
        pos,
        path: [],
        goal: 'wander',
        mode: 'idle',
        nextAt: performance.now() + 400 + Math.random() * 2400,
        stepMs: 230 + Math.random() * 110,
        blocked: 0,
        target: null,
        mineUntil: 0,
      })
    }

    const place = (i: number, ms: number) => {
      const el = actorEls.current?.[i]
      if (!el) return
      const { c, r } = actors[i].pos
      el.style.transition = ms
        ? `transform ${ms}ms linear, opacity 320ms ease`
        : 'opacity 320ms ease'
      el.style.transform = `translate3d(${ox + c * TILE}px, ${oy + r * TILE}px, 0)`
      el.style.zIndex = String(10 + r)
    }
    const show = (i: number, visible: boolean) => {
      const el = actorEls.current?.[i]
      if (el) el.style.opacity = visible ? '1' : '0'
    }
    const hop = (i: number, ms: number) => {
      hopEls.current?.[i]?.animate(
        [
          { transform: 'translateY(0)' },
          { transform: `translateY(${-TILE * 0.09}px)`, offset: 0.45 },
          { transform: 'translateY(0)' },
        ],
        { duration: ms, easing: 'ease-out' },
      )
    }
    const strike = (i: number, toward: Pos) => {
      const { pos } = actors[i]
      const dx = Math.sign(toward.c - pos.c) * TILE * 0.1
      const dy = Math.sign(toward.r - pos.r) * TILE * 0.1
      hopEls.current?.[i]?.animate(
        [
          { transform: 'translate(0, 0)' },
          { transform: `translate(${-dx * 0.4}px, ${-dy * 0.4 - TILE * 0.04}px)`, offset: 0.35 },
          { transform: `translate(${dx}px, ${dy}px)`, offset: 0.6 },
          { transform: 'translate(0, 0)' },
        ],
        { duration: 360, easing: 'ease-in-out' },
      )
    }

    actors.forEach((_, i) => {
      place(i, 0)
      show(i, true)
    })
    if (!animate) return

    let digs = 0
    const occupied = (pos: Pos, self: Actor) =>
      actors.some((a) => a !== self && a.mode !== 'away' && a.pos.c === pos.c && a.pos.r === pos.r)
    const awayCount = () => actors.filter((a) => a.mode === 'away' || a.goal === 'exit').length

    const planDig = (actor: Actor): boolean => {
      if (digs >= MAX_DIGS) return false
      const options = diggable(map)
        .map((cell) => ({
          cell,
          weight: (map.veins.has(idx(map, cell.c, cell.r)) ? 2 : 0) + Math.random(),
        }))
        .sort((a, b) => b.weight - a.weight)
      for (const { cell } of options.slice(0, 6)) {
        for (const spot of workSpots(map, cell)) {
          const path = findPath(map, actor.pos, spot)
          if (path) {
            actor.path = path
            actor.goal = 'dig'
            actor.target = cell
            return true
          }
        }
      }
      return false
    }

    const planWalk = (actor: Actor, goal: Goal, to: Pos | null): boolean => {
      if (!to) return false
      const path = findPath(map, actor.pos, to)
      if (!path?.length) return false
      actor.path = path
      actor.goal = goal
      actor.target = null
      return true
    }

    const decide = (actor: Actor, now: number) => {
      const roll = Math.random()
      const miner = actor.dwarf.profession === 'MINER'
      let planned = false
      if (miner && roll < 0.6) planned = planDig(actor)
      else if (!miner && roll < 0.1 && awayCount() < 2) planned = planWalk(actor, 'exit', map.exit)
      else if (roll < 0.35) {
        const seats = workSpots(map, map.fire).filter((p) => !occupied(p, actor))
        planned = planWalk(actor, 'fire', seats[Math.floor(Math.random() * seats.length)] ?? null)
      }
      if (!planned) {
        const taken = new Set(
          actors.filter((a) => a !== actor).map((a) => idx(map, a.pos.c, a.pos.r)),
        )
        planned = planWalk(actor, 'wander', randomHallCell(map, taken))
      }
      actor.mode = planned ? 'walk' : 'idle'
      actor.nextAt = now + (planned ? 0 : 1200)
    }

    const tick = () => {
      if (document.hidden) return
      const now = performance.now()
      actors.forEach((actor, i) => {
        if (now < actor.nextAt) return
        switch (actor.mode) {
          case 'idle':
            decide(actor, now)
            return
          case 'away': {
            if (occupied(map.exit, actor)) {
              actor.nextAt = now + 600
              return
            }
            actor.pos = { ...map.exit }
            place(i, 0)
            show(i, true)
            actor.mode = 'idle'
            actor.goal = 'wander'
            actor.nextAt = now + 350
            return
          }
          case 'mine': {
            const target = actor.target
            if (!target || isFloor(map, target.c, target.r)) {
              actor.mode = 'idle'
              actor.nextAt = now + 800
              return
            }
            if (now >= actor.mineUntil) {
              map.floor[idx(map, target.c, target.r)] = 1
              map.veins.delete(idx(map, target.c, target.r))
              digs++
              onDigRef.current()
              actor.mode = 'idle'
              actor.target = null
              actor.nextAt = now + 900 + Math.random() * 1200
              return
            }
            strike(i, target)
            const layer = chipLayer.current
            const vein = map.veins.get(idx(map, target.c, target.r))
            if (layer)
              spawnChips(layer, actor.pos, target, layout, vein ? VEIN_COLORS[vein] : '#a8998a')
            actor.nextAt = now + 460
            return
          }
          case 'walk': {
            const next = actor.path[0]
            if (!next) {
              if (actor.goal === 'exit') {
                show(i, false)
                actor.mode = 'away'
                actor.nextAt = now + 4000 + Math.random() * 6000
              } else if (actor.goal === 'dig' && actor.target) {
                actor.mode = 'mine'
                actor.mineUntil = now + 2400 + Math.random() * 1600
                actor.nextAt = now + 200
              } else {
                actor.mode = 'idle'
                actor.nextAt = now + (actor.goal === 'fire' ? 3500 : 900) + Math.random() * 2600
              }
              return
            }
            if (!isWalkable(map, next.c, next.r) || occupied(next, actor)) {
              actor.blocked++
              actor.nextAt = now + 260
              if (actor.blocked > 5) {
                actor.blocked = 0
                actor.path = []
                actor.mode = 'idle'
              }
              return
            }
            actor.blocked = 0
            actor.pos = next
            actor.path.shift()
            place(i, actor.stepMs)
            hop(i, actor.stepMs)
            actor.nextAt = now + actor.stepMs
            return
          }
        }
      })
    }

    const timer = setInterval(tick, 50)
    return () => clearInterval(timer)
  }, [enabled, animate, map, layout, cast, actorEls, hopEls, chipLayer])
}

// ---------------------------------------------------------------------------
// Pieces

function AnimatedTile({
  index,
  sheets,
  frames,
  animate,
  interval = 150,
  className,
  style,
}: {
  index: DfAssetIndex
  sheets: SpriteSheets
  frames: string[]
  animate: boolean
  interval?: number
  className?: string
  style?: React.CSSProperties
}) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  React.useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(TILE * dpr)
    canvas.height = Math.round(TILE * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    let frame = 0
    drawFrame(ctx, index, sheets, frames[0])
    if (!animate) return
    const timer = setInterval(() => {
      frame = (frame + 1) % frames.length
      drawFrame(ctx, index, sheets, frames[frame])
    }, interval)
    return () => clearInterval(timer)
  }, [index, sheets, frames, animate, interval])
  return (
    <canvas
      ref={ref}
      className={cn('pointer-events-none absolute', className)}
      style={{ width: TILE, height: TILE, imageRendering: 'pixelated', ...style }}
    />
  )
}

const DUST = Array.from({ length: 22 }, (_, i) => ({
  left: `${Math.round(hash(i, 1, 40) * 100)}%`,
  top: `${55 + Math.round(hash(i, 2, 40) * 45)}%`,
  size: 1.5 + hash(i, 3, 40) * 2.5,
  duration: `${10 + hash(i, 4, 40) * 12}s`,
  delay: `${-hash(i, 5, 40) * 22}s`,
  drift: `${Math.round((hash(i, 6, 40) - 0.5) * 80)}px`,
  opacity: 0.25 + hash(i, 7, 40) * 0.5,
}))

// ---------------------------------------------------------------------------

/**
 * The sign-in artwork: a small fortress drawn with the game's own sprites,
 * where an expedition goes about its business. Without extracted sprites
 * only the cave light and dust play over a plain backdrop.
 */
export function FortressScene() {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const chipLayer = React.useRef<HTMLDivElement>(null)
  const actorEls = React.useRef<(HTMLDivElement | null)[]>([])
  const hopEls = React.useRef<(HTMLDivElement | null)[]>([])

  const reducedMotion = usePrefersReducedMotion()
  const index = useDfAssets()
  const pages = React.useMemo(() => (index ? scenePages(index) : []), [index])
  const sheets = useSpriteSheets(index, pages)
  const ready = !!index && !!sheets && sheets.size > 0

  const [size, setSize] = React.useState({ w: 0, h: 0 })
  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize((prev) =>
        prev.w === Math.round(width) && prev.h === Math.round(height)
          ? prev
          : { w: Math.round(width), h: Math.round(height) },
      )
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const cols = Math.ceil(size.w / TILE)
  const rows = Math.ceil(size.h / TILE)
  const [map, setMap] = React.useState<SceneMap | null>(null)
  const [mapVersion, setMapVersion] = React.useState(0)
  React.useEffect(() => {
    setMap(cols >= 6 && rows >= 9 ? buildMap(cols, rows) : null)
  }, [cols, rows])

  const layout = React.useMemo<Layout>(
    () => ({ ox: Math.floor((size.w - cols * TILE) / 2), oy: size.h - rows * TILE }),
    [size.w, size.h, cols, rows],
  )

  const cast = React.useMemo(() => {
    if (!map) return []
    let open = 0
    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) if (isWalkable(map, c, r)) open++
    }
    return SCENE_DWARVES.slice(0, Math.min(SCENE_DWARVES.length, Math.max(3, Math.floor(open / 4))))
  }, [map])

  // biome-ignore lint/correctness/useExhaustiveDependencies: mapVersion marks in-place digs
  React.useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !ready || !map || !index || !sheets) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.w * dpr)
    canvas.height = Math.round(size.h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)
    drawScene(ctx, index, sheets, map, layout)
  }, [ready, index, sheets, map, mapVersion, layout, size.w, size.h])

  const onDig = React.useCallback(() => setMapVersion((v) => v + 1), [])

  useExpedition({
    map,
    layout,
    cast,
    enabled: ready,
    animate: !reducedMotion,
    actorEls,
    hopEls,
    chipLayer,
    onDig,
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: mapVersion marks in-place digs
  const sparkles = React.useMemo(() => {
    if (!map) return []
    const out: { x: number; y: number; color: string; delay: string; duration: string }[] = []
    for (const [cell, vein] of map.veins) {
      const c = cell % map.cols
      const r = Math.floor(cell / map.cols)
      const visible =
        isFloor(map, c + 1, r) ||
        isFloor(map, c - 1, r) ||
        isFloor(map, c, r + 1) ||
        isFloor(map, c, r - 1)
      if (!visible) continue
      out.push({
        x: layout.ox + (c + 0.25 + hash(c, r, 30) * 0.5) * TILE,
        y: layout.oy + (r + 0.25 + hash(c, r, 31) * 0.5) * TILE,
        color: VEIN_COLORS[vein],
        delay: `${hash(c, r, 32) * 4}s`,
        duration: `${2.6 + hash(c, r, 33) * 2}s`,
      })
    }
    return out.slice(0, 8)
  }, [map, mapVersion, layout])

  const fire = map
    ? { x: layout.ox + (map.fire.c + 0.5) * TILE, y: layout.oy + (map.fire.r + 0.5) * TILE }
    : { x: size.w / 2, y: size.h * 0.68 }
  const reach = Math.max(size.w, size.h)

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-[#0e0c0d]">
      <SceneStyles />
      {/* Backdrop for when the sprites are not extracted. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_70%,#3a2a1e_0%,#1a1413_40%,#0e0c0d_75%)]"
      />
      <canvas
        ref={canvasRef}
        aria-hidden
        className="absolute inset-0 h-full w-full"
        style={{ imageRendering: 'pixelated' }}
      />

      {ready && map && index && sheets ? (
        <div aria-hidden className="absolute inset-0">
          <AnimatedTile
            index={index}
            sheets={sheets}
            frames={FIRE_FRAMES}
            animate={!reducedMotion}
            style={{
              left: layout.ox + map.fire.c * TILE,
              top: layout.oy + map.fire.r * TILE,
              zIndex: 10 + map.fire.r,
            }}
          />
          <AnimatedTile
            index={index}
            sheets={sheets}
            frames={FIRE_TOP_FRAMES}
            animate={!reducedMotion}
            interval={170}
            style={{
              left: layout.ox + map.fire.c * TILE,
              top: layout.oy + (map.fire.r - 1) * TILE,
              zIndex: 10 + map.fire.r,
            }}
          />
          {cast.map((dwarf, i) => (
            <div
              key={dwarf.name}
              ref={(el) => {
                actorEls.current[i] = el
              }}
              className="absolute top-0 left-0 opacity-0"
              style={{ width: TILE, height: TILE, willChange: 'transform' }}
            >
              <div
                ref={(el) => {
                  hopEls.current[i] = el
                }}
                className="flex h-full w-full items-end justify-center"
              >
                <CreatureSprite
                  unit={dwarf.unit}
                  size={TILE}
                  className="drop-shadow-[0_2px_2px_rgba(0,0,0,0.5)]"
                />
              </div>
            </div>
          ))}
          <div ref={chipLayer} className="absolute inset-0" style={{ zIndex: 200 }} />
        </div>
      ) : null}

      {/* Torchlight: darkness falls off from the campfire, and the flame breathes. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          zIndex: 300,
          background: `radial-gradient(circle at ${fire.x}px ${fire.y}px, rgba(14,10,8,0) ${TILE * 1.3}px, rgba(14,10,8,0.3) ${TILE * 2.8}px, rgba(14,10,8,0.7) ${TILE * 5.5}px, rgba(14,10,8,0.9) ${reach * 0.8}px)`,
        }}
      />
      <div
        aria-hidden
        className="scene-flicker pointer-events-none absolute inset-0 mix-blend-screen"
        style={{
          zIndex: 301,
          transformOrigin: `${fire.x}px ${fire.y}px`,
          background: `radial-gradient(circle at ${fire.x}px ${fire.y}px, rgba(255,150,70,0.3) 0, rgba(255,120,40,0.12) ${TILE * 1.8}px, rgba(255,120,40,0) ${TILE * 3.6}px)`,
        }}
      />
      {sparkles.map((s) => (
        <span
          key={`${s.x}-${s.y}`}
          aria-hidden
          className="scene-sparkle pointer-events-none absolute size-2 opacity-0"
          style={
            {
              zIndex: 302,
              left: s.x,
              top: s.y,
              background: `radial-gradient(circle, #fff 0, ${s.color} 40%, transparent 70%)`,
              '--sparkle-delay': s.delay,
              '--sparkle-duration': s.duration,
            } as React.CSSProperties
          }
        />
      ))}
      {DUST.map((d, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative list
          key={i}
          aria-hidden
          className="scene-dust pointer-events-none absolute rounded-full bg-amber-200"
          style={
            {
              zIndex: 303,
              left: d.left,
              top: d.top,
              width: d.size,
              height: d.size,
              opacity: d.opacity,
              '--dust-duration': d.duration,
              '--dust-delay': d.delay,
              '--dust-drift': d.drift,
              '--dust-opacity': d.opacity,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}

const EXPEDITION_AT_THE_EDGE: EdgeDwarf[] = SCENE_DWARVES.map((d) => ({
  key: d.name,
  unit: d.unit,
}))

/** The expedition wandering along the bottom of the window, unnamed like the artwork. */
export function ExpeditionEdgeDwarves() {
  return <EdgeDwarves dwarves={EXPEDITION_AT_THE_EDGE} showNames={false} />
}

/** The expedition in a row, for small screens where the artwork is hidden. */
export function DwarfRow({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('flex items-end gap-1', className)}>
      <SceneStyles />
      {SCENE_DWARVES.map((dwarf, i) => (
        <div
          key={dwarf.name}
          className="scene-bob"
          style={{ '--bob-delay': `${i * -0.2}s` } as React.CSSProperties}
        >
          <CreatureSprite unit={dwarf.unit} size={32} />
        </div>
      ))}
    </div>
  )
}
