import type { FortUnit } from '@fortress/db-drizzle/fortress-types'

import { type Dossiers, type DwarfFact, type NicknameIdea, callName } from '../people/dossier'
import { nicknameCore } from './alliteration'

/*
 * The player's own list of nicknames, handed to the dwarves they fit best.
 * A name fits when its words point at something in a dwarf's dossier: the
 * same word ("Clayborn" and a dwarf who likes clay), or a theme the name
 * stands for ("Tiny Toes" and a missing toe, "OSHA" and a pile of wounds).
 * Names nothing points at go to dwarves still without a nickname, as wild cards.
 */

/** A word in a name -> what in a fact it points at. */
const THEMES: [name: RegExp, fact: RegExp][] = [
  [/\b(toes?|feet|foot)\b/i, /\btoes?\b|barefoot|\bsandals\b|\bshortest\b/i],
  [/\b(tiny|lil|little|small|mini|shorty)\b/i, /\b(shortest|narrowest|youngest)\b/i],
  [
    /\b(dr|doc|doctor|phd|md|nurse|medic)\b/i,
    /\bmedical\b|\bdiagnos|\bsurgery\b|\bsuturing\b|setting bones|dressing wounds/i,
  ],
  [
    /\b(osha|safety|supervisor|inspector|hazard|accident)\b/i,
    /\bwounds?\b|\binjur|\bcave-in\b|has lost (an?|both|his|her|their)\b|is missing (a|\d)|sparring accident|\brubble\b/i,
  ],
  [/\b(test|dummy|crash|punching)\b/i, /\battacked\b|\bbeaten\b|\bwounds?\b|\bsparring\b/i],
  [/\b(elf|elves|druid|leaf|hippie)\b/i, /\bnature\b|\belf\b|\belves\b|\bfarming\b|\bherbalism\b/i],
  [
    /(fist|punch|knuckle|brawl|fight|slayer|killer|murder)/i,
    /\bbrawl\b|fist fight|\bbeating\b|\bviolence\b|\bwrestling\b|\bkills?\b|\bdetests\b|\bcruel\b/i,
  ],
  [/\b(ice|cube|frost|snow)\b/i, /\bice\b|\bsnow|\bfrost/i],
  [/\b(jr|junior|kid|son)\b/i, /\bson of\b|\bdaughter of\b|\bchild of\b/i],
  [/\b(baby|babies)\b/i, /\bis a baby\b|\bgiven birth\b/i],
  [/\b(lever|mechanic|gear|pump|engineer)\b/i, /\bmechanic|\blevers?\b|\bpumping\b|\bsiege\b/i],
  [/\b(stone|rock|curling|pebble|boulder)\b/i, /\bstone|\bmasonry\b|\brocks?\b|\bengrav/i],
  [/(clay|potter|\bpot\b|\bmud)/i, /\bclay\b|\bpottery\b|\bmud\b|\bkaolinite\b/i],
  [/\b(weed|herb|grass)\b/i, /\bweed\b|\bherbalism\b|\bgrass\b/i],
  [/\b(vampire|blood|dracula)\b/i, /drank blood|\bbats\b|by the sun/i],
  [/(dino|rex\b|raptor|saur)/i, /saur|ceratops|raptor|gnathus/i],
  [
    /\b(space|moon|star|galaxy|cosmic|alien)\b/i,
    /\bmoons?\b|\bstars?\b|\bimagination\b|\bclouds\b/i,
  ],
  [/\b(neo|matrix|dodge|ninja)\b/i, /\bdodging\b|\bsneak/i],
  [/\b(narrative|story|tale|bard|poet|song)\b/i, /\bpoetry\b|\bspeechmaking\b|\bsinging\b/i],
  [/\b(fluid|water|drink|brew|booze|drunk)\b/i, /prefers to drink|\bbrewing\b|\bswimming\b/i],
  [/(drift|wood|timber)/i, /\bdriftwood\b|\bcarpentry\b|\bwoodcutting\b|\bwood crafts\b/i],
  [
    /\b(failure|fail|loser|oops|disaster)\b/i,
    /no skill|gives up|without (a single|any)|without knowing|\bsloppy\b|no idea what/i,
  ],
  [/\b(lazy|nap|sleepy|couch)\b/i, /barely moves|time off|hard work is for fools|\bdrowsy\b/i],
  [/\b(angry|rage|mad|grump)\b/i, /\btemper\b|\btantrum\b|\bmiserable\b|\bunhappiest\b/i],
]

/** Below this a fit is a coincidence of words, not a reason. */
const MIN_FIT = 0.5

const FEMININE = /\b(girl|lady|queen|princess|mom|mother|ms\.?|mrs\.?|miss|dame|gal)\b/i
const MASCULINE = /\b(boy|guy|king|prince|dad|father|mr\.?|sir|lord|bro|dude)\b/i

