import type { FortAlert, FortItem, FortJob, FortOrder } from '@fortress/db-drizzle'

import { COAL_STONES, FLUX_STONES, ORE_METALS, isFuelBar } from './stores'

/*
 * What the suspended and failing jobs are missing, as the work orders that
 * make it, prerequisites first: gold bars before rose gold, charcoal before
 * smelting. Free stock is counted first, so a job that fails with the item
 * in the stores gets an explanation rather than an order for more. What no
 * work order can make (logs, flux stone, a sand zone) becomes a step for the
 * player. Pure functions over the dump; the server runs them.
 */

export interface FixStep {
  key: string
  /** "Make 1 chair", "Smelt 3 native gold". */
  title: string
  /** The stuck jobs it answers, or the step it feeds. */
  why: string[]
  /** The DFHack command that adds the work order; for a manual step, a helper if there is one. */
  command: string | null
  /** What to do in the game for a manual step, or what to know before running the order. */
  hint: string | null
  /** True when only the player can do it: no work order makes it. */
  manual: boolean
  /** Orders for the same thing already at the manager. */
  ordered: string | null
}

/** Something stuck that more of an item would not fix. */
export interface FixNote {
  key: string
  title: string
  text: string
}

export interface FixPlan {
  steps: FixStep[]
  notes: FixNote[]
}

// ---------------------------------------------------------------------------
// What can be made, and how

/** Item types a bare `workorder <job> <n>` makes; the workshop picks the material. */
const ITEM_JOBS: Record<string, { job: string; noun: [string, string] }> = {
  CHAIR: { job: 'ConstructThrone', noun: ['chair', 'chairs'] },
  TABLE: { job: 'ConstructTable', noun: ['table', 'tables'] },
  DOOR: { job: 'ConstructDoor', noun: ['door', 'doors'] },
  STATUE: { job: 'ConstructStatue', noun: ['statue', 'statues'] },
  BED: { job: 'ConstructBed', noun: ['bed', 'beds'] },
  CABINET: { job: 'ConstructCabinet', noun: ['cabinet', 'cabinets'] },
  BOX: { job: 'ConstructChest', noun: ['chest', 'chests'] },
  COFFIN: { job: 'ConstructCoffin', noun: ['coffin', 'coffins'] },
  BIN: { job: 'ConstructBin', noun: ['bin', 'bins'] },
  BAG: { job: 'ConstructBag', noun: ['bag', 'bags'] },
  ARMORSTAND: { job: 'ConstructArmorStand', noun: ['armor stand', 'armor stands'] },
  WEAPONRACK: { job: 'ConstructWeaponRack', noun: ['weapon rack', 'weapon racks'] },
  SLAB: { job: 'ConstructSlab', noun: ['slab', 'slabs'] },
  FLOODGATE: { job: 'ConstructFloodgate', noun: ['floodgate', 'floodgates'] },
  GRATE: { job: 'ConstructGrate', noun: ['grate', 'grates'] },
  HATCH_COVER: { job: 'ConstructHatchCover', noun: ['hatch cover', 'hatch covers'] },
  BLOCKS: { job: 'ConstructBlocks', noun: ['block', 'blocks'] },
  TRAPPARTS: { job: 'ConstructMechanisms', noun: ['mechanism', 'mechanisms'] },
  CAGE: { job: 'MakeCage', noun: ['cage', 'cages'] },
  BARREL: { job: 'MakeBarrel', noun: ['barrel', 'barrels'] },
  BUCKET: { job: 'MakeBucket', noun: ['bucket', 'buckets'] },
  WINDOW: { job: 'MakeWindow', noun: ['window', 'windows'] },
  SPLINT: { job: 'ConstructSplint', noun: ['splint', 'splints'] },
  CRUTCH: { job: 'ConstructCrutch', noun: ['crutch', 'crutches'] },
  GOBLET: { job: 'MakeGoblet', noun: ['goblet', 'goblets'] },
  FLASK: { job: 'MakeFlask', noun: ['flask', 'flasks'] },
  QUIVER: { job: 'MakeQuiver', noun: ['quiver', 'quivers'] },
  BACKPACK: { job: 'MakeBackpack', noun: ['backpack', 'backpacks'] },
  CLOTH: { job: 'WeaveCloth', noun: ['cloth', 'cloth'] },
}

