import type {
  DiplomacyRelation,
  FortCaravan,
  FortDiplomacy,
  FortPower,
  FortPowerSite,
  FortUnit,
  FortWar,
} from '@fortress/db-drizzle'

import { list, plural } from './advice/phrasing'
import { isLiving, splitPascal, unitGroup } from './format'

/**
 * Reading the diplomacy section of the dump: how each power stands with the
 * fortress's civilization, what its people do to a fortress, and how close
 * the fortress is to drawing their caravans, thieves and sieges.
 */

export type StanceKey =
  | 'own'
  | 'civil-war'
  | 'ally'
  | 'peace'
  | 'tribute-to-you'
  | 'tribute-from-you'
  | 'skirmishing'
  | 'war'
  | 'hostile'
  | 'no-contact'

export type StanceTone = 'good' | 'calm' | 'warn' | 'danger' | 'muted'

export interface Stance {
  key: StanceKey
  label: string
  tone: StanceTone
  /** One sentence on what it means. */
  detail: string
  /** At war, or out to steal and snatch whether or not anyone declared it. */
  hostile: boolean
  friendly: boolean
}

export const STANCE_CLASSES: Record<StanceTone, string> = {
  good: 'border-transparent bg-emerald-500/15 text-emerald-800 dark:text-emerald-200',
  calm: 'border-transparent bg-sky-500/15 text-sky-800 dark:text-sky-200',
  warn: 'border-transparent bg-amber-500/20 text-amber-900 dark:text-amber-200',
  danger: 'border-transparent bg-red-600 text-white',
  muted: 'border-dashed text-muted-foreground',
}

/** Fill colour for dots on the neighbourhood map. */
export const STANCE_FILL: Record<StanceTone, string> = {
  good: '#10b981',
  calm: '#0ea5e9',
  warn: '#f59e0b',
  danger: '#dc2626',
  muted: '#a8a29e',
}

const RELATION_WORDS: Record<DiplomacyRelation, string> = {
  Peace: 'peace',
  TotalWar: 'war',
  NoContact: 'no contact',
  AcceptingTribute: 'taking tribute',
  OfferingTribute: 'paying tribute',
  Skirmishing: 'skirmishing',
}

export function relationWord(relation: DiplomacyRelation | null | undefined): string {
  return relation ? RELATION_WORDS[relation] : 'no contact'
}

/** Raw behaviour tokens, in the words the page uses. */
export const BEHAVIOUR: Record<string, { label: string; detail: string; hostile?: boolean }> = {
  SIEGER: {
    label: 'Lays sieges',
    detail: 'At war, it sends armies to besiege a fortress.',
  },
  BABYSNATCHER: {
    label: 'Snatches children',
    detail: 'Its people sneak onto the map to carry off children.',
    hostile: true,
  },
  ITEM_THIEF: {
    label: 'Sends thieves',
    detail: 'Its people sneak onto the map to steal valuables.',
    hostile: true,
  },
  AMBUSHER: {
    label: 'Ambushes',
    detail: 'Its war parties come hidden and spring ambushes.',
  },
  LOCAL_BANDITRY: {
    label: 'Raids its neighbours',
    detail: 'Its people raid the sites around them.',
  },
  AT_PEACE_WITH_WILDLIFE: {
    label: 'Protects nature',
    detail:
      'It cares for trees and animals: its merchants take offence at wooden goods, and its diplomats can limit how many trees you fell.',
  },
  WILL_ACCEPT_TRIBUTE: {
    label: 'Settles for tribute',
    detail: 'Winning a war, it may take tribute instead of the site.',
  },
  MERCHANT_NOBILITY: {
    label: 'Nobles trade',
    detail: 'A noble travels with its caravans.',
  },
  SIEGE_SKILLED_MINERS: {
    label: 'Digs in',
    detail: 'Its besiegers bring miners who can dig through walls.',
  },
  INVADERS_IGNORE_NEUTRALS: {
    label: 'Spares bystanders',
    detail: 'Its invaders leave neutral visitors alone.',
  },
  ABUSE_BODIES: {
    label: 'Desecrates the dead',
    detail: 'Its soldiers mutilate and display the bodies of the fallen.',
  },
}

