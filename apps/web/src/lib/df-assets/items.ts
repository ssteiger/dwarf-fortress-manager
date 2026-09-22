import type { FortItem } from '@fortress/db-drizzle'

import { type DfAssetIndex, type TileSprite, tileSprite } from './index'
import type { Recolor } from './layers'

/**
 * Which sprite the game draws for an item.
 *
 * Weapons, armour, tools and the like are keyed by subtype token in the item
 * graphics ([WEAPON_GRAPHICS:ITEM_WEAPON_PICK] ...) and painted in the
 * material's colour through the standard palette, so those come back with a
 * recolour. Everything else is a named tile, ITEM_<TYPE> with a material
 * variant where the raws have one (ITEM_DOOR_STONE, ITEM_BOOK_METAL) and an
 * EMPTY state for containers whose contents the dump does not carry.
 */

export type SpriteItem = Pick<
  FortItem,
  | 'type'
  | 'subtype_id'
  | 'mat_class'
  | 'color'
  | 'flags'
  | 'material'
  | 'description'
  | 'race_id'
  | 'caste_id'
  | 'plant_id'
  | 'corpse_flags'
>

export type ItemLook =
  | { kind: 'sprite'; sprite: TileSprite; recolor: Recolor | null }
  /** Drawn with the creature's own graphics (corpses, vermin, fish, remains). */
  | { kind: 'creature'; race: string; caste: string | null; flags: string[] }

/** Which BODYPART_* tile a butchered piece is, from its corpse_flags. */
const CORPSE_FLAG_TILES: [string, string][] = [
  ['skull', 'BODYPART_SKULL_1'],
  ['bone', 'BODYPART_BONE'],
  ['horn', 'BODYPART_HORN'],
  ['shell', 'BODYPART_SHELL'],
  ['tooth', 'BODYPART_TEETH'],
  ['hair_wool', 'BODYPART_WOOL'],
  ['hair', 'BODYPART_HAIR'],
  ['leather', 'ITEM_TANNED_SKIN'],
  ['skin', 'BODYPART_SKIN_SMOOTH'],
  ['fat', 'BODYPART_FAT'],
  ['tallow', 'BODYPART_FAT'],
  ['yarn', 'BODYPART_WOOL'],
  ['silk', 'ITEM_THREAD'],
]

/** Organ and tissue names in a body part's description -> tile. */
const BODYPART_WORDS: [RegExp, string][] = [
  [/\bskull\b/i, 'BODYPART_SKULL_1'],
  [/\bbrain\b/i, 'BODYPART_BRAIN'],
  [/\bheart\b/i, 'BODYPART_HEART'],
  [/\blungs?\b/i, 'BODYPART_LUNG'],
  [/\bliver\b/i, 'BODYPART_LIVER'],
  [/\bkidneys?\b/i, 'BODYPART_KIDNEY'],
  [/\bspleen\b/i, 'BODYPART_SPLEEN'],
  [/\bintestines?\b/i, 'BODYPART_INTESTINES'],
  [/\btripe\b/i, 'BODYPART_TRIPE'],
  [/\bsweetbreads?\b/i, 'BODYPART_SWEETBREAD'],
  [/\bgizzard stone\b/i, 'BODYPART_GIZZARD_STONE'],
  [/\bgizzard\b/i, 'BODYPART_GIZZARD'],
  [/\beyes?\b/i, 'BODYPART_EYE'],
  [/\bcartilage\b/i, 'BODYPART_CARTILAGE'],
  [/\bnervous tissue\b/i, 'BODYPART_NERVOUS_TISSUE'],
  [/\bhoo(f|ves)\b/i, 'BODYPART_HOOF'],
  [/\bantlers?\b/i, 'BODYPART_ANTLER'],
  [/\bchitin\b/i, 'BODYPART_CHITIN_1'],
  [/\bscales?\b/i, 'BODYPART_SCALE'],
  [/\bfeathers?\b/i, 'BODYPART_SKIN_FEATHERS'],
  [/\bwool\b/i, 'BODYPART_WOOL'],
  [/\bhair\b/i, 'BODYPART_HAIR'],
  [/\bteeth|tooth|tusk|ivory\b/i, 'BODYPART_TEETH'],
  [/\bhorns?\b/i, 'BODYPART_HORN'],
  [/\bshell\b/i, 'BODYPART_SHELL'],
  [/\bbones?\b/i, 'BODYPART_BONE'],
  [/\bskin\b/i, 'BODYPART_SKIN_SMOOTH'],
  [/\bfat\b|\btallow\b/i, 'BODYPART_FAT'],
  [/\bmeat\b/i, 'BODYPART_MEAT'],
]