/** Words in cancellation reasons -> item type, for reasons without one. */
const ITEM_WORDS: [RegExp, string][] = [
  [/\bstatues?\b/, 'STATUE'],
  [/\bdoors?\b/, 'DOOR'],
  [/\b(chairs?|thrones?)\b/, 'CHAIR'],
  [/\btables?\b/, 'TABLE'],
  [/\bbeds?\b/, 'BED'],
  [/\bcabinets?\b/, 'CABINET'],
  [/\b(chests?|coffers?)\b/, 'BOX'],
  [/\bcoffins?\b/, 'COFFIN'],
  [/\bbins?\b/, 'BIN'],
  [/\bbags?\b/, 'BAG'],
  [/\barmor stands?\b/, 'ARMORSTAND'],
  [/\bweapon racks?\b/, 'WEAPONRACK'],
  [/\bslabs?\b/, 'SLAB'],
  [/\bhatch covers?\b/, 'HATCH_COVER'],
  [/\bgrates?\b/, 'GRATE'],
  [/\bfloodgates?\b/, 'FLOODGATE'],
  [/\bblocks?\b/, 'BLOCKS'],
  [/\bmechanisms?\b/, 'TRAPPARTS'],
  [/\bcages?\b/, 'CAGE'],
  [/\bbarrels?\b/, 'BARREL'],
  [/\bbuckets?\b/, 'BUCKET'],
  [/\bsplints?\b/, 'SPLINT'],
  [/\bcrutch(es)?\b/, 'CRUTCH'],
  [/\b(goblets?|mugs?|cups?)\b/, 'GOBLET'],
  [/\bcloth\b/, 'CLOTH'],
]

const PURE_METALS = new Set(Object.values(ORE_METALS).flat())

/** Smelter alloys from bars: the reaction, bars per batch, and bars of each metal it takes. */
const ALLOYS: Record<
  string,
  { reaction: string; name: string; yields: number; bars: Record<string, number>; flux?: true }
> = {
  'pig iron': {
    reaction: 'PIG_IRON_MAKING',
    name: 'make pig iron bars',
    yields: 1,
    bars: { iron: 1 },
    flux: true,
  },
  steel: {
    reaction: 'STEEL_MAKING',
    name: 'make steel bars',
    yields: 2,
    bars: { iron: 1, 'pig iron': 1 },
    flux: true,
  },
  bronze: {
    reaction: 'BRONZE_MAKING2',
    name: 'make bronze bars (use bars)',
    yields: 2,
    bars: { tin: 1, copper: 1 },
  },
  brass: {
    reaction: 'BRASS_MAKING2',
    name: 'make brass bars (use bars)',
    yields: 2,
    bars: { zinc: 1, copper: 1 },
  },
  electrum: {
    reaction: 'ELECTRUM_MAKING2',
    name: 'make electrum bars (use bars)',
    yields: 2,
    bars: { silver: 1, gold: 1 },
  },
  billon: {
    reaction: 'BILLON_MAKING2',
    name: 'make billon bars (use bars)',
    yields: 2,
    bars: { silver: 1, copper: 1 },
  },
  'fine pewter': {
    reaction: 'PEWTER_FINE_MAKING2',
    name: 'make fine pewter bars (use bars)',
    yields: 4,
    bars: { tin: 3, copper: 1 },
  },
  'trifle pewter': {
    reaction: 'PEWTER_TRIFLE_MAKING2',
    name: 'make trifle pewter bars (use bars)',
    yields: 3,
    bars: { tin: 2, copper: 1 },
  },
  'lay pewter': {
    reaction: 'PEWTER_LAY_MAKING',
    name: 'make lay pewter bars (use bars)',
    yields: 4,
    bars: { tin: 2, copper: 1, lead: 1 },
  },
  'nickel silver': {
    reaction: 'NICKEL_SILVER_MAKING',
    name: 'make nickel silver bars',
    yields: 4,
    bars: { nickel: 2, copper: 1, zinc: 1 },
  },
  'black bronze': {
    reaction: 'BLACK_BRONZE_MAKING',
    name: 'make black bronze bars',
    yields: 4,
    bars: { copper: 2, silver: 1, gold: 1 },
  },
  'sterling silver': {
    reaction: 'STERLING_SILVER_MAKING',
    name: 'make sterling silver bars',
    yields: 4,
    bars: { silver: 3, copper: 1 },
  },
  'rose gold': {
    reaction: 'ROSE_GOLD_MAKING',
    name: 'make rose gold bars',
    yields: 4,
    bars: { gold: 3, copper: 1 },
  },
  'bismuth bronze': {
    reaction: 'BISMUTH_BRONZE_MAKING',
    name: 'make bismuth bronze bars',
    yields: 4,
    bars: { tin: 1, copper: 2, bismuth: 1 },
  },
}

