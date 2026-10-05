import type { FortUnit } from '@fortress/db-drizzle/fortress-types'

import {
  type Dossiers,
  type DwarfFact,
  type DwarfName,
  type NicknameIdea,
  callName,
  stableHash,
} from '../people/dossier'
import { nicknameCore } from './alliteration'

/*
 * Nicknames without a language model: candidate names from each citizen's
 * dossier, scored and spread over the fortress so that no two dwarves get
 * the same idea and no one comic form names everybody. Client-safe.
 */

interface Candidate extends NicknameIdea {
  score: number
  factKey: string
  shape: NameShape
}

/**
 * The comic form a name takes. A roster reads funnier when the forms are
 * mixed, so no form gets to name the whole fortress.
 */
export type NameShape = 'sequel' | 'title' | 'fan' | 'doer' | 'mc' | 'word' | 'phrase'

const DOERS =
  /(er|or|ist|Muncher|Puncher|Gobbler|Slurper|Stomper|Swatter|Guzzler|Sipper|Chugger|Boozer|Hound|Lover|Eater)$/

export function nameShape(nickname: string): NameShape {
  const words = nickname.trim().split(/\s+/)
  if (/\b(Jr\.|II|2|Reborn|the Younger|Lil|Baby)(?!\w)/.test(nickname)) return 'sequel'
  if (
    /^(Dr\.|Mr\.|Ms\.|Mrs\.|Mx\.|Sir|Dame|Captain|Saint|Mayor|Professor|Count)\s|, PhD$/.test(
      nickname,
    )
  )
    return 'title'
  if (/\bMc[A-Z]/.test(nickname)) return 'mc'
  if (
    words.length >= 2 &&
    /(Enjoyer|Fan|Fancier|Hugger|Hater|Truther|Superfan|Whisperer)$/.test(nickname)
  )
    return 'fan'
  if (words.length >= 2 && DOERS.test(words.at(-1) ?? '')) return 'doer'
  return words.length === 1 ? 'word' : 'phrase'
}

/** What sort of fact a key is, so no one sort names the whole fortress: "pref:LikeFood", "facet", "kin". */
function factFamily(key: string): string {
  const parts = key.split(':')
  return parts[0] === 'pref' ? `${parts[0]}:${parts[1]}` : parts[0]
}

function candidates(unit: FortUnit, facts: DwarfFact[], name: DwarfName | undefined): Candidate[] {
  const called = callName(name, unit)
  const current = unit.nickname?.trim()
  const seen = new Set(
    [name?.given, current, current ? nicknameCore(current) : null]
      .filter((n): n is string => Boolean(n))
      .map((n) => n.toLowerCase()),
  )
  const out: Candidate[] = []
  for (const fact of facts) {
    if (!fact.names.length) continue
    const offset = stableHash(`${unit.id}:${fact.key}`) % fact.names.length
    const rotated = [...fact.names.slice(offset), ...fact.names.slice(0, offset)]
    rotated.forEach((nickname, i) => {
      const key = nickname.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      out.push({
        nickname,
        why: fact.why ?? `${called} ${fact.text}.`,
        source: 'facts',
        score: fact.score * (i === 0 ? 1 : 0.7),
        factKey: fact.key,
        shape: nameShape(nickname),
      })
    })
  }
  return out.sort((a, b) => b.score - a.score)
}

/**
 * Up to `perDwarf` ideas for each citizen, each on a different fact. No two
 * dwarves get the same first idea, nor one another citizen already goes by.
 * First ideas spread across the name shapes: once a shape has named its share
 * of the fortress, the next dwarf has to be a lot funnier in it to get it.
 */
export function factIdeas(
  citizens: FortUnit[],
  dossiers: Dossiers,
  perDwarf = 5,
): Map<number, NicknameIdea[]> {
  const pools = new Map(
    citizens.map((u) => [
      u.id,
      candidates(u, dossiers.facts.get(u.id) ?? [], dossiers.names.get(u.id)),
    ]),
  )
  const nicknamed = new Map<string, number>()
  for (const u of citizens) {
    const nick = u.nickname?.trim()
    if (!nick) continue
    nicknamed.set(nick.toLowerCase(), u.id)
    nicknamed.set(nicknameCore(nick).toLowerCase(), u.id)
  }
  const firsts = new Map<string, number>()
  const order = [...citizens].sort(
    (a, b) =>
      (pools.get(b.id)?.[0]?.score ?? 0) - (pools.get(a.id)?.[0]?.score ?? 0) || a.id - b.id,
  )
  const share = Math.max(2, Math.ceil(citizens.length / 7))
  const familyShare = Math.max(2, Math.ceil(citizens.length / 10))
  const used = new Map<string, number>()
  const handicap = (c: Candidate) => {
    const shapes = used.get(c.shape) ?? 0
    const families = used.get(factFamily(c.factKey)) ?? 0
    const quota = c.shape === 'word' || c.shape === 'phrase' ? share * 2 : share
    return 0.7 ** Math.floor(shapes / quota) * 0.7 ** Math.floor(families / familyShare)
  }
  const free = (c: Candidate, unitId: number) => {
    const key = c.nickname.toLowerCase()
    const owner = nicknamed.get(key) ?? firsts.get(key)
    return owner === undefined || owner === unitId
  }
  const firstOf = new Map<number, Candidate>()
  for (const unit of order) {
    let pick: Candidate | null = null
    let best = -1
    for (const c of pools.get(unit.id) ?? []) {
      if (!free(c, unit.id)) continue
      const score = c.score * handicap(c)
      if (score > best) {
        best = score
        pick = c
      }
    }
    if (!pick) continue
    firsts.set(pick.nickname.toLowerCase(), unit.id)
    firstOf.set(unit.id, pick)
    for (const key of [pick.shape, factFamily(pick.factKey)])
      used.set(key, (used.get(key) ?? 0) + 1)
  }
  const out = new Map<number, NicknameIdea[]>()
  for (const unit of citizens) {
    const first = firstOf.get(unit.id)
    const ideas: Candidate[] = first ? [first] : []
    const facts = new Set(ideas.map((c) => c.factKey))
    const names = new Set(ideas.map((c) => c.nickname.toLowerCase()))
    const shapes = new Set(ideas.map((c) => c.shape))
    const families = new Set(ideas.map((c) => factFamily(c.factKey)))
    const rest = (pools.get(unit.id) ?? [])
      .filter((c) => free(c, unit.id))
      .map((c) => ({
        c,
        score:
          c.score *
          (shapes.has(c.shape) ? 0.75 : 1) *
          (families.has(factFamily(c.factKey)) ? 0.75 : 1),
      }))
      .sort((a, b) => b.score - a.score)
    for (const { c } of rest) {
      if (ideas.length >= perDwarf) break
      const key = c.nickname.toLowerCase()
      if (facts.has(c.factKey) || names.has(key)) continue
      facts.add(c.factKey)
      names.add(key)
      ideas.push(c)
    }
    out.set(
      unit.id,
      ideas.map(({ nickname, why, source }) => ({ nickname, why, source })),
    )
  }
  return out
}
