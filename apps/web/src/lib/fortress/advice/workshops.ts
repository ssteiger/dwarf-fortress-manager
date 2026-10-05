import type { FortBuilding, FortJob, FortUnit } from '@fortress/db-drizzle'

import { isLiving, splitPascal } from '../format'
import { isCitizenish } from '../people/units'

/*
 * Workshops and the job queue as the work page shows them: what each kind
 * of workshop is for, how many are built, how busy they are and who is
 * skilled to work them, and the job queue summarised. Client-safe.
 */

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

export const DIG_JOBS =
  /^(Dig|DigChannel|Carve.*Staircase|CarveRamp|CarveFortification|CarveTrack|RemoveStairs|Smooth|Detail)/
