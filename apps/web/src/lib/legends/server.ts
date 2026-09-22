import {
  type LegendsPayload,
  type LegendsRecord,
  type LegendsWorld,
  postgres_db,
  schema,
} from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'

/** Kinds whose id arrays on events point back at them. */
const REF_COLUMN: Record<string, 'hfids' | 'entity_ids' | 'site_ids' | 'artifact_ids'> = {
  historical_figure: 'hfids',
  entity: 'entity_ids',
  site: 'site_ids',
  artifact: 'artifact_ids',
}

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

export interface LegendsSearchQuery {
  worldId: number
  q?: string
  kind?: string
  limit?: number
}

export type LegendsHit = Pick<LegendsRecord, 'kind' | 'id' | 'name' | 'type' | 'year'>

export const searchLegends = createServerFn({ method: 'GET' })
  .inputValidator((input: LegendsSearchQuery) => input)
  .handler(async ({ data }): Promise<LegendsHit[]> => {
    const limit = Math.min(Math.max(data.limit ?? 100, 1), 500)
    const q = (data.q ?? '').trim()
    const conditions = [eq(schema.legends_records.world_id, data.worldId)]
    if (data.kind) conditions.push(eq(schema.legends_records.kind, data.kind))
    if (q) conditions.push(sql`${schema.legends_records.name} ilike ${`%${q}%`}`)
    else conditions.push(sql`${schema.legends_records.name} is not null`)
    return postgres_db
      .select({
        kind: schema.legends_records.kind,
        id: schema.legends_records.id,
        name: schema.legends_records.name,
        type: schema.legends_records.type,
        year: schema.legends_records.year,
      })
      .from(schema.legends_records)
      .where(and(...conditions))
      .orderBy(
        asc(schema.legends_records.name),
        asc(schema.legends_records.kind),
        asc(schema.legends_records.id),
      )
      .limit(limit)
  })

export interface LegendsRecordQuery {
  worldId: number
  kind: string
  id: number
}

export type NameIndex = Record<string, Record<number, string>>

export interface LegendsRecordDetail {
  record: LegendsRecord | null
  /** Events that reference this record, oldest first. */
  events: LegendsRecord[]
  eventsTotal: number
  /** kind -> id -> name, for every id referenced by the record or its events. */
  names: NameIndex
}

const HF_KEY_RE =
  /hfid|hist_?fig|histfig|(^|_)hf$|^hf_|^(woundee|wounder|doer|target|eater|victim|snatcher|changee|changer|trickster|corruptor|seeker|lure|plotter|partner|group|attacker|defender|builder|creator|actor|appointer|promise_to|leader|ruler|hunter|convicted|convicter|contact|prisoner|rescuer|abductor|joined)$/i
const ENTITY_KEY_RE = /civ|entity|enid|(^|_)en$/i
const SITE_KEY_RE = /site/i
const ARTIFACT_KEY_RE = /artifact|artifact_id/i
const REGION_KEY_RE = /subregion|region_id|^region$/i
const WC_KEY_RE = /wc_id|written_content/i

function addRefs(target: Record<string, Set<number>>, obj: unknown, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 2) return
  if (Array.isArray(obj)) {
    for (const v of obj) addRefs(target, v, depth + 1)
    return
  }
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key === 'plus') {
      addRefs(target, value, depth)
      continue
    }
    if (typeof value === 'object' && value !== null) {
      addRefs(target, value, depth + 1)
      continue
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) continue
    let kind: string | null = null
    if (ENTITY_KEY_RE.test(key)) kind = 'entity'
    else if (SITE_KEY_RE.test(key)) kind = 'site'
    else if (ARTIFACT_KEY_RE.test(key)) kind = 'artifact'
    else if (WC_KEY_RE.test(key)) kind = 'written_content'
    else if (REGION_KEY_RE.test(key)) kind = 'region'
    else if (HF_KEY_RE.test(key)) kind = 'historical_figure'
    if (!kind) continue
    const set = target[kind] ?? new Set<number>()
    set.add(value)
    target[kind] = set
  }
}

