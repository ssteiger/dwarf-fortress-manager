import {
  type JsonObject,
  type LegendsPayload,
  type LegendsRecord,
  type LegendsWorld,
  postgres_db,
  schema,
} from '@fortress/db-drizzle'
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
  notInArray,
  or,
  sql,
} from 'drizzle-orm'

import { EVENT_CATEGORIES, num, numList, objList, plusOf, str } from './events'
import { raceToken, words } from './model'
import {
  type Decorate,
  REF_COLUMN,
  type RecordRow,
  type RefSet,
  addEntityRefs,
  addRef,
  addRefs,
  describeRows,
  endYearOf,
  eventsWhere,
  lookupNames,
  nameOf,
} from './records'

const R = schema.legends_records

export type NameIndex = Record<string, Record<number, string>>

// ---------------------------------------------------------------------------
// Worlds

export interface LegendsOverview {
  worlds: LegendsWorld[]
  /** World name of the running fortress, so the UI can say whether they match. */
  liveWorldName: string | null
}

export const getLegendsOverview = createServerFn({ method: 'GET' }).handler(
  async (): Promise<LegendsOverview> => {
    const [worlds, state] = await Promise.all([
      postgres_db
        .select()
        .from(schema.legends_worlds)
        .orderBy(desc(schema.legends_worlds.imported_at)),
      postgres_db
        .select({ world_name: schema.fort_state.world_name })
        .from(schema.fort_state)
        .where(eq(schema.fort_state.id, 1))
        .limit(1),
    ])
    return { worlds, liveWorldName: state[0]?.world_name ?? null }
  },
)

// ---------------------------------------------------------------------------
// Browsing

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

export interface LegendsHit {
  kind: string
  id: number
  name: string | null
  type: string | null
  year: number | null
  endYear?: number | null
  /** One line of context: race and lifespan, owner, author, outcome. */
  detail?: string
  /** Raw creature token (DWARF, BEAR_BLACK) for figures, groups, and creatures, so the game's sprite can be drawn. */
  race?: string | null
  /** Caste token (MALE, FEMALE, DEFAULT) for figures. */
  caste?: string | null
  /** Artifact item type and subtype names from legends_plus ("weapon", "war hammer"). */
  item?: { type: string | null; subtype: string | null } | null
  /**
   * Historical events that mention this record. Null when this kind has no
   * event link. The same link the record page uses for its history.
   */
  events?: number | null
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

// ---------------------------------------------------------------------------
// World summary

export interface LegendsRef {
  id: number
  name: string | null
}

export interface CivSummary extends LegendsRef {
  race: string | null
  sites: number
  wars: number
}

export interface WarSummary extends LegendsRef {
  startYear: number | null
  endYear: number | null
  aggressor: LegendsRef | null
  defender: LegendsRef | null
  battles: number
  conquests: number
}

export interface TimelineBin {
  start: number
  total: number
  deaths: number
  battles: number
  culture: number
}

export interface FigureSummary extends LegendsRef {
  race: string | null
  /** Raw creature token for the sprite. */
  raceToken: string | null
  birthYear: number | null
  deathYear: number | null
  events: number
}

export interface DeitySummary extends LegendsRef {
  race: string | null
  raceToken: string | null
  spheres: string[]
}

export interface LegendsWorldSummary {
  years: { min: number; max: number } | null
  eras: { name: string; startYear: number }[]
  civilizations: CivSummary[]
  wars: WarSummary[]
  timeline: TimelineBin[]
  binYears: number
  races: { race: string; token: string | null; total: number; alive: number }[]
  deities: DeitySummary[]
  deitiesTotal: number
  notable: FigureSummary[]
  siteTypes: Record<string, number>
  regionTypes: Record<string, number>
}

const WAR_TYPES = EVENT_CATEGORIES.find((c) => c.key === 'war')?.types ?? []
const CULTURE_TYPES = EVENT_CATEGORIES.find((c) => c.key === 'culture')?.types ?? []

function niceBin(target: number): number {
  for (const step of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000])
    if (step >= target) return step
  return 1000
}

