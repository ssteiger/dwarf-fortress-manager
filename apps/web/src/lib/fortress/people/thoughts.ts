import type { FortUnit } from '@fortress/db-drizzle'

import { humanize, isLiving, splitPascal } from '../format'
import { type GameTime, TICKS_PER_MONTH, absTicks } from '../time'
import { isCitizenish, pronouns } from './units'

/*
 * What dwarves think and feel: the game's thought and emotion tokens in
 * words, whether each one is good or bad news, what the player can do about
 * the bad ones, and what went through the fortress's heads lately.
 * Client-safe.
 */

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

/** The thought in words; give `subject` when the sentence names whose thought it was. */
export function thoughtPhrase(
  thought: string,
  emotion?: string,
  subject?: Pick<FortUnit, 'sex'>,
): string {
  if (thought === 'Syndrome' && emotion)
    return `felt ${humanize(emotion).toLowerCase()} from a syndrome`
  const known = THOUGHTS[thought]
  if (known)
    return subject ? known.phrase.replace(/\btheir\b/g, pronouns(subject).their) : known.phrase
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
