import { cn } from '@fortress/ui'

import { regionColor } from '~/lib/legends/model'
import {
  artifactSprite,
  legendTerrain,
  siteSpriteFor,
  tileSpriteByName,
} from '~/lib/legends/worldTiles'
import { CreatureSprite, DfTile } from './components'
import { type DfAssetIndex, useDfAssets } from './index'

/** The fields a legends row or record needs to pick its sprite. */
export interface LegendsSpriteSubject {
  kind: string
  id: number
  /** Raw creature token (DWARF, BEAR_BLACK) for figures, groups, creatures. */
  race?: string | null
  /** Caste token for figures; groups and creatures have none. */
  caste?: string | null
  /** Record type: the site type for sites, the region type for regions. */
  type?: string | null
  item?: { type: string | null; subtype: string | null } | null
}

const CREATURE_KINDS = new Set(['historical_figure', 'entity', 'entity_population', 'creature'])

/** Legend swatch: a terrain type's base tile with its forest/mountain overlay. */
export function TerrainChip({
  index,
  type,
  size = 16,
  className,
}: {
  index: DfAssetIndex
  type: string
  size?: number
  className?: string
}) {
  const look = legendTerrain(index, type)
  if (!look.base) {
    return (
      <span
        className={cn('inline-block size-3 rounded-sm border border-black/20', className)}
        style={{ backgroundColor: regionColor(type) }}
      />
    )
  }
  return (
    <span
      className={cn('relative inline-block shrink-0', className)}
      style={{ width: size, height: size }}
    >
      <DfTile index={index} sprite={look.base} size={size} className="absolute left-0 top-0" />
      {look.overlay ? (
        <DfTile index={index} sprite={look.overlay} size={size} className="absolute left-0 top-0" />
      ) : null}
    </span>
  )
}

export function TileChip({
  index,
  name,
  size = 16,
  className,
}: {
  index: DfAssetIndex
  name: string
  size?: number
  className?: string
}) {
  const sprite = tileSpriteByName(index, name)
  return sprite ? <DfTile index={index} sprite={sprite} size={size} className={className} /> : null
}

/**
 * What the game would draw for a legends record: the creature sprite for
 * figures, groups and creatures (a plain member of the race; legends know
 * caste but not wardrobe), the world-map marker for sites, the item sprite
 * for artifacts, and the terrain tile for regions. Nothing when the sprites
 * are not extracted or the record has no graphic (forces, poems, events).
 */
export function LegendsSprite({
  subject,
  size = 24,
  className,
  title,
}: {
  subject: LegendsSpriteSubject
  size?: number
  className?: string
  title?: string
}) {
  const index = useDfAssets()
  if (!index) return null

  if (CREATURE_KINDS.has(subject.kind)) {
    if (!subject.race) return null
    return (
      <CreatureSprite
        unit={{
          id: subject.id,
          race_id: subject.race,
          // Layer rules pick limbs by caste; a group has no caste, so draw its people as males.
          caste_id: subject.caste && subject.caste !== 'DEFAULT' ? subject.caste : 'MALE',
          flags: [],
          look: null,
        }}
        size={size}
        className={className}
        title={title}
      />
    )
  }
  if (subject.kind === 'site') {
    const sprite = siteSpriteFor(index, subject.type ?? null, subject.id)
    return sprite ? (
      <DfTile index={index} sprite={sprite} size={size} className={className} title={title} />
    ) : null
  }
  if (subject.kind === 'artifact') {
    const sprite = artifactSprite(index, subject.item)
    return sprite ? (
      <DfTile index={index} sprite={sprite} size={size} className={className} title={title} />
    ) : null
  }
  if (subject.kind === 'region' && subject.type) {
    return <TerrainChip index={index} type={subject.type} size={size} className={className} />
  }
  return null
}
