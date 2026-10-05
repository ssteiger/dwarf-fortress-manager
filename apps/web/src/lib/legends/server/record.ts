import {
  type JsonObject,
  type LegendsPayload,
  type LegendsRecord,
  postgres_db,
  schema,
} from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { type SQL, and, asc, eq, inArray, or, sql } from 'drizzle-orm'

import { num, numList, objList, plusOf, str } from '../events'
import { words } from '../model'
import type { HeldPosition, LegendsHit, NameIndex } from '../types'
import {
  type Decorate,
  type RecordRow,
  type RefSet,
  addEntityRefs,
  addRef,
  addRefs,
  describeRows,
  eventsWhere,
  lookupNames,
  resolvePositions,
} from './records'

/*
 * Server function: one legends record in full, with the names of
 * everything it points at and the records related to it.
 */

const R = schema.legends_records

export interface LegendsRecordQuery {
  worldId: number
  kind: string
  id: number
}

export interface HitList {
  rows: LegendsHit[]
  total: number
}

export interface RelatedRecords {
  /** Figures tied to a site through a home, lair, or seat of power. */
  residents?: HitList
  /** Figures who are members of a group. */
  members?: HitList
  /** Sites a group holds or founded. */
  sites?: HitList
  /** Wars, battles, and other chapters involving a site or group. */
  collections?: HitList & { byType: Record<string, number> }
  /** Sub-chapters of a chapter, or the groups under a civilization. */
  children?: LegendsHit[]
  /** The war or chapter this one belongs to. */
  parent?: LegendsHit | null
  /** Figures a figure has slain. */
  kills?: HitList
  /** Artifacts held by a figure, kept at a site, or carrying a text. */
  artifacts?: LegendsHit[]
  /** Works a figure wrote. */
  writings?: LegendsHit[]
  /** False identities a figure has used. */
  identities?: LegendsHit[]
  /** Events a written work refers to. */
  referencedEvents?: LegendsRecord[]
  /** The earliest event on record for this thing. */
  firstEvent?: LegendsRecord | null
  eventsTotal?: number
}

export interface LegendsRecordDetail {
  record: LegendsRecord | null
  /** kind -> id -> name, for every id referenced by the record or its relations. */
  names: NameIndex
  positions: HeldPosition[]
  related: RelatedRecords
}

const ROW_COLUMNS = {
  kind: R.kind,
  id: R.id,
  name: R.name,
  type: R.type,
  year: R.year,
  payload: R.payload,
}

async function hitList(
  worldId: number,
  where: SQL,
  limit: number,
  order: SQL[] = [asc(R.name), asc(R.id)],
  decorate?: Decorate,
): Promise<HitList> {
  const [countRows, rows] = await Promise.all([
    postgres_db.select({ count: sql<number>`count(*)::int` }).from(R).where(where),
    postgres_db
      .select(ROW_COLUMNS)
      .from(R)
      .where(where)
      .orderBy(...order)
      .limit(limit),
  ])
  return { rows: await describeRows(worldId, rows, decorate), total: countRows[0]?.count ?? 0 }
}

async function hits(
  worldId: number,
  where: SQL,
  limit: number,
  order: SQL[] = [asc(R.name), asc(R.id)],
): Promise<LegendsHit[]> {
  const rows = await postgres_db
    .select(ROW_COLUMNS)
    .from(R)
    .where(where)
    .orderBy(...order)
    .limit(limit)
  return describeRows(worldId, rows)
}

async function hitsByIds(worldId: number, kind: string, ids: number[]): Promise<LegendsHit[]> {
  const list = ids.filter((id) => Number.isInteger(id) && id >= 0).slice(0, 200)
  if (!list.length) return []
  const rows = await postgres_db
    .select(ROW_COLUMNS)
    .from(R)
    .where(and(eq(R.world_id, worldId), eq(R.kind, kind), inArray(R.id, list)))
  const byId = new Map(rows.map((r) => [r.id, r]))
  const ordered = list.map((id) => byId.get(id)).filter((r): r is RecordRow => !!r)
  return describeRows(worldId, ordered)
}

