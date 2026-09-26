import type { DfhackAction, FortBuilding, FortItem, FortUnit } from '@fortress/db-drizzle'

import type { SpriteItem } from '../df-assets/items'
import {
  type Advice,
  type AdviceStatus,
  type AdvisorInput,
  SHOP_TYPES,
  type Shortcut,
  type Situation,
  WORKSHOPS,
  compact,
  fmt,
  fortAdvice,
  list,
  names,
  plural,
  recentEvents,
  situations,
  skilledIn,
} from './advisor'
import { isLiving } from './format'
import { fortFeelings, isCitizenish } from './insights'

/*
 * Client-safe: what the fortress keeps, read for the player. Which items
 * belong to which view of the item list (the server filters with the same
 * rules), what each thing in the stores is good for, what is worth making
 * next, and what to do with the stores when something goes wrong.
 */

// ---------------------------------------------------------------------------
// Materials

/** Ores by the metal they smelt into; tetrahedrite and galena give two. */
export const ORE_METALS: Record<string, string[]> = {
  hematite: ['iron'],
  magnetite: ['iron'],
  limonite: ['iron'],
  'native copper': ['copper'],
  malachite: ['copper'],
  tetrahedrite: ['copper', 'silver'],
  cassiterite: ['tin'],
  sphalerite: ['zinc'],
  galena: ['lead', 'silver'],
  'native silver': ['silver'],
  'horn silver': ['silver'],
  'native gold': ['gold'],
  'native electrum': ['gold', 'silver'],
  'native platinum': ['platinum'],
  bismuthinite: ['bismuth'],
  garnierite: ['nickel'],
  'native aluminum': ['aluminum'],
}
export const COAL_STONES = new Set(['bituminous coal', 'lignite'])
/** Stones that make steel when smelted with iron and coke. */
export const FLUX_STONES = new Set(['calcite', 'chalk', 'dolomite', 'limestone', 'marble'])

/** Coke and charcoal bars: the game names both by their material, coal. */
export function isFuelBar(material: string): boolean {
  return /coal|coke/.test(material)
}

// ---------------------------------------------------------------------------
// Views of the item list

export const ITEM_VIEWS = [
  'fortress',
  'forbidden',
  'loose',
  'refuse',
  'enemy',
  'worn',
  'artifacts',
  'carried',
  'merchant',
  'elsewhere',
] as const
export type ItemView = (typeof ITEM_VIEWS)[number]

export function isItemView(value: unknown): value is ItemView {
  return typeof value === 'string' && (ITEM_VIEWS as readonly string[]).includes(value)
}

export const REFUSE_TYPES = new Set(['CORPSE', 'CORPSEPIECE', 'REMAINS'])
/** Things a soldier wears or carries into battle. */
export const GEAR_TYPES = new Set([
  'WEAPON',
  'ARMOR',
  'HELM',
  'SHOES',
  'GLOVES',
  'PANTS',
  'SHIELD',
  'AMMO',
  'QUIVER',
  'BACKPACK',
  'FLASK',
])
const CLOTHING_TYPES = new Set(['ARMOR', 'HELM', 'SHOES', 'GLOVES', 'PANTS'])
const CRAFT_TYPES = new Set([
  'AMULET',
  'RING',
  'EARRING',
  'BRACELET',
  'CROWN',
  'FIGURINE',
  'SCEPTER',
  'TOTEM',
])
const FURNITURE_TYPES = new Set([
  'BED',
  'CHAIR',
  'TABLE',
  'DOOR',
  'CABINET',
  'BOX',
  'ARMORSTAND',
  'WEAPONRACK',
  'STATUE',
  'HATCH_COVER',
  'GRATE',
  'QUERN',
  'MILLSTONE',
  'TRACTION_BENCH',
])

type PlacedItem = Pick<
  FortItem,
  'x' | 'y' | 'z' | 'flags' | 'container_id' | 'holder_unit_id' | 'holder_building_id'
>

/** Stockpile footprints by level, for a quick "is this item in a stockpile" test. */
export function stockpileTest(
  buildings: FortBuilding[],
): (item: Pick<FortItem, 'x' | 'y' | 'z'>) => boolean {
  const byLevel = new Map<number, FortBuilding[]>()
  for (const b of buildings) {
    if (b.type !== 'Stockpile') continue
    const piles = byLevel.get(b.z) ?? []
    piles.push(b)
    byLevel.set(b.z, piles)
  }
  return ({ x, y, z }) => {
    if (x === null || y === null || z === null) return false
    return (byLevel.get(z) ?? []).some((p) => x >= p.x1 && x <= p.x2 && y >= p.y1 && y <= p.y2)
  }
}

/** On the floor and free: not stored, carried, built into something or claimed by a job. */
export function isLooseItem(item: PlacedItem): boolean {
  const f = item.flags
  return (
    item.x !== null &&
    item.container_id === null &&
    item.holder_unit_id === null &&
    item.holder_building_id === null &&
    !f.includes('construction') &&
    !f.includes('in_building') &&
    !f.includes('in_job')
  )
}

/**
 * Every view an item belongs to. Items without a position are artifacts and
 * books the game knows of elsewhere in the world; merchants' goods belong to
 * the caravan. Neither counts as the fortress's.
 */
export function itemViews(
  item: PlacedItem & Pick<FortItem, 'type' | 'wear'>,
  inStockpile: (item: Pick<FortItem, 'x' | 'y' | 'z'>) => boolean,
): ItemView[] {
  const f = item.flags
  if (item.x === null) return ['elsewhere']
  if (f.includes('trader')) return ['merchant']
  const out: ItemView[] = ['fortress']
  const forbidden = f.includes('forbid')
  if (forbidden) out.push('forbidden')
  const refuse = REFUSE_TYPES.has(item.type) || f.includes('rotten')
  if (refuse && item.holder_building_id === null) out.push('refuse')
  else if (!forbidden && !f.includes('spider_web') && isLooseItem(item) && !inStockpile(item))
    out.push('loose')
  if (f.includes('foreign') && GEAR_TYPES.has(item.type) && item.holder_unit_id === null)
    out.push('enemy')
  if (item.wear > 0) out.push('worn')
  if (f.includes('artifact')) out.push('artifacts')
  if (item.holder_unit_id !== null) out.push('carried')
  return out
}

export interface ViewInfo {
  label: string
  /** What the view shows, in a sentence. */
  blurb: string
  /** What to do about what it shows. */
  steps?: string[]
  actions?: DfhackAction[]
  dfhack?: Shortcut[]
}

