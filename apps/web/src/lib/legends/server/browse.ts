import { type LegendsPayload, postgres_db, schema } from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import {
  type SQL,
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from 'drizzle-orm'

import { numList } from '../events'
import type { LegendsHit } from '../types'
import { REF_COLUMN, type RecordRow, describeRows } from './records'

/*
 * Server function for the archive: browsing a world's records by kind,
 * searched, filtered and sorted, with the number of events each one is in.
 */

const R = schema.legends_records

export type LegendsSortKey = 'name' | 'type' | 'year' | 'events'

export interface LegendsBrowseQuery {
  worldId: number
  /** Empty means every kind. */
  kinds?: string[]
  /** Restrict to these `type` values (archive tab whitelist). */
  types?: string[]
  /** User-picked types. `__none__` means rows with no type. */
  type?: string[]
  namedOnly?: boolean
  q?: string
  page?: number
  pageSize?: number
  sortKey?: LegendsSortKey
  sortDir?: 'asc' | 'desc'
  /** Figures: still living at export, or dead. */
  alive?: 'alive' | 'dead'
  /** Figures: mortals only, gods only, or forces of nature only. */
  nature?: 'mortal' | 'deity' | 'force'
  /** Figures: members of this entity (civilization, group). Sites: held by this civilization. */
  entityId?: number
  /** Figures: born in this range of years. */
  bornFrom?: number
  bornTo?: number
}

export interface LegendsBrowseResult {
  rows: LegendsHit[]
  total: number
  page: number
  pageSize: number
  /** Types present in this slice of the archive, ignoring the type filter. */
  types: { type: string | null; count: number }[]
}

const KIND_ORDER: Record<string, number> = {
  historical_figure: 0,
  site: 1,
  entity: 2,
  artifact: 3,
  historical_event_collection: 4,
  region: 5,
  written_content: 6,
}

const EVENT_COUNT_KINDS = [
  'historical_figure',
  'entity',
  'site',
  'artifact',
  'historical_event_collection',
  'region',
  'written_content',
  'poetic_form',
  'musical_form',
  'dance_form',
] as const

const FORM_KINDS = ['poetic_form', 'musical_form', 'dance_form'] as const

function eventCountKinds(kinds: string[]): string[] {
  if (!kinds.length) return [...EVENT_COUNT_KINDS]
  return EVENT_COUNT_KINDS.filter((kind) => kinds.includes(kind))
}

function intArray(ids: number[]): SQL {
  return sql`array[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::int[]`
}

/** Events that contain this id in the kind's reference array. One count per event. */
function refCountSql(worldId: number, kind: string, column: (typeof REF_COLUMN)[string]): SQL {
  return sql`
    select ${kind}::text as kind, u.id, count(distinct e.id)::int as c
    from ${R} e, unnest(e.${sql.raw(column)}) as u(id)
    where e.world_id = ${worldId} and e.kind = 'historical_event'
    group by u.id
  `
}

function payloadCountSql(worldId: number, kind: string, field: string): SQL {
  return sql`
    select ${kind}::text as kind, (e.payload->>${field})::int as id, count(*)::int as c
    from ${R} e
    where e.world_id = ${worldId}
      and e.kind = 'historical_event'
      and e.payload ? ${field}
    group by 2
  `
}

function formCountSql(worldId: number, kinds: readonly string[]): SQL {
  const types = kinds.map((kind) => `${kind.replace('_', ' ')} created`)
  return sql`
    select replace(replace(e.type, ' created', ''), ' ', '_') as kind,
           (e.payload->>'form_id')::int as id,
           count(*)::int as c
    from ${R} e
    where e.world_id = ${worldId}
      and e.kind = 'historical_event'
      and e.type in (${sql.join(
        types.map((type) => sql`${type}`),
        sql`, `,
      )})
      and e.payload ? 'form_id'
    group by 1, 2
  `
}

/** Child events of a chapter, matching `eventsWhere` (existing event ids, first 5000). */
function collectionCountSql(worldId: number): SQL {
  return sql`
    select 'historical_event_collection'::text as kind, r.id, count(distinct e.id)::int as c
    from ${R} r
    left join lateral (
      select eid::int as eid
      from (
        select jsonb_array_elements_text(
          case
            when jsonb_typeof(r.payload->'event') = 'array' then r.payload->'event'
            when jsonb_typeof(r.payload->'event') = 'number' then jsonb_build_array(r.payload->'event')
            else '[]'::jsonb
          end
        ) as eid
      ) s
      where eid ~ '^-?[0-9]+$'
      limit 5000
    ) ev on true
    left join ${R} e
      on e.world_id = r.world_id and e.kind = 'historical_event' and e.id = ev.eid
    where r.world_id = ${worldId} and r.kind = 'historical_event_collection'
    group by r.id
  `
}

/** Derived table `(kind, id, c)` for sorting the archive by event count. */
function eventCountSource(worldId: number, kinds: readonly string[]): SQL {
  const wanted = new Set(kinds)
  const parts: SQL[] = []
  for (const [kind, column] of Object.entries(REF_COLUMN)) {
    if (wanted.has(kind)) parts.push(refCountSql(worldId, kind, column))
  }
  if (wanted.has('historical_event_collection')) parts.push(collectionCountSql(worldId))
  if (wanted.has('region')) parts.push(payloadCountSql(worldId, 'region', 'subregion_id'))
  if (wanted.has('written_content'))
    parts.push(payloadCountSql(worldId, 'written_content', 'wc_id'))
  const forms = FORM_KINDS.filter((kind) => wanted.has(kind))
  if (forms.length) parts.push(formCountSql(worldId, forms))
  return sql`(${sql.join(parts, sql` union all `)}) event_counts`
}

function hitKey(kind: string, id: number): string {
  return `${kind}:${id}`
}

async function countedIds(query: SQL): Promise<Map<number, number>> {
  const result = await postgres_db.execute<{ id: number; c: number }>(query)
  const counts = new Map<number, number>()
  for (const row of result) counts.set(Number(row.id), Number(row.c))
  return counts
}

/**
 * Event totals for one page of archive rows. Kinds with no event link stay
 * null; a tracked kind with no events is 0.
 */
async function eventCountsForRows(
  worldId: number,
  rows: RecordRow[],
): Promise<Map<string, number | null>> {
  const counts = new Map<string, number | null>()
  const idsByKind = new Map<string, number[]>()
  for (const row of rows) {
    const tracked = (EVENT_COUNT_KINDS as readonly string[]).includes(row.kind)
    counts.set(hitKey(row.kind, row.id), tracked ? 0 : null)
    if (!tracked) continue
    const ids = idsByKind.get(row.kind) ?? []
    ids.push(row.id)
    idsByKind.set(row.kind, ids)
  }

  const jobs: Promise<void>[] = []
  const fill = (kind: string, found: Map<number, number>) => {
    for (const [id, count] of found) counts.set(hitKey(kind, id), count)
  }

  for (const [kind, column] of Object.entries(REF_COLUMN)) {
    const ids = idsByKind.get(kind)
    if (!ids?.length) continue
    const arr = intArray(ids)
    jobs.push(
      countedIds(
        sql`
          select u.id, count(distinct e.id)::int as c
          from ${R} e, unnest(e.${sql.raw(column)}) as u(id)
          where e.world_id = ${worldId}
            and e.kind = 'historical_event'
            and e.${sql.raw(column)} && ${arr}
            and u.id = any(${arr})
          group by u.id
        `,
      ).then((found) => fill(kind, found)),
    )
  }

  const regions = idsByKind.get('region')
  if (regions?.length) {
    jobs.push(
      countedIds(
        sql`
          select (e.payload->>'subregion_id')::int as id, count(*)::int as c
          from ${R} e
          where e.world_id = ${worldId}
            and e.kind = 'historical_event'
            and (e.payload->>'subregion_id')::int = any(${intArray(regions)})
          group by 1
        `,
      ).then((found) => fill('region', found)),
    )
  }

  const writings = idsByKind.get('written_content')
  if (writings?.length) {
    jobs.push(
      countedIds(
        sql`
          select (e.payload->>'wc_id')::int as id, count(*)::int as c
          from ${R} e
          where e.world_id = ${worldId}
            and e.kind = 'historical_event'
            and (e.payload->>'wc_id')::int = any(${intArray(writings)})
          group by 1
        `,
      ).then((found) => fill('written_content', found)),
    )
  }

  const formIds = FORM_KINDS.flatMap((kind) => idsByKind.get(kind) ?? [])
  const formKinds = FORM_KINDS.filter((kind) => idsByKind.has(kind))
  if (formIds.length) {
    jobs.push(
      postgres_db
        .execute<{ kind: string; id: number; c: number }>(
          sql`
            select replace(replace(e.type, ' created', ''), ' ', '_') as kind,
                   (e.payload->>'form_id')::int as id,
                   count(*)::int as c
            from ${R} e
            where e.world_id = ${worldId}
              and e.kind = 'historical_event'
              and e.type in (${sql.join(
                formKinds.map((kind) => sql`${`${kind.replace('_', ' ')} created`}`),
                sql`, `,
              )})
              and (e.payload->>'form_id')::int = any(${intArray(formIds)})
            group by 1, 2
          `,
        )
        .then((result) => {
          for (const row of result) counts.set(hitKey(row.kind, Number(row.id)), Number(row.c))
        }),
    )
  }

  const collections = rows.filter((row) => row.kind === 'historical_event_collection')
  if (collections.length) jobs.push(countCollectionRows(worldId, collections, counts))

  await Promise.all(jobs)
  return counts
}

async function countCollectionRows(
  worldId: number,
  rows: RecordRow[],
  counts: Map<string, number | null>,
): Promise<void> {
  const lists = new Map<number, number[]>()
  const wanted = new Set<number>()
  for (const row of rows) {
    const ids = [...new Set(numList((row.payload as LegendsPayload).event).slice(0, 5000))]
    lists.set(row.id, ids)
    for (const id of ids) wanted.add(id)
  }
  const have = new Set<number>()
  const all = [...wanted]
  for (let i = 0; i < all.length; i += 5000) {
    const chunk = all.slice(i, i + 5000)
    const found = await postgres_db
      .select({ id: R.id })
      .from(R)
      .where(and(eq(R.world_id, worldId), eq(R.kind, 'historical_event'), inArray(R.id, chunk)))
    for (const row of found) have.add(row.id)
  }
  for (const [id, eventIds] of lists) {
    counts.set(
      hitKey('historical_event_collection', id),
      eventIds.filter((eventId) => have.has(eventId)).length,
    )
  }
}

export const browseLegends = createServerFn({ method: 'GET' })
  .inputValidator((input: LegendsBrowseQuery) => input)
  .handler(async ({ data }): Promise<LegendsBrowseResult> => {
    const pageSize = Math.min(Math.max(data.pageSize ?? 50, 10), 500)
    const page = Math.max(data.page ?? 0, 0)
    const q = (data.q ?? '').trim()
    const kinds = data.kinds ?? []
    const named = !!(data.namedOnly || kinds.length === 0)
    const scope: SQL[] = [eq(R.world_id, data.worldId)]
    if (kinds.length) scope.push(inArray(R.kind, kinds))
    else scope.push(sql`${R.kind} <> 'historical_event'`)
    if (data.types?.length) scope.push(inArray(R.type, data.types))
    const conditions = [...scope]
    if (q) {
      const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`
      conditions.push(or(ilike(R.name, like), ilike(R.type, like)) as SQL)
    } else if (named) conditions.push(isNotNull(R.name))
    const picked = data.type ?? []
    const none = picked.includes('__none__')
    const namedTypes = picked.filter((t) => t !== '__none__')
    if (none && namedTypes.length)
      conditions.push(or(isNull(R.type), inArray(R.type, namedTypes)) as SQL)
    else if (none) conditions.push(isNull(R.type))
    else if (namedTypes.length) conditions.push(inArray(R.type, namedTypes))
    // Research facets. Figures record their life on the payload; sites their holder.
    if (data.alive === 'alive') conditions.push(sql`(${R.payload}->>'death_year')::int = -1`)
    else if (data.alive === 'dead') conditions.push(sql`(${R.payload}->>'death_year')::int >= 0`)
    if (data.nature === 'mortal')
      conditions.push(sql`not (${R.payload} ? 'deity') and not (${R.payload} ? 'force')`)
    else if (data.nature === 'deity') conditions.push(sql`${R.payload} ? 'deity'`)
    else if (data.nature === 'force') conditions.push(sql`${R.payload} ? 'force'`)
    if (data.entityId !== undefined) {
      const siteScope = kinds.length === 1 && kinds[0] === 'site'
      conditions.push(
        siteScope
          ? sql`((${R.payload}->'plus'->>'civ_id')::int = ${data.entityId} or (${R.payload}->'plus'->>'cur_owner_id')::int = ${data.entityId})`
          : sql`${R.entity_ids} @> array[${data.entityId}]::int[]`,
      )
    }
    if (data.bornFrom !== undefined)
      conditions.push(sql`(${R.payload}->>'birth_year')::int >= ${Math.floor(data.bornFrom)}`)
    if (data.bornTo !== undefined)
      conditions.push(sql`(${R.payload}->>'birth_year')::int <= ${Math.floor(data.bornTo)}`)
    const where = and(...conditions)
    const typeWhere = named ? and(...scope, isNotNull(R.name)) : and(...scope)

    const dir = data.sortDir === 'desc' ? 'desc' : 'asc'
    const nulls = sql.raw(dir === 'asc' ? 'asc nulls last' : 'desc nulls last')
    const tracked = eventCountKinds(kinds)
    const sortByEvents = data.sortKey === 'events' && tracked.length > 0
    const primary = sortByEvents
      ? sql`case when ${R.kind} in (${sql.join(
          tracked.map((kind) => sql`${kind}`),
          sql`, `,
        )}) then coalesce(event_counts.c, 0) else null end ${nulls}`
      : data.sortKey === 'type'
        ? sql`${R.type} ${nulls}`
        : data.sortKey === 'year'
          ? sql`${R.year} ${nulls}`
          : sql`${R.name} ${nulls}`
    const kindOrder = sql`case ${R.kind} ${sql.join(
      Object.entries(KIND_ORDER).map(([k, n]) => sql`when ${k} then ${n}`),
      sql` `,
    )} else 9 end`

    const rowSelect = {
      kind: R.kind,
      id: R.id,
      name: R.name,
      type: R.type,
      year: R.year,
      payload: R.payload,
    }
    const rowsQuery = postgres_db.select(rowSelect).from(R).$dynamic()
    if (sortByEvents) {
      rowsQuery.leftJoin(
        eventCountSource(data.worldId, tracked),
        sql`event_counts.kind = ${R.kind} and event_counts.id = ${R.id}`,
      )
    }

    const [countRows, rows, typeRows] = await Promise.all([
      postgres_db.select({ count: sql<number>`count(*)::int` }).from(R).where(where),
      rowsQuery
        .where(where)
        .orderBy(primary, kindOrder, asc(R.name), asc(R.id))
        .limit(pageSize)
        .offset(page * pageSize),
      postgres_db
        .select({ type: R.type, count: sql<number>`count(*)::int` })
        .from(R)
        .where(typeWhere)
        .groupBy(R.type)
        .orderBy(desc(sql`count(*)`)),
    ])
    const [described, eventCounts] = await Promise.all([
      describeRows(data.worldId, rows),
      eventCountsForRows(data.worldId, rows),
    ])
    return {
      rows: described.map((hit) => ({
        ...hit,
        events: eventCounts.get(hitKey(hit.kind, hit.id)) ?? null,
      })),
      total: countRows[0]?.count ?? 0,
      page,
      pageSize,
      types: typeRows.map((row) => ({ type: row.type, count: Number(row.count) })),
    }
  })