const STOP = new Set([
  'than',
  'that',
  'with',
  'their',
  'them',
  'they',
  'into',
  'from',
  'about',
  'fortress',
  'dwarf',
  'dwarves',
  'anything',
  'else',
  'prefers',
  'likes',
  'other',
  'anyone',
  'everyone',
  'nothing',
  'enjoyed',
  'enjoy',
  'felt',
  'times',
  'better',
  'skilled',
  'talented',
  'proficient',
  'competent',
  'adept',
  'expert',
  'professional',
  'accomplished',
  'great',
  'high',
  'master',
  'grand',
  'legendary',
  'most',
  'best',
  'scale',
  'though',
  'never',
  'always',
  'have',
  'been',
  'chronicle',
])

function stem(word: string): string {
  return word.replace(/(ies|es|s|ing|ed|er)$/, '')
}

function words(text: string): string[] {
  return (text.toLowerCase().match(/\p{L}+/gu) ?? []).filter((w) => w.length >= 4 && !STOP.has(w))
}

interface Fit {
  score: number
  fact: DwarfFact | null
}

/** How well a name suits one dwarf, and the fact that suits it best. */
function fit(name: string, unit: FortUnit, facts: DwarfFact[]): Fit {
  const compact = name.toLowerCase().replace(/[^a-z]/g, '')
  const own = new Set(words(name).map(stem))
  let best: Fit = { score: 0, fact: null }
  let total = 0
  for (const fact of facts) {
    let hit = 0
    for (const word of words(fact.text)) {
      const root = stem(word)
      if (root.length < 4) continue
      if (own.has(root) || compact.includes(root)) {
        hit = 1
        break
      }
    }
    if (THEMES.some(([n, f]) => n.test(name) && f.test(fact.text))) hit = 1.2
    if (!hit) continue
    const score = fact.score * hit
    if (score < MIN_FIT) continue
    total += score
    if (score > best.score) best = { score, fact }
  }
  if (!best.fact) return best
  const sexed = FEMININE.test(name) ? 0 : MASCULINE.test(name) ? 1 : null
  const bonus = sexed === null ? 1 : sexed === unit.sex ? 1.2 : 0.6
  return { score: (best.score + total * 0.25) * bonus, fact: best.fact }
}

export type ListState = 'used' | 'fits' | 'wildcard' | 'spare'

export interface ListPlacement {
  /** The dwarf it is on, fits, or is offered to as a wild card; null when spare. */
  unitId: number | null
  state: ListState
}

export interface ListMatch {
  /** One name from the list per dwarf, at most. */
  ideas: Map<number, NicknameIdea>
  /** Keyed by the name in lower case. */
  placements: Map<string, ListPlacement>
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * Where each name on the list goes. Names a citizen already goes by stay
 * with them; the rest go to the dwarf they fit best, best fits first, one
 * name per dwarf. What is left goes to dwarves with no nickname yet.
 */
export function matchNameList(
  names: string[],
  citizens: FortUnit[],
  dossiers: Dossiers,
): ListMatch {
  const ideas = new Map<number, NicknameIdea>()
  const placements = new Map<string, ListPlacement>()
  const wearer = new Map<string, number>()
  for (const unit of citizens) {
    const nick = unit.nickname?.trim()
    if (!nick) continue
    wearer.set(nick.toLowerCase(), unit.id)
    wearer.set(nicknameCore(nick).toLowerCase(), unit.id)
  }
  const open: string[] = []
  for (const name of names) {
    const key = name.toLowerCase()
    if (placements.has(key)) continue
    const unitId = wearer.get(key)
    if (unitId !== undefined) placements.set(key, { unitId, state: 'used' })
    else open.push(name)
  }

  const pairs: { name: string; unit: FortUnit; score: number; fact: DwarfFact }[] = []
  for (const name of open) {
    for (const unit of citizens) {
      const { score, fact } = fit(name, unit, dossiers.facts.get(unit.id) ?? [])
      if (fact && score > 0) pairs.push({ name, unit, score, fact })
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.unit.id - b.unit.id)
  for (const { name, unit, fact } of pairs) {
    const key = name.toLowerCase()
    if (placements.has(key) || ideas.has(unit.id)) continue
    const called = callName(dossiers.names.get(unit.id), unit)
    placements.set(key, { unitId: unit.id, state: 'fits' })
    ideas.set(unit.id, {
      nickname: name,
      why: `From your list: ${called} ${fact.text}.`,
      source: 'list',
    })
  }

  const unnamed = citizens.filter((u) => !u.nickname?.trim() && !ideas.has(u.id))
  const spare = open
    .filter((name) => !placements.has(name.toLowerCase()))
    .sort((a, b) => stableHash(a.toLowerCase()) - stableHash(b.toLowerCase()))
  for (const name of spare) {
    const unit = unnamed.shift()
    if (!unit) {
      placements.set(name.toLowerCase(), { unitId: null, state: 'spare' })
      continue
    }
    placements.set(name.toLowerCase(), { unitId: unit.id, state: 'wildcard' })
    ideas.set(unit.id, {
      nickname: name,
      why: 'From your list. Nothing in their story points at it, so it is a wild card.',
      source: 'list',
    })
  }
  return { ideas, placements }
}
