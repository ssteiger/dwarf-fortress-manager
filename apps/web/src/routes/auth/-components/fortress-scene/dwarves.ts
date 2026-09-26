import type { UnitLook, UnitTissue, UnitWornItem } from '@fortress/db-drizzle'

import type { LookUnitProps } from '~/lib/df-assets/components'

/**
 * A made-up expedition for the sign-in artwork. Each dwarf carries a `look`
 * in the same shape the fortress dump writes, so the game's layered graphics
 * draw them with their own hair, beards, clothes and tools. Nothing here
 * comes from the player's fortress.
 */

type Caste = 'MALE' | 'FEMALE'

interface Hair {
  color: string
  length: number
  style?: string | null
  curly?: number
}

interface DwarfSpec {
  id: number
  name: string
  caste: Caste
  skin: string
  eyes: string
  hair: Hair
  beard?: Hair
  profession: string
  worn: UnitWornItem[]
}

export interface SceneDwarf {
  name: string
  profession: string
  unit: LookUnitProps & { race_id: string; caste_id: string }
}

const EXTERNAL_PARTS: [string, string][] = [
  ['UB', 'BODY_UPPER'],
  ['LB', 'BODY_LOWER'],
  ['NK', 'NECK'],
  ['HD', 'HEAD'],
  ['RUA', 'ARM_UPPER'],
  ['LUA', 'ARM_UPPER'],
  ['RLA', 'ARM_LOWER'],
  ['LLA', 'ARM_LOWER'],
  ['RH', 'HAND'],
  ['LH', 'HAND'],
  ['RUL', 'LEG_UPPER'],
  ['LUL', 'LEG_UPPER'],
  ['RLL', 'LEG_LOWER'],
  ['LLL', 'LEG_LOWER'],
  ['RF', 'FOOT'],
  ['LF', 'FOOT'],
  ['REYE', 'EYE'],
  ['LEYE', 'EYE'],
  ['R_EAR', 'EAR'],
  ['L_EAR', 'EAR'],
  ['NOSE', 'NOSE'],
  ['MOUTH', 'MOUTH'],
  ['R_CHEEK', 'CHEEK'],
  ['L_CHEEK', 'CHEEK'],
  ['R_EYELID', 'EYELID'],
  ['L_EYELID', 'EYELID'],
  ['U_LIP', 'LIP'],
  ['L_LIP', 'LIP'],
  ['THROAT', 'THROAT'],
]

const SKIN_PARTS: [string[], string][] = [
  [['HD'], 'HEAD'],
  [['NK'], 'NECK'],
  [['UB'], 'BODY_UPPER'],
  [['LB'], 'BODY_LOWER'],
  [['LH', 'RH'], 'HAND'],
  [['LF', 'RF'], 'FOOT'],
  [['L_EAR', 'R_EAR'], 'EAR'],
  [['NOSE'], 'NOSE'],
]

let nextItemId = 1

function cloth(
  bp: string,
  cat: string,
  type: string,
  subtype: string,
  color: string,
): UnitWornItem {
  return {
    item_id: nextItemId++,
    mode: 'Worn',
    bp,
    cat,
    type,
    subtype,
    quality: 0,
    material_type: 'PLANT',
    color,
    dyed: false,
    flags: ['ANY_PLANT_CLOTH_MATERIAL', 'WOVEN_ITEM', 'NOT_ARTIFACT'],
  }
}

function metal(
  bp: string,
  cat: string,
  type: string,
  subtype: string,
  color: string,
  mode = 'Worn',
): UnitWornItem {
  return {
    item_id: nextItemId++,
    mode,
    bp,
    cat,
    type,
    subtype,
    quality: 0,
    material_type: 'INORGANIC',
    color,
    dyed: false,
    flags: ['ANY_METAL_MATERIAL', 'NOT_ARTIFACT'],
  }
}

const shirt = (subtype: string, color: string) => cloth('UB', 'BODY_UPPER', 'ARMOR', subtype, color)
const pants = (subtype: string, color: string) => cloth('LB', 'BODY_LOWER', 'PANTS', subtype, color)
const shoes = (color: string) => [
  cloth('LF', 'FOOT', 'SHOES', 'ITEM_SHOES_SHOES', color),
  cloth('RF', 'FOOT', 'SHOES', 'ITEM_SHOES_SHOES', color),
]
const hat = (subtype: string, color: string) => cloth('HD', 'HEAD', 'HELM', subtype, color)
const wield = (subtype: string, color: string) =>
  metal('RH', 'HAND', 'WEAPON', subtype, color, 'Weapon')

function hairTissue(layer: string, cat: string, bps: string[], hair: Hair): UnitTissue {
  return {
    bps,
    cat,
    layer,
    color: hair.color,
    length: hair.length,
    style: hair.style ?? null,
    curly: hair.curly ?? 40,
    dense: 100,
  }
}

function lookFor(spec: DwarfSpec): UnitLook {
  const tissues: UnitTissue[] = [
    ...SKIN_PARTS.map(([bps, cat]) => ({ bps, cat, layer: 'SKIN', color: spec.skin })),
    { bps: ['LEYE', 'REYE'], cat: 'EYE', layer: 'EYE', color: spec.eyes },
    { bps: ['R_EYELID', 'L_EYELID'], cat: 'EYELID', layer: 'EYELASH', color: spec.hair.color },
    { bps: ['HD', 'HD'], cat: 'HEAD', layer: 'EYEBROW', color: spec.hair.color, dense: 90 },
    hairTissue('HAIR', 'HEAD', ['HD', 'HD'], spec.hair),
  ]
  if (spec.beard) {
    tissues.push(
      hairTissue('CHIN_WHISKERS', 'HEAD', ['HD'], spec.beard),
      hairTissue('MOUSTACHE', 'HEAD', ['HD'], spec.beard),
      hairTissue('SIDEBURNS', 'HEAD', ['HD', 'HD'], spec.beard),
      hairTissue('CHEEK_WHISKERS', 'CHEEK', ['R_CHEEK', 'L_CHEEK'], spec.beard),
    )
  }
  return {
    profession_category: spec.profession,
    syn_classes: [],
    haul_count: 0,
    body_size: 6000,
    tissues,
    bp_modifiers: [],
    body_modifiers: [],
    parts: EXTERNAL_PARTS.map(([token, cat]) => [token, cat, 0]),
    worn: spec.worn,
  }
}

