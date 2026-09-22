import { cn } from '@fortress/ui'
import type * as React from 'react'

import {
  type DfAssetIndex,
  type LayerSprite,
  type TileSprite,
  type UnitLook,
  creatureLook,
  pageUrl,
  useDfAssets,
} from './index'

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
  sprite: TileSprite & Partial<Pick<LayerSprite, 'w' | 'h'>>
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

/**
 * A unit as the game draws it: a single sprite for animals and beasts, a
 * composited stack of body layers for dwarves and other civilized races.
 * Renders nothing when the sprites have not been extracted on this machine,
 * when the dump predates the race_id column, or when the race has no graphics.
 */
export function CreatureSprite({
  unit,
  size = 32,
  className,
  title,
}: {
  unit: UnitLook
  size?: number
  className?: string
  title?: string
}) {
  const index = useDfAssets()
  if (!index) return null
  const look = creatureLook(index, unit)
  if (!look) return null
  const ghost = unit.flags.includes('ghost')

  if (look.kind === 'sprite') {
    return (
      <DfTile
        index={index}
        sprite={look.sprite}
        size={size}
        title={title}
        className={cn(ghost && 'opacity-50', className)}
      />
    )
  }

  const base = index.pages[look.layers[0].page]
  if (!base) return null
  const scale = size / base.tileHeight
  return (
    <span
      role={title ? 'img' : undefined}
      aria-label={title}
      title={title}
      className={cn('relative inline-block shrink-0', ghost && 'opacity-50', className)}
      style={{ width: base.tileWidth * scale, height: size }}
    >
      {look.layers.map((layer, i) => (
        <DfTile
          key={`${layer.name}-${i}`}
          index={index}
          sprite={layer}
          size={size}
          className="absolute left-0 top-0"
        />
      ))}
    </span>
  )
}
