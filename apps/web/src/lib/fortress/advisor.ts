import type {
  DfhackAction,
  FortBuilding,
  FortEvent,
  FortJob,
  FortSummary,
  FortUnit,
} from '@fortress/db-drizzle'

import { isLiving, splitPascal, stressLabel, unitGroup } from './format'
import {
  type GameTime,
  TICKS_PER_MONTH,
  absTicks,
  cancellationHint,
  creatureCounts,
  firstName,
  fortFeelings,
  isCitizenish,
  isGrownCitizen,
  pronouns,
  seasonOf,
} from './insights'
import type { FortConcerns, FortSupplies } from './server'
import type { ItemView } from './stores'

/*
 * Client-safe: what a thriving fortress needs, checked against the dump,
 * with what to do in the game when a check fails. Everything here reads
 * data the pages already fetch; nothing is sent to the game.
 */

export type AdviceStatus = 'good' | 'attention' | 'problem'
export type AdviceArea = 'food' | 'health' | 'safety' | 'industry' | 'labor' | 'comfort' | 'trade'

export const AREAS: Record<AdviceArea, { label: string; blurb: string }> = {
  food: {
    label: 'Food and drink',
    blurb: 'Enough to eat and drink, and the means to make more.',
  },
  health: {
    label: 'Health and the dead',
    blurb: 'Somewhere to heal, and somewhere to rest.',
  },
  safety: {
    label: 'Safety',
    blurb: 'Soldiers, traps, and a way to shut the gates.',
  },
  industry: {
    label: 'Industry',
    blurb: 'Raw materials turned into what the fortress needs.',
  },
  labor: { label: 'Labor', blurb: 'The right dwarves on the right jobs.' },
  comfort: {
    label: 'Comfort',
    blurb: 'Beds, meals and things to do keep dwarves happy.',
  },
  trade: { label: 'Trade', blurb: 'Goods to sell, and someone to sell them.' },
}

export const AREA_ORDER: AdviceArea[] = [
  'food',
  'health',
  'safety',
  'industry',
  'labor',
  'comfort',
  'trade',
]

/** A DFHack command that does the job for you, and what it does. */
export interface Shortcut {
  command: string
  what: string
}

export interface Advice {
  key: string
  area: AdviceArea
  status: AdviceStatus
  /** Higher comes first among advice of the same status. */
  weight: number
  /** A statement when good ("Drink is flowing"), an instruction otherwise ("Brew more drink"). */
  title: string
  /** What the dump shows. */
  why: string
  /** What to do in the game, in order. */
  steps: string[]
  /** Whitelisted DFHack actions the worker can run for you. */
  actions?: DfhackAction[]
  /** Commands to copy into the console yourself: too risky to run with one click. */
  dfhack?: Shortcut[]
  units?: FortUnit[]
  link?: {
    to: '/fortress/dwarves' | '/fortress/items' | '/fortress/map' | '/fortress/chronicle'
    label: string
    /** Which view of the item list to open, for links to the items page. */
    view?: ItemView
  }
}

export interface AdvisorInput {
  summary: FortSummary | null
  units: FortUnit[]
  buildings: FortBuilding[]
  jobs: FortJob[]
  concerns: FortConcerns | null
  supplies: FortSupplies | null
  events: FortEvent[]
  now: GameTime | null
}

// ---------------------------------------------------------------------------
// Small helpers

