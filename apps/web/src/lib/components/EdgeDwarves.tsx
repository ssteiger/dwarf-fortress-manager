import * as React from 'react'

import type { SpriteUnit } from '~/lib/df-assets'
import { CreatureSprite, type LookUnitProps } from '~/lib/df-assets/components'
import { usePrefersReducedMotion } from '~/lib/utils/usePrefersReducedMotion'

export interface EdgeDwarf {
  key: string | number
  name?: string
  unit: LookUnitProps & SpriteUnit
}

/*
 * Dwarves pottering along the bottom of the window. The cursor never lands on
 * them (they take no pointer events, so nothing underneath is blocked); its
 * path is tested against them instead. A slow brush knocks a dwarf over, a
 * fast swipe sends it flying with the cursor's speed. Downed dwarves lie
 * there a moment, then get back up and carry on.
 */

const GRAVITY = 2600
const FLICK_SPEED = 520
const MAX_LAUNCH = 2400
const WALL_BOUNCE = 0.55
const FLOOR_BOUNCE = 0.35
const FLOOR_FRICTION = 2200
const HIT_COOLDOWN_MS = 140
const RISE_MS = 450

type Mode = 'walk' | 'idle' | 'air' | 'down' | 'rise'

interface Body {
  x: number
  /** Feet, in viewport pixels. */
  y: number
  vx: number
  vy: number
  angle: number
  spin: number
  /** Angle to settle at while down: a quarter turn either way. */
  lie: number
  /** Lying sprites sit lower so the body, not the sprite box, rests on the floor. */
  drop: number
  mode: Mode
  dir: 1 | -1
  speed: number
  until: number
  phase: number
  hitAt: number
  riseFrom: number
}