export const getLegendsWorldSummary = createServerFn({ method: 'GET' })
  .inputValidator((input: { worldId: number }) => input)
  .handler(async ({ data }): Promise<LegendsWorldSummary> => {
    const W = eq(R.world_id, data.worldId)
    const events = and(W, eq(R.kind, 'historical_event'), sql`${R.year} >= 0`)

    const yearRows = await postgres_db
      .select({ min: sql<number | null>`min(${R.year})`, max: sql<number | null>`max(${R.year})` })
      .from(R)
      .where(events)
    const years =
      yearRows[0]?.min !== null && yearRows[0]?.max !== null && yearRows[0]
        ? { min: Number(yearRows[0].min), max: Number(yearRows[0].max) }
        : null
    const binYears = years ? niceBin((years.max - years.min + 1) / 40) : 50

    const [
      eraRows,
      civRows,
      siteCounts,
      warRows,
      warChildren,
      timelineRows,
      raceRows,
      deityRows,
      deityCount,
      notableRows,
      siteTypeRows,
      regionTypeRows,
    ] = await Promise.all([
      postgres_db
        .select({ payload: R.payload })
        .from(R)
        .where(and(W, eq(R.kind, 'historical_era'))),
      postgres_db
        .select({ id: R.id, name: R.name, race: sql<string | null>`${R.payload}->'plus'->>'race'` })
        .from(R)
        .where(and(W, eq(R.kind, 'entity'), sql`${R.payload}->'plus'->>'type' = 'civilization'`))
        .orderBy(asc(R.name)),
      postgres_db
        .select({
          civ: sql<number>`(${R.payload}->'plus'->>'civ_id')::int`,
          count: sql<number>`count(*)::int`,
        })
        .from(R)
        .where(and(W, eq(R.kind, 'site'), sql`${R.payload}->'plus' ? 'civ_id'`))
        .groupBy(sql`1`),
      postgres_db
        .select({ id: R.id, name: R.name, payload: R.payload })
        .from(R)
        .where(and(W, eq(R.kind, 'historical_event_collection'), eq(R.type, 'war')))
        .orderBy(asc(R.year), asc(R.id)),
      postgres_db
        .select({
          war: sql<number>`(${R.payload}->>'war_eventcol')::int`,
          battles: sql<number>`count(*) filter (where ${R.type} = 'battle')::int`,
          conquests: sql<number>`count(*) filter (where ${R.type} = 'site conquered')::int`,
        })
        .from(R)
        .where(
          and(W, eq(R.kind, 'historical_event_collection'), sql`${R.payload} ? 'war_eventcol'`),
        )
        .groupBy(sql`1`),
      postgres_db
        .select({
          start: sql<number>`(${R.year} / ${sql.raw(String(binYears))}) * ${sql.raw(String(binYears))}`,
          total: sql<number>`count(*)::int`,
          deaths: sql<number>`count(*) filter (where ${R.type} = 'hf died')::int`,
          battles: sql<number>`count(*) filter (where ${inArray(R.type, WAR_TYPES)})::int`,
          culture: sql<number>`count(*) filter (where ${inArray(R.type, CULTURE_TYPES)})::int`,
        })
        .from(R)
        .where(events)
        .groupBy(sql`1`)
        .orderBy(sql`1`),
      postgres_db
        .select({
          race: sql<string>`coalesce(${R.payload}->'plus'->>'race', lower(replace(coalesce(${R.type}, 'unknown'), '_', ' ')))`,
          // The raw creature token behind the name (the type column holds it for figures).
          token: sql<string | null>`min(${R.type})`,
          total: sql<number>`count(*)::int`,
          alive: sql<number>`count(*) filter (where (${R.payload}->>'death_year')::int = -1)::int`,
        })
        .from(R)
        .where(
          and(
            W,
            eq(R.kind, 'historical_figure'),
            sql`not (${R.payload} ? 'deity')`,
            sql`not (${R.payload} ? 'force')`,
          ),
        )
        .groupBy(sql`1`)
        .orderBy(sql`2 desc`)
        .limit(18),
      postgres_db
        .select({ id: R.id, name: R.name, payload: R.payload })
        .from(R)
        .where(and(W, eq(R.kind, 'historical_figure'), sql`${R.payload} ? 'deity'`))
        .orderBy(asc(R.name))
        .limit(12),
      postgres_db
        .select({ count: sql<number>`count(*)::int` })
        .from(R)
        .where(and(W, eq(R.kind, 'historical_figure'), sql`${R.payload} ? 'deity'`)),
      postgres_db.execute<{ hf: number; c: number }>(
        sql`select hf, count(*)::int as c from (select unnest(${R.hfids}) as hf from ${R} where ${W} and ${R.kind} = 'historical_event') s group by hf order by c desc limit 12`,
      ),
      postgres_db
        .select({ type: R.type, count: sql<number>`count(*)::int` })
        .from(R)
        .where(and(W, eq(R.kind, 'site')))
        .groupBy(R.type),
      postgres_db
        .select({ type: R.type, count: sql<number>`count(*)::int` })
        .from(R)
        .where(and(W, eq(R.kind, 'region')))
        .groupBy(R.type),
    ])

    const sitesByCiv = new Map<number, number>()
    for (const row of siteCounts) sitesByCiv.set(Number(row.civ), Number(row.count))

    const warsByCiv = new Map<number, number>()
    const childStats = new Map<number, { battles: number; conquests: number }>()
    for (const row of warChildren)
      childStats.set(Number(row.war), {
        battles: Number(row.battles),
        conquests: Number(row.conquests),
      })

    const entityRefs: RefSet = {}
    for (const war of warRows) {
      const p = war.payload as LegendsPayload
      addRef(entityRefs, 'entity', p.aggressor_ent_id)
      addRef(entityRefs, 'entity', p.defender_ent_id)
      for (const key of ['aggressor_ent_id', 'defender_ent_id']) {
        const id = num(p[key])
        if (id !== null && id >= 0) warsByCiv.set(id, (warsByCiv.get(id) ?? 0) + 1)
      }
    }
    const notableList = [...notableRows].map((row) => ({ hf: Number(row.hf), c: Number(row.c) }))
    for (const row of notableList) addRef(entityRefs, 'historical_figure', row.hf)
    const names = await lookupNames(data.worldId, entityRefs)

    const notableRecords = notableList.length
      ? await postgres_db
          .select({ id: R.id, name: R.name, type: R.type, payload: R.payload })
          .from(R)
          .where(
            and(
              W,
              eq(R.kind, 'historical_figure'),
              inArray(
                R.id,
                notableList.map((r) => r.hf),
              ),
            ),
          )
      : []
    const notableById = new Map(notableRecords.map((r) => [r.id, r]))

    const ref = (id: unknown): LegendsRef | null =>
      typeof id === 'number' && id >= 0 ? { id, name: names.entity?.[id] ?? null } : null

    return {
      years,
      eras: eraRows
        .map((row) => {
          const p = row.payload as LegendsPayload
          return { name: str(p.name) ?? 'Unnamed era', startYear: num(p.start_year) ?? -1 }
        })
        .sort((a, b) => a.startYear - b.startYear),
      civilizations: civRows
        .map((row) => ({
          id: row.id,
          name: row.name,
          race: row.race,
          sites: sitesByCiv.get(row.id) ?? 0,
          wars: warsByCiv.get(row.id) ?? 0,
        }))
        .sort((a, b) => b.sites - a.sites || (a.name ?? '').localeCompare(b.name ?? '')),
      wars: warRows.map((war) => {
        const p = war.payload as LegendsPayload
        const stats = childStats.get(war.id)
        return {
          id: war.id,
          name: war.name,
          startYear: num(p.start_year),
          endYear: num(p.end_year),
          aggressor: ref(p.aggressor_ent_id),
          defender: ref(p.defender_ent_id),
          battles: stats?.battles ?? 0,
          conquests: stats?.conquests ?? 0,
        }
      }),
      timeline: timelineRows.map((row) => ({
        start: Number(row.start),
        total: Number(row.total),
        deaths: Number(row.deaths),
        battles: Number(row.battles),
        culture: Number(row.culture),
      })),
      binYears,
      races: raceRows.map((row) => ({
        race: row.race,
        token: row.token ?? null,
        total: Number(row.total),
        alive: Number(row.alive),
      })),
      deities: deityRows.map((row) => {
        const p = row.payload as LegendsPayload
        return {
          id: row.id,
          name: row.name,
          race: str(plusOf(p).race),
          raceToken: str(p.race) ?? raceToken(str(plusOf(p).race)),
          spheres: Array.isArray(p.sphere) ? p.sphere.map(String) : [],
        }
      }),
      deitiesTotal: deityCount[0]?.count ?? 0,
      notable: notableList.map((row) => {
        const record = notableById.get(row.hf)
        const p = (record?.payload ?? {}) as LegendsPayload
        return {
          id: row.hf,
          name: record?.name ?? names.historical_figure?.[row.hf] ?? null,
          race: str(plusOf(p).race) ?? (record?.type ? words(record.type) : null),
          raceToken: record?.type ?? str(p.race),
          birthYear: num(p.birth_year),
          deathYear: num(p.death_year),
          events: row.c,
        }
      }),
      siteTypes: Object.fromEntries(
        siteTypeRows.map((r) => [r.type ?? 'unknown', Number(r.count)]),
      ),
      regionTypes: Object.fromEntries(
        regionTypeRows.map((r) => [r.type ?? 'unknown', Number(r.count)]),
      ),
    }
  })

