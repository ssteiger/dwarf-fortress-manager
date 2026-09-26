import type { FortUnit, SheetPerson, UnitSheet } from '@fortress/db-drizzle/fortress-types'

import { facetPhrase, skillLabel, valuePhrase } from './dossier'
import { formatGameTick, humanize, sexLabel, skillRank, splitPascal, stressLabel } from './format'
import { type GameTime, firstName, gameAgo, pronouns, thoughtPhrase } from './insights'

/*
 * Client-safe readings of a unit's sheet: what the game's numbers mean in
 * words, what the player can do about them, and the character a role-player
 * would play. Pure functions over FortUnit and its sheet.
 */

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function listing(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

// ---------------------------------------------------------------------------
// Needs

export type Standing = 'good' | 'ok' | 'warning' | 'danger'

export interface NeedText {
  /** Short label: "Pray". */
  label: string
  /** Reads after "longs to": "pray". */
  want: string
  /** What helps, in the fortress. */
  tip: string
}

const NEED_TEXT: Record<string, NeedText> = {
  Socialize: {
    label: 'Socialize',
    want: 'spend time with others',
    tip: 'A tavern or meeting hall, and free time to spend there.',
  },
  DrinkAlcohol: {
    label: 'Drink',
    want: 'have a drink',
    tip: 'Keep alcohol stocked where they can reach it. A tavern keeper serves it too.',
  },
  PrayOrMeditate: {
    label: 'Pray',
    want: 'pray',
    tip: 'A temple, dedicated to their god if they have one, and time to visit it.',
  },
  StayOccupied: {
    label: 'Stay busy',
    want: 'keep busy',
    tip: 'Work they are allowed to do: enable labors and keep work orders queued.',
  },
  BeCreative: {
    label: 'Be creative',
    want: 'make something',
    tip: 'Crafting, engraving or performing: an art labor or a place in a troupe.',
  },
  Excitement: {
    label: 'Excitement',
    want: 'do something exciting',
    tip: 'Military training, hunting or a trip outside.',
  },
  LearnSomething: {
    label: 'Learn',
    want: 'learn something',
    tip: 'A library with books, or work that teaches them a new skill.',
  },
  BeWithFamily: {
    label: 'Family',
    want: 'be with family',
    tip: 'Shared meals and free time let family members meet.',
  },
  BeWithFriends: {
    label: 'Friends',
    want: 'be with friends',
    tip: 'A tavern or meeting hall and time off let friends meet.',
  },
  HearEloquence: {
    label: 'Eloquence',
    want: 'hear eloquent speech',
    tip: 'Poets, storytellers and speakers performing in a tavern or temple.',
  },
  UpholdTradition: {
    label: 'Tradition',
    want: 'uphold tradition',
    tip: 'Temples and taverns where their customs are kept.',
  },
  SelfExamination: {
    label: 'Reflect',
    want: 'reflect on {self}',
    tip: 'Quiet time: a temple, a library, or simply a break.',
  },
  MakeMerry: {
    label: 'Make merry',
    want: 'make merry',
    tip: 'A tavern with drink, music and dancing.',
  },
  CraftObject: {
    label: 'Craft',
    want: 'craft something',
    tip: 'A crafting labor, even if all they make is trinkets.',
  },
  MartialTraining: {
    label: 'Train',
    want: 'train for battle',
    tip: 'A squad with a training schedule and a barracks.',
  },
  PracticeSkill: {
    label: 'Practise',
    want: 'practise {their} skills',
    tip: 'Work that uses the skills they already have.',
  },
  TakeItEasy: {
    label: 'Take it easy',
    want: 'take it easy',
    tip: 'Free time: fewer labors, or a lighter work detail.',
  },
  MakeRomance: {
    label: 'Romance',
    want: 'find romance',
    tip: 'Time among others in a tavern or meeting hall, where romance starts.',
  },
  SeeAnimal: {
    label: 'See animals',
    want: 'see animals',
    tip: 'Pets, a pasture or animals kept where they pass.',
  },
  SeeGreatBeast: {
    label: 'See a great beast',
    want: 'see a great beast',
    tip: 'Only a great beast will do: a caged one, or the next one that comes calling.',
  },
  AcquireObject: {
    label: 'Acquire',
    want: 'get something new',
    tip: 'Trinkets and goods in the stockpiles for them to claim.',
  },
  EatGoodMeal: {
    label: 'Good meal',
    want: 'eat a good meal',
    tip: 'Prepared meals, best of foods they like, in a fine dining hall.',
  },
  Fight: {
    label: 'Fight',
    want: 'get into a fight',
    tip: 'Sparring in a squad will do.',
  },
  CauseTrouble: {
    label: 'Cause trouble',
    want: 'cause trouble',
    tip: 'A tavern gives them somewhere to stir things up.',
  },
  Argue: {
    label: 'Argue',
    want: 'argue with someone',
    tip: 'A tavern, meeting hall or temple with people to argue with.',
  },
  BeExtravagant: {
    label: 'Extravagance',
    want: 'live extravagantly',
    tip: 'Fine clothes, jewellery and a rich bedroom.',
  },
  Wander: {
    label: 'Wander',
    want: 'wander',
    tip: 'Let them outside now and then.',
  },
  HelpSomebody: {
    label: 'Help someone',
    want: 'help somebody',
    tip: 'Caring for the hurt, hauling, or any job done for others.',
  },
  ThinkAbstractly: {
    label: 'Think',
    want: 'think deeply',
    tip: 'A library, or scholarly work.',
  },
  AdmireArt: {
    label: 'Admire art',
    want: 'admire art',
    tip: 'Engravings, statues and artwork along the halls they use.',
  },
}

export function needText(token: string, unit?: FortUnit): NeedText {
  const known = NEED_TEXT[token]
  const words = splitPascal(token)
  if (!known) return { label: words, want: words.toLowerCase(), tip: '' }
  if (!unit) return known
  const p = pronouns(unit)
  return { ...known, want: known.want.replace('{self}', p.self).replace('{their}', p.their) }
}

const NEED_LEVELS: [at: number, label: string, standing: Standing, bar: number][] = [
  [300, 'Unfettered', 'good', 100],
  [200, 'Level-headed', 'good', 88],
  [100, 'Untroubled', 'good', 76],
  [-999, 'Not distracted', 'ok', 60],
  [-9999, 'Unfocused', 'warning', 40],
  [-99999, 'Distracted', 'warning', 22],
]

/** The game's word for how met a need is, and a bar length for it. */
export function needLevel(focus: number): { label: string; standing: Standing; bar: number } {
  for (const [at, label, standing, bar] of NEED_LEVELS)
    if (focus >= at) return { label, standing, bar }
  return { label: 'Badly distracted', standing: 'danger', bar: 8 }
}

/** "pray to Avan", "have a drink". */
export function needWant(need: UnitSheet['needs'][number], unit: FortUnit): string {
  const text = needText(need[0], unit)
  return need[0] === 'PrayOrMeditate' && need[3] ? `pray to ${need[3]}` : text.want
}

// ---------------------------------------------------------------------------
// Attributes

const ATTRIBUTES: Record<string, [label: string, high: string, low: string]> = {
  STRENGTH: ['Strength', 'strong', 'weak'],
  AGILITY: ['Agility', 'agile', 'clumsy'],
  TOUGHNESS: ['Toughness', 'tough', 'fragile'],
  ENDURANCE: ['Endurance', 'tireless', 'quick to tire'],
  RECUPERATION: ['Recuperation', 'quick to heal', 'slow to heal'],
  DISEASE_RESISTANCE: ['Disease resistance', 'rarely ill', 'sickly'],
  ANALYTICAL_ABILITY: [
    'Analytical ability',
    'a sharp analytical mind',
    'poor at working things out',
  ],
  FOCUS: ['Focus', 'great focus', 'easily distracted'],
  WILLPOWER: ['Willpower', 'an iron will', 'weak-willed'],
  CREATIVITY: ['Creativity', 'very creative', 'unimaginative'],
  INTUITION: ['Intuition', 'good instincts', 'poor instincts'],
  PATIENCE: ['Patience', 'patient', 'impatient'],
  MEMORY: ['Memory', 'a long memory', 'forgetful'],
  LINGUISTIC_ABILITY: ['Linguistic ability', 'a way with words', 'clumsy with words'],
  SPATIAL_SENSE: ['Spatial sense', 'a keen sense of space', 'a poor sense of space'],
  MUSICALITY: ['Musicality', 'musical', 'tone-deaf'],
  KINESTHETIC_SENSE: ['Kinesthetic sense', 'graceful', 'awkward in {their} body'],
  EMPATHY: ['Empathy', 'deeply empathetic', 'little empathy'],
  SOCIAL_AWARENESS: ['Social awareness', 'socially perceptive', 'socially oblivious'],
}

export function attributeLabel(token: string): string {
  return ATTRIBUTES[token]?.[0] ?? humanize(token)
}

const STANDINGS = ['Minimal', 'Very low', 'Low', 'Average', 'High', 'Very high', 'Exceptional']

/**
 * Where a value sits among its caste, from the seven cutoffs the game
 * generates attributes from (lowest, ..., median, ..., highest): -3 to 3.
 */
export function attributeTier(value: number, ranges: number[]): number {
  if (ranges.length < 7) return 0
  if (value >= ranges[6]) return 3
  if (value >= ranges[5]) return 2
  if (value >= ranges[4]) return 1
  if (value > ranges[2]) return 0
  if (value > ranges[1]) return -1
  if (value > ranges[0]) return -2
  return -3
}

export function attributeStanding(value: number, ranges: number[]): string {
  return STANDINGS[attributeTier(value, ranges) + 3]
}

/** "strong", "forgetful": an attribute worth a remark, or null. */
export function attributeRemark(
  attr: UnitSheet['attributes'][number],
  unit: FortUnit,
): string | null {
  const tier = attributeTier(attr[2], attr[4])
  const words = ATTRIBUTES[attr[0]]
  if (!words || Math.abs(tier) < 2) return null
  const text = (tier > 0 ? words[1] : words[2]).replace('{their}', pronouns(unit).their)
  return Math.abs(tier) === 3 ? `${tier > 0 ? 'exceptionally' : 'hopelessly'} ${text}` : text
}

// ---------------------------------------------------------------------------
// Skills

const SKILL_CLASSES: Record<string, string> = {
  Normal: 'Work',
  Medical: 'Medicine',
  Personal: 'Personal',
  Social: 'Social',
  Cultural: 'Arts and learning',
  MilitaryWeapon: 'Combat',
  MilitaryUnarmed: 'Combat',
  MilitaryAttack: 'Combat',
  MilitaryDefense: 'Combat',
  MilitaryMisc: 'Combat',
}

export const SKILL_GROUP_ORDER = [
  'Work',
  'Medicine',
  'Combat',
  'Social',
  'Arts and learning',
  'Personal',
]

export function skillGroup(skillClass: string | null): string {
  return (skillClass && SKILL_CLASSES[skillClass]) || 'Work'
}

export function skillName(token: string, unit: FortUnit): string {
  return capitalize(skillLabel(token, unit))
}

/** Experience from one rating to the next. */
export function xpForNextLevel(rating: number): number {
  return 500 + 100 * rating
}

// ---------------------------------------------------------------------------
// Preferences

interface PreferenceKind {
  group: string
  label: string
  tip: (list: string) => string
}

const PREFERENCES: Record<string, PreferenceKind> = {
  LikeMaterial: {
    group: 'materials',
    label: 'Materials',
    tip: (x) => `Furniture, doors and crafts of ${x} where they sleep and work please them.`,
  },
  LikeFood: {
    group: 'food',
    label: 'Food and drink',
    tip: (x) => `Keep ${x} in stock: eating or drinking a favourite is a good memory.`,
  },
  LikeCreature: {
    group: 'creatures',
    label: 'Creatures',
    tip: (x) => `Seeing ${x} cheers them: a pet or a pasture along their way.`,
  },
  HateCreature: {
    group: 'hates',
    label: 'Cannot stand',
    tip: (x) => `Seeing ${x} upsets them. Cats and traps keep vermin down.`,
  },
  LikeItem: {
    group: 'items',
    label: 'Items',
    tip: (x) => `Fine ${x} in their room or as their gear please them.`,
  },
  LikePlant: {
    group: 'plants',
    label: 'Plants and trees',
    tip: (x) => `Seeing ${x}, growing or picked, cheers them.`,
  },
  LikeTree: {
    group: 'plants',
    label: 'Plants and trees',
    tip: (x) => `Seeing ${x}, growing or picked, cheers them.`,
  },
  LikeColor: {
    group: 'colors',
    label: 'Colours',
    tip: (x) => `Things in ${x} catch their eye.`,
  },
  LikeShape: {
    group: 'shapes',
    label: 'Shapes',
    tip: (x) => `Gems cut as ${x}, worn or set into furniture, delight them.`,
  },
  LikePoeticForm: {
    group: 'art',
    label: 'Poetry, music and dance',
    tip: (x) => `A performance of ${x} in a tavern or temple is a treat for them.`,
  },
  LikeMusicalForm: {
    group: 'art',
    label: 'Poetry, music and dance',
    tip: (x) => `A performance of ${x} in a tavern or temple is a treat for them.`,
  },
  LikeDanceForm: {
    group: 'art',
    label: 'Poetry, music and dance',
    tip: (x) => `A performance of ${x} in a tavern or temple is a treat for them.`,
  },
}

export interface PreferenceGroup {
  key: string
  label: string
  items: string[]
  tip: string
}

export function preferenceGroups(sheet: UnitSheet): PreferenceGroup[] {
  const groups = new Map<string, PreferenceGroup & { kind: PreferenceKind }>()
  for (const [kind, what] of sheet.preferences) {
    const spec = PREFERENCES[kind]
    if (!spec) continue
    const group = groups.get(spec.group) ?? {
      key: spec.group,
      label: spec.label,
      items: [],
      tip: '',
      kind: spec,
    }
    if (!group.items.includes(what)) group.items.push(what)
    groups.set(spec.group, group)
  }
  return [...groups.values()].map(({ kind, ...group }) => ({
    ...group,
    tip: kind.tip(listing(group.items.slice(0, 3))),
  }))
}

// ---------------------------------------------------------------------------
// Dreams, gods and memories

const DREAMS: Record<string, string> = {
  STAY_ALIVE: 'staying alive',
  MAINTAIN_ENTITY_STATUS: 'keeping {their} standing',
  START_A_FAMILY: 'raising a family',
  RULE_THE_WORLD: 'ruling the world',
  CREATE_A_GREAT_WORK_OF_ART: 'creating a great work of art',
  CRAFT_A_MASTERWORK: 'crafting a masterwork',
  BRING_PEACE_TO_THE_WORLD: 'bringing peace to the world',
  BECOME_A_LEGENDARY_WARRIOR: 'becoming a legendary warrior',
  MASTER_A_SKILL: 'mastering a skill',
  FALL_IN_LOVE: 'falling in love',
  SEE_THE_GREAT_NATURAL_SITES: 'seeing the great natural sites',
  IMMORTALITY: 'living forever',
  MAKE_A_GREAT_DISCOVERY: 'making a great discovery',
  ATTAIN_RANK_IN_SOCIETY: 'rising high in society',
  BATHE_WORLD_IN_CHAOS: 'bathing the world in chaos',
}

/** "dreams of raising a family", or "has realised {their} dream of ...". */
export function dreamText(dream: UnitSheet['dreams'][number], unit: FortUnit): string {
  const p = pronouns(unit)
  const what = (DREAMS[dream[0]] ?? humanize(dream[0]).toLowerCase()).replace('{their}', p.their)
  return dream[1] ? `has realised ${p.their} dream of ${what}` : `dreams of ${what}`
}

export function worshipLevel(strength: number): string {
  if (strength >= 90) return 'ardent worshipper'
  if (strength >= 75) return 'faithful worshipper'
  if (strength >= 25) return 'worshipper'
  if (strength >= 10) return 'casual worshipper'
  return 'dubious worshipper'
}

/** "Ardent worshipper of Avan, god of painting and poetry". */
export function deityText(deity: UnitSheet['deities'][number]): string {
  const [name, strength, spheres] = deity
  const of = spheres.length ? `, of ${listing(spheres.map((s) => humanize(s).toLowerCase()))}` : ''
  return `${capitalize(worshipLevel(strength))} of ${name}${of}`
}

// ---------------------------------------------------------------------------
// People

const FAMILY: Record<string, [female: string, male: string, other: string]> = {
  MOTHER: ['Mother', 'Mother', 'Mother'],
  FATHER: ['Father', 'Father', 'Father'],
  SPOUSE: ['Wife', 'Husband', 'Spouse'],
  CHILD: ['Daughter', 'Son', 'Child'],
  LOVER: ['Lover', 'Lover', 'Lover'],
  FORMER_SPOUSE: ['Former wife', 'Former husband', 'Former spouse'],
  DECEASED_SPOUSE: ['Late wife', 'Late husband', 'Late spouse'],
  MASTER: ['Master', 'Master', 'Master'],
  APPRENTICE: ['Apprentice', 'Apprentice', 'Apprentice'],
  FORMER_MASTER: ['Former master', 'Former master', 'Former master'],
  FORMER_APPRENTICE: ['Former apprentice', 'Former apprentice', 'Former apprentice'],
  COMPANION: ['Companion', 'Companion', 'Companion'],
  PET_OWNER: ['Owner', 'Owner', 'Owner'],
  PRISONER: ['Prisoner', 'Prisoner', 'Prisoner'],
  IMPRISONER: ['Captor', 'Captor', 'Captor'],
}

export type Tone = 'good' | 'bad' | 'neutral'

const RANKS: Record<string, [label: string, tone: Tone]> = {
  childhood_friend: ['childhood friend', 'good'],
  war_buddy: ['war buddy', 'good'],
  athlete_buddy: ['sporting friend', 'good'],
  scholar_buddy: ['fellow scholar', 'good'],
  artistic_buddy: ['fellow artist', 'good'],
  lover: ['lover', 'good'],
  former_lover: ['former lover', 'neutral'],
  jealous_obsession: ['jealous obsession', 'bad'],
  jealous_relationship_grudge: ['jealous grudge', 'bad'],
  grudge: ['grudge', 'bad'],
  persecution_grudge: ['grudge over persecution', 'bad'],
  religious_persecution_grudge: ['grudge over faith', 'bad'],
  supernatural_grudge: ['grudge', 'bad'],
  athletic_rival: ['sporting rival', 'bad'],
  business_rival: ['business rival', 'bad'],
  neighbor: ['neighbour', 'neutral'],
  shared_entity: ['fellow member', 'neutral'],
  lieutenant: ['lieutenant', 'neutral'],
}

/** The game's word for how much one figure loves another. */
export function opinionLabel(love: number): { label: string; tone: Tone } {
  if (love >= 100) return { label: 'Kindred spirit', tone: 'good' }
  if (love >= 75) return { label: 'Close friend', tone: 'good' }
  if (love >= 50) return { label: 'Friend', tone: 'good' }
  if (love <= -100) return { label: 'Pure hatred', tone: 'bad' }
  if (love <= -75) return { label: 'Hated', tone: 'bad' }
  if (love <= -50) return { label: 'Disliked', tone: 'bad' }
  return { label: 'Acquaintance', tone: 'neutral' }
}

export type PeopleGroup = 'family' | 'friends' | 'foes' | 'acquaintances'

export interface Relation {
  person: SheetPerson
  group: PeopleGroup
  label: string
  /** The special bond, when the game records one: "childhood friend", "grudge". */
  detail: string | null
  tone: Tone
}

export function relationOf(person: SheetPerson): Relation {
  if (person.kind !== 'known') {
    const words = FAMILY[person.kind]
    const label = words
      ? words[person.sex === 0 ? 0 : person.sex === 1 ? 1 : 2]
      : humanize(person.kind)
    return { person, group: 'family', label, detail: null, tone: 'good' }
  }
  const opinion = opinionLabel(person.love ?? 0)
  const rank = person.rank ? RANKS[person.rank] : undefined
  const tone = rank?.[1] === 'bad' ? 'bad' : opinion.tone
  const group: PeopleGroup =
    tone === 'bad' ? 'foes' : tone === 'good' || rank?.[1] === 'good' ? 'friends' : 'acquaintances'
  return {
    person,
    group,
    label: rank?.[1] === 'bad' && opinion.tone !== 'bad' ? capitalize(rank[0]) : opinion.label,
    detail: rank && !(rank[1] === 'bad' && opinion.tone !== 'bad') ? rank[0] : null,
    tone,
  }
}

/** Family first, then friends, foes and acquaintances; a figure appears once. */
export function relations(sheet: UnitSheet): Relation[] {
  const family = sheet.people.filter((p) => p.kind !== 'known')
  const familyIds = new Set(family.map((p) => p.hf))
  const known = sheet.people.filter((p) => p.kind === 'known' && !familyIds.has(p.hf))
  const order: Record<PeopleGroup, number> = { family: 0, friends: 1, foes: 2, acquaintances: 3 }
  return [...family, ...known]
    .map(relationOf)
    .sort(
      (a, b) =>
        order[a.group] - order[b.group] ||
        Math.abs(b.person.love ?? 0) - Math.abs(a.person.love ?? 0) ||
        (b.person.met ?? 0) - (a.person.met ?? 0),
    )
}

export function personName(person: SheetPerson): string {
  return person.name ?? person.name_english ?? 'someone unnamed'
}

// ---------------------------------------------------------------------------
// Wounds

export function wordsForWound(wound: UnitSheet['wounds'][number]): string {
  const where = wound.parts.length ? listing(wound.parts) : 'body'
  const what = [...wound.damage, ...wound.flags]
  return `${capitalize(where)}${what.length ? `: ${what.join(', ')}` : ''}`
}

/** Injuries only; syndrome effects such as drink are left out. */
export function injuries(sheet: UnitSheet): UnitSheet['wounds'] {
  return sheet.wounds.filter((w) => !w.effect)
}

/** Syndromes by name, including the ones that show up only as a wound (drink). */
export function syndromeNames(sheet: UnitSheet): string[] {
  const names = new Set(sheet.syndromes)
  for (const w of sheet.wounds) if (w.syndrome) names.add(w.syndrome)
  return [...names]
}

// ---------------------------------------------------------------------------
// Care: what the player can do to make them happier

export interface CareTip {
  key: string
  title: string
  text: string
  standing: Standing
}

export function careTips(unit: FortUnit, sheet: UnitSheet): CareTip[] {
  const out: CareTip[] = []
  for (const need of sheet.needs) {
    const level = needLevel(need[1])
    if (level.standing !== 'warning' && level.standing !== 'danger') continue
    out.push({
      key: `need:${need[0]}`,
      title: `${level.label}: longs to ${needWant(need, unit)}`,
      text: needText(need[0]).tip,
      standing: level.standing,
    })
  }
  for (const [token, rating, , , , enabled] of sheet.skills) {
    if (enabled !== false || rating < 5) continue
    out.push({
      key: `labor:${token}`,
      title: `${skillRank(rating)} at ${skillLabel(token, unit)}, but not allowed to do it`,
      text: 'Enable the labor, or add them to a work detail that allows it.',
      standing: 'ok',
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// The character, for role play

export interface CharacterSheet {
  temperament: string[]
  holds: string[]
  scorns: string[]
  dreams: string[]
  loves: string[]
  hates: string[]
  faith: string[]
  bonds: string[]
  grudges: string[]
  haunted: string[]
  talents: string[]
  physique: string[]
}

export function characterSheet(unit: FortUnit, sheet: UnitSheet | null): CharacterSheet {
  const temperament = (unit.traits ?? [])
    .map(([facet, value]) => facetPhrase(unit, facet, value))
    .filter((t): t is string => Boolean(t))
  const holds: string[] = []
  const scorns: string[] = []
  for (const [value, strength] of unit.values ?? []) {
    const phrase = valuePhrase(unit, value, strength)
    if (phrase) (strength > 0 ? holds : scorns).push(phrase)
  }
  const empty: CharacterSheet = {
    temperament,
    holds,
    scorns,
    dreams: [],
    loves: [],
    hates: [],
    faith: [],
    bonds: [],
    grudges: [],
    haunted: [],
    talents: [],
    physique: [],
  }
  if (!sheet) return empty
  const groups = preferenceGroups(sheet)
  const rels = relations(sheet)
  return {
    ...empty,
    dreams: sheet.dreams.map((d) => dreamText(d, unit)),
    loves: groups
      .filter((g) => g.key !== 'hates')
      .flatMap((g) => g.items.slice(0, g.key === 'materials' ? 3 : 2)),
    hates: groups.find((g) => g.key === 'hates')?.items ?? [],
    faith: sheet.deities.map(deityText),
    bonds: rels
      .filter((r) => r.group === 'family' || (r.group === 'friends' && (r.person.love ?? 0) >= 75))
      .slice(0, 8)
      .map((r) => `${r.label}: ${personName(r.person)}${r.person.alive ? '' : ' (dead)'}`),
    grudges: rels
      .filter((r) => r.group === 'foes')
      .slice(0, 5)
      .map((r) => `${r.label}: ${personName(r.person)}`),
    haunted: [
      ...(sheet.core_memories ?? []).map(
        ([thought, emotion, year, , facet, from, to, value, vFrom, vTo]) =>
          `${capitalize(thoughtPhrase(thought, emotion))} in ${year}${
            facet && from !== null && to !== null
              ? `, and it changed ${pronouns(unit).them}: ${humanize(facet).toLowerCase()} ${to > from ? 'rose' : 'fell'}`
              : value && vFrom !== null && vTo !== null
                ? `, and it changed what ${pronouns(unit).they} believe about ${humanize(value).toLowerCase()}`
                : ''
          }`,
      ),
      ...(sheet.memories ?? [])
        .filter((m) => m[5] === 'long')
        .map(
          ([thought, emotion, , year]) => `Remembers: ${thoughtPhrase(thought, emotion)} (${year})`,
        ),
    ],
    talents: sheet.skills
      .filter(([, rating]) => rating >= 5)
      .slice(0, 5)
      .map(([token, rating]) => `${skillRank(rating)} at ${skillLabel(token, unit)}`),
    physique: sheet.attributes
      .map((a) => attributeRemark(a, unit))
      .filter((t): t is string => Boolean(t)),
  }
}

export interface StoryHook {
  key: string
  text: string
}

const GRUDGE_RANKS = /grudge|obsession|rival/

/** Loose threads worth a scene: grudges, dreams, losses, talents going to waste. */
export function storyHooks(
  unit: FortUnit,
  sheet: UnitSheet | null,
  now: GameTime | null,
): StoryHook[] {
  const name = firstName(unit)
  const p = pronouns(unit)
  const out: StoryHook[] = []
  if (unit.mood)
    out.push({
      key: 'mood',
      text: `${name} is in a ${unit.mood.toLowerCase()} mood. What will ${p.they} make, and what will ${p.they} demand to make it?`,
    })
  if (!sheet) return out
  for (const d of sheet.dreams)
    if (!d[1])
      out.push({
        key: `dream:${d[0]}`,
        text: `${name} ${dreamText(d, unit)}. What stands in the way?`,
      })
  for (const r of relations(sheet)) {
    const who = personName(r.person)
    const bond = r.person.rank ? RANKS[r.person.rank]?.[0] : undefined
    if (r.group === 'foes' && (!bond || GRUDGE_RANKS.test(bond)))
      out.push({
        key: `foe:${r.person.hf}`,
        text: `${
          !bond
            ? `${name} cannot stand ${who}`
            : bond.includes('grudge')
              ? `${name} holds a ${bond} against ${who}`
              : bond.includes('obsession')
                ? `${name} has a jealous obsession with ${who}`
                : `${name} and ${who} are ${bond}s`
        }. Put them at the same table.`,
      })
    else if (r.group === 'family' && !r.person.alive)
      out.push({
        key: `loss:${r.person.hf}`,
        text: `${name} lost ${p.their} ${r.label.toLowerCase()}, ${who}. How does ${p.they} carry it?`,
      })
    else if (r.person.kind === 'known' && (r.person.love ?? 0) >= 100)
      out.push({
        key: `kindred:${r.person.hf}`,
        text: `${name} and ${who} are kindred spirits. What do they share that no one else does?`,
      })
  }
  const lonely = sheet.needs.find(
    (n) => (n[0] === 'BeWithFriends' || n[0] === 'BeWithFamily') && n[1] < -9999,
  )
  if (lonely)
    out.push({
      key: 'lonely',
      text: `${name} has gone too long without ${lonely[0] === 'BeWithFamily' ? 'family' : 'friends'} and feels it.`,
    })
  const prayer = sheet.needs.find((n) => n[0] === 'PrayOrMeditate' && n[1] < -9999)
  if (prayer)
    out.push({
      key: 'faith',
      text: `${name} has not been able to pray${prayer[3] ? ` to ${prayer[3]}` : ''} in a long time. Does ${p.their} faith waver, or harden?`,
    })
  for (const [token, rating, , , , enabled] of sheet.skills) {
    if (enabled !== false || rating < 8) continue
    out.push({
      key: `wasted:${token}`,
      text: `${name} is ${skillRank(rating).toLowerCase()} at ${skillLabel(token, unit)}, and nobody lets ${p.them} do it.`,
    })
    break
  }
  const values = new Map(unit.values ?? [])
  if (
    unit.squad &&
    ((values.get('PEACE') ?? 0) >= 21 || (values.get('MARTIAL_PROWESS') ?? 0) <= -21)
  )
    out.push({
      key: 'soldier',
      text: `${name} serves in ${unit.squad} but believes in peace. What happens when the order to fight comes?`,
    })
  if (
    (values.get('NATURE') ?? 0) >= 21 &&
    sheet.skills.some(([t, , , , , on]) => t === 'WOODCUTTING' && on)
  )
    out.push({
      key: 'nature',
      text: `${name} loves nature, and cuts down trees for a living.`,
    })
  for (const [thought, emotion, year, tick] of sheet.core_memories ?? []) {
    const ago = gameAgo({ year, tick }, now)
    out.push({
      key: `core:${thought}:${year}:${tick}`,
      text: `${name} ${thoughtPhrase(thought, emotion)}${ago ? ` ${ago}` : ` in ${year}`}, and was never the same.`,
    })
  }
  if (sheet.pregnant) out.push({ key: 'pregnant', text: `${name} is expecting a child.` })
  if ((sheet.kills ?? 0) > 0)
    out.push({
      key: 'kills',
      text: `${name} has killed ${sheet.kills === 1 ? 'once' : `${sheet.kills} times`}. Does it weigh on ${p.them}?`,
    })
  return out
}

// ---------------------------------------------------------------------------
// The brief a language model is given to voice them

export type VoiceMode = 'voice' | 'diary' | 'gossip' | 'bio' | 'ask'

export const VOICE_MODES: { key: VoiceMode; label: string; hint: string }[] = [
  {
    key: 'voice',
    label: 'In their words',
    hint: 'What is on their mind right now, as they would say it.',
  },
  { key: 'diary', label: 'Diary entry', hint: 'Tonight’s entry in their journal.' },
  {
    key: 'gossip',
    label: 'Tavern gossip',
    hint: 'What the people who know them say behind their back.',
  },
  {
    key: 'bio',
    label: 'Biography',
    hint: 'Their life so far, as the fortress chronicler would set it down.',
  },
  { key: 'ask', label: 'Ask them', hint: 'Put a question to them and hear their answer.' },
]

/** Everything the page knows about them, as plain statements. */
export function characterBrief(unit: FortUnit, now: GameTime | null): string[] {
  const sheet = unit.sheet && !unit.sheet.error ? unit.sheet : null
  const p = pronouns(unit)
  const lines: string[] = []
  const title = sheet?.custom_profession
  const who = [`${Math.floor(unit.age)}-year-old`, sexLabel(unit.sex), unit.race]
    .filter((w) => w && w !== 'no sex')
    .join(' ')
  lines.push(
    `${unit.name || unit.readable}${unit.nickname ? ` (called "${unit.nickname}")` : ''}${unit.name_english && unit.name_english !== unit.name ? `, in plain words "${unit.name_english}"` : ''}: a ${who}, ${title ? `given the title "${title}"` : unit.profession.toLowerCase()}.`,
  )
  if (sheet?.birth) lines.push(`Born on ${formatGameTick(sheet.birth[0], sheet.birth[1])}.`)
  if (unit.positions.length) lines.push(`Holds the office of ${listing(unit.positions)}.`)
  if (unit.squad) lines.push(`Serves in the squad ${unit.squad}.`)
  lines.push(
    `Right now ${p.they} ${p.is} ${stressLabel(unit.stress_category)}${unit.job ? `, busy with: ${unit.job.toLowerCase()}` : ', without a job'}.`,
  )
  if (unit.mood) lines.push(`In the grip of a ${unit.mood.toLowerCase()} mood.`)
  const character = characterSheet(unit, sheet)
  if (character.temperament.length)
    lines.push(`Temperament: ${p.they} ${listing(character.temperament)}.`)
  const mild = (unit.traits ?? [])
    .filter(([facet, value]) => !facetPhrase(unit, facet, value))
    .map(
      ([facet, value]) =>
        `${value >= 61 ? 'rather high' : 'rather low'} ${humanize(facet).toLowerCase()}`,
    )
  if (mild.length) lines.push(`Also: ${listing(mild)}.`)
  if (character.holds.length) lines.push(`Beliefs: ${p.they} ${listing(character.holds)}.`)
  if (character.scorns.length) lines.push(`Scorns: ${p.they} ${listing(character.scorns)}.`)
  for (const dream of character.dreams) lines.push(`${capitalize(p.they)} ${dream}.`)
  if (!sheet) return lines
  for (const faith of character.faith) lines.push(`${faith}.`)
  const unmet = sheet.needs.filter((n) => n[1] < -999)
  if (unmet.length)
    lines.push(
      `Unmet longings: ${listing(unmet.map((n) => `to ${needWant(n, unit)} (${needLevel(n[1]).label.toLowerCase()})`))}.`,
    )
  const met = sheet.needs.filter((n) => n[1] >= 200)
  if (met.length)
    lines.push(`Recently satisfied: ${listing(met.map((n) => `to ${needWant(n, unit)}`))}.`)
  for (const group of preferenceGroups(sheet))
    lines.push(
      `${group.key === 'hates' ? 'Cannot stand' : `Likes (${group.label.toLowerCase()})`}: ${listing(group.items)}.`,
    )
  for (const r of relations(sheet).slice(0, 20)) {
    const who = personName(r.person)
    const extra = [
      r.person.race && r.person.race !== unit.race ? r.person.race : null,
      r.person.alive ? null : 'dead',
      r.detail,
      r.person.met ? `met ${r.person.met} times` : null,
    ]
      .filter(Boolean)
      .join(', ')
    lines.push(`${r.label}: ${who}${extra ? ` (${extra})` : ''}.`)
  }
  for (const [name, type, link] of sheet.groups)
    if (!/^FORMER/.test(link))
      lines.push(
        `Member of ${name} (${splitPascal(type).toLowerCase()}${link === 'POSITION' ? ', holds a position' : ''}).`,
      )
  for (const talent of character.talents) lines.push(`Skill: ${talent}.`)
  for (const remark of character.physique) lines.push(`${capitalize(p.they)} ${p.is} ${remark}.`)
  for (const t of (unit.thoughts ?? []).slice(0, 8)) {
    const ago = gameAgo({ year: t[3], tick: t[4] }, now)
    lines.push(`Lately ${p.they} ${thoughtPhrase(t[0], t[1])}${ago ? ` (${ago})` : ''}.`)
  }
  for (const memory of character.haunted) lines.push(`${memory}.`)
  const hurt = injuries(sheet)
  if (hurt.length) lines.push(`Injuries: ${hurt.map(wordsForWound).join('; ')}.`)
  const syndromes = syndromeNames(sheet)
  if (syndromes.length) lines.push(`Affected by: ${listing(syndromes)}.`)
  if (sheet.pregnant) lines.push(`${capitalize(p.they)} ${p.is} pregnant.`)
  if (sheet.kills) lines.push(`Has killed ${sheet.kills}.`)
  return lines
}