interface Els {
  outer: HTMLDivElement | null
  inner: HTMLDivElement | null
  label: HTMLDivElement | null
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function normalize(angle: number): number {
  const turn = Math.PI * 2
  return ((((angle + Math.PI) % turn) + turn) % turn) - Math.PI
}

function spawn(width: number, ground: number, now: number): Body {
  return {
    x: 40 + Math.random() * Math.max(0, width - 80),
    y: ground,
    vx: 0,
    vy: 0,
    angle: 0,
    spin: 0,
    lie: 0,
    drop: 0,
    mode: 'walk',
    dir: Math.random() < 0.5 ? -1 : 1,
    speed: 16 + Math.random() * 18,
    until: now + 2000 + Math.random() * 6000,
    phase: Math.random() * 10,
    hitAt: 0,
    riseFrom: 0,
  }
}

function startWalking(b: Body, now: number) {
  b.mode = 'walk'
  b.dir = Math.random() < 0.5 ? -1 : 1
  b.until = now + 2500 + Math.random() * 6000
}

function land(b: Body, now: number) {
  b.angle = normalize(b.angle)
  b.vy = 0
  b.spin = 0
  if (Math.abs(b.angle) < 0.3) {
    // Stuck the landing.
    b.angle = 0
    b.vx = 0
    b.mode = 'idle'
    b.until = now + 700
    return
  }
  b.lie = b.angle >= 0 ? Math.PI / 2 : -Math.PI / 2
  b.mode = 'down'
  b.until = now + 1400 + Math.random() * 1800
}

function step(b: Body, dt: number, now: number, width: number, ground: number, size: number) {
  const half = size * 0.3
  switch (b.mode) {
    case 'walk': {
      b.y = ground
      b.x += b.dir * b.speed * dt
      b.phase += (dt * b.speed) / 7
      if (b.x < half) {
        b.x = half
        b.dir = 1
      } else if (b.x > width - half) {
        b.x = width - half
        b.dir = -1
      }
      if (now > b.until) {
        if (Math.random() < 0.45) {
          b.mode = 'idle'
          b.until = now + 800 + Math.random() * 2400
        } else {
          b.dir = b.dir === 1 ? -1 : 1
          b.until = now + 2500 + Math.random() * 6000
        }
      }
      break
    }
    case 'idle': {
      b.y = ground
      b.angle += (0 - b.angle) * Math.min(1, dt * 12)
      if (now > b.until) startWalking(b, now)
      break
    }
    case 'air': {
      b.vy += GRAVITY * dt
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.angle += b.spin * dt
      if (b.x < half) {
        b.x = half
        b.vx = Math.abs(b.vx) * WALL_BOUNCE
        b.spin *= -0.6
      } else if (b.x > width - half) {
        b.x = width - half
        b.vx = -Math.abs(b.vx) * WALL_BOUNCE
        b.spin *= -0.6
      }
      if (b.y - size < 0) {
        b.y = size
        b.vy = Math.abs(b.vy) * 0.4
      }
      if (b.y >= ground) {
        b.y = ground
        if (b.vy > 420) {
          b.vy = -b.vy * FLOOR_BOUNCE
          b.vx *= 0.7
          b.spin *= 0.55
        } else {
          land(b, now)
        }
      }
      break
    }
    case 'down': {
      b.y = ground
      const decel = FLOOR_FRICTION * dt
      b.vx = Math.abs(b.vx) <= decel ? 0 : b.vx - Math.sign(b.vx) * decel
      b.x = clamp(b.x + b.vx * dt, half, width - half)
      b.angle += (b.lie - b.angle) * Math.min(1, dt * 14)
      if (now > b.until) {
        b.mode = 'rise'
        b.riseFrom = b.angle
        b.until = now + RISE_MS
      }
      break
    }
    case 'rise': {
      b.y = ground
      const t = clamp(1 - (b.until - now) / RISE_MS, 0, 1)
      b.angle = b.riseFrom * (1 - t) ** 3
      if (t >= 1) {
        b.angle = 0
        startWalking(b, now)
      }
      break
    }
  }
  const lying = b.mode === 'air' ? 0 : Math.abs(Math.sin(b.angle)) * size * 0.28
  b.drop += (lying - b.drop) * Math.min(1, dt * 18)
}

function topple(b: Body, pushX: number, now: number) {
  b.mode = 'down'
  b.lie = (pushX >= 0 ? 1 : -1) * (Math.PI / 2)
  b.vx = clamp(pushX * 0.12, -160, 160)
  b.until = now + 1600 + Math.random() * 1800
  b.hitAt = now
}

function flick(b: Body, pvx: number, pvy: number, now: number) {
  const vx = clamp(pvx * 0.75, -MAX_LAUNCH, MAX_LAUNCH)
  const vy = clamp(pvy * 0.75, -MAX_LAUNCH, MAX_LAUNCH)
  if (b.mode === 'air') {
    b.vx = clamp(b.vx * 0.4 + vx, -MAX_LAUNCH, MAX_LAUNCH)
    b.vy = Math.min(b.vy * 0.4 + vy, -250)
  } else {
    b.angle = normalize(b.angle)
    b.vx = vx
    b.vy = Math.min(vy, -450 - Math.hypot(pvx, pvy) * 0.35)
  }
  b.spin = b.vx * 0.012 + (Math.random() - 0.5) * 4
  b.mode = 'air'
  b.hitAt = now
}

/** The part of the sprite box the dwarf actually fills, upright or lying. */
function hitBox(b: Body, size: number) {
  const s = Math.abs(Math.sin(b.angle))
  const w = size * (0.42 + 0.4 * s)
  const h = size * (0.8 - 0.38 * s)
  const cy = b.y + b.drop - size / 2 + size * 0.05
  return { left: b.x - w / 2, right: b.x + w / 2, top: cy - h / 2, bottom: cy + h / 2 }
}

function segmentHits(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  box: ReturnType<typeof hitBox>,
): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 8))
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps
    const y = y0 + ((y1 - y0) * i) / steps
    if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return true
  }
  return false
}