const PASTE_REACTION = { reaction: 'MILL_SEEDS_NUTS_TO_PASTE', name: 'mill seeds/nuts to paste' }

// ---------------------------------------------------------------------------
// The stores

/** Taken, forbidden, built in or on its way out: not for a new job. */
const BUSY_FLAGS = new Set([
  'forbid',
  'in_job',
  'in_building',
  'construction',
  'removed',
  'trader',
  'garbage_collect',
  'dump',
  'melt',
  'artifact',
])

function isFree(item: FortItem): boolean {
  return (
    item.x !== null && item.holder_unit_id === null && !item.flags.some((f) => BUSY_FLAGS.has(f))
  )
}

interface Stores {
  count: (test: (item: FortItem) => boolean) => number
  /** Ore stone -> free boulders, for the ores of `metal`, most plentiful first. */
  ores: (metal: string) => [string, number][]
}

function storesOf(items: FortItem[]): Stores {
  const free = items.filter(isFree)
  const count = (test: (item: FortItem) => boolean) =>
    free.reduce((sum, item) => sum + (test(item) ? item.stack || 1 : 0), 0)
  return {
    count,
    ores: (metal) => {
      const by = new Map<string, number>()
      for (const item of free) {
        if (item.type === 'BOULDER' && ORE_METALS[item.material]?.includes(metal))
          by.set(item.material, (by.get(item.material) ?? 0) + (item.stack || 1))
      }
      return [...by].sort((a, b) => b[1] - a[1])
    },
  }
}

// ---------------------------------------------------------------------------
// Goods

interface Make {
  title: string
  command: string
  /** Good key -> how much of it the order uses. */
  inputs: [string, number][]
  /** To find matching manager orders. */
  job: string
  label?: string
  detail?: string
  hint?: string
}

interface Good {
  noun: [string, string]
  /** Free in the stores, in the units demand is counted in. */
  stock: number
  make: ((n: number) => Make) | null
  /** For goods no work order makes: the step for the player. */
  manual?: { title: string; hint: string; command?: string }
  /** Why a job fails although the stores hold enough. */
  stocked: (stock: number) => string
}

const plural = (n: number, noun: [string, string]) =>
  `${n.toLocaleString()} ${n === 1 ? noun[0] : noun[1]}`
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`)

/** A JSON work order the way DFHack's console takes it: one double-quoted argument. */
function jsonOrder(order: Record<string, string | number>): string {
  return `workorder "${JSON.stringify(order).replace(/"/g, '\\"')}"`
}

const unreachable = (noun: [string, string]) => (stock: number) =>
  `The stores hold ${plural(stock, noun)} nobody has claimed, so more would not help. If the job still fails, the workshop cannot get to ${stock === 1 ? 'it' : 'them'}: check its Take from stockpile links, and that the way there is open.`

