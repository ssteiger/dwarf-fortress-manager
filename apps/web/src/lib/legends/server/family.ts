import { type LegendsPayload, postgres_db, schema } from '@fortress/db-drizzle'
import { and, eq, inArray, sql } from 'drizzle-orm'

import { num, objList, str } from '../events'
import { words } from '../model'
import type { Prose } from '../prose'
import { FAMOUS_KIN, ancestorsOf, lifeLines } from './lives'
import { figureEventCounts, remember } from './memo'

/*
 * A figure's family as the export records it: the `hf_link` entries of the
 * figure, its parents and their parents. Nothing is inferred beyond those
 * links; siblings are the other children their parents' records name.
 *
 * Server only; the browser reaches it through `tellings.ts`.
 */

const R = schema.legends_records

export interface FamilyMember {
  id: number
  name: string | null
  race: string | null
  /** 0 female, 1 male, null unknown. */
  sex: number | null
  birth: number | null
  /** Null while alive. */
  death: number | null
  deity: boolean
}

export interface FamilyTree {
  /** Grandparents, each with the parent they belong to. */
  grandparents: (FamilyMember & { of: number; relation: 'mother' | 'father' })[]
  parents: (FamilyMember & { relation: 'mother' | 'father' })[]
  /** Spouses and lovers, current and past. */
  partners: (FamilyMember & { relation: string })[]
  siblings: FamilyMember[]
  children: FamilyMember[]
  /** Family links the export mentions but does not record. */
  unrecorded: number
}

const PARTNER_LINKS = ['spouse', 'former spouse', 'deceased spouse', 'lover', 'former lover']

function linkIds(links: unknown, ...types: string[]): number[] {
  return objList(links)
    .filter((l) => types.includes(str(l.link_type) ?? ''))
    .map((l) => num(l.hfid))
    .filter((id): id is number => id !== null && id >= 0)
}

async function members(worldId: number, ids: number[]): Promise<Map<number, FamilyMember>> {
  const list = [...new Set(ids)].slice(0, 400)
  if (!list.length) return new Map()
  const rows = await postgres_db
    .select({
      id: R.id,
      name: R.name,
      type: R.type,
      sex: sql<number | null>`(${R.payload}->'plus'->>'sex')::int`,
      race: sql<string | null>`${R.payload}->'plus'->>'race'`,
      birth: sql<number | null>`(${R.payload}->>'birth_year')::int`,
      death: sql<number | null>`(${R.payload}->>'death_year')::int`,
      deity: sql<boolean>`coalesce((${R.payload}->>'deity')::boolean, false)`,
    })
    .from(R)
    .where(and(eq(R.world_id, worldId), eq(R.kind, 'historical_figure'), inArray(R.id, list)))
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        name: r.name,
        race: words(r.race ?? r.type) || null,
        sex: r.sex === null ? null : Number(r.sex),
        birth: r.birth === null ? null : Number(r.birth),
        death: r.death === null || Number(r.death) < 0 ? null : Number(r.death),
        deity: r.deity === true,
      },
    ]),
  )
}