export const ITEM_VIEW_INFO: Record<ItemView, ViewInfo> = {
  fortress: {
    label: 'In the fortress',
    blurb: 'Everything on the map that belongs to the fortress.',
  },
  forbidden: {
    label: 'Forbidden',
    blurb:
      'Dwarves will not touch these: usually the gear of the fallen, remains of vermin, and whatever you forbade on purpose.',
    steps: [
      'Claim what you want to use: select it in the game and switch Forbid off, or drag the Claim tool from the item designations over an area.',
      'Leave vermin remains forbidden. Nobody needs them, and the game forbids them for you.',
      'Metal gear from enemies can be claimed and melted into bars at a smelter.',
    ],
    dfhack: [
      {
        command: 'unforbid all',
        what: 'claims everything forbidden that dwarves can reach, including what you forbade on purpose',
      },
    ],
  },
  loose: {
    label: 'Lying around',
    blurb: 'On the floor outside any stockpile, waiting to be hauled.',
    steps: [
      'Make a stockpile that takes them, next to the workshop that uses them: logs by the carpenter, stone by the mason, cloth by the clothier.',
      'In the stockpile settings, allow wheelbarrows for stone and bins for small goods: fewer trips, more room.',
      'Keep the hauling labors on for most dwarves.',
      'Stone left where it was mined does no harm. Haul only what the masons need.',
    ],
    actions: ['combine'],
  },
  refuse: {
    label: 'Corpses and refuse',
    blurb: 'Bodies, body parts, remains and anything rotten that is not in a coffin.',
    steps: [
      'Bury your own dead: place coffins and draw a tomb zone over them; dwarves carry the bodies there.',
      'Stockpiles → Refuse, outside or behind a door, for everything else. Rotting things indoors fill the halls with miasma.',
      "Butcher fresh animal corpses at a butcher's shop for meat, fat, bone and skin.",
      "Bones, skulls and shells make crafts and bolts at a craftsdwarf's workshop, and macabre moods ask for them.",
    ],
    actions: ['burial'],
  },
  enemy: {
    label: 'Enemy gear',
    blurb: 'Weapons and armor made abroad that nobody wears: loot from invaders and the fallen.',
    steps: [
      'Claim it first: gear dropped by enemies is forbidden.',
      'Mark the metal pieces for melting with the item designations; a smelter with fuel turns them back into bars.',
      'Good pieces can equip your squads. Everything else sells to caravans or goes to the garbage dump.',
    ],
  },
  worn: {
    label: 'Worn',
    blurb:
      'Showing wear: x is worn, X threadbare, XX tattered. Dwarves are unhappy in threadbare clothes.',
    steps: [
      "Make new clothes at a clothier's shop from cloth or leather: shirts, trousers, socks, shoes.",
      'Dwarves change into fresh clothes once there are some in store, and leave the old ones lying about.',
      'Mark tattered leftovers for the garbage dump.',
    ],
    actions: ['tailor', 'cleanowned'],
  },
  artifacts: {
    label: 'Artifacts',
    blurb: 'Unique works from strange moods, and books written in the fortress.',
    steps: [
      'Show them off: a display case or pedestal inside a temple, guildhall, tavern or library holds one, and everyone who admires it is pleased.',
      'Keep them behind doors you can lock. Thieves come for artifacts, and some visitors ask to see them.',
    ],
  },
  carried: {
    label: 'Carried',
    blurb: 'Worn, wielded, or on its way somewhere in someone’s hands.',
  },
  merchant: {
    label: 'Merchants’ goods',
    blurb: 'For sale by a caravan at the depot.',
    steps: [
      'Bring goods to the depot and send your broker to trade.',
      'Pay with crafts, cut gems and fine furniture; cheap to make, and caravans value them.',
      'Buy what you cannot make yourself: metal, cloth, leather, food, animals, seeds.',
    ],
  },
  elsewhere: {
    label: 'Elsewhere in the world',
    blurb:
      'Artifacts and books the game knows about that are not on this map. They are held at other sites or by travellers, and do not count toward the fortress.',
  },
}

// ---------------------------------------------------------------------------
// What one item is good for

export interface ItemHint {
  title: string
  text: string
  /** Something wrong with it, rather than a use for it. */
  problem?: boolean
}