// ---------------------------------------------------------------------------
// Map

export interface MapRegion {
  id: number
  name: string | null
  type: string | null
  evilness: string | null
  tiles: number
}

export interface MapSite {
  id: number
  name: string | null
  type: string | null
  x: number
  y: number
  civ: number | null
  owner: number | null
}

export interface MapPeak {
  id: number
  name: string | null
  x: number
  y: number
  volcano: boolean
}

export interface LegendsMapData {
  width: number
  height: number
  regions: MapRegion[]
  /** Index into `regions` per tile (row-major), -1 where no region claims the tile. */
  tiles: number[]
  /** Tiles with a stream or river; size 1 is a stream, 3 a major river. Brooks are left out. */
  rivers: { tile: number; size: 1 | 2 | 3 }[]
  sites: MapSite[]
  peaks: MapPeak[]
  civs: Record<number, { name: string | null; race: string | null }>
}

function parseCoord(s: string | null | undefined): [number, number] | null {
  if (!s) return null
  const [x, y] = s.split(',').map((v) => Number.parseInt(v, 10))
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return null
  return [x, y]
}

function parseCoordList(s: string | null | undefined): [number, number][] {
  if (!s) return []
  const out: [number, number][] = []
  for (const part of s.split('|')) {
    const c = parseCoord(part)
    if (c) out.push(c)
  }
  return out
}