/** The family around one figure, from their record and their parents'. */
export async function familyOf(
  worldId: number,
  id: number,
  payload: LegendsPayload,
): Promise<FamilyTree | null> {
  const mothers = linkIds(payload.hf_link, 'mother')
  const fathers = linkIds(payload.hf_link, 'father')
  const partnerLinks = objList(payload.hf_link).filter((l) =>
    PARTNER_LINKS.includes(str(l.link_type) ?? ''),
  )
  const childIds = linkIds(payload.hf_link, 'child')
  const parentIds = [...mothers, ...fathers]
  if (!parentIds.length && !partnerLinks.length && !childIds.length) return null

  const parentRows = parentIds.length
    ? await postgres_db
        .select({ id: R.id, links: sql<unknown>`${R.payload}->'hf_link'` })
        .from(R)
        .where(
          and(eq(R.world_id, worldId), eq(R.kind, 'historical_figure'), inArray(R.id, parentIds)),
        )
    : []
  const grand: { id: number; of: number; relation: 'mother' | 'father' }[] = []
  const siblingIds = new Set<number>()
  for (const row of parentRows) {
    for (const g of linkIds(row.links, 'mother'))
      grand.push({ id: g, of: row.id, relation: 'mother' })
    for (const g of linkIds(row.links, 'father'))
      grand.push({ id: g, of: row.id, relation: 'father' })
    for (const s of linkIds(row.links, 'child')) if (s !== id) siblingIds.add(s)
  }
  const partnerIds = partnerLinks
    .map((l) => num(l.hfid))
    .filter((v): v is number => v !== null && v >= 0)
  const wanted = [
    ...parentIds,
    ...grand.map((g) => g.id),
    ...partnerIds,
    ...siblingIds,
    ...childIds,
  ]
  const known = await members(worldId, wanted)
  const bornOrder = (a: FamilyMember, b: FamilyMember) =>
    (a.birth ?? Number.MAX_SAFE_INTEGER) - (b.birth ?? Number.MAX_SAFE_INTEGER) || a.id - b.id
  const pick = <T extends { id: number }>(list: T[]) =>
    list.flatMap((entry) => {
      const member = known.get(entry.id)
      return member ? [{ ...entry, ...member }] : []
    })

  const seenPartner = new Set<number>()
  const partners = partnerLinks.flatMap((l) => {
    const pid = num(l.hfid)
    const member = pid !== null ? known.get(pid) : undefined
    if (!member || seenPartner.has(member.id)) return []
    seenPartner.add(member.id)
    const type = str(l.link_type) ?? 'spouse'
    return [{ ...member, relation: type === 'deceased spouse' ? 'late spouse' : type }]
  })
  const siblings = [...siblingIds]
    .flatMap((sid) => {
      const member = known.get(sid)
      return member ? [member] : []
    })
    .sort(bornOrder)
  const children = childIds
    .flatMap((cid) => {
      const member = known.get(cid)
      return member ? [member] : []
    })
    .sort(bornOrder)
  const shown = new Set([
    ...parentIds.filter((p) => known.has(p)),
    ...grand.filter((g) => known.has(g.id)).map((g) => g.id),
    ...partners.map((p) => p.id),
    ...siblings.map((s) => s.id),
    ...children.map((c) => c.id),
  ])

  return {
    grandparents: pick(grand),
    parents: pick([
      ...mothers.map((m) => ({ id: m, relation: 'mother' as const })),
      ...fathers.map((f) => ({ id: f, relation: 'father' as const })),
    ]),
    partners,
    siblings,
    children,
    unrecorded: new Set(wanted.filter((w) => !shown.has(w))).size,
  }
}

// ---------------------------------------------------------------------------
// The line of ancestors

export interface AncestorEntry extends FamilyMember {
  child: number
  relation: 'mother' | 'father'
  generation: number
  /** Events naming them in the record. */
  events: number
}

export interface AncestorLine {
  /** Oldest generation last. */
  generations: AncestorEntry[][]
  /** Ancestors the export mentions but does not record. */
  unrecorded: number
  /** The furthest back the record reaches, earliest born first. */
  oldest: AncestorEntry | null
  /** Ancestors the record has much to say about, most storied first. */
  famous: { ancestor: AncestorEntry; line: Prose }[]
  oldestLine: Prose | null
}

const SHOWN_FAMOUS = 4
/** Ancestors are many; only the well-recorded ones are worth singling out. */
export const FAMOUS_ANCESTOR = FAMOUS_KIN * 3

/** Mothers and fathers up to `maxGen` generations above one figure, with the famous ones told. */
export async function lineOf(worldId: number, id: number, maxGen = 10): Promise<AncestorLine> {
  return remember(worldId, `ancestors:${id}:${maxGen}`, async () => {
    const [found, counts] = await Promise.all([
      ancestorsOf(worldId, [id], maxGen),
      figureEventCounts(worldId),
    ])
    const known = await members(
      worldId,
      found.map((a) => a.id),
    )
    const entries: AncestorEntry[] = found.flatMap((a) => {
      const member = known.get(a.id)
      return member ? [{ ...member, ...a, events: counts.get(a.id) ?? 0 }] : []
    })
    const generations: AncestorEntry[][] = []
    for (const e of entries) {
      const at = e.generation - 1
      if (!generations[at]) generations[at] = []
      generations[at].push(e)
    }
    for (const g of generations)
      g?.sort(
        (a, b) =>
          a.child - b.child || (a.relation === b.relation ? 0 : a.relation === 'mother' ? -1 : 1),
      )
    const deepest = entries.reduce((m, e) => Math.max(m, e.generation), 0)
    const oldest =
      entries
        .filter((e) => e.generation === deepest)
        .sort(
          (a, b) =>
            (a.birth ?? Number.MAX_SAFE_INTEGER) - (b.birth ?? Number.MAX_SAFE_INTEGER) ||
            b.events - a.events,
        )[0] ?? null
    const famousList = entries
      .filter((e) => e.events >= FAMOUS_ANCESTOR && e.generation > 1)
      .sort((a, b) => b.events - a.events)
      .slice(0, SHOWN_FAMOUS)
    const lines = await lifeLines(worldId, [
      ...famousList.map((e) => e.id),
      ...(oldest ? [oldest.id] : []),
    ])
    return {
      generations: generations.filter(Boolean),
      unrecorded: found.length - entries.length,
      oldest: oldest && oldest.generation > 1 ? oldest : null,
      famous: famousList.map((ancestor) => ({ ancestor, line: lines.get(ancestor.id) ?? [] })),
      oldestLine: oldest ? (lines.get(oldest.id) ?? null) : null,
    }
  })
}
