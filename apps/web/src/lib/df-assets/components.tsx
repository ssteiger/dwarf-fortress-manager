import type { FortUnit } from '@fortress/db-drizzle'
import { cn } from '@fortress/ui'
import * as React from 'react'

import { beastLayers, generatedIcon } from './beasts'
import { composeLayers } from './compose'
import {
  type DfAssetIndex,
  type SpriteUnit,
  type TileSprite,
  pageUrl,
  simpleCreatureSprite,
  useDfAssets,
} from './index'
import { type SpriteItem, itemLook } from './items'
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
export function LayerCanvas({
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
    if (!index) return []
    // Generated races are assembled from the beast kit, not from rules.
    const generated = unit.look?.generated
    if (generated) return kind === 'sprite' ? beastLayers(index, generated) : []
    if (!rules) return []
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
  fallbackSprite = null,
}: {
  unit: LookUnitProps & SpriteUnit
  size?: number
  className?: string
  title?: string
  /** Drawn when the race has no graphics for this state. */
  fallbackSprite?: TileSprite | null
}) {
  const index = useDfAssets()
  const layers = useUnitLayers(index, unit, 'sprite')
  if (!index) return null
  const ghost = unit.flags.includes('ghost')
  // Item states (skeleton, remains, vermin) are dedicated simple sprites and
  // win over a layer set; otherwise the layered composite comes first.
  const simple = simpleCreatureSprite(index, unit)
  const preferSimple = unit.flags.some((f) => f === 'skeleton' || f === 'remains' || f === 'vermin')
  if (layers.length && !(preferSimple && simple)) {
    return (
      <LayerCanvas index={index} layers={layers} size={size} className={className} title={title} />
    )
  }
  // Generated races without a body on record (legends figures, corpses)
  // get the game's list icon for their class.
  const sprite = simple ?? fallbackSprite ?? generatedIcon(index, unit.race_id)
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
 * An item as the game draws it: subtype sprites (weapons, armour, tools)
 * coloured by their material, and typed tiles with material variants for
 * everything else. Renders nothing for items the raws have no tile for
 * (corpses, raw food) or when the sprites are not extracted.
 */
export function ItemSprite({
  item,
  size = 24,
  className,
  title,
}: {
  item: SpriteItem
  size?: number
  className?: string
  title?: string
}) {
  const index = useDfAssets()
  const look = React.useMemo(() => (index ? itemLook(index, item) : null), [index, item])
  const layers = React.useMemo<ResolvedLayer[]>(
    () =>
      look?.kind === 'sprite' && look.recolor
        ? [
            {
              name: item.subtype_id ?? item.type,
              page: look.sprite.page,
              x: look.sprite.x,
              y: look.sprite.y,
              w: look.sprite.w ?? 1,
              h: look.sprite.h ?? 1,
              offset: [0, 0],
              recolor: look.recolor,
            },
          ]
        : [],
    [look, item.subtype_id, item.type],
  )
  if (!index || !look) return null
  if (look.kind === 'creature') {
    // A corpse, remains, fish or vermin: the creature's own graphics in the
    // state the item stands for (CORPSE / REMAINS / VERMIN).
    return (
      <CreatureSprite
        unit={{ id: 0, race_id: look.race, caste_id: look.caste, flags: look.flags, look: null }}
        size={size}
        className={className}
        title={title}
        fallbackSprite={item.type === 'REMAINS' ? (index.tiles.ITEM_REMAINS ?? null) : null}
      />
    )
  }
  if (layers.length) {
    return (
      <LayerCanvas index={index} layers={layers} size={size} className={className} title={title} />
    )
  }
  return (
    <DfTile index={index} sprite={look.sprite} size={size} className={className} title={title} />
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