/** A few things worth knowing about one item: what is wrong with it and what it is for. */
export function itemHints(item: FortItem): ItemHint[] {
  const f = item.flags
  const out: ItemHint[] = []
  const add = (hint: ItemHint) => out.push(hint)
  const material = item.material.toLowerCase()
  const metal = item.mat_class === 'METAL'
  const loose = isLooseItem(item)

  if (item.x === null) {
    return [
      {
        title: 'Not in the fortress',
        text: 'The game knows of it, but it lies elsewhere in the world: at another site or with a traveller. The legends pages may tell you who holds it.',
      },
    ]
  }
  if (f.includes('trader')) {
    return [
      {
        title: 'For sale',
        text: "It belongs to a merchant. Trade for it at the depot while the caravan is here; your broker's skill decides the price.",
      },
    ]
  }

  // What is wrong with it.
  if (f.includes('forbid'))
    add({
      title: 'Forbidden',
      problem: item.type !== 'REMAINS',
      text:
        item.type === 'REMAINS'
          ? 'Vermin remains are forbidden by the game. Leave them be, or clear them into a refuse stockpile.'
          : 'Dwarves ignore it until you claim it. Select it in the game and switch Forbid off.',
    })
  if (f.includes('rotten'))
    add({
      title: 'Rotting',
      problem: true,
      text: 'Indoors it fills the air with miasma. Mark it for dumping, or let a refuse stockpile outside take it.',
    })
  if (item.wear >= 2 && CLOTHING_TYPES.has(item.type))
    add({
      title: item.wear >= 3 ? 'Tattered' : 'Threadbare',
      problem: true,
      text:
        item.holder_unit_id !== null
          ? 'Whoever wears it is unhappy about it. Make new clothes and they will change on their own.'
          : 'Nobody will wear it again. Mark it for the garbage dump.',
    })
  if (f.includes('foreign') && GEAR_TYPES.has(item.type) && item.holder_unit_id === null)
    add({
      title: 'Loot',
      text: metal
        ? 'Made abroad. Melt it at a smelter for bars (mark it for melting first), or give it to a squad.'
        : 'Made abroad. Give it to a squad, sell it to a caravan, or mark it for the garbage dump.',
    })

  // What it is for.
  if (f.includes('artifact') && item.type !== 'BOOK') {
    add({
      title: 'Artifact',
      text:
        item.holder_building_id !== null
          ? 'It is on display or set in a building. Keep the room behind a door you can lock.'
          : 'One of a kind. Put it in a display case or on a pedestal in a temple, guildhall or tavern for all to admire.',
    })
  }
  switch (item.type) {
    case 'CORPSE':
      add({
        title: 'Corpse',
        text:
          item.race_id === 'DWARF'
            ? 'Bury it: dwarves carry the dead to a free coffin in a tomb zone. Unburied dead can return as ghosts.'
            : "A fresh animal corpse can be butchered at a butcher's shop. Otherwise a refuse stockpile outside keeps the miasma away.",
      })
      break
    case 'CORPSEPIECE': {
      const parts = item.corpse_flags ?? []
      if (parts.some((p) => ['bone', 'skull', 'shell', 'horn', 'tooth'].includes(p)))
        add({
          title: 'Bone, shell or horn',
          text: 'Craftsdwarves carve it into crafts and bolts. Keep a few for macabre moods, which demand bones and skulls; shells go to other moods too.',
        })
      else
        add({
          title: 'Body part',
          text: 'Once rotten it is only refuse. A refuse stockpile outside keeps the miasma away.',
        })
      break
    }
    case 'BOULDER': {
      const metals = ORE_METALS[material]
      if (metals)
        add({
          title: `${material.charAt(0).toUpperCase()}${material.slice(1)} ore`,
          text: `Smelts into ${list(metals)} at a smelter, with one bar of charcoal or coke as fuel.`,
        })
      else if (COAL_STONES.has(material))
        add({
          title: 'Coal',
          text: 'Make coke from it at a smelter: fuel for smelting and forging that saves your logs.',
        })
      else if (FLUX_STONES.has(material))
        add({
          title: 'Flux stone',
          text: 'Steel needs it: iron, coke and a flux stone at a smelter. Keep some aside, and make the rest into blocks.',
        })
      else
        add({
          title: 'Stone',
          text: 'Masons make it into blocks, furniture and coffins; craftsdwarves into mugs and crafts to trade.',
        })
      break
    }
    case 'WOOD':
      add({
        title: 'Logs',
        text: 'Carpenters make beds, barrels, bins and buckets from them; a wood furnace burns them into charcoal.',
      })
      break
    case 'ROUGH':
      add({
        title: 'Rough gem',
        text: "Cut it at a jeweler's workshop: cut gems are worth far more and can be set into furniture. Keep a few rough ones for moods.",
      })
      break
    case 'SMALLGEM':
      add({
        title: 'Cut gem',
        text: "Set it into furniture or crafts at a jeweler's workshop to raise their value, or trade it.",
      })
      break
    case 'THREAD':
      add(
        f.includes('spider_web')
          ? {
              title: 'Uncollected web',
              text: '"Collect webs" at a loom turns webs into silk thread. Keep the collectors away from the spider that spun it.',
            }
          : {
              title: 'Thread',
              text: 'Weave it into cloth at a loom, and keep some in the hospital: doctors suture wounds with it.',
            },
      )
      break
    case 'CLOTH':
      add({
        title: 'Cloth',
        text: "Clothiers make clothes and bags from it; doctors dress wounds with it. A dyer's shop makes it worth more.",
      })
      break
    case 'SKIN_TANNED':
      add({
        title: 'Leather',
        text: 'Leather works make it into bags, waterskins, quivers and armor for your squads.',
      })
      break
    case 'BAR':
      add(
        /soap/.test(material)
          ? {
              title: 'Soap',
              text: 'Doctors clean wounds with it; keep a few bars in the hospital.',
            }
          : isFuelBar(material)
            ? {
                title: 'Fuel',
                text: 'Burnt by smelters and forges: one bar per job unless you work with magma.',
              }
            : metal
              ? {
                  title: 'Metal bar',
                  text: "A metalsmith's forge makes weapons, armor, anvils and tools from it. Keep a few for moods.",
                }
              : { title: 'Bar', text: 'Used by furnaces and forges.' },
      )
      break
    case 'SEEDS':
      add({
        title: 'Seed',
        text: 'Planted in a farm plot. Cooking destroys seeds, while brewing and eating raw give them back.',
      })
      break
    case 'PLANT':
    case 'PLANT_GROWTH':
      add({
        title: 'Plant',
        text: "Brew it at a still, cook it at a kitchen, or process it at a farmer's workshop for thread or syrup.",
      })
      break
    case 'DRINK':
      add({
        title: 'Drink',
        text: 'Dwarves need it more than food. Keep it in barrels near the dining hall or tavern, with mugs close by.',
      })
      break
    case 'FOOD':
      add({
        title: 'Prepared meal',
        text: 'Keeps for a long time in a food stockpile, and dwarves prefer meals to raw food.',
      })
      break
    case 'MEAT':
    case 'FISH':
    case 'FISH_RAW':
    case 'EGG':
      add({
        title: 'Raw food',
        text: 'Rots unless it is eaten or cooked soon. Cook it into meals at a kitchen, which keep for years.',
      })
      break
    case 'GOBLET':
      add({
        title: 'Mug',
        text: 'Dwarves drink from it. Without one they grumble; keep one for each dwarf near the drink.',
      })
      break
    case 'BARREL':
    case 'BIN':
    case 'BAG':
      add({
        title: 'Container',
        text: 'Stockpiles fill them with goods, and brewing needs empty barrels. Keep a few empty ones in store.',
      })
      break
    case 'CAGE':
      add({
        title: 'Cage',
        text: 'Cage traps need an empty cage each. Captured animals can be tamed; captured enemies stripped.',
      })
      break
    case 'TRAPPARTS':
      add({
        title: 'Mechanism',
        text: 'Levers, bridges, floodgates and traps are all built with mechanisms.',
      })
      break
    case 'WEAPON':
    case 'ARMOR':
    case 'HELM':
    case 'SHIELD':
    case 'SHOES':
    case 'GLOVES':
    case 'PANTS':
      if (item.holder_unit_id === null && !f.includes('foreign') && metal)
        add({
          title: 'Military gear',
          text: 'Squads pick it up when their uniform asks for it: set uniforms in the Squads screen.',
        })
      break
    case 'SLAB':
      add({
        title: 'Slab',
        text: "Engraved at a mason's workshop, it becomes a memorial for a dwarf whose body was never recovered.",
      })
      break
    case 'COFFIN':
      if (loose)
        add({
          title: 'Unplaced coffin',
          text: 'Place it (Build → Furniture → Coffin) and draw a tomb zone over it, so the dead can be buried.',
        })
      break
    case 'BOOK':
      add({
        title: 'Written work',
        text: 'Keep it in a bookcase in a library, where scholars read and copy it.',
      })
      break
    case 'REMAINS':
      break
    default:
      if (CRAFT_TYPES.has(item.type))
        add({
          title: 'Trade good',
          text: 'Caravans buy crafts gladly. Bring it to the depot when one arrives.',
        })
      else if (FURNITURE_TYPES.has(item.type) && loose)
        add({
          title: 'Unplaced furniture',
          text: 'Place it from the Build menu. Furnished rooms make dwarves happy and raise the fortress’s value.',
        })
  }
  if (loose && !f.includes('forbid') && !REFUSE_TYPES.has(item.type) && !out.some((h) => h.problem))
    out.push({
      title: 'Lying around',
      text: 'It is on the floor. A stockpile that accepts it gets it hauled somewhere it can be found.',
    })
  return out.slice(0, 3)
}

// ---------------------------------------------------------------------------
// The stores, checked

/** The fortress-wide advice that is about what the stores hold. */
const STORE_ADVICE_KEYS = new Set([
  'drink',
  'food',
  'metal',
  'cloth',
  'clothes',
  'forbidden',
  'refuse',
  'cups',
  'trade',
])

const rank: Record<AdviceStatus, number> = { problem: 0, attention: 1, good: 2 }

interface StoreFacts {
  pop: number
  citizens: FortUnit[]
  stock: (key: string) => number
  shops: Record<string, number>
  zones: Record<string, number>
  built: Record<string, number>
  metalBars: number
}