export const getLegendsMap = createServerFn({ method: 'GET' })
  .inputValidator((input: { worldId: number }) => input)
  .handler(async ({ data }): Promise<LegendsMapData> => {
    const W = eq(R.world_id, data.worldId)
    const [regionRows, siteRows, peakRows, riverRows] = await Promise.all([
      postgres_db
        .select({
          id: R.id,
          name: R.name,
          type: R.type,
          coords: sql<string | null>`${R.payload}->'plus'->>'coords'`,
          evilness: sql<string | null>`${R.payload}->'plus'->>'evilness'`,
        })
        .from(R)
        .where(and(W, eq(R.kind, 'region')))
        .orderBy(asc(R.id)),
      postgres_db
        .select({
          id: R.id,
          name: R.name,
          type: R.type,
          coords: sql<string | null>`${R.payload}->>'coords'`,
          civ: sql<number | null>`(${R.payload}->'plus'->>'civ_id')::int`,
          owner: sql<number | null>`(${R.payload}->'plus'->>'cur_owner_id')::int`,
        })
        .from(R)
        .where(and(W, eq(R.kind, 'site'))),
      postgres_db
        .select({
          id: R.id,
          name: R.name,
          coords: sql<string | null>`${R.payload}->'plus'->>'coords'`,
          volcano: sql<boolean | null>`(${R.payload}->'plus'->>'is_volcano')::boolean`,
        })
        .from(R)
        .where(and(W, eq(R.kind, 'mountain_peak'))),
      postgres_db
        .select({ path: sql<string | null>`${R.payload}->'plus'->>'path'` })
        .from(R)
        .where(and(W, eq(R.kind, 'river'))),
    ])

    const regionCoords = regionRows.map((row) => parseCoordList(row.coords))
    let maxX = 0
    let maxY = 0
    for (const list of regionCoords)
      for (const [x, y] of list) {
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    const sites: MapSite[] = []
    for (const row of siteRows) {
      const c = parseCoord(row.coords)
      if (!c) continue
      if (c[0] > maxX) maxX = c[0]
      if (c[1] > maxY) maxY = c[1]
      sites.push({
        id: row.id,
        name: row.name,
        type: row.type,
        x: c[0],
        y: c[1],
        civ: row.civ !== null && row.civ >= 0 ? Number(row.civ) : null,
        owner: row.owner !== null && row.owner >= 0 ? Number(row.owner) : null,
      })
    }
    const width = maxX + 1
    const height = maxY + 1
    const tiles = new Array<number>(width * height).fill(-1)
    regionCoords.forEach((list, index) => {
      for (const [x, y] of list) tiles[y * width + x] = index
    })

    // Path segments are "x,y,flow,exit,elevation". Nearly every tile carries a
    // brook, so only streams and rivers (flow >= 5000) make it onto the map.
    const riverTiles = new Map<number, 1 | 2 | 3>()
    for (const row of riverRows) {
      if (!row.path) continue
      for (const part of row.path.split('|')) {
        const [x, y, flow] = part.split(',').map((v) => Number.parseInt(v, 10))
        if (
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          x < 0 ||
          y < 0 ||
          x >= width ||
          y >= height
        )
          continue
        if (!Number.isFinite(flow) || flow < 5000) continue
        const size: 1 | 2 | 3 = flow >= 40_000 ? 3 : flow >= 20_000 ? 2 : 1
        const tile = y * width + x
        if ((riverTiles.get(tile) ?? 0) < size) riverTiles.set(tile, size)
      }
    }

    const peaks: MapPeak[] = []
    for (const row of peakRows) {
      const c = parseCoord(row.coords)
      if (!c) continue
      peaks.push({ id: row.id, name: row.name, x: c[0], y: c[1], volcano: row.volcano === true })
    }

    const civIds = new Set<number>()
    for (const site of sites) {
      if (site.civ !== null) civIds.add(site.civ)
      if (site.owner !== null) civIds.add(site.owner)
    }
    const civRows = civIds.size
      ? await postgres_db
          .select({
            id: R.id,
            name: R.name,
            race: sql<string | null>`${R.payload}->'plus'->>'race'`,
          })
          .from(R)
          .where(and(W, eq(R.kind, 'entity'), inArray(R.id, [...civIds])))
      : []

    return {
      width,
      height,
      regions: regionRows.map((row, index) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        evilness: row.evilness,
        tiles: regionCoords[index].length,
      })),
      tiles,
      rivers: [...riverTiles.entries()].map(([tile, size]) => ({ tile, size })),
      sites,
      peaks,
      civs: Object.fromEntries(civRows.map((row) => [row.id, { name: row.name, race: row.race }])),
    }
  })