export const fmt = (n: number) => n.toLocaleString()

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmt(n)} ${n === 1 ? one : many}`
}

export function list(words: string[]): string {
  if (words.length <= 1) return words.join('')
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

export function names(units: FortUnit[], max = 3): string {
  const shown = units.slice(0, max).map(firstName)
  const rest = units.length - shown.length
  return rest > 0 ? `${shown.join(', ')} and ${rest} more` : list(shown)
}

export const compact = (steps: (string | number | null | false | undefined)[]): string[] =>
  steps.filter((s): s is string => typeof s === 'string' && s.length > 0)

/** Citizens with any of these skills, best first. */
export function skilledIn(
  units: FortUnit[],
  skills: string[],
): { unit: FortUnit; rating: number }[] {
  const out: { unit: FortUnit; rating: number }[] = []
  for (const unit of units) {
    let best = -1
    for (const [skill, rating] of unit.skills)
      if (skills.includes(skill)) best = Math.max(best, rating)
    if (best >= 0) out.push({ unit, rating: best })
  }
  return out.sort((a, b) => b.rating - a.rating)
}

export const SHOP_TYPES = new Set(['Workshop', 'Furnace'])

// ---------------------------------------------------------------------------
// Workshops and who can work them

export interface WorkshopInfo {
  label: string
  skills: string[]
  skillLabel: string
  makes: string
  /** Every fortress wants one. */
  essential?: boolean
}

export const WORKSHOPS: Record<string, WorkshopInfo> = {
  Still: {
    label: 'Still',
    skills: ['BREWING'],
    skillLabel: 'brewing',
    makes: 'drink',
    essential: true,
  },
  Kitchen: {
    label: 'Kitchen',
    skills: ['COOK'],
    skillLabel: 'cooking',
    makes: 'meals',
    essential: true,
  },
  Farmers: {
    label: "Farmer's workshop",
    skills: ['PROCESSPLANTS', 'SPINNING', 'CHEESEMAKING', 'MILK', 'SHEARING'],
    skillLabel: 'plant processing',
    makes: 'thread, syrup, cheese',
    essential: true,
  },
  Quern: {
    label: 'Quern',
    skills: ['MILLING'],
    skillLabel: 'milling',
    makes: 'flour and dye',
  },
  Millstone: {
    label: 'Millstone',
    skills: ['MILLING'],
    skillLabel: 'milling',
    makes: 'flour and dye',
  },
  Masons: {
    label: "Mason's workshop",
    skills: ['CUT_STONE', 'MASONRY'],
    skillLabel: 'stone cutting',
    makes: 'stone furniture, coffins, slabs',
    essential: true,
  },
  Carpenters: {
    label: "Carpenter's workshop",
    skills: ['CARPENTRY'],
    skillLabel: 'carpentry',
    makes: 'beds, barrels, bins, splints',
    essential: true,
  },
  Craftsdwarfs: {
    label: "Craftsdwarf's workshop",
    skills: ['STONECRAFT', 'WOODCRAFT', 'BONECARVE'],
    skillLabel: 'crafting',
    makes: 'mugs, crafts to trade',
    essential: true,
  },
  Mechanics: {
    label: "Mechanic's workshop",
    skills: ['MECHANICS'],
    skillLabel: 'mechanics',
    makes: 'mechanisms for traps and levers',
    essential: true,
  },
  Butchers: {
    label: "Butcher's shop",
    skills: ['BUTCHER'],
    skillLabel: 'butchery',
    makes: 'meat, fat, skins',
  },
  Tanners: {
    label: "Tanner's shop",
    skills: ['TANNER'],
    skillLabel: 'tanning',
    makes: 'leather',
  },
  Leatherworks: {
    label: 'Leather works',
    skills: ['LEATHERWORK'],
    skillLabel: 'leatherworking',
    makes: 'bags, armor, clothes',
  },
  Loom: {
    label: 'Loom',
    skills: ['WEAVING'],
    skillLabel: 'weaving',
    makes: 'cloth, collected webs',
  },
  Clothiers: {
    label: "Clothier's shop",
    skills: ['CLOTHESMAKING'],
    skillLabel: 'clothesmaking',
    makes: 'clothes and bags',
  },
  Dyers: {
    label: "Dyer's shop",
    skills: ['DYER'],
    skillLabel: 'dyeing',
    makes: 'dyed cloth',
  },
  Jewelers: {
    label: "Jeweler's workshop",
    skills: ['CUTGEM', 'ENCRUSTGEM'],
    skillLabel: 'gem cutting',
    makes: 'cut gems to trade',
  },
  MetalsmithsForge: {
    label: "Metalsmith's forge",
    skills: ['FORGE_WEAPON', 'FORGE_ARMOR', 'FORGE_FURNITURE', 'METALCRAFT'],
    skillLabel: 'smithing',
    makes: 'weapons, armor, anvils, picks',
  },
  MagmaForge: {
    label: 'Magma forge',
    skills: ['FORGE_WEAPON', 'FORGE_ARMOR', 'FORGE_FURNITURE', 'METALCRAFT'],
    skillLabel: 'smithing',
    makes: 'weapons, armor, tools',
  },
  Smelter: {
    label: 'Smelter',
    skills: ['SMELT'],
    skillLabel: 'smelting',
    makes: 'metal bars, coke',
  },
  MagmaSmelter: {
    label: 'Magma smelter',
    skills: ['SMELT'],
    skillLabel: 'smelting',
    makes: 'metal bars',
  },
  WoodFurnace: {
    label: 'Wood furnace',
    skills: ['WOOD_BURNING'],
    skillLabel: 'wood burning',
    makes: 'charcoal and ash',
  },
  GlassFurnace: {
    label: 'Glass furnace',
    skills: ['GLASSMAKER'],
    skillLabel: 'glassmaking',
    makes: 'glass',
  },
  Kiln: {
    label: 'Kiln',
    skills: ['POTTERY', 'GLAZING'],
    skillLabel: 'pottery',
    makes: 'pots and glaze',
  },
  Ashery: {
    label: 'Ashery',
    skills: ['LYE_MAKING', 'POTASH_MAKING'],
    skillLabel: 'lye and potash making',
    makes: 'lye, potash for fertilizer',
  },
  Fishery: {
    label: 'Fishery',
    skills: ['PROCESSFISH'],
    skillLabel: 'fish cleaning',
    makes: 'prepared fish',
  },
  Bowyers: {
    label: "Bowyer's workshop",
    skills: ['BOWYER'],
    skillLabel: 'bowmaking',
    makes: 'crossbows',
  },
  Siege: {
    label: 'Siege workshop',
    skills: ['SIEGECRAFT'],
    skillLabel: 'siegecraft',
    makes: 'ballistae',
  },
  Soap: {
    label: "Soap maker's",
    skills: ['SOAP_MAKING'],
    skillLabel: 'soap making',
    makes: 'soap',
  },
}

export interface WorkshopRow {
  key: string
  info: WorkshopInfo
  count: number
  jobs: number
  skilled: { unit: FortUnit; rating: number }[]
}

/** Missing essentials, then essentials nobody can work, then busy ones, then the rest. */
function workshopRank(row: WorkshopRow): number {
  if (row.info.essential && row.count === 0) return 0
  if (row.info.essential && row.info.skills.length && !row.skilled.length) return 1
  if (row.jobs) return 2
  if (row.info.essential) return 3
  return 4
}

/** Each kind of workshop the fortress has, or should have, with its best hands. */
export function workshopBoard(buildings: FortBuilding[], units: FortUnit[]): WorkshopRow[] {
  const citizens = units.filter((u) => isLiving(u) && isCitizenish(u))
  const counts = new Map<string, { count: number; jobs: number }>()
  for (const b of buildings) {
    if (!SHOP_TYPES.has(b.type) || !b.subtype) continue
    const entry = counts.get(b.subtype) ?? { count: 0, jobs: 0 }
    entry.count++
    entry.jobs += b.jobs.length
    counts.set(b.subtype, entry)
  }
  const keys = new Set([
    ...counts.keys(),
    ...Object.entries(WORKSHOPS)
      .filter(([, info]) => info.essential)
      .map(([key]) => key),
  ])
  return [...keys]
    .map((key) => {
      const info = WORKSHOPS[key] ?? {
        label: splitPascal(key),
        skills: [],
        skillLabel: '',
        makes: '',
      }
      const entry = counts.get(key) ?? { count: 0, jobs: 0 }
      return {
        key,
        info,
        count: entry.count,
        jobs: entry.jobs,
        skilled: skilledIn(citizens, info.skills),
      }
    })
    .sort((a, b) => workshopRank(a) - workshopRank(b) || a.info.label.localeCompare(b.info.label))
}

// ---------------------------------------------------------------------------
// The job queue, summarised

export interface JobGroup {
  name: string
  type: string
  total: number
  working: FortUnit[]
  suspended: number
  repeat: number
  orders: number
}

export function jobQueue(jobs: FortJob[], units: FortUnit[]): JobGroup[] {
  const byId = new Map(units.map((u) => [u.id, u]))
  const groups = new Map<string, JobGroup>()
  for (const job of jobs) {
    const name = job.name || splitPascal(job.type)
    const group = groups.get(name) ?? {
      name,
      type: job.type,
      total: 0,
      working: [],
      suspended: 0,
      repeat: 0,
      orders: 0,
    }
    group.total++
    if (job.suspended) group.suspended++
    if (job.repeat) group.repeat++
    if (job.order_id >= 0) group.orders++
    const worker = job.worker_id !== null ? byId.get(job.worker_id) : undefined
    if (worker) group.working.push(worker)
    groups.set(name, group)
  }
  return [...groups.values()].sort((a, b) => b.total - a.total)
}

const DIG_JOBS =
  /^(Dig|DigChannel|Carve.*Staircase|CarveRamp|CarveFortification|CarveTrack|RemoveStairs|Smooth|Detail)/

// ---------------------------------------------------------------------------
// The checks

const FOOD_KEYS = ['meals', 'meat', 'fish', 'plants', 'cheese', 'eggs']

const POSITIONS: { re: RegExp; label: string; why: string }[] = [
  { re: /manager/i, label: 'manager', why: 'handles work orders' },
  {
    re: /bookkeeper/i,
    label: 'bookkeeper',
    why: 'keeps the stock counts that order conditions rely on',
  },
  { re: /broker/i, label: 'broker', why: 'trades with caravans at the depot' },
  {
    re: /medical/i,
    label: 'chief medical dwarf',
    why: 'runs the hospital and diagnoses the hurt',
  },
  {
    re: /militia commander|captain|general/i,
    label: 'militia commander',
    why: 'leads the first squad',
  },
]

export function fortAdvice(input: AdvisorInput): Advice[] {
  const { summary, units, buildings, jobs, concerns, supplies, now } = input
  const out: Advice[] = []
  const add = (advice: Advice) => out.push(advice)

  const living = units.filter(isLiving)
  const citizens = living.filter(isCitizenish)
  const adults = citizens.filter(isGrownCitizen)
  const pop = citizens.length
  if (!summary || pop === 0) return out

  const stock = (key: string) => summary.stocks.find((s) => s.key === key)?.count ?? 0
  const zones: Record<string, number> = {}
  const built: Record<string, number> = {}
  const shops: Record<string, number> = {}
  for (const b of buildings) {
    if (b.type === 'Civzone' && b.subtype) zones[b.subtype] = (zones[b.subtype] ?? 0) + 1
    else if (SHOP_TYPES.has(b.type) && b.subtype) shops[b.subtype] = (shops[b.subtype] ?? 0) + 1
    else {
      const key = b.type === 'Trap' && b.subtype ? b.subtype : b.type
      built[key] = (built[key] ?? 0) + 1
    }
  }
  const skilled = (skills: string[]) => skilledIn(citizens, skills).map((s) => s.unit)
  const holder = (re: RegExp) => citizens.find((u) => u.positions.some((p) => re.test(p)))
  const feelings = fortFeelings(units, now)
  const feltBy = (thought: string) =>
    feelings.filter((f) => f.thought === thought && f.tone === 'bad').flatMap((f) => f.units)
  const idle = adults.filter((u) => !u.job && !u.squad && !u.mood)
  const failing = summary.alerts.filter((a) => a.kind === 'cancellation')

  // Food and drink ----------------------------------------------------------
  {
    const drink = stock('drink')
    const each = drink / pop
    const stills = shops.Still ?? 0
    const brewers = skilled(['BREWING'])
    const plants = stock('plants') + stock('plant_growths')
    const status: AdviceStatus = each < 5 ? 'problem' : each < 15 ? 'attention' : 'good'
    add({
      key: 'drink',
      area: 'food',
      status,
      weight: 100,
      title: status === 'good' ? 'Drink is flowing' : 'Brew more drink',
      why: `${plural(drink, 'drink')} for ${plural(pop, 'dwarf', 'dwarves')}: ${Math.floor(each)} each. Dwarves without drink slow down and sulk; with none at all they die of thirst within weeks.`,
      steps: compact([
        stills
          ? `You have ${plural(stills, 'still')}. ${brewers.length ? `${names(brewers)} ${brewers.length === 1 ? 'knows' : 'know'} brewing.` : 'Nobody has brewed before: give someone the Brewing labor.'}`
          : 'Build a still (Build → Workshops → Still) and give someone the Brewing labor.',
        `Add a repeating "Brew drink from plant" work order that only runs while drink is under ${fmt(pop * 20)} (Work orders → set a condition).`,
        `Brewing takes a plant and an empty barrel or large pot: you have ${plural(plants, 'plant')}${supplies ? ` and ${plural(supplies.emptyBarrels, 'empty barrel')}` : ''}.`,
      ]),
      actions: ['basicOrders'],
    })
  }
  {
    const food = FOOD_KEYS.reduce((sum, key) => sum + stock(key), 0)
    const each = food / pop
    const plots = built.FarmPlot ?? 0
    const farmers = skilled(['PLANT'])
    const cooks = skilled(['COOK'])
    const kitchens = shops.Kitchen ?? 0
    const status: AdviceStatus = each < 3 ? 'problem' : each < 10 ? 'attention' : 'good'
    add({
      key: 'food',
      area: 'food',
      status,
      weight: 90,
      title: status === 'good' ? 'Enough to eat' : 'Grow and cook more food',
      why: `${plural(food, 'portion')} of food for ${plural(pop, 'dwarf', 'dwarves')}: ${Math.floor(each)} each, ${plural(stock('meals'), 'prepared meal')} among them.`,
      steps: compact([
        plots
          ? `Keep all ${plural(plots, 'farm plot')} planted every season: ${plural(stock('seeds'), 'seed')} in store, ${farmers.length ? `and ${names(farmers)} can farm` : 'but nobody has farmed before'}. Plump helmets grow underground all year.`
          : 'Build a farm plot on soil or on muddied stone underground, and plant plump helmets.',
        kitchens
          ? cooks.length
            ? `${names(cooks)} can cook: meals keep for years and dwarves like variety.`
            : 'Nobody knows how to cook: give someone the Cooking labor, then add a "Prepare easy meal" order with a condition.'
          : 'Build a kitchen to turn plants and meat into meals that keep.',
        'Fish, hunt, gather wild plants (Zones → Gather fruit), and butcher animals you will not keep.',
      ]),
      actions: ['autofarm', 'seedwatch', 'banCooking'],
      dfhack: [
        {
          command: 'enable autobutcher',
          what: 'culls surplus animals and keeps breeding pairs; set its targets first',
        },
      ],
    })
  }

  // Health and the dead ------------------------------------------------------
  {
    const hurt = citizens.filter((u) => u.wounds > 0)
    const hospitals = zones.Hospital ?? 0
    const doctor = holder(/medical/i)
    const diagnosers = skilled(['DIAGNOSE'])
    const status: AdviceStatus = hospitals ? 'good' : hurt.length ? 'problem' : 'attention'
    add({
      key: 'hospital',
      area: 'health',
      status,
      weight: 95,
      title: hospitals ? 'A hospital is ready' : 'Build a hospital',
      why: hospitals
        ? `${plural(hospitals, 'hospital zone')}${hurt.length ? `, with ${plural(hurt.length, 'dwarf', 'dwarves')} hurt` : ''}.`
        : hurt.length
          ? `${plural(hurt.length, 'dwarf is', 'dwarves are')} hurt and there is nowhere to treat them. Untreated wounds fester and heal slowly, if at all.`
          : 'Nobody is hurt yet, but when someone is, there is nowhere to treat them.',
      steps: compact([
        !hospitals && 'Zones → Hospital, over a quiet room with a few beds and a table.',
        supplies
          ? `Give it water: a well nearby, or buckets (you have ${supplies.buckets}).`
          : 'Give it water: a well nearby, or buckets.',
        supplies
          ? `Keep supplies close: thread and cloth for sutures and dressings (${plural(stock('cloth'), 'cloth', 'cloth')}), splints (${supplies.splints}), crutches (${supplies.crutches}), soap (${supplies.soap}).`
          : 'Keep thread, cloth, splints, crutches and soap close.',
        doctor
          ? `${firstName(doctor)} is your chief medical dwarf${diagnosers.includes(doctor) ? '.' : `, but has never diagnosed anyone: enable Diagnosis for ${pronouns(doctor).them} in the Labor screen.`}`
          : 'Appoint a chief medical dwarf in the Nobles screen, and enable the medical labors on your doctors.',
      ]),
      units: hurt,
    })
    const medics = skilled(['DIAGNOSE', 'SURGERY', 'SUTURE', 'SET_BONE'])
    if (!medics.length)
      add({
        key: 'doctors',
        area: 'health',
        status: 'attention',
        weight: 60,
        title: 'Train some doctors',
        why: 'Nobody has diagnosed, sutured, set a bone or operated. Medical skill only grows by treating patients, so start before the first siege.',
        steps: compact([
          'Pick two or three steady dwarves and enable Diagnosis, Suturing, Bone setting, Surgery and Wound dressing in the Labor screen.',
          doctor && `${firstName(doctor)} should be the one who diagnoses.`,
          'Everyone else can keep Feed patients and Recovering wounded, so the hurt get carried to bed.',
        ]),
      })
  }
  {
    const unburied = concerns?.unburied ?? []
    const tombs = zones.Tomb ?? 0
    const coffins = built.Coffin ?? 0
    const byId = new Map(units.map((u) => [u.id, u]))
    const status: AdviceStatus = unburied.length
      ? 'problem'
      : tombs && coffins
        ? 'good'
        : 'attention'
    add({
      key: 'burial',
      area: 'health',
      status,
      weight: 80,
      title: unburied.length
        ? unburied.length === 1
          ? `Bury ${unburied[0].name}`
          : `Bury your ${unburied.length} dead`
        : tombs && coffins
          ? 'Room for the dead'
          : 'Prepare a place for the dead',
      why: unburied.length
        ? `${list(unburied.map((b) => `${b.description}${b.x !== null ? ` (at ${b.x},${b.y} z${b.z})` : ''}`))}. Seeing the dead shakes the living, and the unburied can return as ghosts.`
        : `${plural(tombs, 'tomb zone')} and ${plural(coffins, 'coffin')} placed.`,
      steps: [
        'Place a coffin (Build → Furniture → Coffin) and draw a tomb zone over it. In the zone settings, allow burial.',
        'Dwarves carry the dead to a free coffin on their own.',
        "For bodies that are lost or destroyed, engrave a memorial slab at a mason's workshop and place it.",
      ],
      actions: ['burial'],
      units: unburied.map((b) => byId.get(b.unitId)).filter((u): u is FortUnit => u !== undefined),
    })
  }

  // Safety -------------------------------------------------------------------
  const hostiles = living.filter((u) => unitGroup(u) === 'hostile')
  const inSight = hostiles.filter((u) => !u.flags.includes('hidden'))
  const unseen = hostiles.filter((u) => u.flags.includes('hidden'))
  {
    const soldiers = citizens.filter((u) => u.squad)
    const squads = new Set(soldiers.map((u) => u.squad)).size
    const commander = holder(/militia commander|captain|general/i)
    const weapons = supplies?.weapons ?? 0
    const armor = supplies?.metalArmor ?? 0
    const status: AdviceStatus = squads ? 'good' : inSight.length ? 'problem' : 'attention'
    add({
      key: 'military',
      area: 'safety',
      status,
      weight: inSight.length ? 120 : 70,
      title: squads
        ? `${plural(soldiers.length, 'dwarf stands', 'dwarves stand')} ready`
        : 'Raise a squad',
      why: squads
        ? `${plural(squads, 'squad')} with ${plural(soldiers.length, 'soldier')}.`
        : `No one is in a squad${weapons || armor ? `, while ${list(compact([weapons && plural(weapons, 'weapon'), armor && `${plural(armor, 'piece', 'pieces')} of metal armor`]))} sit in storage` : ''}. Wealth draws thieves and sieges sooner or later.`,
      steps: compact([
        commander
          ? `${firstName(commander)} is your militia commander.`
          : 'Appoint a militia commander in the Nobles screen: they lead the first squad.',
        'Squads → Create squad, and add dwarves who are not your only miner, doctor or brewer.',
        `Equip them with metal armor, a helm, a shield and one weapon each${weapons ? ': your stores have weapons to spare' : ''}.`,
        `Schedule training in a barracks when there is no threat${zones.Barracks ? ` (you have ${plural(zones.Barracks, 'barracks', 'barracks')})` : ' (Zones → Barracks)'}, and station them at the gate when danger comes.`,
      ]),
      units: soldiers,
    })
  }
  {
    const bridges = built.Bridge ?? 0
    const levers = built.Lever ?? 0
    const cageTraps = built.CageTrap ?? 0
    const weaponTraps = built.WeaponTrap ?? 0
    const status: AdviceStatus = bridges && levers ? 'good' : 'attention'
    add({
      key: 'gates',
      area: 'safety',
      status,
      weight: 50,
      title: status === 'good' ? 'The gates can be shut' : 'Make a way to shut the gates',
      why: `${plural(bridges, 'bridge')}, ${plural(levers, 'lever')}, ${plural(cageTraps, 'cage trap')} and ${plural(weaponTraps, 'weapon trap')}.`,
      steps: [
        'Put a drawbridge at the main entrance and link it to a lever inside, so one pull seals the fortress.',
        'Line the entrance corridor with cage traps and weapon traps. Cage traps need a supply of empty cages.',
        'Keep one main way in: fewer entrances are easier to hold.',
      ],
    })
  }
  if (inSight.length)
    add({
      key: 'threat',
      area: 'safety',
      status: 'problem',
      weight: 150,
      title: `Deal with ${creatureCounts(inSight)}`,
      why: 'Hostile creatures are in sight on the map.',
      steps: [
        'Pull the lever that raises the drawbridge, or lock the outer doors.',
        'Send civilians indoors: set up a burrow for them and raise the civilian alert in the Squads screen.',
        'Station your squads at a choke point, behind traps if you have them.',
        'Afterwards, haul the dead to a refuse pile and bury your own.',
      ],
      units: inSight,
      link: { to: '/fortress/map', label: 'Open the map' },
    })
  if (unseen.length)
    add({
      key: 'caverns',
      area: 'safety',
      status: 'attention',
      weight: 65,
      title: 'Keep the caverns sealed',
      why: `${creatureCounts(unseen)} ${unseen.length === 1 ? 'lurks' : 'lurk'} unseen deep below.`,
      steps: [
        'Wall off, or cover with hatches, every tunnel that leads into the caverns.',
        'Do not send woodcutters, fishers or gatherers into the caverns alone.',
        'When you are ready, lure what lives there into cage traps, or meet it with a full squad in metal armor.',
      ],
    })

  // Industry -----------------------------------------------------------------
  {
    const workshops = buildings.filter((b) => SHOP_TYPES.has(b.type))
    const busy = workshops.filter((b) => b.jobs.length > 0).length
    const orders = new Set(jobs.filter((j) => j.order_id >= 0).map((j) => j.order_id)).size
    const manager = holder(/manager/i)
    const cups = supplies?.cups ?? null
    const makeNow = compact([
      cups !== null && cups < pop && `${pop - cups} mugs`,
      stock('cloth') < 10 && 'cloth',
      supplies && supplies.fuelBars < 10 && 'charcoal or coke',
      (supplies ? Object.values(supplies.bars).reduce((a, b) => a + b, 0) : stock('bars')) < 10 &&
        'metal bars',
      supplies && supplies.emptyBarrels < 5 && 'barrels',
      supplies && supplies.bins < 5 && 'bins',
      stock('meals') < pop * 2 && 'meals',
      (built.Bed ?? 0) < pop && 'beds',
    ])
    const status: AdviceStatus = workshops.length && busy === 0 ? 'attention' : 'good'
    add({
      key: 'workshops',
      area: 'industry',
      status,
      weight: idle.length ? 85 : 55,
      title:
        status === 'good'
          ? `${busy} of ${workshops.length} workshops at work`
          : 'Put your workshops to work',
      why:
        status === 'good'
          ? `${plural(orders, 'work order')} running.`
          : `None of your ${plural(workshops.length, 'workshop')} has a job queued${idle.length ? `, while ${plural(idle.length, 'dwarf has', 'dwarves have')} nothing to do` : ''}.`,
      steps: compact([
        'Open the Work orders screen and add orders for what you are short of.',
        makeNow.length && `Worth making now: ${list(makeNow)}.`,
        'Give each order a condition ("only while fewer than 20 in stock") so it repeats on its own without flooding the stores.',
        manager
          ? `${firstName(manager)} is your manager and approves new orders.`
          : 'Appoint a manager in the Nobles screen to handle work orders.',
      ]),
      actions: ['basicOrders', 'sortOrders'],
    })
  }
  if (supplies) {
    const ironBars = Object.entries(supplies.bars)
      .filter(([material]) => /iron|steel/.test(material))
      .reduce((sum, [, n]) => sum + n, 0)
    const iron = supplies.ores.find((o) => o.metal === 'iron')
    const copper = supplies.ores.find((o) => o.metal === 'copper')
    const tin = supplies.ores.find((o) => o.metal === 'tin')
    const wantsBars = failing.find((a) => /bars/i.test(a.detail))
    const smelters = (shops.Smelter ?? 0) + (shops.MagmaSmelter ?? 0)
    const forges = (shops.MetalsmithsForge ?? 0) + (shops.MagmaForge ?? 0)
    const smelterHands = skilled(['SMELT'])
    const status: AdviceStatus = ironBars >= 10 ? 'good' : wantsBars ? 'problem' : 'attention'
    add({
      key: 'metal',
      area: 'industry',
      status,
      weight: wantsBars ? 75 : 45,
      title: ironBars >= 10 ? 'Iron on hand' : iron ? 'Smelt your iron ore' : 'Find or buy iron',
      why: compact([
        `${plural(ironBars, 'iron bar')} in store`,
        iron &&
          `, and ${plural(iron.boulders, 'boulder')} of ${list(iron.sources)} wait to be smelted`,
        '.',
        wantsBars &&
          ` "${wantsBars.title.replace(/ keeps failing$/, '')}" keeps failing for want of bars.`,
      ]).join(''),
      steps: compact([
        supplies.fuelBars
          ? `${plural(supplies.fuelBars, 'bar')} of fuel ready.`
          : `Make fuel first: "Make charcoal" at a wood furnace from logs (${fmt(stock('logs'))} in store)${supplies.coalBoulders ? `, or "Make coke" at a smelter from your ${plural(supplies.coalBoulders, 'coal boulder')}` : ''}.`,
        iron
          ? `Then "Smelt ore" at a smelter (${smelters ? `you have ${smelters}` : 'build one'}): each boulder of ore takes one bar of fuel.`
          : 'Watch for hematite, magnetite or limonite while mining, or buy iron bars from a caravan.',
        supplies.enemyGear.metal > 0 &&
          `Loot melts down too: ${plural(supplies.enemyGear.metal, 'piece')} of enemy metal gear lie around. Mark them for melting and a smelter turns them into bars.`,
        smelterHands.length
          ? `${names(smelterHands)} can smelt.`
          : 'Nobody has smelted before: give someone the Furnace operating labor.',
        forges
          ? "Then the metalsmith's forge can make anvils, picks, weapons and armor."
          : "Build a metalsmith's forge to work the bars.",
        copper &&
          tin &&
          `You also have copper ore (${list(copper.sources)}) and tin ore (${list(tin.sources)}): together they alloy into bronze.`,
      ]),
      actions: supplies.ores.length ? ['furnaceOrders', 'smeltingOrders'] : undefined,
      link: supplies.enemyGear.metal
        ? { to: '/fortress/items', label: 'Show the loot', view: 'enemy' }
        : undefined,
    })

    const cloth = stock('cloth')
    const weavers = skilled(['WEAVING'])
    add({
      key: 'cloth',
      area: 'industry',
      status: cloth >= 10 ? 'good' : 'attention',
      weight: 40,
      title: cloth >= 10 ? 'Cloth in store' : 'Weave cloth',
      why: `${plural(cloth, 'cloth', 'cloth')} in store${supplies.webs ? `, and ${plural(supplies.webs, 'spider web')} in the caverns that nobody has collected` : ''}. Cloth goes into bandages, clothes, bags and rope.`,
      steps: compact([
        supplies.webs
          ? '"Collect webs" at a loom gathers cave spider silk. Keep the collectors away from whatever spun it.'
          : "Spin thread from pig tails or rope reeds at a farmer's workshop, or shear and spin wool.",
        shops.Loom ? '"Weave cloth" at the loom turns thread into cloth.' : 'Build a loom.',
        weavers.length
          ? `${names(weavers)} can weave.`
          : 'Nobody has woven before: give someone the Weaving labor.',
      ]),
    })

    if (supplies.wornClothes)
      add({
        key: 'clothes',
        area: 'comfort',
        status: 'attention',
        weight: 30,
        title: 'Replace worn clothing',
        why: `${plural(supplies.wornClothes, 'piece')} of clothing your dwarves wear ${supplies.wornClothes === 1 ? 'is' : 'are'} threadbare or tattered. Rags make dwarves unhappy.`,
        steps: [
          "At a clothier's shop, make shirts, trousers, socks and shoes from cloth or leather.",
          'Dwarves change into new clothes on their own once there are some in stock.',
        ],
        actions: ['tailor', 'cleanowned'],
        link: { to: '/fortress/items', label: 'Show worn items', view: 'worn' },
      })

    const forbidden = Object.entries(supplies.forbidden).sort((a, b) => b[1] - a[1])
    const forbiddenTotal = forbidden.reduce((sum, [, n]) => sum + n, 0)
    if (forbiddenTotal >= 20)
      add({
        key: 'forbidden',
        area: 'industry',
        status: 'attention',
        weight: 25,
        title: 'Claim forbidden items',
        why: `${plural(forbiddenTotal, 'item is', 'items are')} forbidden, mostly ${list(forbidden.slice(0, 3).map(([type, n]) => `${fmt(n)} ${splitPascal(type).toLowerCase()}`))}. Usually the gear of the fallen.`,
        steps: [
          'Your dwarves ignore forbidden items. Unforbid what you want to use or melt from the map or the item list.',
          'Metal gear from enemies melts down into bars at a smelter.',
        ],
        dfhack: [
          {
            command: 'unforbid all',
            what: 'unforbids everything, including what you forbade on purpose, so use with care',
          },
        ],
        link: { to: '/fortress/items', label: 'Show the forbidden items', view: 'forbidden' },
      })

    if (supplies.looseRefuse >= 30) {
      const miasma = feltBy('Miasma')
      add({
        key: 'refuse',
        area: 'comfort',
        status: 'attention',
        weight: miasma.length ? 55 : 20,
        title: 'Clear away the refuse',
        why: `${plural(supplies.looseRefuse, 'corpse, remain or body part', 'corpses, remains and body parts')} lie outside any stockpile${miasma.length ? `, and ${plural(miasma.length, 'dwarf', 'dwarves')} choked on miasma this month` : ''}.`,
        steps: [
          'Stockpiles → Refuse, outside or behind a door, away from where dwarves eat and sleep.',
          'Rotting remains indoors fill the halls with miasma, which dwarves hate.',
          'Forbidden vermin remains stay put until you unforbid them.',
        ],
        units: miasma,
        link: { to: '/fortress/items', label: 'Show the refuse', view: 'refuse' },
      })
    }

    const cups = supplies.cups
    const noCup = feltBy('DrinkWithoutCup')
    add({
      key: 'cups',
      area: 'comfort',
      status: cups >= pop ? 'good' : 'attention',
      weight: noCup.length ? 50 : 20,
      title: cups >= pop ? 'Cups for everyone' : 'Make mugs',
      why: `${plural(cups, 'cup')} for ${plural(pop, 'dwarf', 'dwarves')}.${noCup.length ? ` ${plural(noCup.length, 'dwarf', 'dwarves')} grumbled about drinking without one this month.` : ''}`,
      steps: [
        `At a craftsdwarf's workshop, "Make rock mug" (or wooden cups from logs), about one per dwarf: ${Math.max(0, pop - cups)} more.`,
        'Store them in a stockpile near the drink.',
      ],
      units: noCup,
    })
  }

  const suspended = jobs.filter((j) => j.suspended)
  if (suspended.length) {
    const kinds = new Map<string, number>()
    for (const job of suspended) {
      const name = job.name || splitPascal(job.type)
      kinds.set(name, (kinds.get(name) ?? 0) + 1)
    }
    add({
      key: 'suspended',
      area: 'industry',
      status: 'attention',
      weight: 35,
      title: `Unsuspend ${plural(suspended.length, 'job')}`,
      why: `${list([...kinds.entries()].map(([name, n]) => `${fmt(n)} × ${name.toLowerCase()}`))} ${suspended.length === 1 ? 'is' : 'are'} suspended.`,
      steps: [
        'A construction suspends when its site is blocked by an item, a creature or water, or its materials cannot be reached.',
        "Clear the site, then resume the job from the building's menu.",
      ],
      actions: ['unsuspend', 'suspendmanager'],
    })
  }

  if (failing.length)
    add({
      key: 'failing',
      area: 'industry',
      status: 'problem',
      weight: 70,
      title: 'Fix the jobs that keep failing',
      why: `${plural(failing.length, 'job keeps', 'jobs keep')} getting cancelled, over and over.`,
      steps: [
        ...failing.map((a) => {
          const hint = cancellationHint(a.detail)
          return `${a.title.replace(/ keeps failing$/, '')}: ${a.detail.toLowerCase()} (×${a.count}).${hint ? ` ${hint}` : ''}`
        }),
        'If the materials are gone for now, have the manager re-check the orders so they wait instead of failing.',
      ],
      actions: ['recheckOrders'],
      link: { to: '/fortress/chronicle', label: 'See the cancellations' },
    })

  // Labor --------------------------------------------------------------------
  if (idle.length)
    add({
      key: 'idle',
      area: 'labor',
      status: 'attention',
      weight: 60,
      title: 'Find work for idle hands',
      why: `${names(idle)} ${idle.length === 1 ? 'has' : 'have'} nothing to do.`,
      steps: [
        'Queue work orders so the workshops have something to make.',
        'Give idle dwarves more labors in the Labor screen: hauling, cleaning, and whatever your workshops need.',
        'Plenty left to dig? Add them to the Miners work detail.',
      ],
      units: idle,
    })
  {
    const digging = jobs.filter((j) => DIG_JOBS.test(j.type)).length
    const miners = skilled(['MINING'])
    const picks = supplies?.picks ?? 0
    const perMiner = digging / Math.max(1, miners.length)
    if (digging)
      add({
        key: 'digging',
        area: 'labor',
        status: perMiner > 40 ? 'attention' : 'good',
        weight: 40,
        title: perMiner > 40 ? 'Put more dwarves on the picks' : 'The digging keeps pace',
        why: `${plural(digging, 'tile is', 'tiles are')} marked for digging, for ${plural(miners.length, 'dwarf', 'dwarves')} who can mine${picks ? `; ${plural(picks, 'pick')} lie unused` : ''}.`,
        steps: compact([
          'Add dwarves to the Miners work detail in the Labor screen. Each fetches a pick for themselves.',
          !picks && "No spare picks: forge some at the metalsmith's forge, or buy them.",
          'Dig what you need first: bedrooms, storage and farms before grand halls.',
        ]),
        units: miners,
      })
  }
  {
    const lacking = compact([
      shops.Kitchen && !skilled(['COOK']).length && 'cooking',
      shops.Still && !skilled(['BREWING']).length && 'brewing',
      (shops.Smelter || shops.MagmaSmelter) && !skilled(['SMELT']).length && 'smelting',
      shops.Loom && !skilled(['WEAVING']).length && 'weaving',
      !skilled(['DIAGNOSE']).length && 'diagnosis',
      (built.FarmPlot ?? 0) && !skilled(['PLANT']).length && 'farming',
      shops.Carpenters && !skilled(['CARPENTRY']).length && 'carpentry',
      shops.Mechanics && !skilled(['MECHANICS']).length && 'mechanics',
    ])
    if (lacking.length)
      add({
        key: 'skills',
        area: 'labor',
        status: 'attention',
        weight: 45,
        title: 'Train for the skills you lack',
        why: `No citizen has ever done any ${list(lacking)}.`,
        steps: compact([
          'Skills grow with practice: pick a dwarf, enable the labor in the Labor screen, and give them work to do.',
          idle.length && `Idle dwarves are the easiest to train: ${names(idle)}.`,
          'Migrants bring new skills: check each new wave on the dwarves page.',
        ]),
        units: idle,
      })
  }
  {
    const missing = POSITIONS.filter((p) => !holder(p.re))
    add({
      key: 'nobles',
      area: 'labor',
      status: missing.length ? 'attention' : 'good',
      weight: 35,
      title: missing.length
        ? `Appoint a ${list(missing.map((m) => m.label))}`
        : 'The offices are filled',
      why: missing.length
        ? missing.map((m) => `The ${m.label} ${m.why}.`).join(' ')
        : 'A manager, a bookkeeper, a broker, a chief medical dwarf and a militia commander are in office.',
      steps: [
        'Open the Nobles screen and choose someone for each empty office.',
        'Pick dwarves who are not your only hands at a vital job; offices take time away from work.',
      ],
    })
  }

  // Comfort ------------------------------------------------------------------
  {
    const beds = built.Bed ?? 0
    const rooms = (zones.Bedroom ?? 0) + (zones.Dormitory ?? 0)
    add({
      key: 'beds',
      area: 'comfort',
      status: beds >= pop && rooms ? 'good' : beds >= pop / 2 ? 'attention' : 'problem',
      weight: 65,
      title: beds >= pop && rooms ? 'A bed for everyone' : 'Build more beds',
      why: `${plural(beds, 'bed')} and ${plural(rooms, 'bedroom or dormitory', 'bedrooms and dormitories')} for ${plural(pop, 'dwarf', 'dwarves')}.`,
      steps: [
        "Build beds at a carpenter's workshop and draw a bedroom zone around each (Zones → Bedroom).",
        'Dwarves with a room of their own are happier; a dormitory will do for newcomers.',
      ],
    })
  }
  {
    const halls = zones.DiningHall ?? 0
    const tables = built.Table ?? 0
    const chairs = built.Chair ?? 0
    const noTable = feltBy('EatLikeAnimal')
    const good = halls > 0 && tables * 2 >= pop && chairs * 2 >= pop && !noTable.length
    add({
      key: 'dining',
      area: 'comfort',
      status: good ? 'good' : 'attention',
      weight: 45,
      title: good ? 'Somewhere to eat' : 'Set up a dining hall',
      why: `${plural(halls, 'dining hall')}, ${plural(tables, 'table')} and ${plural(chairs, 'chair')}.${noTable.length ? ` ${plural(noTable.length, 'dwarf', 'dwarves')} ate without a table this month.` : ''}`,
      steps: [
        'Place tables and chairs in a room and draw a dining hall zone over it.',
        'Smooth and engrave the walls, and add statues: dwarves enjoy eating somewhere fine.',
      ],
      units: noTable,
    })
  }
  {
    const needy = feltBy('NeedsUnfulfilled')
    add({
      key: 'needs',
      area: 'comfort',
      status: needy.length >= 3 ? 'attention' : 'good',
      weight: needy.length ? 50 : 20,
      title:
        needy.length >= 3
          ? 'Give dwarves somewhere to pray, drink and read'
          : 'Their needs are mostly met',
      why: `${plural(needy.length, 'dwarf', 'dwarves')} had unmet needs this month. ${plural(zones.MeetingHall ?? 0, 'meeting hall')} in the fortress.`,
      steps: [
        'Zones → Meeting hall, then assign it a location: a temple for the gods your dwarves worship, a tavern with drink and music, or a library with bookcases.',
        'Dwarves also need friends, practice at their crafts, a chance to fight or pray, and time off.',
        "Each dwarf's page shows what went through their head lately.",
      ],
      units: needy,
    })
  }
  {
    const unhappy = citizens.filter((u) => u.stress_category <= 2)
    if (unhappy.length)
      add({
        key: 'unhappy',
        area: 'comfort',
        status: unhappy.some((u) => u.stress_category <= 1) ? 'problem' : 'attention',
        weight: 70,
        title: 'Look after unhappy dwarves',
        why: `${unhappy.length === 1 ? `${firstName(unhappy[0])} is ${stressLabel(unhappy[0].stress_category)}` : `${names(unhappy)} are unhappy`}. Unhappiness spreads through tantrums and can end in madness.`,
        steps: [
          'Open their page and read their thoughts: most unhappiness has a cause you can fix.',
          'Give them a finer bedroom, good meals and drink in a mug, and time with friends.',
          'Keep them away from corpses, miasma, rain and fighting.',
        ],
        units: unhappy,
        link: { to: '/fortress/dwarves', label: 'Open the dwarves' },
      })
  }

  // Trade --------------------------------------------------------------------
  {
    const depot = built.TradeDepot ?? 0
    const broker = holder(/broker/i)
    const goods = supplies ? supplies.tradeGoods : 0
    const rough = supplies?.roughGems ?? 0
    const good = depot > 0 && !!broker && goods >= 20
    add({
      key: 'trade',
      area: 'trade',
      status: good ? 'good' : 'attention',
      weight: 30,
      title: good ? 'Ready for caravans' : depot ? 'Make goods to trade' : 'Build a trade depot',
      why: `${depot ? 'A trade depot' : 'No trade depot'}, ${broker ? `${firstName(broker)} as broker` : 'no broker'}, and ${plural(goods, 'craft or gem', 'crafts and gems')} to sell${rough ? `; ${plural(rough, 'rough gem')} could be cut for more` : ''}.`,
      steps: compact([
        !depot &&
          'Build a trade depot where wagons can reach it, three tiles wide from the edge of the map.',
        "Make crafts from stone, bone or wood at a craftsdwarf's workshop: cheap to make, and caravans buy them.",
        rough && `Cut your ${plural(rough, 'rough gem')} at the jeweler's workshop.`,
        'Ask traders for what you cannot make: metal, cloth, food and animals.',
      ]),
    })
  }

  const rank: Record<AdviceStatus, number> = {
    problem: 0,
    attention: 1,
    good: 2,
  }
  return out.sort((a, b) => rank[a.status] - rank[b.status] || b.weight - a.weight)
}

