import type {
  DfhackAction,
  FortBuilding,
  FortEvent,
  FortJob,
  FortSummary,
  FortUnit,
} from '@fortress/db-drizzle'

import type { GameTime } from '../time'
import type { FortConcerns, FortSupplies } from '../types'
import type { ItemView } from './stores'

/*
 * The shape of advice: the areas a fortress is checked in, how a check came
 * out, and what every check reads (`AdvisorInput`). The checks, the stores
 * and the guides all speak in these types. Client-safe.
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
