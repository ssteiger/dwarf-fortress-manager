import { type LegendsPayload, postgres_db, schema } from '@fortress/db-drizzle'
import { and, eq, inArray } from 'drizzle-orm'

import { num, objList, str } from '../events'
import type { Prose } from '../prose'
import {
  type AncestorEntry,
  type AncestorLine,
  FAMOUS_ANCESTOR,
  type FamilyMember,
  type FamilyTree,
  familyOf,
  lineOf,
} from './family'
import { FAMOUS_KIN, civPast, lifeLines } from './lives'
import { figureEventCounts, remember } from './memo'

/*
 * One of the fortress's dwarves as the world's history knows them: their own
 * line, their recorded kin, the line of their ancestors and the past of their
 * civilization. Only what the export records.
 *
 * Server only; the browser reaches it through `tellings.ts`.
 */

const R = schema.legends_records

export interface DwarfKin extends FamilyMember {
  /** "mother", "grandfather", "spouse", "sister", "son". */
  relation: string
  /** Events naming them in the record. */
  events: number
  /** Their life line, for the ones the record has much to say about. */
  line: Prose | null
}

export interface DwarfInLegends {
  name: string | null
  line: Prose
  /** Recorded kin, most storied first. */
  kin: DwarfKin[]
  family: FamilyTree | null
  ancestors: AncestorLine
  /** The most storied parent or older ancestor, when the record has much to say of one. */
  famousAncestor: { ancestor: AncestorEntry; line: Prose } | null
  civ: { id: number; name: string | null; past: Prose } | null
}

function sexed(sex: number | null, female: string, male: string, other: string): string {
  return sex === 0 ? female : sex === 1 ? male : other
}

function kinOf(family: FamilyTree): Omit<DwarfKin, 'events' | 'line'>[] {
  return [
    ...family.parents.map((m) => ({ ...m, relation: m.relation })),
    ...family.grandparents.map((m) => ({ ...m, relation: `grand${m.relation}` })),
    ...family.partners.map((m) => ({ ...m, relation: m.relation })),
    ...family.siblings.map((m) => ({
      ...m,
      relation: sexed(m.sex, 'sister', 'brother', 'sibling'),
    })),
    ...family.children.map((m) => ({ ...m, relation: sexed(m.sex, 'daughter', 'son', 'child') })),
  ]
}

/** The civilization a figure is a member of, or was last. */
async function civOf(
  worldId: number,
  p: LegendsPayload,
): Promise<{ id: number; name: string | null } | null> {
  const links = objList(p.entity_link)
  const ids = (type: string) =>
    links
      .filter((l) => str(l.link_type) === type)
      .map((l) => num(l.entity_id))
      .filter((id): id is number => id !== null && id >= 0)
  const candidates = [...ids('member'), ...ids('former member')]
  if (!candidates.length) return null
  const rows = await postgres_db
    .select({ id: R.id, name: R.name })
    .from(R)
    .where(
      and(
        eq(R.world_id, worldId),
        eq(R.kind, 'entity'),
        eq(R.type, 'civilization'),
        inArray(R.id, candidates),
      ),
    )
  const byId = new Map(rows.map((r) => [r.id, r]))
  const id = candidates.find((c) => byId.has(c))
  return id === undefined ? null : { id, name: byId.get(id)?.name ?? null }
}

export async function dwarfInLegends(
  worldId: number,
  figureId: number,
): Promise<DwarfInLegends | null> {
  return remember(worldId, `dwarf:${figureId}`, async () => {
    const rows = await postgres_db
      .select({ name: R.name, payload: R.payload })
      .from(R)
      .where(and(eq(R.world_id, worldId), eq(R.kind, 'historical_figure'), eq(R.id, figureId)))
      .limit(1)
    const record = rows[0]
    if (!record) return null
    const p = record.payload as LegendsPayload
    const [family, ancestors, counts, civ] = await Promise.all([
      familyOf(worldId, figureId, p),
      lineOf(worldId, figureId),
      figureEventCounts(worldId),
      civOf(worldId, p),
    ])
    const relatives = (family ? kinOf(family) : [])
      .map((k) => ({ ...k, events: counts.get(k.id) ?? 0 }))
      .sort((a, b) => b.events - a.events)
    const famousParents = relatives.filter(
      (k) => (k.relation === 'mother' || k.relation === 'father') && k.events >= FAMOUS_ANCESTOR,
    )
    const [lines, past] = await Promise.all([
      lifeLines(worldId, [
        figureId,
        ...relatives.filter((k) => k.events >= FAMOUS_KIN).map((k) => k.id),
      ]),
      civ ? civPast(worldId, civ.id) : Promise.resolve(null),
    ])
    const kin: DwarfKin[] = relatives.map((k) => ({ ...k, line: lines.get(k.id) ?? null }))

    const parentEntry = (k: DwarfKin): AncestorEntry => ({
      ...k,
      child: figureId,
      relation: k.relation === 'mother' ? 'mother' : 'father',
      generation: 1,
    })
    const candidates = [
      ...famousParents.map((k) => ({
        ancestor: parentEntry({ ...k, line: null }),
        line: lines.get(k.id) ?? [],
      })),
      ...ancestors.famous,
    ].sort((a, b) => b.ancestor.events - a.ancestor.events)

    return {
      name: record.name,
      line: lines.get(figureId) ?? [],
      kin,
      family,
      ancestors,
      famousAncestor: candidates[0] ?? null,
      civ: civ && past ? { ...civ, past } : null,
    }
  })
}