// ---------------------------------------------------------------------------
// The season ahead

export function seasonNotes(tick: number | null): { season: string; notes: string[] } | null {
  if (tick === null) return null
  const season = seasonOf(tick)
  const notes: Record<typeof season, string[]> = {
    spring: [
      'Surface crops can go in: plant your fields for the season.',
      'Migrants often arrive now. Have beds and a dormitory ready.',
      'Elven caravans come in spring, if you are at peace with them.',
    ],
    summer: [
      'Human caravans come in summer.',
      'As the fortress grows richer, thieves, ambushes and sieges become likelier. Train your squad.',
      'Harvest what you planted in spring and brew the surplus.',
    ],
    autumn: [
      'The dwarven caravan comes from the mountainhomes: have crafts waiting at the depot.',
      'Stock up drink and food before winter.',
      'The liaison may visit to talk trade and nobles.',
    ],
    winter: [
      'Surface water freezes and nothing grows outside. Rely on underground farms and a well.',
      'A quiet season: dig, build and smooth while the world sleeps.',
      'Plan for spring: seeds, beds for migrants, and work orders to keep everyone busy.',
    ],
  }
  return { season, notes: notes[season] }
}

// ---------------------------------------------------------------------------
// Situations, and how to get through them

export interface Situation {
  key: string
  title: string
  /** How you can tell it is happening. */
  signs: string
  steps: string[]
  actions?: DfhackAction[]
  dfhack?: Shortcut[]
  /** Why it looks like this is happening now, if it does. */
  now?: string
}