export function EdgeDwarves({
  dwarves,
  showNames = true,
  size = 48,
}: {
  dwarves: EdgeDwarf[]
  showNames?: boolean
  /** Sprite height in CSS pixels; 48 draws the 32px sprites at 3x on retina screens. */
  size?: number
}) {
  const reducedMotion = usePrefersReducedMotion()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  const bodies = React.useRef(new Map<EdgeDwarf['key'], Body>())
  const els = React.useRef(new Map<EdgeDwarf['key'], Els>())
  const elsFor = (key: EdgeDwarf['key']) => {
    let entry = els.current.get(key)
    if (!entry) {
      entry = { outer: null, inner: null, label: null }
      els.current.set(key, entry)
    }
    return entry
  }

  const keys = dwarves.map((d) => d.key).join('|')
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by the joined dwarf keys
  React.useEffect(() => {
    const now = performance.now()
    const width = document.documentElement.clientWidth
    const ground = document.documentElement.clientHeight
    const wanted = new Set(dwarves.map((d) => d.key))
    for (const key of bodies.current.keys()) {
      if (!wanted.has(key)) {
        bodies.current.delete(key)
        els.current.delete(key)
      }
    }
    for (const key of wanted) {
      if (!bodies.current.has(key)) bodies.current.set(key, spawn(width, ground, now))
    }
  }, [keys])

  React.useEffect(() => {
    if (!mounted || reducedMotion) return
    let frame = 0
    let last = performance.now()
    let pointer: { x: number; y: number; t: number } | null = null
    const velocity = { x: 0, y: 0 }

    const render = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const width = document.documentElement.clientWidth
      const ground = document.documentElement.clientHeight
      for (const [key, b] of bodies.current) {
        step(b, dt, now, width, ground, size)
        const el = els.current.get(key)
        if (!el?.outer || !el.inner) continue
        const bob = b.mode === 'walk' ? -Math.abs(Math.sin(b.phase * Math.PI)) * size * 0.06 : 0
        el.outer.style.transform = `translate3d(${b.x - size / 2}px, ${b.y - size + b.drop + bob}px, 0)`
        el.inner.style.transform = `rotate(${b.angle}rad)`
        if (el.label) el.label.style.opacity = b.mode === 'walk' || b.mode === 'idle' ? '1' : '0'
      }
      frame = requestAnimationFrame(render)
    }
    frame = requestAnimationFrame(render)

    const onMove = (event: PointerEvent) => {
      const now = performance.now()
      const prev = pointer
      pointer = { x: event.clientX, y: event.clientY, t: now }
      if (!prev || now - prev.t > 120) {
        velocity.x = 0
        velocity.y = 0
        return
      }
      const dt = Math.max(0.004, (now - prev.t) / 1000)
      velocity.x = velocity.x * 0.35 + ((event.clientX - prev.x) / dt) * 0.65
      velocity.y = velocity.y * 0.35 + ((event.clientY - prev.y) / dt) * 0.65
      const speed = Math.hypot(velocity.x, velocity.y)
      for (const b of bodies.current.values()) {
        if (now - b.hitAt < HIT_COOLDOWN_MS) continue
        if (!segmentHits(prev.x, prev.y, event.clientX, event.clientY, hitBox(b, size))) continue
        if (speed >= FLICK_SPEED) flick(b, velocity.x, velocity.y, now)
        else if (b.mode === 'walk' || b.mode === 'idle' || b.mode === 'rise') {
          topple(b, velocity.x || event.clientX - prev.x || b.x - event.clientX, now)
        }
      }
    }
    window.addEventListener('pointermove', onMove, { passive: true })

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
    }
  }, [mounted, reducedMotion, size])

  if (!mounted || reducedMotion || !dwarves.length) return null

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
      {dwarves.map((dwarf) => {
        const el = elsFor(dwarf.key)
        return (
          <div
            key={dwarf.key}
            ref={(node) => {
              el.outer = node
            }}
            className="absolute top-0 left-0"
            style={{ width: size, height: size, transform: 'translate3d(-200px, -200px, 0)' }}
          >
            {showNames && dwarf.name ? (
              <div
                ref={(node) => {
                  el.label = node
                }}
                className="absolute bottom-full left-1/2 mb-0.5 -translate-x-1/2 font-mono text-[10px] leading-none font-semibold tracking-wide whitespace-nowrap text-white uppercase transition-opacity duration-200 [text-shadow:0_0_2px_#000,0_1px_1px_#000,1px_0_1px_#000,-1px_0_1px_#000]"
              >
                {dwarf.name}
              </div>
            ) : null}
            <div
              ref={(node) => {
                el.inner = node
              }}
              className="flex h-full w-full items-end justify-center"
            >
              <CreatureSprite
                unit={dwarf.unit}
                size={size}
                className="drop-shadow-[0_1px_1px_rgba(0,0,0,0.6)]"
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
