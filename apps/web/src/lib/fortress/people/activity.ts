import type { FortUnit } from '@fortress/db-drizzle'

import { isLiving, stressLabel } from '../format'
import { type GameTime, TICKS_PER_MONTH, absTicks } from '../time'
import { emotionTone, thoughtPhrase } from './thoughts'
import { firstName, isCitizenish, pronouns } from './units'

/*
 * What everyone is doing: each unit's job sorted into a handful of
 * activities for the overview's board, and the few sentences at the top of a
 * dwarf's page. Client-safe.
 */

export interface Activity {
  key: string
  label: string
}

const ACTIVITY_RULES: [string, string, RegExp][] = [
  [
    'military',
    'Training and on duty',
    /train|drill|patrol|station|military|squad|lesson|archery|spar/i,
  ],
  [
    'care',
    'Tending the hurt',
    /diagnose|surgery|suture|set bone|dress wound|recover wounded|give water|give food|clean patient|immobilize|rescue/i,
  ],
  ['needs', 'Eating, drinking, sleeping', /^(eat|drink|sleep|rest)|bath|clean self/i],
  [
    'leisure',
    'Leisure and worship',
    /pray|worship|socialize|party|perform|listen|read|attend|ponder|meditat|visit|converse/i,
  ],
  ['dig', 'Digging', /^dig|channel|carve (up|down)|carve (ramp|fortification)|stair|remove ramp/i],
  ['build', 'Building', /construct|build|install|link|dismantle|remove construction/i],
  ['haul', 'Hauling', /store|haul|bring|deliver|carry|dump|push|move|place/i],
  [
    'farm',
    'Farming and gathering',
    /plant|harvest|fertili|gather|herb|pick|milk|shear|slaughter|butcher|fish|hunt|tame|animal|feed|catch|collect|pen/i,
  ],
  ['stone', 'Stonework', /smooth|engrave|detail/i],
  ['craft', 'Crafting', /./],
]

export function activityOf(unit: FortUnit): Activity {
  if (!isLiving(unit)) return { key: 'dead', label: 'Dead' }
  if (unit.mood) return { key: 'mood', label: 'In a strange mood' }
  const job = unit.job
  if (!job) {
    if (unit.flags.includes('baby') || unit.flags.includes('child'))
      return { key: 'play', label: 'Playing' }
    if (unit.squad) return { key: 'military', label: 'Training and on duty' }
    return { key: 'idle', label: 'Idle' }
  }
  for (const [key, label, re] of ACTIVITY_RULES) if (re.test(job)) return { key, label }
  return { key: 'craft', label: 'Crafting' }
}

export interface ActivityGroup extends Activity {
  units: FortUnit[]
}

const ACTIVITY_ORDER = [
  'mood',
  'military',
  'care',
  'craft',
  'stone',
  'dig',
  'build',
  'farm',
  'haul',
  'needs',
  'leisure',
  'play',
  'idle',
]

export function activityBoard(units: FortUnit[]): ActivityGroup[] {
  const groups = new Map<string, ActivityGroup>()
  for (const unit of units) {
    if (!isLiving(unit) || !isCitizenish(unit)) continue
    const activity = activityOf(unit)
    const group = groups.get(activity.key) ?? { ...activity, units: [] }
    group.units.push(unit)
    groups.set(activity.key, group)
  }
  return [...groups.values()].sort(
    (a, b) => ACTIVITY_ORDER.indexOf(a.key) - ACTIVITY_ORDER.indexOf(b.key),
  )
}

const ACTIVITY_VERB: Record<string, string> = {
  military: 'on duty',
  care: 'tending the hurt',
  needs: 'seeing to {their} needs',
  leisure: 'taking time for {self}',
  dig: 'digging',
  build: 'building',
  haul: 'hauling',
  farm: 'working the land',
  stone: 'working stone',
  craft: 'at a workshop',
  mood: 'in the grip of a strange mood',
  play: 'playing',
  idle: 'idle',
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a'
}

/**
 * A few sentences on who they are and how they are doing, for the top of
 * their page: "Thelma is a 46-year-old stone carver. Right now she is hauling…"
 */
export function unitStory(unit: FortUnit, now: GameTime | null): string {
  const name = firstName(unit)
  const p = pronouns(unit)
  const They = p.they.charAt(0).toUpperCase() + p.they.slice(1)
  if (!isLiving(unit)) return `${name} is dead.`
  const age = Math.floor(unit.age)
  const role = unit.profession ? unit.profession.toLowerCase() : unit.race
  const sentences: string[] = [
    `${name} is ${article(String(age))} ${age}-year-old ${role}${unit.race && !role.includes(unit.race) && unit.race !== 'dwarf' ? ` (${unit.race})` : ''}.`,
  ]
  const positions = unit.positions.filter((pos) => pos.toLowerCase() !== role)
  if (positions.length) sentences.push(`${They} ${p.is} the fortress’s ${positions.join(' and ')}.`)
  const activity = activityOf(unit)
  const verb = (ACTIVITY_VERB[activity.key] ?? 'busy')
    .replace('{their}', p.their)
    .replace('{self}', p.self)
  sentences.push(
    `Right now ${p.they} ${p.is} ${verb}${unit.job && activity.key !== 'idle' && activity.key !== 'mood' ? `: ${unit.job.toLowerCase()}` : ''}.`,
  )
  if (isCitizenish(unit)) sentences.push(`${They} ${p.is} ${stressLabel(unit.stress_category)}.`)
  const recent = (unit.thoughts ?? []).filter(
    (t) => !now || absTicks(now) - absTicks({ year: t[3], tick: t[4] }) <= TICKS_PER_MONTH,
  )
  const lately: string[] = []
  for (const t of [
    ...recent.filter((t) => emotionTone(t[1]) === 'bad'),
    ...recent.filter((t) => emotionTone(t[1]) !== 'bad' && t[0] !== 'SatisfiedAtWork'),
  ]) {
    const phrase = thoughtPhrase(t[0], t[1], unit)
    if (!lately.includes(phrase)) lately.push(phrase)
    if (lately.length === 3) break
  }
  if (lately.length)
    sentences.push(
      `Lately ${p.they} ${lately.length > 1 ? `${lately.slice(0, -1).join(', ')} and ${lately[lately.length - 1]}` : lately[0]}.`,
    )
  return sentences.join(' ')
}
