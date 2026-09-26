import type { FortAlert, FortEvent, FortSummary, FortUnit } from '@fortress/db-drizzle'

import { humanize, isLiving, splitPascal, stressLabel, unitGroup, unitNeeds } from './format'
import type { FortConcerns } from './server'

/*
 * Client-safe readings of a fortress dump: what needs the player, what
 * everyone is doing and feeling, and what the announcements amount to.
 * Pure functions over data the pages already fetch.
 */

// ---------------------------------------------------------------------------
// Game time

export const TICKS_PER_DAY = 1200
export const TICKS_PER_MONTH = TICKS_PER_DAY * 28
export const TICKS_PER_YEAR = TICKS_PER_MONTH * 12

export interface GameTime {
  year: number
  tick: number
}

export const absTicks = (t: GameTime) => t.year * TICKS_PER_YEAR + t.tick

export function gameTimeOf(
  state: { world?: { year: number; tick: number } | null } | null | undefined,
): GameTime | null {
  const w = state?.world
  return w && typeof w.year === 'number' && typeof w.tick === 'number'
    ? { year: w.year, tick: w.tick }
    : null
}

/** "3 days", "2 months", "a year and a half" is too clever: "1 year". */
export function gameSpan(ticks: number): string {
  const days = Math.floor(ticks / TICKS_PER_DAY)
  if (days < 1) return 'less than a day'
  if (days < 28) return `${days} day${days === 1 ? '' : 's'}`
  const months = Math.floor(days / 28)
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`
  const years = Math.floor(months / 12)
  return `${years} year${years === 1 ? '' : 's'}`
}

export function gameAgo(then: GameTime, now: GameTime | null): string | null {
  if (!now) return null
  const diff = absTicks(now) - absTicks(then)
  if (diff < 0) return null
  if (diff < TICKS_PER_DAY) return 'today'
  return `${gameSpan(diff)} ago`
}

const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const

export function seasonOf(tick: number): (typeof SEASONS)[number] {
  return SEASONS[Math.min(3, Math.floor(tick / TICKS_PER_MONTH / 3))]
}

// ---------------------------------------------------------------------------
// People

export function isCitizenish(unit: FortUnit): boolean {
  const group = unitGroup(unit)
  return group === 'citizen' || group === 'resident'
}

export function isGrownCitizen(unit: FortUnit): boolean {
  return (
    isLiving(unit) &&
    isCitizenish(unit) &&
    !unit.flags.includes('child') &&
    !unit.flags.includes('baby')
  )
}

/** "Thelma" for a nicknamed or named dwarf, the readable name for anyone else. */
export function firstName(unit: Pick<FortUnit, 'name' | 'nickname' | 'readable'>): string {
  return unit.nickname || unit.name.split(/\s+/)[0] || unit.readable
}

export function pronouns(unit: Pick<FortUnit, 'sex'>) {
  if (unit.sex === 0)
    return {
      they: 'she',
      them: 'her',
      their: 'her',
      self: 'herself',
      is: 'is',
      has: 'has',
    }
  if (unit.sex === 1)
    return {
      they: 'he',
      them: 'him',
      their: 'his',
      self: 'himself',
      is: 'is',
      has: 'has',
    }
  return {
    they: 'they',
    them: 'them',
    their: 'their',
    self: 'themselves',
    is: 'are',
    has: 'have',
  }
}

// ---------------------------------------------------------------------------
// Thoughts

export type Tone = 'bad' | 'good' | 'neutral'

export function emotionTone(emotion: string): Tone {
  const name = emotion.toLowerCase()
  if (/anything|interest|empathy|sympathy/.test(name)) return 'neutral'
  if (
    /anger|anguish|anxi|apath|bitter|contempt|despair|disgust|fear|fright|frustrat|grief|grouch|hate|horror|irritat|loath|lonely|loneli|miser|mortif|nervous|panic|pessim|restless|sad|shame|shock|terror|uneas|worry|agitat|empti|outrage|annoy|dejection|self_pity|glum|resent|vengeful|embarrass|regret/.test(
      name,
    )
  )
    return 'bad'
  return 'good'
}

interface ThoughtText {
  /** Past tense, reads after a name or a count: "Urist ___", "3 dwarves ___". */
  phrase: string
  /** What the player could do about it, for thoughts that cost happiness. */
  hint?: string
}

const BURY_HINT =
  'Build coffins and designate a tomb zone, or engrave memorial slabs for those whose bodies are lost.'

const THOUGHTS: Record<string, ThoughtText> = {
  SatisfiedAtWork: { phrase: 'took satisfaction in their work' },
  ImproveSkill: { phrase: 'got better at a skill' },
  MasterSkill: { phrase: 'mastered a skill' },
  MakeMasterwork: { phrase: 'made a masterwork' },
  MadeArtifact: { phrase: 'created an artifact' },
  WatchPerform: { phrase: 'watched a performance' },
  Perform: { phrase: 'performed for an audience' },
  AdmireBuilding: { phrase: 'admired fine furniture' },
  AdmireOwnBuilding: { phrase: 'admired their own work' },
  AdmireArrangedBuilding: { phrase: 'admired a well-arranged room' },
  AdmireOwnArrangedBuilding: { phrase: 'admired a room they arranged' },
  DiningQuality: { phrase: 'dined in a fine hall' },
  BedroomQuality: { phrase: 'slept in a fine bedroom' },
  Prayer: { phrase: 'prayed' },
  Talked: { phrase: 'had a good talk' },
  MadeFriend: { phrase: 'made a friend' },
  NewRomance: { phrase: 'fell in love' },
  BecomeParent: { phrase: 'became a parent' },
  Birth: { phrase: 'welcomed a birth' },
  Argument: { phrase: 'got into an argument' },
  DiscussProblems: { phrase: 'talked through their troubles' },
  DiscussOthersProblems: { phrase: 'listened to a friend’s troubles' },
  IntellectualDiscussion: { phrase: 'had a lively discussion' },
  Complained: { phrase: 'complained' },
  ReceivedComplaint: { phrase: 'heard a complaint' },
  Bath: { phrase: 'took a bath' },
  Syndrome: { phrase: 'felt a syndrome take hold' },
  Trauma: {
    phrase: 'suffered a trauma',
    hint: 'Terrible sights build up. Keep dwarves away from the dead and from fighting they cannot win.',
  },
  WitnessDeath: { phrase: 'saw someone die', hint: BURY_HINT },
  UnexpectedDeath: { phrase: 'lost someone suddenly', hint: BURY_HINT },
  Death: { phrase: 'lost someone close', hint: BURY_HINT },
  SawDeadBody: {
    phrase: 'came across a dead body',
    hint: 'Bury the dead, or haul bodies to a refuse pile away from traffic.',
  },
  LostPet: { phrase: 'lost a pet' },
  Miasma: {
    phrase: 'choked on miasma',
    hint: 'Something is rotting indoors. Move the refuse pile outside, or seal off the room.',
  },
  Smoke: {
    phrase: 'breathed smoke',
    hint: 'Give the smoke somewhere to go, or move the fire.',
  },
  DrinkWithoutCup: {
    phrase: 'drank without a cup',
    hint: 'Make mugs or goblets at a craftsdwarf’s workshop and keep them near the drink.',
  },
  EatLikeAnimal: {
    phrase: 'ate without a table',
    hint: 'A dining hall with tables and chairs puts a stop to it.',
  },
  EatVermin: { phrase: 'ate vermin', hint: 'Keep prepared meals stocked.' },
  NeedsUnfulfilled: {
    phrase: 'had needs go unmet',
    hint: 'Unmet needs wear dwarves down. A temple, a tavern, a library, friends and time off all help.',
  },
  LackWork: {
    phrase: 'had nothing to do',
    hint: 'Queue work orders or give them more labors.',
  },
  Rain: { phrase: 'got caught in the rain' },
  FreakishWeather: { phrase: 'endured freakish weather' },
  SnowStorm: { phrase: 'endured a snowstorm' },
  OldClothing: {
    phrase: 'wore old clothing',
    hint: 'Make new clothes, and let them change.',
  },
  TatteredClothing: {
    phrase: 'wore tattered clothing',
    hint: 'Make new clothes, and let them change.',
  },
  RottedClothing: {
    phrase: 'wore rotting clothing',
    hint: 'Make new clothes, and let them change.',
  },
  NoShirt: {
    phrase: 'had no shirt',
    hint: 'A clothier and a loom keep dwarves dressed.',
  },
  NoShoes: {
    phrase: 'had no shoes',
    hint: 'A clothier or leatherworker keeps dwarves shod.',
  },
  SleepNoiseWake: {
    phrase: 'was woken by noise',
    hint: 'Keep bedrooms away from workshops and busy halls.',
  },
  SleepNoiseMajorWake: {
    phrase: 'was woken by loud noise',
    hint: 'Keep bedrooms away from workshops and busy halls.',
  },
  SleepNoiseMinorWake: { phrase: 'slept fitfully' },
  Drowsy: { phrase: 'grew drowsy' },
  VeryDrowsy: {
    phrase: 'was exhausted',
    hint: 'Build more beds, even a dormitory will do.',
  },
  Thirsty: { phrase: 'was thirsty' },
  Dehydrated: {
    phrase: 'was parched',
    hint: 'Stock drink where they can reach it.',
  },
  Hungry: { phrase: 'was hungry' },
  Starving: {
    phrase: 'was starving',
    hint: 'Stock food where they can reach it.',
  },
  MajorInjuries: {
    phrase: 'was badly hurt',
    hint: 'A hospital with beds and a doctor heals faster.',
  },
  MinorInjuries: { phrase: 'was hurt' },
  GhostHaunt: { phrase: 'was haunted by a ghost', hint: BURY_HINT },
  GhostNightmare: { phrase: 'had nightmares of a ghost', hint: BURY_HINT },
  Cavein: { phrase: 'survived a cave-in' },
  Spar: { phrase: 'sparred' },
  Elected: { phrase: 'was elected' },
  BecomeNoble: { phrase: 'rose to a noble position' },
  Demands: { phrase: 'made demands' },
  MandateIgnored: { phrase: 'saw a mandate ignored' },
  ResearchBreakthrough: { phrase: 'had a research breakthrough' },
  PonderTopic: { phrase: 'pondered a problem' },
  LearnTopic: { phrase: 'learned something new' },
  Read: { phrase: 'read a book' },
  Kill: { phrase: 'killed someone' },
  FirstKill: { phrase: 'made their first kill' },
  Attacked: { phrase: 'was attacked' },
  AttackedByDead: { phrase: 'was attacked by the dead' },
  Conflict: { phrase: 'fought' },
  JoinConflict: { phrase: 'joined a fight' },
  LoveSeparated: { phrase: 'was parted from a loved one' },
  LoveReunited: { phrase: 'was reunited with a loved one' },
}

export function thoughtPhrase(thought: string, emotion?: string): string {
  if (thought === 'Syndrome' && emotion)
    return `felt ${humanize(emotion).toLowerCase()} from a syndrome`
  const known = THOUGHTS[thought]
  if (known) return known.phrase
  const words = splitPascal(thought).toLowerCase()
  return emotion ? `felt ${humanize(emotion).toLowerCase()} (${words})` : words
}

export function thoughtHint(thought: string): string | undefined {
  return THOUGHTS[thought]?.hint
}

export type Thought = [string, string, number, number, number]

/** Their newest thought that is worth a line: bad ones first, then anything but routine work. */
export function notableThought(unit: FortUnit, now: GameTime | null): Thought | null {
  const thoughts = unit.thoughts ?? []
  if (!thoughts.length) return null
  const recent = now
    ? thoughts.filter(
        (t) => absTicks(now) - absTicks({ year: t[3], tick: t[4] }) <= TICKS_PER_MONTH,
      )
    : thoughts
  const pool = recent.length ? recent : thoughts
  return (
    pool.find((t) => emotionTone(t[1]) === 'bad') ??
    pool.find((t) => t[0] !== 'SatisfiedAtWork' && t[0] !== 'ImproveSkill') ??
    pool[0]
  )
}

export interface Feeling {
  key: string
  thought: string
  phrase: string
  tone: Tone
  emotions: string[]
  hint?: string
  /** Distinct dwarves who had it lately, most recent first. */
  units: FortUnit[]
}

/** What went through the citizens' heads in the last month, most widely felt first. */
export function fortFeelings(units: FortUnit[], now: GameTime | null): Feeling[] {
  const groups = new Map<string, Feeling & { latest: number }>()
  for (const unit of units) {
    if (!isLiving(unit) || !isCitizenish(unit)) continue
    const seen = new Set<string>()
    for (const t of unit.thoughts ?? []) {
      const at = absTicks({ year: t[3], tick: t[4] })
      if (now && absTicks(now) - at > TICKS_PER_MONTH) continue
      const tone = emotionTone(t[1])
      const key = `${t[0]}|${tone}`
      if (seen.has(key)) continue
      seen.add(key)
      const group = groups.get(key) ?? {
        key,
        thought: t[0],
        phrase: thoughtPhrase(t[0], t[1]),
        tone,
        emotions: [],
        hint: tone === 'bad' ? thoughtHint(t[0]) : undefined,
        units: [],
        latest: 0,
      }
      group.units.push(unit)
      if (t[1] && !group.emotions.includes(t[1])) group.emotions.push(t[1])
      group.latest = Math.max(group.latest, at)
      groups.set(key, group)
    }
  }
  return [...groups.values()].sort((a, b) => b.units.length - a.units.length || b.latest - a.latest)
}

// ---------------------------------------------------------------------------
// What everyone is doing

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
    `Right now ${p.they} ${p.is} ${verb}${unit.job && activity.key !== 'idle' ? `: ${unit.job.toLowerCase()}` : ''}.`,
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
    const phrase = thoughtPhrase(t[0], t[1])
    if (!lately.includes(phrase)) lately.push(phrase)
    if (lately.length === 3) break
  }
  if (lately.length)
    sentences.push(
      `Lately ${p.they} ${lately.length > 1 ? `${lately.slice(0, -1).join(', ')} and ${lately[lately.length - 1]}` : lately[0]}.`,
    )
  return sentences.join(' ')
}

// ---------------------------------------------------------------------------
// One dwarf's troubles

export type Severity = 'danger' | 'warning' | 'info'

export interface Concern {
  key: string
  severity: Severity
  label: string
  hint?: string
}

const MOOD_TEXT: Record<string, { label: string; severity: Severity; hint: string }> = {
  Fey: {
    label: 'Taken by a fey mood',
    severity: 'warning',
    hint: 'They will claim a workshop and gather materials for an artifact. Keep what they ask for in stock: if they cannot finish, they go mad.',
  },
  Secretive: {
    label: 'In a secretive mood',
    severity: 'warning',
    hint: 'They will claim a workshop and gather materials for an artifact. Keep what they ask for in stock: if they cannot finish, they go mad.',
  },
  Possessed: {
    label: 'Possessed',
    severity: 'warning',
    hint: 'They will make an artifact, but gain no skill from it. Let them work undisturbed.',
  },
  Macabre: {
    label: 'In a macabre mood',
    severity: 'warning',
    hint: 'They want bones, skulls and other remains. Keep some in reach, or they go mad.',
  },
  Fell: {
    label: 'In a fell mood',
    severity: 'danger',
    hint: 'They will kill someone to finish their work. Keep others clear of them, or make peace with the loss.',
  },
  Melancholy: {
    label: 'Stricken by melancholy',
    severity: 'danger',
    hint: 'They will wander and starve. There is no cure, but a burial and a memorial keep the grief from spreading.',
  },
  Raving: {
    label: 'Raving mad',
    severity: 'danger',
    hint: 'There is no cure. Keep them away from others.',
  },
  Berserk: {
    label: 'Gone berserk',
    severity: 'danger',
    hint: 'They will attack anyone near them. Lock them away or let the militia deal with it.',
  },
  Traumatized: {
    label: 'Traumatized',
    severity: 'danger',
    hint: 'They have seen too much. Keep them from the dead and from danger.',
  },
}

export function moodText(mood: string | null) {
  if (!mood) return null
  return (
    MOOD_TEXT[mood] ?? {
      label: `${humanize(mood)} mood`,
      severity: 'warning' as Severity,
      hint: 'Something has taken hold of them. Watch what they do next.',
    }
  )
}

const NEED_HINTS: Record<string, string> = {
  Starving: 'Check food is stocked and nothing blocks the way to it.',
  Hungry: 'They will eat when they can reach food.',
  Dehydrated: 'Check drink is stocked and reachable. A well is a good fallback.',
  Thirsty: 'They will drink when they can reach drink.',
  Exhausted: 'They need a bed. A dormitory will do.',
  Drowsy: 'They will sleep soon.',
}

export function unitConcerns(unit: FortUnit, now: GameTime | null = null): Concern[] {
  if (!isLiving(unit)) return []
  const out: Concern[] = []
  const mood = moodText(unit.mood)
  if (mood)
    out.push({
      key: 'mood',
      severity: mood.severity,
      label: mood.label,
      hint: mood.hint,
    })
  else if (unit.flags.includes('insane'))
    out.push({
      key: 'insane',
      severity: 'danger',
      label: 'Insane',
      hint: 'There is no cure.',
    })

  if (unit.wounds > 0) {
    const blood =
      unit.blood !== null && unit.blood_max ? Math.round((unit.blood / unit.blood_max) * 100) : null
    out.push({
      key: 'wounds',
      severity: blood !== null && blood < 60 ? 'danger' : 'warning',
      label: `${unit.wounds} wound${unit.wounds === 1 ? '' : 's'}${blood !== null && blood < 100 ? `, blood ${blood}%` : ''}`,
      hint: 'Rest in a hospital bed, tended by a doctor, heals them fastest.',
    })
  }
  for (const need of unitNeeds(unit)) {
    out.push({
      key: `need-${need.label}`,
      severity: need.severity === 'danger' ? 'danger' : 'info',
      label: need.label,
      hint: NEED_HINTS[need.label],
    })
  }
  if (isCitizenish(unit) && unit.stress_category <= 2) {
    const lately = notableThought(unit, now)
    out.push({
      key: 'stress',
      severity:
        unit.stress_category === 0 ? 'danger' : unit.stress_category === 1 ? 'warning' : 'info',
      label: humanize(stressLabel(unit.stress_category)),
      hint: `${lately && emotionTone(lately[1]) === 'bad' ? `Lately ${pronouns(unit).they} ${thoughtPhrase(lately[0], lately[1])}. ` : ''}Good meals, a finer bedroom and time with friends lift a dwarf’s spirits.`,
    })
  }
  if (isGrownCitizen(unit) && !unit.job && !unit.squad && !unit.mood)
    out.push({
      key: 'idle',
      severity: 'info',
      label: 'Idle',
      hint: 'Queue work orders, or give them more labors.',
    })
  return out
}

const SEVERITY_RANK: Record<Severity, number> = {
  danger: 0,
  warning: 1,
  info: 2,
}

export function worstSeverity(concerns: Concern[]): Severity | null {
  let worst: Severity | null = null
  for (const c of concerns)
    if (worst === null || SEVERITY_RANK[c.severity] < SEVERITY_RANK[worst]) worst = c.severity
  return worst
}

export function concernScore(concerns: Concern[]): number {
  return concerns.reduce((sum, c) => sum + (3 - SEVERITY_RANK[c.severity]) ** 2, 0)
}

// ---------------------------------------------------------------------------
// The fortress's troubles

export type NoticeKind =
  | 'threat'
  | 'mood'
  | 'dead'
  | 'health'
  | 'needs'
  | 'stress'
  | 'supply'
  | 'work'
  | 'comfort'

export interface NoticeLine {
  label: string
  detail?: string
  count?: number
  hint?: string
}

export interface Notice {
  key: string
  severity: Severity
  kind: NoticeKind
  title: string
  detail?: string
  hint?: string
  units?: FortUnit[]
  lines?: NoticeLine[]
  link?: {
    to: '/fortress/map' | '/fortress/work' | '/fortress/items'
    label: string
  }
}

const KIND_ORDER: NoticeKind[] = [
  'threat',
  'mood',
  'dead',
  'health',
  'needs',
  'stress',
  'supply',
  'work',
  'comfort',
]

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function listNames(units: FortUnit[], max = 3): string {
  const names = units.slice(0, max).map(firstName)
  const rest = units.length - names.length
  if (rest > 0) return `${names.join(', ')} and ${rest} more`
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

const IRREGULAR: Record<string, string> = {
  dwarf: 'dwarves',
  elf: 'elves',
  wolf: 'wolves',
}

/** "fiend of shadow" -> "fiends of shadow", "magma man" -> "magma men". */
export function creaturePlural(race: string): string {
  const [head, ...tail] = race.split(' of ')
  const words = head.split(' ')
  const last = words.pop() ?? ''
  const plural =
    IRREGULAR[last] ??
    (/man$/.test(last)
      ? last.replace(/man$/, 'men')
      : /(s|x|ch|sh)$/.test(last)
        ? `${last}es`
        : /[^aeiou]y$/.test(last)
          ? `${last.slice(0, -1)}ies`
          : `${last}s`)
  return [...words, plural].join(' ') + (tail.length ? ` of ${tail.join(' of ')}` : '')
}

/** "3 goblins and a troll". */
export function creatureCounts(units: Pick<FortUnit, 'race'>[]): string {
  const counts = new Map<string, number>()
  for (const u of units) counts.set(u.race, (counts.get(u.race) ?? 0) + 1)
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([race, n]) =>
      n === 1 ? `${/^[aeiou]/i.test(race) ? 'an' : 'a'} ${race}` : `${n} ${creaturePlural(race)}`,
    )
  return parts.length <= 1
    ? (parts[0] ?? 'something')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

const CANCELLATION_HINTS: [RegExp, string][] = [
  [/iron bars|bars/i, 'Smelt ore into bars at a smelter, or trade for them.'],
  [
    /boulders|stone/i,
    'Mine more stone, or check that the stone you have is not forbidden or reserved.',
  ],
  [/logs|wood/i, 'Cut down trees, or buy wood from a caravan.'],
  [/empty cage/i, 'Build more cages at a carpenter’s or metalsmith’s forge.'],
  [/cloth/i, 'Weave thread into cloth at a loom.'],
  [/thread/i, 'Spin thread from plant fiber or wool.'],
  [
    /processable plant|unrotten/i,
    'Grow or gather plants, and cancel repeating jobs you have no plants for.',
  ],
  [/potash/i, 'Make potash from ash at an ashery.'],
  [/spawn|seeds/i, 'Gather or buy seeds for this crop.'],
  [/table|chair|bed|door|cabinet|coffer/i, 'Build the furniture it needs first.'],
  [
    /interrupted|dangerous|hostile/i,
    'Something scared them off the job. Check the area for danger.',
  ],
]

export function cancellationHint(reason: string): string | undefined {
  return CANCELLATION_HINTS.find(([re]) => re.test(reason))?.[1]
}

export function fortNotices({
  summary,
  units,
  concerns,
  now,
}: {
  summary: FortSummary | null
  units: FortUnit[]
  concerns: FortConcerns | null
  now: GameTime | null
}): Notice[] {
  const notices: Notice[] = []
  const living = units.filter(isLiving)
  const citizens = living.filter(isCitizenish)
  const soldiers = citizens.filter((u) => u.squad).length

  // Threats: what is on the map, split by whether your dwarves have seen it.
  const hostiles = living.filter((u) => unitGroup(u) === 'hostile')
  const seen = hostiles.filter((u) => !u.flags.includes('hidden'))
  const unseen = hostiles.filter((u) => u.flags.includes('hidden'))
  if (seen.length) {
    const invaders = seen.some((u) => u.flags.includes('invader'))
    notices.push({
      key: 'threat-seen',
      severity: 'danger',
      kind: 'threat',
      title: `${creatureCounts(seen)} ${seen.length === 1 ? 'is' : 'are'} on the map`,
      detail: invaders
        ? 'Invaders have come for the fortress.'
        : 'Dangerous creatures roam in sight.',
      hint: soldiers
        ? 'Send your squads, and keep everyone else indoors.'
        : 'You have no squads. Pull up the drawbridge and keep everyone inside, or arm some dwarves.',
      units: seen,
      link: { to: '/fortress/map', label: 'Open the map' },
    })
  }
  if (unseen.length) {
    const depths = unseen.map((u) => u.z).filter((z): z is number => z !== null)
    const low = depths.length ? Math.min(...depths) : null
    const high = depths.length ? Math.max(...depths) : null
    notices.push({
      key: 'threat-unseen',
      severity: 'warning',
      kind: 'threat',
      title: `${creatureCounts(unseen)} ${unseen.length === 1 ? 'lurks' : 'lurk'} unseen`,
      detail:
        low !== null
          ? `Deep down, at z${low === high ? low : `${low}–${high}`}. Your dwarves have not come across ${unseen.length === 1 ? 'it' : 'them'} yet.`
          : 'Your dwarves have not come across them yet.',
      hint: 'Keep cavern entrances walled off or behind a hatch until you are ready for them.',
    })
  }

  // Strange moods and madness: each one is its own story.
  for (const unit of citizens) {
    const mood = moodText(unit.mood)
    if (!mood) continue
    notices.push({
      key: `mood-${unit.id}`,
      severity: mood.severity,
      kind: 'mood',
      title: `${firstName(unit)} is ${mood.label.charAt(0).toLowerCase()}${mood.label.slice(1)}`,
      detail: unit.job ? `Now: ${unit.job}.` : undefined,
      hint: mood.hint,
      units: [unit],
    })
  }

  // The unburied dead.
  if (concerns?.unburied.length) {
    const byId = new Map(units.map((u) => [u.id, u]))
    const dead = concerns.unburied
      .map((b) => byId.get(b.unitId))
      .filter((u): u is FortUnit => u !== undefined)
    notices.push({
      key: 'dead-unburied',
      severity: 'warning',
      kind: 'dead',
      title:
        concerns.unburied.length === 1
          ? `${concerns.unburied[0].name} lies unburied`
          : `${concerns.unburied.length} of your dead lie unburied`,
      lines: concerns.unburied.map((b) => ({
        label: b.description,
        detail: b.x !== null ? `${b.x},${b.y} z${b.z}` : undefined,
      })),
      hint: `Seeing the dead shakes your dwarves, and the unburied dead of a fortress can return as ghosts. ${concerns.coffins ? `You have ${plural(concerns.coffins, 'coffin')} built: put ${concerns.coffins === 1 ? 'it' : 'them'} in a tomb zone.` : 'Build a coffin and place it in a tomb zone.'}`,
      units: dead,
    })
  }

  // The hurt.
  const hurt = citizens.filter((u) => u.wounds > 0)
  if (hurt.length) {
    const doctor = citizens.find((u) => u.positions.some((p) => /medical/i.test(p)))
    const hospital = (concerns?.zones.Hospital ?? 0) > 0
    const bleeding = hurt.some(
      (u) => u.blood !== null && u.blood_max && u.blood / u.blood_max < 0.6,
    )
    notices.push({
      key: 'health-hurt',
      severity: bleeding ? 'danger' : 'warning',
      kind: 'health',
      title:
        hurt.length === 1 ? `${firstName(hurt[0])} is hurt` : `${hurt.length} dwarves are hurt`,
      detail: doctor
        ? `${firstName(doctor)} is your chief medical dwarf.`
        : 'Nobody is appointed chief medical dwarf.',
      hint: hospital
        ? 'They will heal fastest resting in the hospital.'
        : concerns
          ? `You have no hospital. Designate a hospital zone with beds${doctor ? '' : ', and appoint a chief medical dwarf'}.`
          : undefined,
      units: hurt,
    })
  }

  // Needs gone critical.
  const critical = citizens.filter((u) => unitNeeds(u).some((n) => n.severity === 'danger'))
  if (critical.length) {
    const labels = [
      ...new Set(
        critical.flatMap((u) =>
          unitNeeds(u)
            .filter((n) => n.severity === 'danger')
            .map((n) => n.label.toLowerCase()),
        ),
      ),
    ]
    notices.push({
      key: 'needs-critical',
      severity: 'danger',
      kind: 'needs',
      title: `${listNames(critical)} ${critical.length === 1 ? 'is' : 'are'} ${labels.join(' and ')}`,
      hint: 'Check that food, drink and beds are stocked and nothing blocks the way to them.',
      units: critical,
    })
  }

  // Unhappiness.
  const unhappy = citizens
    .filter((u) => u.stress_category <= 2)
    .sort((a, b) => a.stress_category - b.stress_category)
  if (unhappy.length) {
    const worst = unhappy[0].stress_category
    notices.push({
      key: 'stress',
      severity: worst === 0 ? 'danger' : worst === 1 ? 'warning' : 'info',
      kind: 'stress',
      title:
        unhappy.length === 1
          ? `${firstName(unhappy[0])} is ${stressLabel(worst)}`
          : `${unhappy.length} dwarves are unhappy`,
      lines: unhappy.map((u) => {
        const t = notableThought(u, now)
        return {
          label: `${firstName(u)}: ${stressLabel(u.stress_category)}`,
          detail:
            t && emotionTone(t[1]) === 'bad' ? `lately ${thoughtPhrase(t[0], t[1])}` : undefined,
        }
      }),
      hint: 'Unhappy dwarves throw tantrums, and tantrums spread. Good meals, finer bedrooms and time with friends turn it around.',
      units: unhappy,
    })
  }

  // Supplies and failing jobs, as the game dump counts them.
  const alerts: FortAlert[] = summary?.alerts ?? []
  for (const alert of alerts.filter((a) => a.kind === 'supply')) {
    notices.push({
      key: `supply-${alert.title}`,
      severity: alert.severity,
      kind: 'supply',
      title: alert.title,
      detail: alert.detail,
      hint: /drink/i.test(alert.title)
        ? 'Brew more: a still, barrels and plants to ferment.'
        : 'Cook meals, farm, fish or hunt. Buy food from caravans.',
      link: { to: '/fortress/items', label: 'Browse the stores' },
    })
  }
  const failing = alerts.filter((a) => a.kind === 'cancellation')
  if (failing.length) {
    notices.push({
      key: 'work-failing',
      severity: 'warning',
      kind: 'work',
      title: `${plural(failing.length, 'job keeps', 'jobs keep')} failing`,
      lines: failing.map((a) => ({
        label: a.title.replace(/ keeps failing$/, ''),
        detail: a.detail,
        count: a.count,
        hint: cancellationHint(a.detail),
      })),
      hint: 'Repeating orders retry forever. Supply what they need, or cancel them in the game.',
      link: { to: '/fortress/work', label: 'Open work' },
    })
  }

  const idle = citizens.filter((u) => isGrownCitizen(u) && !u.job && !u.squad && !u.mood)
  if (idle.length) {
    notices.push({
      key: 'work-idle',
      severity: 'info',
      kind: 'work',
      title: `${listNames(idle)} ${idle.length === 1 ? 'has' : 'have'} nothing to do`,
      hint: 'Queue work orders at the manager, or give them more labors.',
      units: idle,
    })
  }
  if (summary?.jobs_suspended) {
    notices.push({
      key: 'work-suspended',
      severity: 'info',
      kind: 'work',
      title: `${plural(summary.jobs_suspended, 'job is', 'jobs are')} suspended`,
      hint: 'Suspended jobs usually lack materials or are blocked. Unsuspend them in the game once that is fixed.',
      link: { to: '/fortress/work', label: 'Open work' },
    })
  }

  // Small unhappinesses many dwarves share, with what fixes them.
  for (const feeling of fortFeelings(units, now)) {
    if (feeling.tone !== 'bad' || !feeling.hint || feeling.units.length < 2) continue
    let hint = feeling.hint
    if (feeling.thought === 'DrinkWithoutCup' && concerns)
      hint = `${hint} ${concerns.cups ? `The fortress has ${plural(concerns.cups, 'cup')}.` : 'The fortress has no cups at all.'}`
    notices.push({
      key: `comfort-${feeling.thought}`,
      severity: 'info',
      kind: 'comfort',
      title: `${feeling.units.length} dwarves ${feeling.phrase}`,
      hint,
      units: feeling.units,
    })
  }

  return notices.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  )
}

// ---------------------------------------------------------------------------
// Announcements as a story

export type StoryKind =
  | 'death'
  | 'threat'
  | 'mood'
  | 'birth'
  | 'arrival'
  | 'craft'
  | 'discovery'
  | 'society'
  | 'work'
  | 'season'
  | 'other'

export const STORY_KINDS: Record<
  StoryKind,
  {
    label: string
    /** Singular and plural, for counts: "1 birth", "3 births". */
    noun: [string, string]
    tone: 'danger' | 'warning' | 'good' | 'info' | 'muted'
    story: boolean
  }
> = {
  death: {
    label: 'Deaths',
    noun: ['death', 'deaths'],
    tone: 'danger',
    story: true,
  },
  threat: {
    label: 'Danger',
    noun: ['danger', 'dangers'],
    tone: 'danger',
    story: true,
  },
  mood: {
    label: 'Moods and madness',
    noun: ['mood', 'moods'],
    tone: 'warning',
    story: true,
  },
  birth: {
    label: 'Births',
    noun: ['birth', 'births'],
    tone: 'good',
    story: true,
  },
  arrival: {
    label: 'Arrivals and departures',
    noun: ['arrival', 'arrivals'],
    tone: 'info',
    story: true,
  },
  craft: {
    label: 'Masterworks',
    noun: ['masterwork', 'masterworks'],
    tone: 'good',
    story: true,
  },
  discovery: {
    label: 'Discoveries',
    noun: ['discovery', 'discoveries'],
    tone: 'info',
    story: true,
  },
  society: {
    label: 'Nobles and society',
    noun: ['matter of state', 'matters of state'],
    tone: 'info',
    story: true,
  },
  work: {
    label: 'Work',
    noun: ['work event', 'work events'],
    tone: 'muted',
    story: false,
  },
  season: {
    label: 'Seasons and weather',
    noun: ['change of season', 'changes of season'],
    tone: 'muted',
    story: false,
  },
  other: {
    label: 'Other',
    noun: ['other event', 'other events'],
    tone: 'muted',
    story: true,
  },
}

export function storyKind(event: Pick<FortEvent, 'type' | 'text'>): StoryKind {
  const type = event.type ?? ''
  const text = event.text
  if (text.startsWith('[DFHack')) return 'work'
  if (
    /DEATH|DIED|KILLED|SLAIN/.test(type) ||
    /found dead|has died|has been slain|starved to death|drowned/i.test(text)
  )
    return 'death'
  if (/LOST_TO_STRESS|TANTRUM|MOOD|ARTIFACT|INSANE|BERSERK|MELANCHOLY/.test(type)) return 'mood'
  if (
    /SIEGE|AMBUSH|ATTACK|INVADER|MEGABEAST|FORGOTTEN|FB_|WEREBEAST|NIGHT_CREATURE|THIEF|SNATCHER|CAVE_COLLAPSE|FLOOD|VERMIN_BITE|COMBAT|DANGER|UNDEAD|CURSE/.test(
      type,
    )
  )
    return 'threat'
  if (/BIRTH|GROWS_UP/.test(type)) return 'birth'
  if (/ARRIVAL|LEAVE|DEPART|CARAVAN|MIGRANT|DIPLOMAT|LIAISON|VISITOR|PETITION/.test(type))
    return 'arrival'
  if (/MASTERPIECE|MASTERWORK/.test(type)) return 'craft'
  if (/STRUCK|DISCOVER|CAVERN|FEATURE|REACHED_PEAK/.test(type)) return 'discovery'
  if (/NOBLE|ELECT|MANDATE|POSITION|APPOINT|MARRIAGE|MARRY|SPOUSE|LAND_ELEVATED|TITLE/.test(type))
    return 'society'
  if (/SEASON|WEATHER/.test(type)) return 'season'
  if (/CANCEL|QUOTA|PROFESSION|CONSTRUCTION|DIG_|JOB|NOTHING_TO_CATCH/.test(type)) return 'work'
  return 'other'
}

/** How loudly to tell the player about a new announcement, if at all. */
export function alertLevel(event: Pick<FortEvent, 'type' | 'text'>): 'urgent' | 'notable' | null {
  const kind = storyKind(event)
  if (kind === 'death' || kind === 'threat') return 'urgent'
  if (kind === 'mood')
    return /LOST_TO_STRESS|INSANE|BERSERK/.test(event.type ?? '') ? 'urgent' : 'notable'
  if (kind === 'birth' || kind === 'arrival' || kind === 'society') return 'notable'
  if (kind === 'craft' && /artifact/i.test(event.text)) return 'notable'
  return null
}

// ---------------------------------------------------------------------------
// Names in announcements

export interface TextPart {
  text: string
  unit?: FortUnit
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** DF quotes nicknames as `Nick'; show them the way the rest of the app does. */
export function cleanAnnouncement(text: string): string {
  return text.replace(/`([^'`]{1,60})'/g, '“$1”').replace(/\s{2,}/g, ' ')
}