function bodyPartTile(item: SpriteItem): string {
  for (const [flag, tile] of CORPSE_FLAG_TILES) if (item.corpse_flags?.includes(flag)) return tile
  for (const [re, tile] of BODYPART_WORDS) if (re.test(item.description)) return tile
  return item.corpse_flags?.includes('separated_part') ? 'BODYPART_LARGE_1' : 'BODYPART_SMALL_1'
}

/** Item type enum names whose tiles are spelled differently. */
const TYPE_TILE_BASE: Record<string, string> = {
  ARMORSTAND: 'ITEM_ARMOR_STAND',
  WEAPONRACK: 'ITEM_WEAPON_RACK',
  ANIMALTRAP: 'ITEM_ANIMAL_TRAP',
  BAR: 'ITEM_BARS',
  COIN: 'ITEM_COINS',
  CATAPULTPARTS: 'ITEM_CATAPULT_PARTS',
  BALLISTAPARTS: 'ITEM_BALLISTA_PARTS',
  BALLISTAARROWHEAD: 'ITEM_BALLISTA_ARROWHEAD',
  TRAPPARTS: 'ITEM_MECHANISMS',
  TRAPCOMP: 'ITEM_TRAP_COMPONENT',
  SKIN_TANNED: 'ITEM_TANNED_SKIN',
  FOOD: 'ITEM_PREPARED_MEAL',
  POWDER_MISC: 'ITEM_POWDER',
  LIQUID_MISC: 'ITEM_LIQUID',
  DRINK: 'ITEM_LIQUID',
  GEM: 'ITEM_GEMS',
  SMALLGEM: 'ITEM_GEMS',
  ROUGH: 'ITEM_ROUGH_GEM',
  EGG: 'ITEM_EGG_SIZE2',
  INSTRUMENT: 'ITEM_INSTRUMENT_STRINGED_HANDHELD',
  HATCH_COVER: 'ITEM_HATCH_COVER',
  PIPE_SECTION: 'ITEM_PIPE_SECTION',
  TRACTION_BENCH: 'ITEM_TRACTION_BENCH',
  ORTHOPEDIC_CAST: 'ITEM_ORTHOPEDIC_CAST',
  PLANT_GROWTH: 'ITEM_PLANT_GROWTH',
}

/** Jewellery only comes in METAL and WOOD variants. */
const METAL_OR_WOOD = new Set([
  'AMULET',
  'BRACELET',
  'CROWN',
  'EARRING',
  'FIGURINE',
  'RING',
  'SCEPTER',
  'GOBLET',
])

function materialSuffixes(type: string, cls: string | null): string[] {
  if (type === 'TRACTION_BENCH') return [cls === 'WOOD' ? 'WOODEN_ROPE' : `${cls ?? 'WOODEN'}_ROPE`]
  if (METAL_OR_WOOD.has(type)) return [cls === 'METAL' ? 'METAL' : 'WOOD', 'METAL']
  if (type === 'FLASK') return [cls === 'LEATHER' || cls === 'GLASS' ? cls : 'METAL', 'METAL']
  if (type === 'CHAIN') return [cls === 'METAL' ? 'METAL' : 'ROPE']
  if (type === 'BARREL' || type === 'BIN') return [cls === 'METAL' ? 'METAL' : 'WOOD']
  return cls ? [cls] : []
}

const plain = (sprite: TileSprite): ItemLook => ({ kind: 'sprite', sprite, recolor: null })