function storeFacts({ summary, units, buildings, supplies }: AdvisorInput): StoreFacts | null {
  if (!summary || !supplies) return null
  const citizens = units.filter((u) => isLiving(u) && isCitizenish(u))
  if (!citizens.length) return null
  const shops: Record<string, number> = {}
  const zones: Record<string, number> = {}
  const built: Record<string, number> = {}
  for (const b of buildings) {
    if (b.type === 'Civzone' && b.subtype) zones[b.subtype] = (zones[b.subtype] ?? 0) + 1
    else if (SHOP_TYPES.has(b.type) && b.subtype) shops[b.subtype] = (shops[b.subtype] ?? 0) + 1
    else built[b.type] = (built[b.type] ?? 0) + 1
  }
  return {
    pop: citizens.length,
    citizens,
    stock: (key) => summary.stocks.find((s) => s.key === key)?.count ?? 0,
    shops,
    zones,
    built,
    metalBars: Object.values(supplies.bars).reduce((a, b) => a + b, 0),
  }
}

function topTypes(counts: Record<string, number>, max = 3): string[] {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([type, n]) => `${fmt(n)} ${TYPE_WORDS[type] ?? type.toLowerCase().replace(/_/g, ' ')}`)
}

const TYPE_WORDS: Record<string, string> = {
  WOOD: 'logs',
  BOULDER: 'boulders',
  BLOCKS: 'blocks',
  ROUGH: 'rough gems',
  SMALLGEM: 'cut gems',
  BAR: 'bars',
  TRAPPARTS: 'mechanisms',
  SKIN_TANNED: 'leather',
  CORPSEPIECE: 'body parts',
  PLANT_GROWTH: 'fruit and leaves',
}