function goodFor(key: string, stores: Stores): Good {
  const [kind, arg = ''] = key.split(':')
  if (kind === 'item') {
    const spec = ITEM_JOBS[arg]
    return {
      noun: spec.noun,
      stock: stores.count((i) => i.type === arg),
      make: (n) => ({
        title: `Make ${plural(n, spec.noun)}`,
        command: `workorder ${spec.job} ${n}`,
        inputs: [],
        job: spec.job,
        hint: 'The workshop picks the material it has.',
      }),
      stocked: (stock) =>
        `The stores hold ${plural(stock, spec.noun)} that nobody uses, so more would not help. If the buildings still wait, the builders cannot get to them: check that the ${spec.noun[1]} are not walled off and that the way to each site is open. Buildings placed with DFHack's buildingplan take theirs in the order they were placed.`,
    }
  }
  if (kind === 'bar') {
    const noun: [string, string] = [`${arg} bar`, `${arg} bars`]
    const stock = stores.count((i) => i.type === 'BAR' && i.material === arg)
    const alloy = ALLOYS[arg]
    if (alloy) {
      return {
        noun,
        stock,
        make: (n) => {
          const batches = Math.ceil(n / alloy.yields)
          const inputs: [string, number][] = Object.entries(alloy.bars).map(([metal, bars]) => [
            `bar:${metal}`,
            bars * batches,
          ])
          inputs.push(['fuel', batches])
          if (alloy.flux) inputs.push(['flux', batches])
          return {
            title: `${capitalize(alloy.name)}, ${times(batches)}`,
            command: jsonOrder({
              job: 'CustomReaction',
              reaction: alloy.reaction,
              amount_total: batches,
            }),
            inputs,
            job: 'CustomReaction',
            label: alloy.name,
            hint: `Makes ${plural(batches * alloy.yields, noun)} at a smelter.`,
          }
        },
        stocked: unreachable(noun),
      }
    }
    if (PURE_METALS.has(arg)) {
      const ores = stores.ores(arg)
      const [ore, oreStock] = ores[0] ?? [null, 0]
      return {
        noun,
        stock,
        make: ore
          ? (n) => {
              const smelts = Math.min(n, oreStock)
              return {
                title: `Smelt ${smelts} ${ore}`,
                command: jsonOrder({
                  job: 'SmeltOre',
                  material: `INORGANIC:${ore.toUpperCase().replace(/ /g, '_')}`,
                  amount_total: smelts,
                }),
                inputs: [['fuel', smelts]],
                job: 'SmeltOre',
                detail: ore,
                hint: `${capitalize(ore)} smelts into ${arg}, and the stores hold ${plural(oreStock, ['boulder', 'boulders'])} of it.${smelts < n ? ` That is less than the ${n} bars wanted: mine more, or buy ${arg} from a caravan.` : ''}`,
              }
            }
          : null,
        manual: {
          title: `Find ${arg} ore`,
          hint: `No ore of ${arg} is in the stores. Mine some, or buy ${arg} bars from a caravan.`,
        },
        stocked: unreachable(noun),
      }
    }
    if (arg === 'ash' || arg === 'potash') {
      const job = arg === 'ash' ? 'MakeAsh' : 'MakePotashFromAsh'
      return {
        noun,
        stock,
        make: (n) => ({
          title: `Make ${plural(n, noun)}`,
          command: `workorder ${job} ${n}`,
          inputs: [[arg === 'ash' ? 'logs' : 'bar:ash', n]],
          job,
        }),
        stocked: unreachable(noun),
      }
    }
  }
  if (kind === 'fuel') {
    const coal = stores.count((i) => i.type === 'BOULDER' && COAL_STONES.has(i.material))
    return {
      noun: ['charcoal or coke bar', 'charcoal or coke bars'],
      stock: stores.count((i) => i.type === 'BAR' && isFuelBar(i.material)),
      make: (n) => ({
        title: `Make ${n} charcoal`,
        command: `workorder MakeCharcoal ${n}`,
        inputs: [['logs', n]],
        job: 'MakeCharcoal',
        hint: `Burns logs at a wood furnace.${coal ? ` The ${coal.toLocaleString()} coal boulders in the stores make coke at a smelter too.` : ''}`,
      }),
      stocked: unreachable(['charcoal or coke bar', 'charcoal or coke bars']),
    }
  }
  if (kind === 'paste') {
    return {
      noun: ['paste', 'paste'],
      stock: stores.count(
        (i) => i.type === 'GLOB' && /paste/i.test(i.description) && !/pressed/i.test(i.description),
      ),
      make: (n) => ({
        title: `Mill ${plural(n, ['seed or nut', 'seeds or nuts'])} to paste`,
        command: jsonOrder({
          job: 'CustomReaction',
          reaction: PASTE_REACTION.reaction,
          amount_total: n,
        }),
        inputs: [['seeds', n]],
        job: 'CustomReaction',
        label: PASTE_REACTION.name,
        hint: 'At a quern or millstone. Only seeds and nuts that press into oil count.',
      }),
      stocked: unreachable(['glob of paste', 'globs of paste']),
    }
  }
  if (kind === 'seeds') {
    return {
      noun: ['seed', 'seeds'],
      stock: stores.count((i) => i.type === 'SEEDS'),
      make: null,
      manual: {
        title: 'Gather seeds and nuts',
        hint: 'Grow or gather plants whose seeds press into oil, and eat or brew them for their seeds.',
      },
      stocked: unreachable(['seed', 'seeds']),
    }
  }
  if (kind === 'logs') {
    return {
      noun: ['log', 'logs'],
      stock: stores.count((i) => i.type === 'WOOD'),
      make: null,
      manual: {
        title: 'Cut down trees',
        hint: 'No work order makes logs. Mark trees for felling in the game, or let DFHack mark them as stocks run low.',
        command: 'enable autochop',
      },
      stocked: unreachable(['log', 'logs']),
    }
  }
  if (kind === 'flux') {
    return {
      noun: ['flux stone', 'flux stones'],
      stock: stores.count((i) => i.type === 'BOULDER' && FLUX_STONES.has(i.material)),
      make: null,
      manual: {
        title: 'Mine flux stone',
        hint: 'No work order makes stone. Dig out limestone, dolomite, chalk, marble or calcite, or buy flux from a caravan. Flux built into walls and floors does not count.',
      },
      stocked: unreachable(['flux stone', 'flux stones']),
    }
  }
  if (kind === 'zone') {
    return {
      noun: ['sand zone', 'sand zones'],
      stock: 0,
      make: null,
      manual: {
        title: 'Designate a sand collection zone',
        hint: 'Mark a zone for sand collection on sand tiles, or cancel the Collect sand order if you have no sand.',
      },
      stocked: () => '',
    }
  }
  return {
    noun: ['stone', 'stones'],
    stock: stores.count((i) => i.type === 'BOULDER'),
    make: null,
    manual: { title: 'Mine stone', hint: 'No work order makes stone. Dig some out.' },
    stocked: unreachable(['stone', 'stones']),
  }
}