/**
 * Split an announcement into text and the units it names, so names can link
 * to their dwarves. Matches full names and the nicknamed "`Nick' Surname".
 */
export function makeNameLinker(units: FortUnit[]): (text: string) => TextPart[] {
  const ordered = [...units].sort(
    (a, b) =>
      Number(isCitizenish(b)) - Number(isCitizenish(a)) ||
      Number(isLiving(b)) - Number(isLiving(a)),
  )
  const byFull = new Map<string, FortUnit>()
  const bySurname = new Map<string, FortUnit>()
  for (const unit of ordered) {
    const name = unit.name.trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (!byFull.has(key)) byFull.set(key, unit)
    const parts = name.split(/\s+/)
    if (parts.length > 1) {
      const surname = parts[parts.length - 1].toLowerCase()
      if (!bySurname.has(surname)) bySurname.set(surname, unit)
    }
  }
  if (!byFull.size) return (text) => [{ text: cleanAnnouncement(text) }]
  const full = [...byFull.keys()].sort((a, b) => b.length - a.length).map(escapeRe)
  const surnames = [...bySurname.keys()].sort((a, b) => b.length - a.length).map(escapeRe)
  // Groups: 1 full name; 2 nickname and 3 surname. `(?!)` keeps the numbering when empty.
  const re = new RegExp(
    `(${full.join('|')})|\`([^'\`]{1,60})' (${surnames.length ? surnames.join('|') : '(?!)'})`,
    'giu',
  )
  const cache = new Map<string, TextPart[]>()

  return (text) => {
    const hit = cache.get(text)
    if (hit) return hit
    const parts: TextPart[] = []
    let last = 0
    for (const m of text.matchAll(re)) {
      const at = m.index ?? 0
      if (at > last) parts.push({ text: cleanAnnouncement(text.slice(last, at)) })
      const unit = m[1] ? byFull.get(m[1].toLowerCase()) : bySurname.get((m[3] ?? '').toLowerCase())
      parts.push({ text: cleanAnnouncement(m[0]), unit })
      last = at + m[0].length
    }
    if (last < text.length) parts.push({ text: cleanAnnouncement(text.slice(last)) })
    cache.set(text, parts)
    return parts
  }
}