/** Checks on the stores themselves, beyond what the fortress-wide advice covers. */
function storeChecks(input: AdvisorInput, facts: StoreFacts): Advice[] {
  const supplies = input.supplies
  if (!supplies) return []
  const { pop, citizens, stock, shops, zones, built, metalBars } = facts
  const out: Advice[] = []
  const add = (advice: Advice) => out.push(advice)
  const logs = stock('logs')
  const stone = stock('stone')
  const blocks = stock('blocks')
  const cloth = stock('cloth')
  const leather = stock('leather')
  const cutGems = stock('gems_cut')

  // Containers
  {
    const bins = supplies.bins
    const vessels = supplies.emptyBarrels + supplies.emptyPots
    const bags = supplies.bags
    const wantBins = Math.max(5, Math.ceil(pop / 2))
    const wantVessels = Math.max(5, Math.ceil(pop / 3))
    const short = compact([
      bins < wantBins && 'bins',
      vessels < wantVessels && 'barrels',
      bags < 5 && 'bags',
    ])
    const status: AdviceStatus = !short.length ? 'good' : vessels === 0 ? 'problem' : 'attention'
    add({
      key: 'stores-containers',
      area: 'industry',
      status,
      weight: vessels === 0 ? 80 : 40,
      title: status === 'good' ? 'Room to store things' : `Make ${list(short)}`,
      why: `${plural(bins, 'bin')}, ${plural(vessels, 'empty barrel or pot', 'empty barrels and pots')} and ${plural(bags, 'bag')}. Every brew needs an empty barrel or pot, a bin packs many small goods onto one stockpile tile, and seeds and flour keep in bags.`,
      steps: compact([
        `At a carpenter's workshop, make bins and barrels from logs (${fmt(logs)} in store).${shops.Kiln ? ' Large pots from the kiln work like barrels.' : ''}`,
        bags < 5 &&
          `Bags come from cloth at a clothier's shop or leather at the leather works (${plural(cloth, 'cloth', 'cloth')} and ${fmt(leather)} leather in store).`,
        'In each stockpile’s settings, allow bins for small goods and barrels for food and drink.',
        'Merging half-empty stacks frees containers without making new ones.',
      ]),
      actions: ['combine'],
    })
  }

  // Things lying around
  {
    const stoneLeft = supplies.loose.BOULDER ?? 0
    const rest = Object.fromEntries(
      Object.entries(supplies.loose).filter(([type]) => type !== 'BOULDER'),
    )
    const other = Object.values(rest).reduce((a, b) => a + b, 0)
    const status: AdviceStatus = other >= Math.max(100, pop * 5) ? 'attention' : 'good'
    add({
      key: 'stores-hauling',
      area: 'industry',
      status,
      weight: 30,
      title: status === 'good' ? 'The stores are tidy' : 'Haul in what lies around',
      why: `${plural(other, 'item lies', 'items lie')} outside any stockpile${other ? `, mostly ${list(topTypes(rest))}` : ''}${stoneLeft ? `, besides ${plural(stoneLeft, 'boulder')} of stone where it was mined` : ''}. Workers walk to wherever things lie, so every job that needs them takes longer.`,
      steps: compact([
        other > 0 &&
          `Make stockpiles for ${list(topTypes(rest).map((t) => t.replace(/^[\d,]+ /, '')))}, next to the workshops that use them.`,
        `In the stockpile settings, allow wheelbarrows for stone and bins for small goods${supplies.wheelbarrows ? ` (${plural(supplies.wheelbarrows, 'wheelbarrow')} in the fortress)` : ''}.`,
        'Keep the hauling labors on for most dwarves; turn them off only for your best craftsdwarves.',
        stoneLeft > 0 &&
          'Stone left where it was mined can stay there. Haul only what the masons need.',
      ]),
      link: { to: '/fortress/items', label: 'Show what lies around', view: 'loose' },
    })
  }

  // Wood and stone
  {
    const status: AdviceStatus = logs < 10 || stone < 10 ? 'attention' : 'good'
    add({
      key: 'stores-raw',
      area: 'industry',
      status,
      weight: logs < 10 ? 50 : 30,
      title:
        status === 'good'
          ? 'Wood and stone in store'
          : logs < 10
            ? 'Cut more trees'
            : 'Mine more stone',
      why: `${plural(logs, 'log')}, ${plural(stone, 'boulder')} of stone and ${plural(blocks, 'block')}. Logs make beds, barrels, bins and charcoal; stone makes blocks, furniture, mugs and crafts.`,
      steps: compact([
        logs < 50
          ? 'Designate trees to cut down, on the surface or among the tower-caps in the caverns if they are safe.'
          : 'Keep a woodcutter busy now and then, so the log pile never runs dry.',
        stone < 50 && 'Dig new rooms or tunnels: digging through stone leaves boulders behind.',
        'Masons turn boulders into blocks, which build faster and are worth more than raw stone.',
        'Caravans sell logs when nothing grows nearby.',
      ]),
      dfhack: [
        {
          command: 'enable autochop',
          what: 'designates trees to cut whenever the log stock runs low (targets are set in gui/autochop)',
        },
      ],
    })
  }

  // Hospital supplies
  {
    const needs: [string, number, number, string][] = [
      ['thread', supplies.thread, 5, "spin it at a farmer's workshop or collect webs at a loom"],
      ['cloth', cloth, 5, 'weave it at a loom'],
      ['splints', supplies.splints, 2, "a carpenter's workshop makes them"],
      ['crutches', supplies.crutches, 2, "a carpenter's workshop makes them"],
      ['soap', supplies.soap, 1, "a soap maker's workshop makes it from lye and tallow"],
      ['buckets', supplies.buckets, 2, "a carpenter's workshop makes them"],
    ]
    const missing = needs.filter(([, have, want]) => have < want)
    const hurt = citizens.filter((u) => u.wounds > 0)
    const status: AdviceStatus = !missing.length ? 'good' : hurt.length ? 'problem' : 'attention'
    add({
      key: 'stores-hospital',
      area: 'health',
      status,
      weight: hurt.length ? 90 : 45,
      title: status === 'good' ? 'Medical supplies in store' : 'Stock up on medical supplies',
      why: `${needs.map(([label, have]) => `${fmt(have)} ${label}`).join(', ')}. Doctors suture with thread, dress wounds with cloth, set bones with splints and wash wounds with soap; without them the hurt heal badly.`,
      steps: [
        ...missing.map(
          ([label, have, want, how]) =>
            `${label.charAt(0).toUpperCase()}${label.slice(1)}: ${fmt(have)} of at least ${want}; ${how}.`,
        ),
        zones.Hospital
          ? 'In the hospital zone’s settings, set how much of each it should keep; dwarves stock it for you.'
          : 'Designate a hospital zone first, then set how many of each supply it should keep.',
      ],
      units: hurt,
    })
  }

  // Materials strange moods ask for
  {
    const kinds: [string, number][] = [
      ['rough gems', supplies.roughGems],
      ['cut gems', cutGems],
      ['metal bars', metalBars],
      ['cloth', cloth],
      ['leather', leather],
      ['bones', supplies.bones],
      ['shells', supplies.shells],
      ['logs', logs],
      ['blocks', blocks],
    ]
    const missing = kinds.filter(([, n]) => n === 0).map(([label]) => label)
    add({
      key: 'stores-moods',
      area: 'comfort',
      status: missing.length >= 2 ? 'attention' : 'good',
      weight: 25,
      title:
        missing.length >= 2 ? 'Keep a little of what moods ask for' : 'Ready for a strange mood',
      why: missing.length
        ? `A dwarf in a strange mood demands materials for a masterpiece, and goes mad if the fortress cannot supply them. You have no ${list(missing)}.`
        : 'You keep some of every material a strange mood tends to ask for.',
      steps: compact([
        'Moods ask for what their craft works with, often gems, metal bars, cloth, leather, bone or shell, besides logs or blocks.',
        'Keep a few of each in a small stockpile near the workshops.',
        (missing.includes('bones') || missing.includes('shells')) &&
          'Bones come from butchered animals and cleared refuse; shells from turtles and shellfish.',
        missing.includes('metal bars') &&
          'Smelt a little ore, or melt a piece of loot, to keep a few bars around.',
        'When a mood strikes, select the workshop to see what it lacks, then mine, make or buy it fast.',
      ]),
    })
  }

  // Rough gems
  if (supplies.roughGems + cutGems > 0) {
    const jewelers = shops.Jewelers ?? 0
    const cutters = skilledIn(citizens, ['CUTGEM'])
    const status: AdviceStatus = supplies.roughGems >= 10 ? 'attention' : 'good'
    add({
      key: 'stores-gems',
      area: 'trade',
      status,
      weight: 30,
      title:
        status === 'good'
          ? 'Gems cut'
          : jewelers
            ? 'Cut your rough gems'
            : "Build a jeweler's workshop",
      why: `${plural(supplies.roughGems, 'rough gem')} and ${plural(cutGems, 'cut gem')} in store. Cut gems are worth many times more, sell well, and raise the value of anything they are set into.`,
      steps: compact([
        !jewelers && "Build → Workshops → Jeweler's workshop.",
        cutters.length
          ? `${names(cutters.map((c) => c.unit))} can cut gems.`
          : 'Nobody has cut gems before: enable Gem cutting for a dwarf in the Labor screen.',
        'Add a "Cut gems" work order with a condition, so it runs while rough gems are in store.',
        'Keep a few rough gems of each kind aside for strange moods.',
        'Set cut gems into furniture and crafts (Encrust) to multiply their value.',
      ]),
    })
  }

  // Loot
  if (supplies.enemyGear.items > 0) {
    const gear = supplies.enemyGear
    add({
      key: 'stores-loot',
      area: 'industry',
      status: 'attention',
      weight: metalBars === 0 && gear.metal ? 45 : 25,
      title: gear.metal ? 'Melt or use the loot' : 'Put the loot to use',
      why: `${plural(gear.items, 'piece')} of weapons and armor made abroad lie around${gear.metal ? `, ${fmt(gear.metal)} of them metal` : ''}, worth ${fmt(gear.value)}☼.${metalBars === 0 && gear.metal ? ' Your stores hold no metal bars; melting this makes some.' : ''}`,
      steps: compact([
        'Claim it first: loot dropped by enemies is forbidden.',
        gear.metal > 0 &&
          `Mark the metal pieces for melting with the item designations. A smelter${shops.Smelter || shops.MagmaSmelter ? '' : ' (you have none yet)'} then melts them into bars, one bar of fuel per job.`,
        'Give good pieces to your squads by setting their uniforms to use what is in store.',
        'Sell the rest to a caravan, or mark it for the garbage dump.',
      ]),
      link: { to: '/fortress/items', label: 'Show the loot', view: 'enemy' },
    })
  }

  // Artifacts
  if (supplies.artifacts.loose > 0) {
    const art = supplies.artifacts
    add({
      key: 'stores-artifacts',
      area: 'comfort',
      status: 'attention',
      weight: 20,
      title: 'Put your artifacts on display',
      why: `${plural(art.loose, 'artifact lies', 'artifacts lie')} about unguarded, of ${fmt(art.items)} in the fortress worth ${fmt(art.value)}☼ together.`,
      steps: [
        'Build a display case or pedestal (Build → Furniture) inside a temple, guildhall, tavern or library, and choose the artifact to show.',
        'Displayed artifacts count toward the fortress’s wealth, and dwarves enjoy admiring them.',
        'Keep them behind doors you can lock: thieves and some visitors come for artifacts.',
      ],
      link: { to: '/fortress/items', label: 'Show the artifacts', view: 'artifacts' },
    })
  }

  // Rot
  if (supplies.rotting > 0) {
    const miasma = fortFeelings(input.units, input.now)
      .filter((f) => f.thought === 'Miasma' && f.tone === 'bad')
      .flatMap((f) => f.units)
    add({
      key: 'stores-rot',
      area: 'comfort',
      status: 'attention',
      weight: miasma.length ? 55 : 30,
      title: 'Keep food from rotting',
      why: `${plural(supplies.rotting, 'item has', 'items have')} gone rotten. Rotting food and bodies fill the air with miasma indoors.`,
      steps: [
        'Store food and drink in barrels and pots, in stockpiles underground: they keep far longer there.',
        'Cook raw meat and fish soon after butchering; meals keep for years.',
        'Mark rotten items for dumping, or let a refuse stockpile outside take them.',
      ],
      units: miasma,
      link: { to: '/fortress/items', label: 'Show refuse and rot', view: 'refuse' },
    })
  }

  // Seeds
  {
    const plots = built.FarmPlot ?? 0
    const seeds = stock('seeds')
    if (plots)
      add({
        key: 'stores-seeds',
        area: 'food',
        status: seeds === 0 ? 'problem' : seeds < 20 ? 'attention' : 'good',
        weight: seeds < 20 ? 70 : 20,
        title: seeds >= 20 ? 'Seeds for the fields' : 'Save your seeds',
        why: `${plural(seeds, 'seed')} for ${plural(plots, 'farm plot')}. Cooking destroys seeds; brewing and eating plants raw give them back.`,
        steps: [
          'Keep cooks away from seeds and from plants you still need to plant.',
          'Gather wild plants (Zones → Gather fruit) for new kinds of seed.',
          'Caravans sell seeds; the elves bring surface ones in spring.',
        ],
        actions: ['seedwatch', 'banCooking'],
      })
  }

  return out
}