async function lookupNames(worldId: number, refs: Record<string, Set<number>>): Promise<NameIndex> {
  const names: NameIndex = {}
  const chunks: Promise<void>[] = []
  for (const [kind, ids] of Object.entries(refs)) {
    const list = [...ids].slice(0, 5000)
    if (list.length === 0) continue
    chunks.push(
      postgres_db
        .select({
          id: schema.legends_records.id,
          name: schema.legends_records.name,
          type: schema.legends_records.type,
        })
        .from(schema.legends_records)
        .where(
          and(
            eq(schema.legends_records.world_id, worldId),
            eq(schema.legends_records.kind, kind),
            inArray(schema.legends_records.id, list),
          ),
        )
        .then((rows) => {
          const map: Record<number, string> = {}
          for (const row of rows) {
            map[row.id] =
              row.name ??
              (kind === 'historical_figure' && row.type
                ? `an unnamed ${row.type}`
                : `${kind} #${row.id}`)
          }
          names[kind] = map
        }),
    )
  }
  await Promise.all(chunks)
  return names
}

export const getLegendsRecord = createServerFn({ method: 'GET' })
  .inputValidator((input: LegendsRecordQuery) => input)
  .handler(async ({ data }): Promise<LegendsRecordDetail> => {
    const rows = await postgres_db
      .select()
      .from(schema.legends_records)
      .where(
        and(
          eq(schema.legends_records.world_id, data.worldId),
          eq(schema.legends_records.kind, data.kind),
          eq(schema.legends_records.id, data.id),
        ),
      )
      .limit(1)
    const record = rows[0] ?? null
    if (!record) return { record: null, events: [], eventsTotal: 0, names: {} }

    let events: LegendsRecord[] = []
    let eventsTotal = 0
    const refColumn = REF_COLUMN[data.kind]
    if (refColumn) {
      const column = schema.legends_records[refColumn]
      const where = and(
        eq(schema.legends_records.world_id, data.worldId),
        eq(schema.legends_records.kind, 'historical_event'),
        sql`${column} @> ARRAY[${data.id}]::int[]`,
      )
      const [countRows, eventRows] = await Promise.all([
        postgres_db
          .select({ count: sql<number>`count(*)::int` })
          .from(schema.legends_records)
          .where(where),
        postgres_db
          .select()
          .from(schema.legends_records)
          .where(where)
          .orderBy(asc(schema.legends_records.year), asc(schema.legends_records.id))
          .limit(600),
      ])
      eventsTotal = countRows[0]?.count ?? 0
      events = eventRows
    } else if (data.kind === 'historical_event_collection') {
      const ids = (record.payload as LegendsPayload).event as unknown
      const list = Array.isArray(ids)
        ? ids.filter((v): v is number => typeof v === 'number').slice(0, 600)
        : []
      if (list.length) {
        events = await postgres_db
          .select()
          .from(schema.legends_records)
          .where(
            and(
              eq(schema.legends_records.world_id, data.worldId),
              eq(schema.legends_records.kind, 'historical_event'),
              inArray(schema.legends_records.id, list),
            ),
          )
          .orderBy(asc(schema.legends_records.year), asc(schema.legends_records.id))
        eventsTotal = events.length
      }
    }

    const refs: Record<string, Set<number>> = {}
    addRefs(refs, record.payload)
    for (const ev of events) addRefs(refs, ev.payload)
    const names = await lookupNames(data.worldId, refs)
    return { record, events, eventsTotal, names }
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
      .select({ id: schema.legends_records.id })
      .from(schema.legends_records)
      .where(
        and(
          eq(schema.legends_records.world_id, data.worldId),
          eq(schema.legends_records.kind, 'historical_figure'),
          inArray(schema.legends_records.id, ids),
        ),
      )
    return rows.map((r) => r.id)
  })