export function itemLook(index: DfAssetIndex, item: SpriteItem): ItemLook | null {
  const artifact = item.flags.includes('artifact')
  const type = item.type

  // Subtype-keyed graphics, coloured by material like the game does.
  if (item.subtype_id) {
    const entry = index.items[item.subtype_id]
    if (entry) {
      const sprite = (artifact && entry.artifact) || entry.default
      const standard = index.palettes.DEFAULT
      const row = item.color && standard ? standard.colors[item.color] : undefined
      const recolor =
        standard && row !== undefined
          ? { file: standard.file, fromRow: standard.defaultRow, toRow: row }
          : null
      return { kind: 'sprite', sprite, recolor }
    }
  }

  // Things that are drawn as the creature they came from.
  if (item.race_id) {
    const creature = (flags: string[]): ItemLook => ({
      kind: 'creature',
      race: item.race_id as string,
      caste: item.caste_id,
      flags,
    })
    if (type === 'CORPSE') {
      // A corpse reduced to bone is drawn with the creature's skeleton states.
      const flags = item.corpse_flags ?? []
      const skeleton =
        /\bskeleton\b/i.test(item.description) ||
        (flags.includes('bone') && !flags.includes('skin'))
      return creature([skeleton ? 'skeleton' : 'dead'])
    }
    if (type === 'REMAINS') return creature(['remains'])
    if (type === 'VERMIN' || type === 'PET' || type === 'FISH' || type === 'FISH_RAW') {
      return creature(['vermin'])
    }
  }
  if (type === 'CORPSEPIECE') {
    const sprite = tileSprite(index, bodyPartTile(item))
    return sprite ? plain(sprite) : null
  }
  if (type === 'MEAT') {
    const sprite = tileSprite(index, 'BODYPART_MEAT')
    return sprite ? plain(sprite) : null
  }
  if (type === 'GLOB') {
    const name = /cheese/i.test(item.description)
      ? 'ITEM_CHEESE'
      : /\b(fat|tallow|suet)\b/i.test(item.description)
        ? 'BODYPART_FAT'
        : 'ITEM_LIQUID'
    const sprite = tileSprite(index, name)
    return sprite ? plain(sprite) : null
  }

  // Plant products: the plant's own seed / harvested / growth sprites.
  if (item.plant_id) {
    const plant = index.plants[item.plant_id]
    const pick =
      type === 'SEEDS'
        ? plant?.seed
        : type === 'PLANT'
          ? (plant?.picked ?? plant?.shrub)
          : type === 'PLANT_GROWTH'
            ? (plant?.growth ?? plant?.picked)
            : undefined
    if (pick) return plain(pick)
  }

  const base = TYPE_TILE_BASE[type] ?? `ITEM_${type}`
  const cls = item.mat_class
  const candidates: string[] = []
  if (type === 'BAR' && /soap/i.test(item.material)) candidates.push('ITEM_BARS_SOAP')
  if (type === 'PLANT' && item.flags.includes('rotten')) candidates.push('ITEM_ROTTEN_PLANT')
  if (type === 'STATUE' && artifact) candidates.push('ITEM_STATUE_ARTIFACT')
  if (type === 'SLAB') candidates.push('ITEM_SLAB_BLANK')
  if (type === 'COIN') candidates.push('ITEM_COINS_PILE_1')
  for (const suffix of materialSuffixes(type, cls)) {
    candidates.push(`${base}_${suffix}_EMPTY`, `${base}_${suffix}`)
  }
  candidates.push(
    `${base}_EMPTY`,
    base,
    `${base}_WOOD_EMPTY`,
    `${base}_WOOD`,
    `${base}_STONE`,
    `${base}_METAL`,
  )

  for (const name of candidates) {
    const sprite = tileSprite(index, name)
    if (sprite) return plain(sprite)
  }
  // Remains of a creature without graphics of its own.
  if (type === 'REMAINS') {
    const sprite = tileSprite(index, 'ITEM_REMAINS')
    if (sprite) return plain(sprite)
  }
  return null
}