/** Everything the items page advises about the stores, problems first. */
export function storesAdvice(input: AdvisorInput): Advice[] {
  const facts = storeFacts(input)
  const shared = fortAdvice(input).filter((a) => STORE_ADVICE_KEYS.has(a.key))
  const own = facts ? storeChecks(input, facts) : []
  return [...shared, ...own].sort((a, b) => rank[a.status] - rank[b.status] || b.weight - a.weight)
}

// ---------------------------------------------------------------------------
// At a glance

export interface StoreTile {
  key: string
  label: string
  value: string
  detail: string
  /** The advice that explains the tile; its status colours it. */
  advice: string
  sprite: SpriteItem
}

/** A made-up item for drawing a kind of thing: its type and, optionally, material. */
export function spriteOf(type: string, extra: Partial<SpriteItem> = {}): SpriteItem {
  return {
    type,
    subtype_id: null,
    mat_class: null,
    color: null,
    flags: [],
    material: '',
    description: '',
    race_id: null,
    caste_id: null,
    plant_id: null,
    corpse_flags: null,
    ...extra,
  }
}

export function storeTiles(input: AdvisorInput): StoreTile[] {
  const facts = storeFacts(input)
  const supplies = input.supplies
  if (!facts || !supplies) return []
  const { pop, stock, metalBars } = facts
  const food = ['meals', 'meat', 'fish', 'plants', 'cheese', 'eggs'].reduce(
    (s, k) => s + stock(k),
    0,
  )
  const ore = supplies.ores.reduce((s, o) => s + o.boulders, 0)
  const loose = Object.entries(supplies.loose)
    .filter(([type]) => type !== 'BOULDER')
    .reduce((s, [, n]) => s + n, 0)
  const forbidden = Object.values(supplies.forbidden).reduce((a, b) => a + b, 0)
  return [
    {
      key: 'drink',
      label: 'Drink',
      value: `${fmt(Math.floor(stock('drink') / pop))} each`,
      detail: `${fmt(stock('drink'))} in store`,
      advice: 'drink',
      sprite: spriteOf('DRINK'),
    },
    {
      key: 'food',
      label: 'Food',
      value: `${fmt(Math.floor(food / pop))} each`,
      detail: `${plural(stock('meals'), 'meal')}, ${plural(stock('seeds'), 'seed')}`,
      advice: 'food',
      sprite: spriteOf('FOOD'),
    },
    {
      key: 'raw',
      label: 'Wood and stone',
      value: plural(stock('logs'), 'log'),
      detail: `${fmt(stock('stone'))} stone, ${plural(stock('blocks'), 'block')}`,
      advice: 'stores-raw',
      sprite: spriteOf('WOOD'),
    },
    {
      key: 'metal',
      label: 'Metal',
      value: plural(metalBars, 'bar'),
      detail: `${fmt(supplies.fuelBars)} fuel, ${fmt(ore)} ore`,
      advice: 'metal',
      sprite: spriteOf('BAR', { mat_class: 'METAL' }),
    },
    {
      key: 'cloth',
      label: 'Cloth and leather',
      value: `${fmt(stock('cloth'))} cloth`,
      detail: `${fmt(stock('leather'))} leather, ${plural(supplies.webs, 'web')}`,
      advice: 'cloth',
      sprite: spriteOf('CLOTH'),
    },
    {
      key: 'containers',
      label: 'Containers',
      value: plural(supplies.bins, 'bin'),
      detail: `${plural(supplies.emptyBarrels + supplies.emptyPots, 'empty barrel')}, ${plural(supplies.bags, 'bag')}`,
      advice: 'stores-containers',
      sprite: spriteOf('BIN', { mat_class: 'WOOD' }),
    },
    {
      key: 'trade',
      label: 'Trade goods',
      value: fmt(supplies.tradeGoods),
      detail: `${plural(supplies.roughGems, 'rough gem')} to cut`,
      advice: 'trade',
      sprite: spriteOf('FIGURINE', { mat_class: 'WOOD' }),
    },
    {
      key: 'clutter',
      label: 'Lying around',
      value: fmt(loose),
      detail: `${fmt(forbidden)} forbidden, ${fmt(supplies.looseRefuse)} refuse`,
      advice: 'stores-hauling',
      sprite: spriteOf('BOULDER'),
    },
  ]
}

// ---------------------------------------------------------------------------
// Worth making next

export interface PlanRow {
  key: string
  label: string
  sprite: SpriteItem
  have: number
  want: number
  status: AdviceStatus
  /** WORKSHOPS key of where it is made. */
  shop: string
  /** How many of those the fortress has. */
  built: number
  /** The task to queue there. */
  task: string
  /** What it takes, and how much of that is in store. */
  from: string
  why: string
  /** Citizens who have done the work before, best first. */
  hands: FortUnit[]
  actions?: DfhackAction[]
}