/** The good a requirement or cancellation reason asks for, or null when none fits. */
export function goodKey(text: string, itemType?: string | null): string | null {
  const t = text
    .toLowerCase()
    .replace(/^needs? /, '')
    .replace(/^\d+ /, '')
    .replace(/\bempty /, '')
    .trim()
  if (/sand collection zone/.test(t)) return 'zone:sand'
  if (/\bflux\b/.test(t)) return 'flux'
  if (/oil-bearing glob|\bpaste\b/.test(t)) return 'paste'
  if (itemType === 'BAR' || /\bbars?$/.test(t)) {
    if (/charcoal|coke|\bcoal\b|fuel/.test(t)) return 'fuel'
    const metal = t.replace(/ bars?$/, '').trim()
    if (ALLOYS[metal] || PURE_METALS.has(metal) || metal === 'ash' || metal === 'potash')
      return `bar:${metal}`
    return null
  }
  if (itemType === 'WOOD' || /\blogs?\b/.test(t)) return 'logs'
  if (itemType && ITEM_JOBS[itemType]) return `item:${itemType}`
  const word = ITEM_WORDS.find(([re]) => re.test(t))
  if (word) return `item:${word[1]}`
  if (itemType === 'BOULDER' || /\b(rock|stone|boulders?)\b/.test(t)) return 'stone'
  return null
}

/** How many a reason asks for: "Needs 3 gold bars" -> 3; paste is counted in globs of 150. */
function amountOf(text: string, key: string): number {
  const n = Number(/^needs? (\d+)/i.exec(text)?.[1] ?? 1)
  return Math.max(1, key === 'paste' ? Math.round(n / 150) : n)
}

function orderedNote(make: Make, orders: FortOrder[]): string | null {
  const same = orders.filter(
    (o) =>
      o.job === make.job &&
      o.amount_left > 0 &&
      (!make.label || o.label.toLowerCase() === make.label) &&
      (!make.detail || (o.detail ?? '').toLowerCase().includes(make.detail)),
  )
  if (!same.length) return null
  const left = same.reduce((sum, o) => sum + o.amount_left, 0)
  const state = same.some((o) => o.active)
    ? 'and running'
    : same.some((o) => o.validated)
      ? 'waiting for its conditions'
      : 'not checked by the manager yet'
  return `${same.length === 1 ? 'An order for this is' : `${same.length} orders for this are`} already at the manager with ${left.toLocaleString()} left, ${state}.`
}

// ---------------------------------------------------------------------------
// The plan