// ---------------------------------------------------------------------------
// One record

export interface LegendsRecordQuery {
  worldId: number
  kind: string
  id: number
}

export interface HeldPosition {
  entity: LegendsRef
  title: string
  startYear: number | null
  endYear: number | null
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

async function resolvePositions(worldId: number, payload: LegendsPayload): Promise<HeldPosition[]> {
  const current = objList(payload.entity_position_link).map((l) => ({ link: l, current: true }))
  const former = objList(payload.entity_former_position_link).map((l) => ({
    link: l,
    current: false,
  }))
  const links = [...current, ...former]
  if (!links.length) return []
  const entityIds = [
    ...new Set(
      links.map((l) => num(l.link.entity_id)).filter((v): v is number => v !== null && v >= 0),
    ),
  ]
  const entities = await postgres_db
    .select({ id: R.id, name: R.name, payload: R.payload })
    .from(R)
    .where(and(eq(R.world_id, worldId), eq(R.kind, 'entity'), inArray(R.id, entityIds)))
  const byId = new Map(entities.map((e) => [e.id, e]))
  const sex = num(plusOf(payload).sex)
  const out: HeldPosition[] = []
  for (const { link, current: isCurrent } of links) {
    const entityId = num(link.entity_id)
    if (entityId === null) continue
    const entity = byId.get(entityId)
    const plus = entity ? plusOf(entity.payload as LegendsPayload) : {}
    const assignment = objList(plus.entity_position_assignment).find(
      (a) => num(a.id) === num(link.position_profile_id),
    )
    const position = objList(plus.entity_position).find(
      (p) => num(p.id) === num(assignment?.position_id),
    )
    const title =
      (sex === 0 ? str(position?.name_female) : sex === 1 ? str(position?.name_male) : null) ??
      str(position?.name) ??
      'an office'
    out.push({
      entity: { id: entityId, name: entity?.name ?? null },
      title,
      startYear: num(link.start_year),
      endYear: isCurrent ? null : num(link.end_year),
    })
  }
  return out.sort((a, b) => (a.startYear ?? 0) - (b.startYear ?? 0))
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

// ---------------------------------------------------------------------------
// Events for one record

export interface LegendsEventsQuery {
  worldId: number
  kind: string
  id: number
  page?: number
  pageSize?: number
  /** Only these event types; empty means all. */
  types?: string[]
  /** Never these event types. */
  excludeTypes?: string[]
  order?: 'asc' | 'desc'
}

export interface LegendsEventsResult {
  events: LegendsRecord[]
  total: number
  page: number
  pageSize: number
  names: NameIndex
  /** Event type -> count, across every event for this record. */
  byType: Record<string, number>
}

export const getLegendsEvents = createServerFn({ method: 'GET' })
  .inputValidator((input: LegendsEventsQuery) => input)
  .handler(async ({ data }): Promise<LegendsEventsResult> => {
    const pageSize = Math.min(Math.max(data.pageSize ?? 50, 10), 500)
    const page = Math.max(data.page ?? 0, 0)
    const empty = { events: [], total: 0, page, pageSize, names: {}, byType: {} }

    let payload: LegendsPayload | null = null
    if (data.kind === 'historical_event_collection') {
      const rows = await postgres_db
        .select({ payload: R.payload })
        .from(R)
        .where(and(eq(R.world_id, data.worldId), eq(R.kind, data.kind), eq(R.id, data.id)))
        .limit(1)
      payload = (rows[0]?.payload as LegendsPayload | undefined) ?? null
      if (!payload) return empty
    }
    const base = eventsWhere(data.worldId, data.kind, data.id, payload)
    if (!base) return empty
    const where = and(
      base,
      data.types?.length ? inArray(R.type, data.types) : undefined,
      data.excludeTypes?.length
        ? or(isNull(R.type), notInArray(R.type, data.excludeTypes))
        : undefined,
    ) as SQL
    const order = data.order === 'desc' ? 'desc' : 'asc'
    const seconds = sql`(${R.payload}->>'seconds72')::int`

    const [countRows, byTypeRows, events] = await Promise.all([
      postgres_db.select({ count: sql<number>`count(*)::int` }).from(R).where(where),
      postgres_db
        .select({ type: R.type, count: sql<number>`count(*)::int` })
        .from(R)
        .where(base)
        .groupBy(R.type),
      postgres_db
        .select()
        .from(R)
        .where(where)
        .orderBy(
          ...(order === 'asc'
            ? [asc(R.year), sql`${seconds} asc nulls first`, asc(R.id)]
            : [desc(R.year), sql`${seconds} desc nulls last`, desc(R.id)]),
        )
        .limit(pageSize)
        .offset(page * pageSize),
    ])
    const refs: RefSet = {}
    for (const ev of events) addRefs(refs, ev.payload)
    const names = await lookupNames(data.worldId, refs)
    return {
      events,
      total: countRows[0]?.count ?? 0,
      page,
      pageSize,
      names,
      byType: Object.fromEntries(byTypeRows.map((r) => [r.type ?? 'unknown', Number(r.count)])),
    }
  })

// ---------------------------------------------------------------------------
// Cross-links from the live fortress

/** Names for a few ids of any kind; ids the export does not contain are left out. */
export const getLegendsNames = createServerFn({ method: 'GET' })
  .inputValidator((input: { worldId: number; refs: Record<string, number[]> }) => input)
  .handler(async ({ data }): Promise<NameIndex> => {
    const refs: RefSet = {}
    for (const [kind, ids] of Object.entries(data.refs).slice(0, 12))
      for (const id of ids.slice(0, 200)) addRef(refs, kind, id)
    return lookupNames(data.worldId, refs)
  })

export interface LegendsFigureLookup {
  worldId: number
  ids: number[]
}

/** Which of these historical figure ids exist in the legends world. */
export const getKnownFigures = createServerFn({ method: 'GET' })
  .inputValidator((input: LegendsFigureLookup) => input)
  .handler(async ({ data }): Promise<number[]> => {
    const ids = data.ids.filter((v) => Number.isInteger(v) && v >= 0).slice(0, 2000)
    if (ids.length === 0) return []
    const rows = await postgres_db
      .select({ id: R.id })
      .from(R)
      .where(and(eq(R.world_id, data.worldId), eq(R.kind, 'historical_figure'), inArray(R.id, ids)))
    return rows.map((r) => r.id)
  })

/** How many historical events mention each figure. Figures with none are omitted. */
export const getFigureEventCounts = createServerFn({ method: 'GET' })
  .inputValidator((input: LegendsFigureLookup) => input)
  .handler(async ({ data }): Promise<{ id: number; count: number }[]> => {
    const ids = data.ids.filter((v) => Number.isInteger(v) && v >= 0).slice(0, 2000)
    if (ids.length === 0) return []
    const list = sql`array[${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )}]::int[]`
    const result = await postgres_db.execute<{ id: number; c: number }>(sql`
      select u.id, count(distinct e.id)::int as c
      from ${R} e, unnest(e.hfids) as u(id)
      where e.world_id = ${data.worldId}
        and e.kind = 'historical_event'
        and e.hfids && ${list}
        and u.id = any(${list})
      group by u.id
    `)
    return [...result].map((row) => ({ id: Number(row.id), count: Number(row.c) }))
  })