/** What the fortress is short of, with where and from what to make it. Shortest first. */
export function productionPlan(input: AdvisorInput): PlanRow[] {
  const facts = storeFacts(input)
  const supplies = input.supplies
  if (!facts || !supplies) return []
  const { pop, citizens, stock, shops, zones, built, metalBars } = facts
  const logs = stock('logs')
  const stone = stock('stone')
  const ore = supplies.ores.reduce((s, o) => s + o.boulders, 0)
  const metalWork =
    ore > 0 ||
    (shops.Smelter ?? 0) +
      (shops.MagmaSmelter ?? 0) +
      (shops.MetalsmithsForge ?? 0) +
      (shops.MagmaForge ?? 0) >
      0
  const soldiers = citizens.filter((u) => u.squad).length
  const shopCount = (key: string) => shops[key] ?? 0

  const rows: Omit<PlanRow, 'status' | 'built' | 'hands'>[] = [
    {
      key: 'drink',
      label: 'Drink',
      sprite: spriteOf('DRINK'),
      have: stock('drink'),
      want: pop * 20,
      shop: 'Still',
      task: 'Brew drink from plant',
      from: `a plant and an empty barrel or pot each (${fmt(stock('plants'))} plants, ${fmt(supplies.emptyBarrels + supplies.emptyPots)} empty barrels and pots)`,
      why: 'Dwarves drink more than they eat, and work slowly when there is none.',
      actions: ['basicOrders'],
    },
    {
      key: 'meals',
      label: 'Prepared meals',
      sprite: spriteOf('FOOD'),
      have: stock('meals'),
      want: pop * 3,
      shop: 'Kitchen',
      task: 'Prepare easy meal',
      from: `two cookable ingredients (${fmt(stock('meat') + stock('fish'))} meat and fish, ${fmt(stock('plants'))} plants)`,
      why: 'Meals keep for years and dwarves enjoy them far more than raw food.',
      actions: ['banCooking'],
    },
    {
      key: 'mugs',
      label: 'Mugs',
      sprite: spriteOf('GOBLET', { mat_class: 'WOOD' }),
      have: supplies.cups,
      want: pop,
      shop: 'Craftsdwarfs',
      task: 'Make rock mug',
      from: `a stone each (${fmt(stone)} in store)`,
      why: 'Drinking without a mug makes dwarves grumble.',
    },
    {
      key: 'barrels',
      label: 'Empty barrels',
      sprite: spriteOf('BARREL', { mat_class: 'WOOD' }),
      have: supplies.emptyBarrels + supplies.emptyPots,
      want: Math.max(5, Math.ceil(pop / 3)),
      shop: 'Carpenters',
      task: 'Make wooden barrel',
      from: `a log each (${fmt(logs)} in store)`,
      why: 'Every brew needs an empty barrel or pot, and food keeps better in them.',
    },
    {
      key: 'bins',
      label: 'Bins',
      sprite: spriteOf('BIN', { mat_class: 'WOOD' }),
      have: supplies.bins,
      want: Math.max(5, Math.ceil(pop / 2)),
      shop: 'Carpenters',
      task: 'Make wooden bin',
      from: `a log each (${fmt(logs)} in store)`,
      why: 'A bin packs many small goods onto one stockpile tile: bars, gems, crafts, cloth, ammo.',
    },
    {
      key: 'bags',
      label: 'Bags',
      sprite: spriteOf('BAG'),
      have: supplies.bags,
      want: Math.max(5, Math.ceil(pop / 4)),
      shop: shopCount('Leatherworks') && !shopCount('Clothiers') ? 'Leatherworks' : 'Clothiers',
      task: 'Make bag',
      from: `one cloth or leather each (${fmt(stock('cloth'))} cloth, ${fmt(stock('leather'))} leather)`,
      why: 'Seeds, flour, sugar and sand are stored in bags.',
    },
    {
      key: 'cloth',
      label: 'Cloth',
      sprite: spriteOf('CLOTH'),
      have: stock('cloth'),
      want: Math.max(10, pop),
      shop: 'Loom',
      task: supplies.webs ? 'Collect webs, then weave cloth' : 'Weave cloth',
      from: `thread (${fmt(supplies.thread)} in store${supplies.webs ? `, ${fmt(supplies.webs)} webs to collect` : ''})`,
      why: 'Clothes, bags, rope and bandages are all made of cloth.',
    },
    {
      key: 'beds',
      label: 'Beds',
      sprite: spriteOf('BED', { mat_class: 'WOOD' }),
      have: stock('beds'),
      want: pop + Math.max(3, Math.ceil(pop / 5)),
      shop: 'Carpenters',
      task: 'Make wooden bed',
      from: `a log each (${fmt(logs)} in store)`,
      why: 'One for each dwarf and a few spare for the next migrants.',
    },
    {
      key: 'coffins',
      label: 'Coffins',
      sprite: spriteOf('COFFIN', { mat_class: 'STONE' }),
      have: stock('coffins'),
      want: Math.max(2, Math.ceil(pop / 10)),
      shop: 'Masons',
      task: 'Make rock coffin',
      from: `a stone each (${fmt(stone)} in store)`,
      why: 'The dead need somewhere to rest before grief and ghosts set in.',
    },
    {
      key: 'mechanisms',
      label: 'Mechanisms',
      sprite: spriteOf('TRAPPARTS', { mat_class: 'STONE' }),
      have: supplies.mechanisms,
      want: 5,
      shop: 'Mechanics',
      task: 'Make rock mechanisms',
      from: `a stone each (${fmt(stone)} in store)`,
      why: 'Levers, drawbridges and traps are built with them.',
    },
    {
      key: 'buckets',
      label: 'Buckets',
      sprite: spriteOf('BUCKET', { mat_class: 'WOOD' }),
      have: supplies.buckets,
      want: 3,
      shop: 'Carpenters',
      task: 'Make wooden bucket',
      from: `a log each (${fmt(logs)} in store)`,
      why: 'Wells and the hospital need them to carry water.',
    },
  ]
  if (metalWork)
    rows.push(
      {
        key: 'fuel',
        label: 'Charcoal and coke',
        sprite: spriteOf('BAR', { material: 'charcoal' }),
        have: supplies.fuelBars,
        want: 10,
        shop: supplies.coalBoulders ? 'Smelter' : 'WoodFurnace',
        task: supplies.coalBoulders ? 'Make coke' : 'Make charcoal',
        from: supplies.coalBoulders
          ? `coal (${plural(supplies.coalBoulders, 'boulder')} in store)`
          : `a log each (${fmt(logs)} in store)`,
        why: 'Every smelting and forging job burns a bar unless you work with magma.',
        actions: ['furnaceOrders'],
      },
      {
        key: 'bars',
        label: 'Metal bars',
        sprite: spriteOf('BAR', { mat_class: 'METAL' }),
        have: metalBars,
        want: 20,
        shop: 'Smelter',
        task: 'Smelt ore',
        from: `ore and fuel (${fmt(ore)} ore boulders, ${fmt(supplies.fuelBars)} fuel${supplies.enemyGear.metal ? `, or melt ${fmt(supplies.enemyGear.metal)} pieces of loot` : ''})`,
        why: 'Anvils, picks, weapons and armor all start as bars.',
        actions: ['smeltingOrders'],
      },
    )
  if (supplies.roughGems > 0)
    rows.push({
      key: 'gems',
      label: 'Cut gems',
      sprite: spriteOf('SMALLGEM'),
      have: stock('gems_cut'),
      want: Math.min(10, supplies.roughGems + stock('gems_cut')),
      shop: 'Jewelers',
      task: 'Cut gems',
      from: `rough gems (${fmt(supplies.roughGems)} in store)`,
      why: 'Worth far more than rough ones, and set into furniture they multiply its value.',
    })
  if (built.TradeDepot)
    rows.push({
      key: 'crafts',
      label: 'Crafts to trade',
      sprite: spriteOf('FIGURINE', { mat_class: 'WOOD' }),
      have: supplies.tradeGoods,
      want: 20,
      shop: 'Craftsdwarfs',
      task: 'Make rock crafts',
      from: `stone, bone, shell or wood (${fmt(stone)} stone, ${fmt(supplies.bones + supplies.shells)} bone and shell)`,
      why: 'Cheap to make, and caravans pay with what you cannot make yourself.',
    })
  if (zones.Hospital)
    rows.push(
      {
        key: 'soap',
        label: 'Soap',
        sprite: spriteOf('BAR', { material: 'soap' }),
        have: supplies.soap,
        want: 3,
        shop: 'Soap',
        task: 'Make soap',
        from: 'lye and tallow',
        why: 'Doctors wash wounds with it, which keeps infection away.',
      },
      {
        key: 'splints',
        label: 'Splints',
        sprite: spriteOf('SPLINT'),
        have: supplies.splints,
        want: 2,
        shop: 'Carpenters',
        task: 'Make wooden splint',
        from: `a log each (${fmt(logs)} in store)`,
        why: 'Broken bones heal crooked without one.',
      },
      {
        key: 'crutches',
        label: 'Crutches',
        sprite: spriteOf('CRUTCH'),
        have: supplies.crutches,
        want: 2,
        shop: 'Carpenters',
        task: 'Make wooden crutch',
        from: `a log each (${fmt(logs)} in store)`,
        why: 'Dwarves with a hurt leg cannot walk without one.',
      },
    )
  if (soldiers > 0 || built.ArcheryTarget)
    rows.push({
      key: 'bolts',
      label: 'Bolts',
      sprite: spriteOf('AMMO', { subtype_id: 'ITEM_AMMO_BOLTS' }),
      have: stock('ammo'),
      want: 100,
      shop: 'Craftsdwarfs',
      task: 'Make bone or wooden bolts',
      from: `bones or logs (${fmt(supplies.bones)} bones, ${fmt(logs)} logs); metal bolts come from the forge`,
      why: 'Marksdwarves train and fight with them, and use them up.',
    })

  return rows
    .map((row): PlanRow => {
      const info = WORKSHOPS[row.shop]
      const status: AdviceStatus =
        row.have >= row.want ? 'good' : row.have < row.want / 4 ? 'problem' : 'attention'
      return {
        ...row,
        status,
        built: shopCount(row.shop),
        hands: info ? skilledIn(citizens, info.skills).map((s) => s.unit) : [],
      }
    })
    .sort(
      (a, b) =>
        rank[a.status] - rank[b.status] ||
        a.have / Math.max(1, a.want) - b.have / Math.max(1, b.want),
    )
}