const SPECS: DwarfSpec[] = [
  {
    id: 101,
    name: 'Urist',
    caste: 'MALE',
    skin: 'PEACH',
    eyes: 'COBALT',
    hair: { color: 'AUBURN', length: 150, style: 'NEATLY_COMBED' },
    beard: { color: 'AUBURN', length: 260, style: 'BRAIDED' },
    profession: 'MINER',
    worn: [
      shirt('ITEM_ARMOR_SHIRT', 'TAN'),
      pants('ITEM_PANTS_PANTS', 'BROWN'),
      ...shoes('BROWN'),
      wield('ITEM_WEAPON_PICK', 'GRAY'),
    ],
  },
  {
    id: 102,
    name: 'Kadol',
    caste: 'MALE',
    skin: 'TAN',
    eyes: 'BROWN',
    hair: { color: 'BLACK', length: 120 },
    beard: { color: 'BLACK', length: 320, style: 'NEATLY_COMBED' },
    profession: 'WOODWORKER',
    worn: [
      shirt('ITEM_ARMOR_VEST', 'GREEN'),
      pants('ITEM_PANTS_PANTS', 'DARK_BROWN'),
      ...shoes('DARK_BROWN'),
      wield('ITEM_WEAPON_AXE_BATTLE', 'COPPER'),
    ],
  },
  {
    id: 103,
    name: 'Ingiz',
    caste: 'FEMALE',
    skin: 'DARK_TAN',
    eyes: 'GRAY',
    hair: { color: 'GRAY', length: 220, style: 'DOUBLE_BRAIDS' },
    profession: 'STONEWORKER',
    worn: [shirt('ITEM_ARMOR_DRESS', 'GRAY'), ...shoes('GRAY')],
  },
  {
    id: 104,
    name: 'Doren',
    caste: 'MALE',
    skin: 'DARK_BROWN',
    eyes: 'AMBER',
    hair: { color: 'CHARCOAL', length: 60 },
    beard: { color: 'CHARCOAL', length: 220, style: 'BRAIDED' },
    profession: 'METALSMITH',
    worn: [
      shirt('ITEM_ARMOR_VEST', 'BLACK'),
      pants('ITEM_PANTS_PANTS', 'CHARCOAL'),
      ...shoes('BLACK'),
      wield('ITEM_WEAPON_HAMMER_WAR', 'GRAY'),
    ],
  },
  {
    id: 105,
    name: 'Mafol',
    caste: 'FEMALE',
    skin: 'PALE_PINK',
    eyes: 'EMERALD',
    hair: { color: 'GOLD', length: 260, style: 'BRAIDED' },
    profession: 'JEWELER',
    worn: [shirt('ITEM_ARMOR_ROBE', 'PURPLE'), ...shoes('PURPLE')],
  },
  {
    id: 106,
    name: 'Zasit',
    caste: 'MALE',
    skin: 'COPPER',
    eyes: 'BLUE',
    hair: { color: 'RUSSET', length: 80 },
    beard: { color: 'RUSSET', length: 360, style: 'DOUBLE_BRAIDS' },
    profession: 'STANDARD',
    worn: [
      metal('HD', 'HEAD', 'HELM', 'ITEM_HELM_HELM', 'GRAY'),
      metal('UB', 'BODY_UPPER', 'ARMOR', 'ITEM_ARMOR_MAIL_SHIRT', 'GRAY'),
      metal('LB', 'BODY_LOWER', 'PANTS', 'ITEM_PANTS_GREAVES', 'GRAY'),
      ...shoes('BROWN'),
      wield('ITEM_WEAPON_AXE_BATTLE', 'GRAY'),
    ],
  },
  {
    id: 107,
    name: 'Bomrek',
    caste: 'MALE',
    skin: 'PEACH',
    eyes: 'HAZEL',
    hair: { color: 'FLAX', length: 100 },
    beard: { color: 'FLAX', length: 190, style: 'NEATLY_COMBED' },
    profession: 'FARMER',
    worn: [
      shirt('ITEM_ARMOR_TUNIC', 'OCHRE'),
      pants('ITEM_PANTS_PANTS', 'BROWN'),
      ...shoes('BROWN'),
    ],
  },
  {
    id: 108,
    name: 'Sibrek',
    caste: 'FEMALE',
    skin: 'SEPIA',
    eyes: 'BROWN',
    hair: { color: 'COPPER', length: 180, style: 'PONY_TAILS' },
    profession: 'FISHERY_WORKER',
    worn: [
      hat('ITEM_HELM_CAP', 'BLUE'),
      shirt('ITEM_ARMOR_SHIRT', 'BLUE'),
      pants('ITEM_PANTS_PANTS', 'GRAY'),
      ...shoes('GRAY'),
    ],
  },
]

export const SCENE_DWARVES: SceneDwarf[] = SPECS.map((spec) => ({
  name: spec.name,
  profession: spec.profession,
  unit: {
    id: spec.id,
    race_id: 'DWARF',
    caste_id: spec.caste,
    flags: [],
    look: lookFor(spec),
  },
}))