/** What makes a power dangerous to a fortress it has no dealings with. */
function hostileByNature(power: FortPower): string[] {
  return power.behaviour.filter((flag) => BEHAVIOUR[flag]?.hostile)
}

export function stanceOf(power: FortPower): Stance {
  if (power.own) {
    if (power.relation === 'TotalWar' || power.relation === 'Skirmishing')
      return {
        key: 'civil-war',
        label: 'Civil war',
        tone: 'danger',
        detail: 'Your civilization is at war with itself, so no caravans or migrants come.',
        hostile: true,
        friendly: false,
      }
    return {
      key: 'own',
      label: 'Your civilization',
      tone: 'good',
      detail:
        'The civilization your fortress belongs to: its caravan, liaison and nobles come from here.',
      hostile: false,
      friendly: true,
    }
  }
  if (power.relation_flags.includes('allies'))
    return {
      key: 'ally',
      label: 'Allied',
      tone: 'good',
      detail: 'An ally of your civilization.',
      hostile: false,
      friendly: true,
    }
  switch (power.relation) {
    case 'Peace':
      return {
        key: 'peace',
        label: 'At peace',
        tone: 'calm',
        detail: 'At peace with your civilization.',
        hostile: false,
        friendly: true,
      }
    case 'AcceptingTribute':
      return {
        key: 'tribute-to-you',
        label: 'Pays you tribute',
        tone: 'good',
        detail: 'Your civilization takes tribute from them.',
        hostile: false,
        friendly: true,
      }
    case 'OfferingTribute':
      return {
        key: 'tribute-from-you',
        label: 'You pay tribute',
        tone: 'warn',
        detail: 'Your civilization pays them tribute.',
        hostile: false,
        friendly: false,
      }
    case 'Skirmishing':
      return {
        key: 'skirmishing',
        label: 'Skirmishing',
        tone: 'danger',
        detail:
          'At war with your civilization, though the game counts it as skirmishing rather than total war.',
        hostile: true,
        friendly: false,
      }
    case 'TotalWar':
      return {
        key: 'war',
        label: 'At war',
        tone: 'danger',
        detail: 'At total war with your civilization.',
        hostile: true,
        friendly: false,
      }
  }
  const nature = hostileByNature(power)
  if (nature.length > 0)
    return {
      key: 'hostile',
      label: 'Hostile by nature',
      tone: 'warn',
      detail: `No dealings with your civilization yet, but its people ${list(nature.map((flag) => BEHAVIOUR[flag].label.toLowerCase()))}.`,
      hostile: true,
      friendly: false,
    }
  return {
    key: 'no-contact',
    label: 'No contact',
    tone: 'muted',
    detail: 'Your civilization has no dealings with them yet.',
    hostile: false,
    friendly: false,
  }
}

/** "They count it as peace", when the two sides see it differently. */
export function mismatchOf(power: FortPower): string | null {
  if (power.own || !power.their_relation || power.their_relation === power.relation) return null
  return `They count it as ${relationWord(power.their_relation)}, your civilization as ${relationWord(power.relation)}.`
}

/** Race in the plural, "kobolds", falling back to the group's name. */
export function peopleOf(power: Pick<FortPower, 'race' | 'race_plural' | 'name'>): string {
  return power.race_plural ?? (power.race ? `${power.race}s` : (power.name ?? 'unknown people'))
}

export function powerName(power: Pick<FortPower, 'name' | 'name_native' | 'id'>): string {
  return power.name ?? power.name_native ?? `Group ${power.id}`
}

const DIRECTIONS = [
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
  'north',
  'north-east',
]

/** Compass direction from the fortress; world y grows southwards. */
export function compass(dx: number, dy: number): string {
  if (dx === 0 && dy === 0) return 'here'
  const step = Math.round(Math.atan2(dy, dx) / (Math.PI / 4))
  return DIRECTIONS[((step % 8) + 8) % 8]
}