// ---------------------------------------------------------------------------
// When something happens to the stores

/** Playbook entries from the work page that are about the stores. */
const SHARED_SITUATIONS = ['caravan', 'mood', 'failing', 'hunger']

/** Clauses joined into one sentence, or undefined when there are none. */
function sentence(
  clauses: (string | number | null | false | undefined)[],
  joiner = ', ',
): string | undefined {
  const text = compact(clauses).join(joiner)
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : undefined
}

export function storeSituations(input: AdvisorInput): Situation[] {
  const { supplies, events, now, units } = input
  const shared = situations(input)
    .filter((s) => SHARED_SITUATIONS.includes(s.key))
    .map((s) =>
      s.key === 'caravan' && !s.now && supplies?.merchantGoods.items
        ? {
            ...s,
            now: `${plural(supplies.merchantGoods.items, 'good')} for sale at the depot, worth ${fmt(supplies.merchantGoods.value)}☼.`,
          }
        : s,
    )
  const thefts = recentEvents(events, now, (e) =>
    /\b(stole|steals|stolen|thief|thieves|snatcher)\b/i.test(e.text),
  )
  const loose = supplies
    ? Object.entries(supplies.loose)
        .filter(([type]) => type !== 'BOULDER')
        .reduce((s, [, n]) => s + n, 0)
    : 0
  const miasma = fortFeelings(units, now).some((f) => f.thought === 'Miasma' && f.tone === 'bad')
  const stock = (key: string) => input.summary?.stocks.find((s) => s.key === key)?.count ?? null
  const logs = stock('logs')
  const stone = stock('stone')

  const own: Situation[] = [
    {
      key: 'loot',
      title: 'After a battle: bodies and loot',
      signs: 'Enemy dead and their gear scattered about the gates, much of it forbidden.',
      steps: [
        'Wait until the fighting is truly over before sending haulers outside.',
        'Bury your own dead in coffins inside tomb zones; dwarves do it on their own when a coffin is free.',
        'Claim the enemy gear, mark the metal pieces for melting, and give the best to your squads.',
        'A refuse stockpile away from the halls takes the enemy dead.',
        'Caged prisoners keep their gear on until you have it taken off them.',
      ],
      actions: ['burial'],
      dfhack: [
        {
          command: 'stripcaged all',
          what: 'marks everything caged creatures carry and wear for the garbage dump, so your dwarves take it',
        },
      ],
      now: sentence(
        [
          supplies?.enemyGear.items &&
            `${plural(supplies.enemyGear.items, 'piece')} of loot lying around`,
          supplies &&
            supplies.looseRefuse >= 10 &&
            `${plural(supplies.looseRefuse, 'body or remain', 'bodies and remains')} outside a stockpile`,
        ],
        ', and ',
      ),
    },
    {
      key: 'hauling',
      title: 'Stockpiles are full, or the hauling never ends',
      signs:
        'Goods piling up on the floor, long queues of hauling jobs, workshops cluttered with finished goods.',
      steps: [
        'Make stockpiles bigger, or add new ones next to the workshops that fill them.',
        'Allow bins and barrels in stockpile settings: one tile then holds many items.',
        'Merge half-empty stacks to free space and containers.',
        'Give more dwarves the hauling labors, and let stone stockpiles use wheelbarrows.',
        'Link a stockpile to a workshop (Give to) so goods go straight where they are needed.',
      ],
      actions: ['combine'],
      now:
        loose >= 150
          ? `${plural(loose, 'item lies', 'items lie')} outside any stockpile.`
          : undefined,
    },
    {
      key: 'rot',
      title: 'Food is rotting, and the halls smell',
      signs: 'Rotten items, flies, and dwarves complaining about miasma.',
      steps: [
        'Keep food and drink underground in barrels and pots: it keeps far longer.',
        'Move the refuse stockpile outside, or behind a door that stays shut.',
        'Cook raw meat and fish before it turns; butcher only what the kitchen can use.',
        'Mark rotten items for dumping, and bury or remove bodies quickly.',
      ],
      now: sentence(
        [
          supplies?.rotting && `${plural(supplies.rotting, 'item is', 'items are')} rotting`,
          miasma && 'dwarves choked on miasma this month',
        ],
        ', and ',
      ),
    },
    {
      key: 'theft',
      title: 'Something was stolen',
      signs: 'An announcement about a thief or a snatcher, or an artifact gone missing.',
      steps: [
        'Keep artifacts and valuables behind doors you can lock, away from the entrance.',
        'Line the entrance with cage traps: thieves sneak, but traps catch them.',
        'War dogs at the gate and a squad on patrol spot sneaking visitors.',
        'Check the visitors in your taverns and temples: some are thieves in disguise.',
      ],
      now: thefts.length ? thefts[0].text : undefined,
    },
    {
      key: 'raw',
      title: 'Running out of wood or stone',
      signs: 'Carpenters and masons idle, and jobs cancelled for want of logs or stone.',
      steps: [
        'Designate trees to cut down; cavern tower-caps grow back underground.',
        'Dig new rooms or tunnels for stone, or mine a quarry level.',
        'Buy logs from caravans; the elves bring wood but take offence if you cut too many trees.',
        'Build with blocks: a boulder makes several, so stone goes further.',
      ],
      dfhack: [
        {
          command: 'enable autochop',
          what: 'designates trees to cut whenever the log stock runs low',
        },
      ],
      now: sentence([
        logs !== null && logs < 10 && `only ${plural(logs, 'log')} left`,
        stone !== null && stone < 10 && `only ${plural(stone, 'boulder')} of stone left`,
      ]),
    },
  ]
  return [...shared, ...own].sort((a, b) => Number(Boolean(b.now)) - Number(Boolean(a.now)))
}