/** Events from the last month that pass `test`; undated ones count as recent. */
export const recentEvents = (
  events: FortEvent[],
  now: GameTime | null,
  test: (e: FortEvent) => boolean,
) =>
  events.filter(
    (e) =>
      test(e) &&
      (!now ||
        e.game_year === null ||
        e.game_tick === null ||
        absTicks(now) - absTicks({ year: e.game_year, tick: e.game_tick }) <= TICKS_PER_MONTH),
  )

export function situations({ units, summary, concerns, events, now }: AdvisorInput): Situation[] {
  const living = units.filter(isLiving)
  const citizens = living.filter(isCitizenish)
  const hostiles = living.filter((u) => unitGroup(u) === 'hostile')
  const inSight = hostiles.filter((u) => !u.flags.includes('hidden'))
  const unseen = hostiles.filter((u) => u.flags.includes('hidden'))
  const moody = citizens.filter(
    (u) => u.mood && ['Fey', 'Secretive', 'Possessed', 'Macabre', 'Fell'].includes(u.mood),
  )
  const mad = citizens.filter(
    (u) =>
      u.stress_category <= 1 ||
      (u.mood && ['Melancholy', 'Raving', 'Berserk', 'Traumatized'].includes(u.mood)),
  )
  const hurt = citizens.filter((u) => u.wounds > 0)
  const ghosts = living.filter((u) => u.flags.includes('ghost'))
  const undead = hostiles.filter(
    (u) => u.flags.includes('undead') || u.flags.includes('opposed_to_life'),
  )
  const shortage = (summary?.alerts ?? []).filter((a) => a.kind === 'supply')
  const failing = (summary?.alerts ?? []).filter((a) => a.kind === 'cancellation')
  const damp = recentEvents(events, now, (e) => /DIG_CANCEL_(DAMP|WARM)/.test(e.type ?? ''))
  const migrants = recentEvents(events, now, (e) => /MIGRANT/.test(e.type ?? ''))
  const idle = citizens.filter((u) => isGrownCitizen(u) && !u.job && !u.squad && !u.mood)
  const tired = citizens.filter((u) => u.sleepiness >= 57_600)

  const all: Situation[] = [
    {
      key: 'siege',
      title: 'Invaders or monsters at the gates',
      signs: 'A siege or ambush announcement, or dangerous creatures in sight on the map.',
      steps: [
        'Raise the drawbridge or lock the outer doors.',
        'Send civilians indoors: a burrow for everyone plus the civilian alert in the Squads screen.',
        'Station squads at a choke point, behind cage and weapon traps if you have them.',
        'Against archers, build fortifications (arrow slits) so your marksdwarves can shoot back from cover.',
        'When it is over, haul the enemy dead to a refuse pile and bury your own.',
      ],
      now: inSight.length ? `${creatureCounts(inSight)} in sight.` : undefined,
    },
    {
      key: 'caverns',
      title: 'Something lurks in the caverns',
      signs: 'A forgotten beast or titan is announced, or creatures show as unseen deep below.',
      steps: [
        'Wall off or hatch-cover every tunnel into the caverns until you are ready.',
        'Read the creature’s description: poison breath, webs or fire decide what armor and tactics work.',
        'Lure it into cage traps or over a long drop, or meet it with a full squad in metal armor.',
        'Keep woodcutters, fishers and gatherers out of the caverns meanwhile.',
      ],
      now: unseen.length ? `${creatureCounts(unseen)} unseen below.` : undefined,
    },
    {
      key: 'mood',
      title: 'A dwarf is taken by a strange mood',
      signs: '"…is taken by a fey mood", or secretive, possessed, macabre or fell.',
      steps: [
        'They claim a free workshop of their best craft, so keep one of each kind free.',
        'Select the workshop to see what they demand. Dwarves fetch it if the fortress has it; otherwise mine, make or trade for it fast.',
        'Macabre moods want bones, skulls and shells. Fell moods kill someone first.',
        'Success brings a legendary artifact and skill. Failure ends in melancholy, raving or a berserk rage.',
      ],
      now: moody.length
        ? `${names(moody)} ${moody.length === 1 ? 'is' : 'are'} in a mood.`
        : undefined,
    },
    {
      key: 'madness',
      title: 'Tantrums, melancholy and madness',
      signs:
        'Unhappy or miserable dwarves, tantrums that smash furniture, dwarves stricken by melancholy.',
      steps: [
        'Read their thoughts on the dwarves page: the cause is usually something you can fix.',
        'Fix the big comforts first: an own bedroom, a dining hall, good meals, drink in a mug.',
        'Meet their needs: a temple, a tavern, a library, time with friends and family.',
        'Give a tantrum space; a berserk dwarf must be locked up or stopped by the militia.',
        'Melancholy and raving dwarves do not recover. Bury them properly when they die so the grief does not spread.',
      ],
      now: mad.length
        ? `${names(mad)} ${mad.length === 1 ? 'is' : 'are'} in a bad way.`
        : undefined,
    },
    {
      key: 'hurt',
      title: 'Someone is hurt',
      signs: 'Wounded dwarves, bleeding, or dwarves lying down where they fell.',
      steps: [
        'Designate a hospital zone with beds, near water.',
        'Appoint a chief medical dwarf and enable Diagnosis, Surgery, Suturing, Bone setting and Wound dressing on your doctors.',
        'Stock thread, cloth, splints, crutches, soap and buckets in or near the hospital.',
        'Keep Recovering wounded enabled on plenty of dwarves, so the hurt get carried in.',
      ],
      now: hurt.length ? `${names(hurt)} ${hurt.length === 1 ? 'is' : 'are'} hurt.` : undefined,
    },
    {
      key: 'dead',
      title: 'A death, and a ghost',
      signs: '"…has been found dead", bodies left where they fell, or a ghost haunting the halls.',
      steps: [
        'Place coffins in tomb zones: dwarves bury citizens on their own when a coffin is free.',
        'Bodies that cannot be recovered need a memorial slab, engraved at a mason’s workshop with their name.',
        'A ghost means someone lies unburied or unremembered: bury the body or place a slab, and it will rest.',
        'Grieving friends and family need time, good rooms and meals.',
      ],
      actions: ['burial'],
      now: ghosts.length
        ? `${plural(ghosts.length, 'ghost')} walk the fortress.`
        : concerns?.unburied.length
          ? `${plural(concerns.unburied.length, 'body lies', 'bodies lie')} unburied.`
          : undefined,
    },
    {
      key: 'hunger',
      title: 'Running out of food or drink',
      signs: 'Low stocks, thirsty or hungry dwarves, cooks and brewers idle for lack of plants.',
      steps: [
        'Brew first: without drink dwarves slow down, and dehydration kills within days.',
        'Keep farm plots planted every season; plump helmets grow underground all year.',
        'Fish, hunt, gather plants and butcher surplus animals.',
        'Trade with the next caravan for food and drink.',
      ],
      actions: ['seedwatch', 'autofarm'],
      now: shortage.length ? shortage.map((a) => a.title).join('. ') : undefined,
    },
    {
      key: 'sleep',
      title: 'Dwarves who cannot sleep',
      signs: 'Drowsy or exhausted dwarves, or thoughts about being woken by noise.',
      steps: [
        'Build enough beds: one each in bedrooms, or a dormitory with several for now.',
        'Keep bedrooms away from workshops, busy halls and pump stacks; noise wakes dwarves.',
        'Make sure the way to the beds is open: locked doors and flooded halls keep them from rest.',
      ],
      now: tired.length
        ? `${names(tired)} ${tired.length === 1 ? 'is' : 'are'} drowsy or worse.`
        : undefined,
    },
    {
      key: 'failing',
      title: 'Jobs keep getting cancelled',
      signs: '"…cancels X: needs Y" over and over in the chronicle.',
      steps: [
        '"Needs X" means there is no X the worker can reach and use.',
        'Check the item is not forbidden, already in use, behind a locked door or in an unreachable cave.',
        'Make, mine or buy the missing input, or cancel the repeating order.',
        'A workshop also needs a free dwarf with that labor enabled.',
        'Orders whose materials ran out keep failing until the manager re-checks them.',
      ],
      actions: ['recheckOrders'],
      now: failing.length
        ? `${plural(failing.length, 'job keeps', 'jobs keep')} failing.`
        : undefined,
    },
    {
      key: 'idle',
      title: 'Dwarves with nothing to do',
      signs: 'Idle dwarves at the meeting hall while designations wait.',
      steps: [
        'Queue work orders so workshops always have something to make.',
        'Give idle dwarves more labors in the Labor screen, starting with hauling.',
        'Dig new rooms, smooth and engrave walls: busy dwarves are happier and the fortress grows richer.',
      ],
      actions: ['basicOrders'],
      now: idle.length ? `${names(idle)} ${idle.length === 1 ? 'is' : 'are'} idle.` : undefined,
    },
    {
      key: 'undead',
      title: 'The dead walk',
      signs:
        '"The dead walk", zombies or skeletons at the gates, a necromancer nearby, or evil weather.',
      steps: [
        'Close the gates: the undead never tire and never flee.',
        'Deal with corpses before they rise: burn them, drop them into magma, or seal them in a pit.',
        'Blunt weapons break skeletons; axes and swords cut zombies apart.',
        'Keep civilians inside while evil clouds or rain pass over.',
      ],
      now: undead.length ? `${creatureCounts(undead)} on the map.` : undefined,
    },
    {
      key: 'night',
      title: 'Vampires and werebeasts',
      signs:
        'Dwarves found dead and drained of blood, a dwarf who never eats, drinks or sleeps; or a citizen who turns into a beast.',
      steps: [
        'Read the cause of each death and who was nearby: a pattern points to the culprit.',
        'Lock a suspected vampire in a room or wall them in; they cannot be cured but need no food.',
        'Lock a werebeast away before the full moon, or send them off. Anyone they bite may catch the curse.',
      ],
    },
    {
      key: 'water',
      title: 'Water or magma near the digging',
      signs: '"Damp stone located" or "Warm stone located": digging stops next to water or magma.',
      steps: [
        'Do not dig on: the warning means the next tile may flood.',
        'Plan first: floodgates, hatches or walls to hold it, then channel or pump it where you want it.',
        'If water breaks through, evacuate the level and close the doors and hatches behind you.',
      ],
      now: damp.length ? 'Your miners hit damp or warm stone this month.' : undefined,
    },
    {
      key: 'caravan',
      title: 'A caravan has arrived',
      signs: 'Merchants at the depot, and wagons on the map.',
      steps: [
        'Bring goods to the depot: crafts, cut gems and fine furniture sell well.',
        'Send your broker; appraisal and social skills get better prices.',
        'Buy what you cannot make: metal, cloth, food, animals.',
        'Gifts improve relations; the liaison takes orders for next year.',
      ],
      now: summary?.merchants ? `${plural(summary.merchants, 'merchant')} on the map.` : undefined,
    },
    {
      key: 'migrants',
      title: 'New arrivals',
      signs: '"Some migrants have arrived."',
      steps: [
        'Look through their skills on the dwarves page and put them to work where you are short.',
        'Give them beds; a dormitory will do until they get rooms.',
        'Watch the first months: newcomers bring grudges, curses and sometimes worse.',
      ],
      now: migrants.length ? 'Migrants arrived this month.' : undefined,
    },
  ]
  return all.sort((a, b) => Number(Boolean(b.now)) - Number(Boolean(a.now)))
}