export const getLegendsRecord = createServerFn({ method: 'GET' })
  .inputValidator((input: LegendsRecordQuery) => input)
  .handler(async ({ data }): Promise<LegendsRecordDetail> => {
    const W = eq(R.world_id, data.worldId)
    const rows = await postgres_db
      .select()
      .from(R)
      .where(and(W, eq(R.kind, data.kind), eq(R.id, data.id)))
      .limit(1)
    const record = rows[0] ?? null
    if (!record) return { record: null, names: {}, positions: [], related: {} }
    const payload = record.payload as LegendsPayload
    const plus = plusOf(payload)
    const related: RelatedRecords = {}
    const refs: RefSet = {}
    addRefs(refs, payload)
    if (data.kind === 'entity') addEntityRefs(refs, payload)

    let positions: HeldPosition[] = []
    const jobs: Promise<void>[] = []

    const evWhere = eventsWhere(data.worldId, data.kind, data.id, payload)
    if (evWhere) {
      jobs.push(
        Promise.all([
          postgres_db.select({ count: sql<number>`count(*)::int` }).from(R).where(evWhere),
          postgres_db
            .select()
            .from(R)
            .where(evWhere)
            .orderBy(asc(R.year), sql`(${R.payload}->>'seconds72')::int asc nulls first`, asc(R.id))
            .limit(1),
        ]).then(([countRows, firstRows]) => {
          related.eventsTotal = countRows[0]?.count ?? 0
          related.firstEvent = firstRows[0] ?? null
          if (firstRows[0]) addRefs(refs, firstRows[0].payload)
        }),
      )
    }

    switch (data.kind) {
      case 'historical_figure': {
        jobs.push(
          resolvePositions(data.worldId, payload).then((p) => {
            positions = p
          }),
          (async () => {
            const deathWhere = and(
              W,
              eq(R.kind, 'historical_event'),
              eq(R.type, 'hf died'),
              sql`${R.hfids} @> ARRAY[${data.id}]::int[]`,
              sql`(${R.payload}->>'slayer_hfid')::int = ${data.id}`,
            ) as SQL
            const [countRows, deaths] = await Promise.all([
              postgres_db.select({ count: sql<number>`count(*)::int` }).from(R).where(deathWhere),
              postgres_db
                .select({ year: R.year, payload: R.payload })
                .from(R)
                .where(deathWhere)
                .orderBy(asc(R.year), asc(R.id))
                .limit(60),
            ])
            const victims = deaths
              .map((d) => ({
                hf: num((d.payload as LegendsPayload).hfid),
                year: d.year,
                cause: str((d.payload as LegendsPayload).cause),
              }))
              .filter(
                (v): v is { hf: number; year: number | null; cause: string | null } =>
                  v.hf !== null && v.hf >= 0,
              )
            const killed = await hitsByIds(
              data.worldId,
              'historical_figure',
              victims.map((v) => v.hf),
            )
            related.kills = {
              rows: killed.map((row) => {
                const victim = victims.find((v) => v.hf === row.id)
                return {
                  ...row,
                  year: victim?.year ?? row.year,
                  detail: [victim?.cause ? words(victim.cause) : null, row.detail]
                    .filter(Boolean)
                    .join(' · '),
                }
              }),
              total: countRows[0]?.count ?? 0,
            }
          })(),
          hits(
            data.worldId,
            and(
              W,
              eq(R.kind, 'written_content'),
              sql`(${R.payload}->>'author_hfid')::int = ${data.id}`,
            ) as SQL,
            60,
          ).then((w) => {
            related.writings = w
          }),
          hits(
            data.worldId,
            and(
              W,
              eq(R.kind, 'artifact'),
              sql`(${R.payload}->>'holder_hfid')::int = ${data.id}`,
            ) as SQL,
            60,
          ).then(async (held) => {
            const listed = await hitsByIds(
              data.worldId,
              'artifact',
              numList(payload.holds_artifact),
            )
            const seen = new Set(held.map((h) => h.id))
            related.artifacts = [...held, ...listed.filter((h) => !seen.has(h.id))]
          }),
          hitsByIds(data.worldId, 'identity', numList(payload.used_identity_id)).then((ids) => {
            related.identities = ids
          }),
        )
        break
      }
      case 'site': {
        jobs.push(
          hitList(
            data.worldId,
            and(
              W,
              eq(R.kind, 'historical_figure'),
              sql`${R.payload}->'site_link' @> ${JSON.stringify([{ site_id: data.id }])}::jsonb`,
            ) as SQL,
            80,
            [sql`(${R.payload}->>'death_year')::int asc`, asc(R.name)],
            (row) => {
              const links = objList((row.payload as LegendsPayload).site_link)
                .filter((l) => num(l.site_id) === data.id)
                .map((l) => words(str(l.link_type)))
                .filter(Boolean)
              return links.length ? [...new Set(links)].join(', ') : null
            },
          ).then((r) => {
            related.residents = r
          }),
          hitList(
            data.worldId,
            and(
              W,
              eq(R.kind, 'historical_event_collection'),
              sql`${R.site_ids} @> ARRAY[${data.id}]::int[]`,
            ) as SQL,
            80,
            [asc(R.year), asc(R.id)],
          ).then(async (c) => {
            const byTypeRows = await postgres_db
              .select({ type: R.type, count: sql<number>`count(*)::int` })
              .from(R)
              .where(
                and(
                  W,
                  eq(R.kind, 'historical_event_collection'),
                  sql`${R.site_ids} @> ARRAY[${data.id}]::int[]`,
                ),
              )
              .groupBy(R.type)
            related.collections = {
              ...c,
              byType: Object.fromEntries(
                byTypeRows.map((r) => [r.type ?? 'unknown', Number(r.count)]),
              ),
            }
          }),
          hits(
            data.worldId,
            and(
              W,
              eq(R.kind, 'artifact'),
              sql`(${R.payload}->>'site_id')::int = ${data.id}`,
            ) as SQL,
            60,
          ).then((a) => {
            related.artifacts = a
          }),
        )
        break
      }
      case 'entity': {
        jobs.push(
          hitList(
            data.worldId,
            and(
              W,
              eq(R.kind, 'site'),
              or(
                sql`(${R.payload}->'plus'->>'civ_id')::int = ${data.id}`,
                sql`(${R.payload}->'plus'->>'cur_owner_id')::int = ${data.id}`,
              ),
            ) as SQL,
            120,
          ).then((s) => {
            related.sites = s
          }),
          hitList(
            data.worldId,
            and(
              W,
              eq(R.kind, 'historical_figure'),
              sql`${R.payload}->'entity_link' @> ${JSON.stringify([{ entity_id: data.id, link_type: 'member' }])}::jsonb`,
            ) as SQL,
            80,
            [sql`(${R.payload}->>'death_year')::int asc`, asc(R.name)],
          ).then((m) => {
            related.members = m
          }),
          hitList(
            data.worldId,
            and(
              W,
              eq(R.kind, 'historical_event_collection'),
              inArray(R.type, [
                'war',
                'battle',
                'site conquered',
                'persecution',
                'purge',
                'insurrection',
              ]),
              sql`${R.entity_ids} @> ARRAY[${data.id}]::int[]`,
            ) as SQL,
            80,
            [asc(R.year), asc(R.id)],
          ).then(async (c) => {
            const byTypeRows = await postgres_db
              .select({ type: R.type, count: sql<number>`count(*)::int` })
              .from(R)
              .where(
                and(
                  W,
                  eq(R.kind, 'historical_event_collection'),
                  sql`${R.entity_ids} @> ARRAY[${data.id}]::int[]`,
                ),
              )
              .groupBy(R.type)
            related.collections = {
              ...c,
              byType: Object.fromEntries(
                byTypeRows.map((r) => [r.type ?? 'unknown', Number(r.count)]),
              ),
            }
          }),
          hitsByIds(
            data.worldId,
            'entity',
            numList(plus.child).filter((id) => id !== data.id),
          ).then((children) => {
            related.children = children
          }),
        )
        break
      }
      case 'artifact': {
        const writing =
          num(plus.writing) ??
          num((payload.item as JsonObject | undefined)?.writing_written_content_id)
        addRef(refs, 'written_content', writing)
        break
      }
      case 'written_content': {
        const references = objList(plus.reference)
        const eventIds: number[] = []
        for (const reference of references) {
          const id = num(reference.id)
          const type = str(reference.type)
          if (id === null || id < 0 || !type) continue
          if (type === 'HISTORICAL_EVENT') eventIds.push(id)
          else if (type === 'ENTITY') addRef(refs, 'entity', id)
          else if (type === 'SITE') addRef(refs, 'site', id)
          else if (type === 'HISTORICAL_FIGURE') addRef(refs, 'historical_figure', id)
          else if (type === 'ARTIFACT') addRef(refs, 'artifact', id)
          else if (type === 'SUBREGION' || type === 'REGION') addRef(refs, 'region', id)
          else if (type === 'WRITTEN_CONTENT') addRef(refs, 'written_content', id)
          else if (type === 'POETIC_FORM') addRef(refs, 'poetic_form', id)
          else if (type === 'MUSICAL_FORM') addRef(refs, 'musical_form', id)
          else if (type === 'DANCE_FORM') addRef(refs, 'dance_form', id)
        }
        if (eventIds.length)
          jobs.push(
            postgres_db
              .select()
              .from(R)
              .where(and(W, eq(R.kind, 'historical_event'), inArray(R.id, eventIds.slice(0, 200))))
              .orderBy(asc(R.year), asc(R.id))
              .then((events) => {
                related.referencedEvents = events
                for (const ev of events) addRefs(refs, ev.payload)
              }),
          )
        jobs.push(
          hits(
            data.worldId,
            and(
              W,
              eq(R.kind, 'artifact'),
              or(
                sql`(${R.payload}->'plus'->>'writing')::int = ${data.id}`,
                sql`(${R.payload}->'item'->>'writing_written_content_id')::int = ${data.id}`,
              ),
            ) as SQL,
            40,
          ).then((a) => {
            related.artifacts = a
          }),
        )
        break
      }
      case 'historical_event_collection': {
        const childIds = numList(payload.eventcol)
        const parentId = num(payload.war_eventcol) ?? num(payload.parent_eventcol)
        jobs.push(
          hitsByIds(data.worldId, 'historical_event_collection', childIds).then((children) => {
            related.children = children
          }),
        )
        if (parentId !== null && parentId >= 0)
          jobs.push(
            hitsByIds(data.worldId, 'historical_event_collection', [parentId]).then((parents) => {
              related.parent = parents[0] ?? null
            }),
          )
        break
      }
    }

    await Promise.all(jobs)
    const names = await lookupNames(data.worldId, refs)
    return { record, names, positions, related }
  })