export function planFixes({
  jobs,
  alerts,
  items,
  orders,
}: {
  jobs: FortJob[]
  alerts: FortAlert[]
  items: FortItem[]
  orders: FortOrder[]
}): FixPlan {
  const stores = storesOf(items)
  const notes: FixNote[] = []
  const demand = new Map<string, number>()
  const why = new Map<string, string[]>()
  const wanted = new Set<string>()
  const want = (key: string, n: number, reason: string) => {
    demand.set(key, (demand.get(key) ?? 0) + n)
    why.set(key, [...(why.get(key) ?? []), reason])
    wanted.add(key)
  }

  // Suspended jobs: what they still lack, counted per kind of job.
  const lacking = new Map<string, { key: string; jobs: number; n: number; noun: string }>()
  const complete = new Map<string, number>()
  for (const job of jobs) {
    if (!job.suspended || !job.needs?.length) continue
    const name = job.name || job.type
    const missing = job.needs.filter(([, need, have]) => have < need)
    if (!missing.length) {
      complete.set(name, (complete.get(name) ?? 0) + 1)
      continue
    }
    for (const [label, need, have, itemType] of missing) {
      const key = goodKey(label, itemType)
      if (!key) {
        notes.push({
          key: `suspended-${job.id}-${label}`,
          title: `${name} needs ${label}`,
          text: 'No work order the app knows makes that. Supply it in the game, or cancel the job.',
        })
        continue
      }
      const slot = `${key}|${name}`
      const entry = lacking.get(slot) ?? { key, jobs: 0, n: 0, noun: label }
      entry.jobs++
      entry.n += need - have
      lacking.set(slot, entry)
    }
  }
  for (const [slot, entry] of lacking) {
    const name = slot.split('|')[1]
    want(
      entry.key,
      entry.n,
      `${entry.jobs === 1 ? `A suspended ${name} job waits` : `${entry.jobs} suspended ${name} jobs wait`} for ${entry.jobs === 1 ? `a ${entry.noun}` : `${entry.n} ${entry.noun}s`}.`,
    )
  }
  for (const [name, count] of complete) {
    notes.push({
      key: `blocked-${name}`,
      title: `${count === 1 ? `A suspended ${name} job has` : `${count} suspended ${name} jobs have`} everything ${count === 1 ? 'it needs' : 'they need'}`,
      text: 'Something is in the way at the site (an item, a creature or water), or the builders cannot reach it. Clear it, then resume the job in the game.',
    })
  }

  // Jobs that keep failing, by the reason the game gives.
  for (const alert of alerts) {
    if (alert.kind !== 'cancellation') continue
    const task = alert.title.replace(/ keeps failing$/, '')
    const key = goodKey(alert.detail)
    const reason = `${task} keeps failing: ${alert.detail.charAt(0).toLowerCase()}${alert.detail.slice(1)} (${alert.count}×).`
    if (!key) {
      notes.push({
        key: `failing-${task}-${alert.detail}`,
        title: `${task} keeps failing`,
        text: `${alert.detail}. No work order the app knows supplies that.`,
      })
      continue
    }
    want(key, amountOf(alert.detail, key), reason)
  }

  // Every good the wants lead to, inputs after the goods that use them.
  const goods = new Map<string, Good>()
  const order: string[] = []
  const visit = (key: string) => {
    if (goods.has(key)) return
    const good = goodFor(key, stores)
    goods.set(key, good)
    for (const [input] of good.make?.(1).inputs ?? []) visit(input)
    order.push(key)
  }
  for (const key of wanted) visit(key)

  // Walk from what the jobs want down to raw materials, adding what each
  // order uses to the demand for its inputs.
  const short = new Map<string, number>()
  for (const key of [...order].reverse()) {
    const need = demand.get(key) ?? 0
    if (need <= 0) continue
    const good = goods.get(key) as Good
    const missing = Math.max(0, need - good.stock)
    if (missing === 0) {
      if (wanted.has(key) && good.stock > 0)
        notes.push({
          key: `stocked-${key}`,
          title: `${capitalize(good.noun[1])} in the stores`,
          text: `${(why.get(key) ?? []).join(' ')} ${good.stocked(good.stock)}`.trim(),
        })
      continue
    }
    short.set(key, missing)
    const make = good.make?.(missing)
    if (!make) continue
    for (const [input, n] of make.inputs) {
      demand.set(input, (demand.get(input) ?? 0) + n)
      why.set(input, [...(why.get(input) ?? []), `For “${make.title}”.`])
    }
  }

  const steps: FixStep[] = []
  for (const key of order) {
    const missing = short.get(key)
    if (!missing) continue
    const good = goods.get(key) as Good
    const make = good.make?.(missing)
    if (make) {
      steps.push({
        key,
        title: make.title,
        why: why.get(key) ?? [],
        command: make.command,
        hint: make.hint ?? null,
        manual: false,
        ordered: orderedNote(make, orders),
      })
    } else if (good.manual) {
      steps.push({
        key,
        title: good.manual.title,
        why: why.get(key) ?? [],
        command: good.manual.command ?? null,
        hint: good.manual.hint,
        manual: true,
        ordered: null,
      })
    }
  }
  return { steps, notes }
}
