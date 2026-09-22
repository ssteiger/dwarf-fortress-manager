import type { FortUnit } from '@fortress/db-drizzle'
import { cn } from '@fortress/ui'
import * as React from 'react'

import { composeLayers } from './compose'
import {
  type DfAssetIndex,
  type SpriteUnit,
  type TileSprite,
  pageUrl,
  simpleCreatureSprite,
  useDfAssets,
} from './index'
import {
  type LayerSetKind,
  type ResolvedLayer,
  resolveLayers,
  selectLayerSet,
  useCreatureRules,
} from './layers'

/**
 * One sprite cut from a sheet with CSS backgrounds. `size` is the rendered
 * height of a single tile in CSS pixels; wider or taller sprites scale along.
 */
export function DfTile({
  index,
  sprite,
  size,
  className,
  style,
  title,
}: {
  index: DfAssetIndex
  sprite: TileSprite
  size: number
  className?: string
  style?: React.CSSProperties
  title?: string
}) {
  const page = index.pages[sprite.page]
  if (!page) return null
  const scale = size / page.tileHeight
  const w = sprite.w ?? 1
  const h = sprite.h ?? 1
  return (
    <span
      role={title ? 'img' : undefined}
      aria-label={title}
      title={title}
      className={cn('inline-block shrink-0', className)}
      style={{
        width: page.tileWidth * w * scale,
        height: page.tileHeight * h * scale,
        backgroundImage: `url(${pageUrl(page)})`,
        backgroundSize: `${page.pageWidth * scale}px ${page.pageHeight * scale}px`,
        backgroundPosition: `-${sprite.x * page.tileWidth * scale}px -${sprite.y * page.tileHeight * scale}px`,
        backgroundRepeat: 'no-repeat',
        imageRendering: 'pixelated',
        ...style,
      }}
    />
  )
}

/** A resolved layer stack composited onto a canvas, drawn crisp at `size` px tall. */
function LayerCanvas({
  index,
  layers,
  size,
  className,
  title,
}: {
  index: DfAssetIndex
  layers: ResolvedLayer[]
  size: number
  className?: string
  title?: string
}) {
  const ref = React.useRef<HTMLCanvasElement>(null)
  const [aspect, setAspect] = React.useState(1)

  // `layers` comes memoised from useUnitLayers, so identity changes only
  // when the unit's look does.
  React.useEffect(() => {
    let cancelled = false
    composeLayers(index, layers).then((composite) => {
      const el = ref.current
      if (cancelled || !composite || !el) return
      const dpr = window.devicePixelRatio || 1
      const scale = size / composite.tileHeight
      el.width = Math.round(composite.tileWidth * scale * dpr)
      el.height = Math.round(size * dpr)
      const ctx = el.getContext('2d')
      if (!ctx) return
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, el.width, el.height)
      ctx.drawImage(composite.canvas, 0, 0, el.width, el.height)
      setAspect(composite.tileWidth / composite.tileHeight)
    })
    return () => {
      cancelled = true
    }
  }, [index, layers, size])

  return (
    <canvas
      ref={ref}
      role={title ? 'img' : undefined}
      aria-label={title}
      title={title}
      className={cn('inline-block shrink-0', className)}
      style={{ width: size * aspect, height: size, imageRendering: 'pixelated' }}
    />
  )
}

export type LookUnitProps = Pick<FortUnit, 'id' | 'race_id' | 'caste_id' | 'flags' | 'look'>

/** Resolve the layer stack for a unit and a kind of graphic; [] when it has none. */
function useUnitLayers(
  index: DfAssetIndex | null,
  unit: LookUnitProps,
  kind: LayerSetKind,
): ResolvedLayer[] {
  const rules = useCreatureRules(index, unit.race_id)
  return React.useMemo(() => {
    if (!index || !rules) return []
    const set = selectLayerSet(rules, kind, unit)
    return set ? resolveLayers(set, unit, index) : []
  }, [index, rules, kind, unit])
}

/**
 * A unit as the game draws it on the map: the layered composite for
 * civilized races (skin and hair colours, styling, worn clothes and armour
 * in their material colours, profession-coloured defaults), a single sprite
 * for animals and beasts. Renders nothing when the sprites have not been
 * extracted on this machine or the race has no graphics.
 */
export function CreatureSprite({
  unit,
  size = 32,
  className,
  title,
}: {
  unit: LookUnitProps & SpriteUnit
  size?: number
  className?: string
  title?: string
}) {
  const index = useDfAssets()
  const layers = useUnitLayers(index, unit, 'sprite')
  if (!index) return null
  const ghost = unit.flags.includes('ghost')
  if (layers.length) {
    return (
      <LayerCanvas index={index} layers={layers} size={size} className={className} title={title} />
    )
  }
  const sprite = simpleCreatureSprite(index, unit)
  if (!sprite) return null
  return (
    <DfTile
      index={index}
      sprite={sprite}
      size={size}
      title={title}
      className={cn(ghost && 'opacity-50', className)}
    />
  )
}

/**
 * The portrait the game shows in a unit's details window (96px layered
 * face for civilized races). Renders nothing for creatures without one.
 */
export function UnitPortrait({
  unit,
  size = 96,
  className,
  title,
  fallbackToSprite = false,
}: {
  unit: LookUnitProps & SpriteUnit
  size?: number
  className?: string
  title?: string
  /** Show the map sprite for creatures that have no portrait (animals, beasts). */
  fallbackToSprite?: boolean
}) {
  const index = useDfAssets()
  const layers = useUnitLayers(index, unit, 'portrait')
  if (!index) return null
  if (layers.length) {
    return (
      <LayerCanvas index={index} layers={layers} size={size} className={className} title={title} />
    )
  }
  if (!fallbackToSprite) return null
  return <CreatureSprite unit={unit} size={size} className={className} title={title} />
}