/** "5 tiles to the west". */
export function whereText(dx: number, dy: number): string {
  const distance = Math.max(Math.abs(dx), Math.abs(dy))
  if (distance === 0) return 'on your doorstep'
  return `${plural(distance, 'tile')} to the ${compass(dx, dy)}`
}

/** World map tiles at or below which a power counts as near. */
export const NEAR_TILES = 50

/** Near enough to matter day to day: within NEAR_TILES, or your own civilization. */
export function isNearPower(power: FortPower): boolean {
  return power.own || (power.distance != null && power.distance <= NEAR_TILES)
}

const SITE_WORDS: Record<string, string> = {
  PlayerFortress: 'fortress',
  DarkFortress: 'dark fortress',
  DarkPits: 'dark pits',
  MountainHalls: 'mountain halls',
  ForestRetreat: 'forest retreat',
  LairShrine: 'lair',
  ImportantLocation: 'landmark',
}

export function siteTypeWord(type: string): string {
  return SITE_WORDS[type] ?? splitPascal(type).toLowerCase()
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a')

const PLURAL_SITES = new Set(['MountainHalls', 'DarkPits'])

/** "Lipvirgil, a cave, 5 tiles to the west". */
export function siteText(site: FortPowerSite): string {
  const word = siteTypeWord(site.type)
  const kind = PLURAL_SITES.has(site.type) ? word : `${article(word)} ${word}`
  return `${site.name ?? site.name_native ?? 'An unnamed site'}, ${kind}, ${whereText(site.dx, site.dy)}`
}

/** "Kobold site government", "Dwarven civilization". */
export function peopleLabel(power: FortPower): string {
  const who = power.race_adjective ?? power.race ?? ''
  const what = splitPascal(power.type).toLowerCase()
  const text = who ? `${who} ${what}` : what
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// Entities ------------------------------------------------------------------

export function powerById(d: FortDiplomacy, id: number): FortPower | undefined {
  return d.powers.find((p) => p.id === id)
}

/** The power an entity answers to, itself when it is one. */
export function powerIdOf(d: FortDiplomacy, id: number): number {
  if (d.powers.some((p) => p.id === id)) return id
  return d.entities[String(id)]?.power_id ?? id
}

export function entityName(d: FortDiplomacy, id: number | null | undefined): string {
  if (id === null || id === undefined || id < 0) return 'someone unknown'
  const power = powerById(d, id)
  if (power) return powerName(power)
  return d.entities[String(id)]?.name ?? `group ${id}`
}

// Wars ----------------------------------------------------------------------

export function isOngoing(war: FortWar): boolean {
  return war.end_year == null
}

/** Wars a power fights in, through itself or any group that answers to it. */
export function warsOf(d: FortDiplomacy, powerId: number): FortWar[] {
  return d.wars.filter((war) =>
    [...war.attackers, ...war.defenders].some((id) => powerIdOf(d, id) === powerId),
  )
}

/** "The Noseys of Wiping against The Mythical Fluffleduff". */
export function warSides(d: FortDiplomacy, war: FortWar): string {
  const side = (ids: number[]) => list(ids.map((id) => entityName(d, id))) || 'someone unknown'
  return `${side(war.attackers)} against ${side(war.defenders)}`
}

/** "Since year 74, still going" or "Years 120 to 131". */
export function warSpan(war: FortWar, year: number): string {
  if (war.end_year == null) {
    const years = year - war.start_year
    return `Since year ${war.start_year}${years > 0 ? `, ${plural(years, 'year')} and still going` : ', still going'}`
  }
  if (war.end_year === war.start_year) return `In year ${war.start_year}`
  return `Years ${war.start_year} to ${war.end_year}`
}

export function warTally(war: FortWar): string {
  const parts = [
    war.battles > 0 && plural(war.battles, 'battle'),
    war.conquests > 0 && plural(war.conquests, 'site conquered', 'sites conquered'),
    war.raids > 0 && plural(war.raids, 'raid'),
    war.deaths > 0 && plural(war.deaths, 'death'),
  ].filter((part): part is string => typeof part === 'string')
  return parts.length ? list(parts) : 'No battles recorded'
}

// Relations between powers ---------------------------------------------------

/** How two listed powers stand, as either of them records it; war wins over peace. */
export function relationBetween(a: FortPower, b: FortPower): DiplomacyRelation | null {
  const ab = a.relations.find(([id]) => id === b.id)?.[1] ?? null
  const ba = b.relations.find(([id]) => id === a.id)?.[1] ?? null
  if (!ab) return ba
  if (!ba) return ab
  return ab === 'Peace' ? ba : ab
}

export function isWarRelation(relation: DiplomacyRelation | null | undefined): boolean {
  return relation === 'TotalWar' || relation === 'Skirmishing'
}

// Who is on the map ------------------------------------------------------------

export type PresenceRole = 'merchant' | 'diplomat' | 'visitor' | 'hostile'

export function presenceRole(unit: FortUnit): PresenceRole | null {
  if (!isLiving(unit) || unit.civ_id < 0) return null
  const group = unitGroup(unit)
  if (group === 'hostile') return 'hostile'
  if (group !== 'visitor') return null
  if (unit.flags.includes('diplomat')) return 'diplomat'
  if (unit.flags.includes('merchant')) return 'merchant'
  return 'visitor'
}

/** Visitors and invaders on the map now, by the power they come from. */
export function presenceByPower(d: FortDiplomacy, units: FortUnit[]): Map<number, FortUnit[]> {
  const out = new Map<number, FortUnit[]>()
  for (const unit of units) {
    if (!presenceRole(unit)) continue
    const id = powerIdOf(d, unit.civ_id)
    const group = out.get(id)
    if (group) group.push(unit)
    else out.set(id, [unit])
  }
  return out
}

const ROLE_WORDS: Record<PresenceRole, [string, string]> = {
  merchant: ['merchant', 'merchants'],
  diplomat: ['diplomat', 'diplomats'],
  visitor: ['visitor', 'visitors'],
  hostile: ['invader', 'invaders'],
}

/** "2 merchants and 1 diplomat". */
export function presenceText(units: FortUnit[]): string {
  const counts = new Map<PresenceRole, number>()
  for (const unit of units) {
    const role = presenceRole(unit)
    if (role) counts.set(role, (counts.get(role) ?? 0) + 1)
  }
  return list(
    (['hostile', 'diplomat', 'merchant', 'visitor'] as PresenceRole[])
      .filter((role) => counts.get(role))
      .map((role) => plural(counts.get(role) ?? 0, ...ROLE_WORDS[role])),
  )
}

export function caravansOf(d: FortDiplomacy, caravans: FortCaravan[], powerId: number) {
  return caravans.filter((c) => powerIdOf(d, c.entity_id) === powerId)
}

// What draws them ------------------------------------------------------------

export type Measure = 'population' | 'production' | 'trade'

export const MEASURES: {
  key: Measure
  label: string
  siege: 'pop_siege' | 'prod_siege' | 'trade_siege'
}[] = [
  { key: 'population', label: 'Citizens', siege: 'pop_siege' },
  { key: 'production', label: 'Created wealth', siege: 'prod_siege' },
  { key: 'trade', label: 'Exported wealth', siege: 'trade_siege' },
]

export interface FortProgressValues {
  citizens: number
  createdWealth: number | null
  exportedWealth: number | null
}

export function measureValue(measure: Measure, values: FortProgressValues): number | null {
  if (measure === 'population') return values.citizens
  if (measure === 'production') return values.createdWealth
  return values.exportedWealth
}

/** The value a progress level (1-5) of one measure needs. */
export function thresholdOf(d: FortDiplomacy, measure: Measure, level: number): number | null {
  if (level <= 0) return null
  return d.triggers?.[measure]?.[level - 1] ?? null
}

/** "80 citizens", "100,000☼ of created wealth". */
export function amountText(measure: Measure, amount: number): string {
  if (measure === 'population') return plural(amount, 'citizen')
  return `${amount.toLocaleString()}☼ of ${measure === 'production' ? 'created' : 'exported'} wealth`
}

export interface TriggerCheck {
  measure: Measure
  /** Progress level that triggers it. */
  level: number
  met: boolean
  threshold: number | null
  value: number | null
}

export interface TriggerOutlook {
  /** Some measure has reached its level. */
  met: boolean
  /** The measures that can trigger it. */
  checks: TriggerCheck[]
  /** The unmet measure closest to its threshold. */
  next: TriggerCheck | null
}

function outlook(
  d: FortDiplomacy,
  values: FortProgressValues,
  levelOf: (m: (typeof MEASURES)[number]) => number,
): TriggerOutlook {
  const checks: TriggerCheck[] = MEASURES.map((m) => {
    const level = levelOf(m)
    return {
      measure: m.key,
      level,
      met: level > 0 && d.progress[m.key] >= level,
      threshold: thresholdOf(d, m.key, level),
      value: measureValue(m.key, values),
    }
  }).filter((check) => check.level > 0)
  const unmet = checks.filter((check) => !check.met)
  const ratio = (check: TriggerCheck) =>
    check.threshold && check.value !== null ? check.value / check.threshold : 0
  const next = unmet.sort((a, b) => ratio(b) - ratio(a))[0] ?? null
  return { met: checks.some((check) => check.met), checks, next }
}

export interface PowerForecast {
  /** When the power starts to deal with the fortress at all: caravans, diplomats, thieves or ambushes. */
  notice: TriggerOutlook
  /** When it can lay siege, should it be at war with you. */
  siege: TriggerOutlook
}

export function forecastOf(
  d: FortDiplomacy,
  power: FortPower,
  values: FortProgressValues,
): PowerForecast | null {
  const t = power.triggers
  if (!t) return null
  return {
    notice: outlook(d, values, (m) => t[m.key]),
    siege: outlook(d, values, (m) => t[m.siege]),
  }
}

/** "once you have 80 citizens (12 more)". */
export function triggerText(check: TriggerCheck): string {
  if (check.threshold === null) return `at progress level ${check.level}`
  const gap = check.value !== null ? check.threshold - check.value : null
  const more =
    gap !== null && gap > 0
      ? check.measure === 'population'
        ? ` (${plural(gap, 'more citizen', 'more citizens')})`
        : ` (${gap.toLocaleString()}☼ more)`
      : ''
  return `${amountText(check.measure, check.threshold)}${more}`
}

// Headline ----------------------------------------------------------------------

/**
 * "Your civilization is at war with 1 and allied with 1 of its neighbours,
 * and has no dealings with 20 others. Nearest danger: …". Neighbours are the
 * near powers with settlements, and any power at war with yours.
 */
export function diplomacyHeadline(d: FortDiplomacy): string {
  const stances = d.powers
    .filter((p) => !p.own)
    .map((p) => ({ power: p, stance: stanceOf(p) }))
    .filter(
      ({ power, stance }) =>
        (stance.hostile && power.relation) || (power.site_count > 0 && isNearPower(power)),
    )
  const count = (keys: StanceKey[]) => stances.filter((s) => keys.includes(s.stance.key)).length
  const war = count(['war', 'skirmishing'])
  const allies = count(['ally'])
  const peace = count(['peace', 'tribute-to-you', 'tribute-from-you'])
  const unmet = count(['no-contact', 'hostile'])
  const parts = [
    war > 0 && `at war with ${war}`,
    allies > 0 && `allied with ${allies}`,
    peace > 0 && `at peace with ${peace}`,
  ].filter((part): part is string => typeof part === 'string')
  const own = d.powers.find((p) => p.own)
  const civil = own && stanceOf(own).key === 'civil-war'
  const first = civil
    ? 'Your civilization is in a civil war.'
    : parts.length
      ? `Your civilization is ${list(parts)} of its neighbours${unmet ? `, and has no dealings with ${unmet} others` : ''}.`
      : 'Your civilization has no dealings with its neighbours yet.'
  const danger = stances.find((s) => s.stance.hostile && s.power.sites[0])
  if (!danger) return first
  const site = danger.power.sites[0]
  return `${first} Nearest danger: ${peopleOf(danger.power)} of ${powerName(danger.power)}, ${whereText(site.dx, site.dy)}.`
}
