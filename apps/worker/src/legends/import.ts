import fs from 'node:fs/promises'
import path from 'node:path'
import { type JsonObject, type NewLegendsRecord, postgres_db, schema } from '@fortress/db-drizzle'
import { and, eq, sql } from 'drizzle-orm'
import { logger } from '../utils/logger'
import { readLegendsFile } from './xml'

const BATCH_SIZE = 1000
const LOG_EVERY = 50_000

/** `region1-02000-01-01-legends.xml` -> prefix `region1-02000-01-01`, plus = false */
const FILE_RE = /^(.+)-legends(_plus)?\.xml$/i

/** Keys whose integer values point at historical figures. */
const HF_KEY_RE =
  /hfid|hist_?fig|histfig|(^|_)hf$|^hf_|^(woundee|wounder|doer|target|eater|victim|snatcher|changee|changer|trickster|corruptor|seeker|lure|plotter|partner|group|attacker|defender|builder|creator|actor|appointer|promise_to|identity_hf|leader|ruler|hunter|convicted|convicter|confessed|contact|fooled|framer|corruptee|persecutor|prisoner|rescuer|abductor|joined)$/i
const ENTITY_KEY_RE = /civ|entity|enid|(^|_)en$/i
const SITE_KEY_RE = /site/i
const ARTIFACT_KEY_RE = /artifact/i

function collectIds(
  obj: Record<string, unknown> | undefined,
  matcher: RegExp,
  reject?: RegExp,
): number[] {
  if (!obj) return []
  const out = new Set<number>()
  for (const [key, value] of Object.entries(obj)) {
    if (!matcher.test(key) || reject?.test(key)) continue
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) out.add(value)
    else if (Array.isArray(value)) {
      for (const v of value) {
        if (typeof v === 'number' && Number.isInteger(v) && v >= 0) out.add(v)
      }
    }
  }
  return [...out]
}

function unique(...lists: number[][]): number[] | null {
  const set = new Set<number>()
  for (const list of lists) for (const v of list) set.add(v)
  return set.size ? [...set] : null
}

function stringOrNull(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v
  if (typeof v === 'number') return String(v)
  return null
}

function intOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) ? v : null
}

function pickName(kind: string, value: Record<string, unknown>): string | null {
  const direct = stringOrNull(value.name)
  if (direct) return direct
  if (kind === 'written_content') return stringOrNull(value.title)
  if (kind === 'artifact') {
    const item = value.item as Record<string, unknown> | undefined
    return stringOrNull(item?.name_string) ?? stringOrNull(item?.name)
  }
  return null
}

function pickYear(value: Record<string, unknown>): number | null {
  return intOrNull(value.year) ?? intOrNull(value.start_year) ?? intOrNull(value.birth_year)
}

interface RecordShape {
  id: number
  name: string | null
  type: string | null
  year: number | null
  hfids: number[] | null
  entity_ids: number[] | null
  site_ids: number[] | null
  artifact_ids: number[] | null
}

function shapeRecord(
  kind: string,
  value: Record<string, unknown>,
  fallbackId: number,
): RecordShape {
  const id = intOrNull(value.id) ?? fallbackId
  const hf = collectIds(value, HF_KEY_RE)
  const entities = collectIds(value, ENTITY_KEY_RE)
  const sites = collectIds(value, SITE_KEY_RE, /civ/i)
  const artifacts = kind === 'artifact' ? [] : collectIds(value, ARTIFACT_KEY_RE)
  return {
    id,
    name: pickName(kind, value),
    type:
      stringOrNull(value.type) ?? (kind === 'historical_figure' ? stringOrNull(value.race) : null),
    year: pickYear(value),
    hfids: unique(hf),
    entity_ids: unique(entities),
    site_ids: unique(sites),
    artifact_ids: unique(artifacts),
  }
}

const mergeIntArrays = (column: string) =>
  sql.raw(
    `(select array(select distinct unnest(coalesce(legends_records.${column}, '{}'::int[]) || coalesce(excluded.${column}, '{}'::int[]))))`,
  )

async function upsertBatch(rows: NewLegendsRecord[], isPlus: boolean): Promise<void> {
  if (rows.length === 0) return
  const arrays = {
    hfids: mergeIntArrays('hfids'),
    entity_ids: mergeIntArrays('entity_ids'),
    site_ids: mergeIntArrays('site_ids'),
    artifact_ids: mergeIntArrays('artifact_ids'),
  }
  await postgres_db
    .insert(schema.legends_records)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        schema.legends_records.world_id,
        schema.legends_records.kind,
        schema.legends_records.id,
      ],
      set: isPlus
        ? {
            name: sql.raw('coalesce(legends_records.name, excluded.name)'),
            type: sql.raw('coalesce(legends_records.type, excluded.type)'),
            year: sql.raw('coalesce(legends_records.year, excluded.year)'),
            ...arrays,
            payload: sql.raw('legends_records.payload || excluded.payload'),
          }
        : {
            name: sql.raw('coalesce(excluded.name, legends_records.name)'),
            type: sql.raw('coalesce(excluded.type, legends_records.type)'),
            year: sql.raw('coalesce(excluded.year, legends_records.year)'),
            ...arrays,
            payload: sql.raw(
              "excluded.payload || coalesce(jsonb_strip_nulls(jsonb_build_object('plus', legends_records.payload->'plus')), '{}'::jsonb)",
            ),
          },
    })
}

async function ensureWorld(key: string): Promise<number> {
  const inserted = await postgres_db
    .insert(schema.legends_worlds)
    .values({ key })
    .onConflictDoNothing({ target: schema.legends_worlds.key })
    .returning({ id: schema.legends_worlds.id })
  if (inserted[0]) return inserted[0].id
  const existing = await postgres_db
    .select({ id: schema.legends_worlds.id })
    .from(schema.legends_worlds)
    .where(eq(schema.legends_worlds.key, key))
    .limit(1)
  return existing[0].id
}

async function alreadyImported(filePath: string, size: number, mtimeMs: number): Promise<boolean> {
  const rows = await postgres_db
    .select({ size: schema.legends_imports.size, mtime_ms: schema.legends_imports.mtime_ms })
    .from(schema.legends_imports)
    .where(eq(schema.legends_imports.path, filePath))
    .limit(1)
  const row = rows[0]
  return !!row && row.size === size && Math.floor(row.mtime_ms) === Math.floor(mtimeMs)
}

async function refreshWorldCounts(worldId: number): Promise<Record<string, number>> {
  const rows = await postgres_db
    .select({ kind: schema.legends_records.kind, count: sql<number>`count(*)::int` })
    .from(schema.legends_records)
    .where(eq(schema.legends_records.world_id, worldId))
    .groupBy(schema.legends_records.kind)
  const counts: Record<string, number> = {}
  for (const row of rows) counts[row.kind] = row.count
  await postgres_db
    .update(schema.legends_worlds)
    .set({ record_counts: counts, imported_at: new Date().toISOString() })
    .where(eq(schema.legends_worlds.id, worldId))
  return counts
}

/** Import one legends file into the given world. Returns the record count. */
export async function importLegendsFile(
  worldId: number,
  filePath: string,
  isPlus: boolean,
): Promise<number> {
  const started = Date.now()
  const label = path.basename(filePath)
  await logger.info(`Legends: importing ${label}`)

  let batch: NewLegendsRecord[] = []
  let total = 0
  let nextLog = LOG_EVERY
  const fallbackIds = new Map<string, number>()

  const flush = async () => {
    const rows = batch
    batch = []
    await upsertBatch(rows, isPlus)
  }

  for await (const event of readLegendsFile(filePath)) {
    if (event.type === 'header') {
      const { key, value } = event.header
      if (key === 'name') {
        await postgres_db
          .update(schema.legends_worlds)
          .set({ name: value })
          .where(eq(schema.legends_worlds.id, worldId))
      } else if (key === 'altname') {
        await postgres_db
          .update(schema.legends_worlds)
          .set({ alt_name: value })
          .where(eq(schema.legends_worlds.id, worldId))
      }
      continue
    }

    const { kind, value } = event.record
    const fallback = fallbackIds.get(kind) ?? 0
    fallbackIds.set(kind, fallback + 1)
    const shape = shapeRecord(kind, value, fallback)
    batch.push({
      world_id: worldId,
      kind,
      id: shape.id,
      name: shape.name,
      type: shape.type,
      year: shape.year,
      hfids: shape.hfids,
      entity_ids: shape.entity_ids,
      site_ids: shape.site_ids,
      artifact_ids: shape.artifact_ids,
      payload: isPlus ? { plus: value as JsonObject } : (value as JsonObject),
    })
    total++
    if (batch.length >= BATCH_SIZE) await flush()
    if (total >= nextLog) {
      nextLog += LOG_EVERY
      console.log(`Legends: ${label} ${total.toLocaleString()} records so far`)
    }
  }
  await flush()

  const stat = await fs.stat(filePath)
  await postgres_db
    .insert(schema.legends_imports)
    .values({
      world_id: worldId,
      path: filePath,
      size: stat.size,
      mtime_ms: Math.floor(stat.mtimeMs),
      records: total,
      imported_at: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: schema.legends_imports.path,
      set: {
        world_id: worldId,
        size: stat.size,
        mtime_ms: Math.floor(stat.mtimeMs),
        records: total,
        imported_at: new Date().toISOString(),
      },
    })

  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  await logger.info(
    `Legends: imported ${total.toLocaleString()} records from ${label} in ${seconds}s`,
  )
  return total
}

/**
 * Find legends exports in a folder and import every file that is new or has
 * changed since the last run. Vanilla files go first so their field names win.
 */
export async function scanAndImportLegends(dir: string): Promise<void> {
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch (err) {
    await logger.warn(
      `Legends: cannot read ${dir}: ${err instanceof Error ? err.message : String(err)}`,
    )
    return
  }

  const groups = new Map<string, { vanilla?: string; plus?: string }>()
  for (const name of entries) {
    const match = FILE_RE.exec(name)
    if (!match) continue
    const prefix = match[1]
    const group = groups.get(prefix) ?? {}
    if (match[2]) group.plus = path.join(dir, name)
    else group.vanilla = path.join(dir, name)
    groups.set(prefix, group)
  }
  if (groups.size === 0) {
    console.log(`Legends: no *-legends.xml files in ${dir}`)
    return
  }

  for (const [prefix, files] of groups) {
    const worldId = await ensureWorld(prefix)
    let changed = false
    for (const [filePath, isPlus] of [
      [files.vanilla, false],
      [files.plus, true],
    ] as const) {
      if (!filePath) continue
      const stat = await fs.stat(filePath)
      if (await alreadyImported(filePath, stat.size, stat.mtimeMs)) {
        console.log(`Legends: ${path.basename(filePath)} already imported`)
        continue
      }
      try {
        await importLegendsFile(worldId, filePath, isPlus)
        changed = true
      } catch (err) {
        await logger.error(
          `Legends: import of ${path.basename(filePath)} failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    if (changed) {
      const counts = await refreshWorldCounts(worldId)
      const total = Object.values(counts).reduce((a, b) => a + b, 0)
      await logger.info(`Legends: world "${prefix}" now has ${total.toLocaleString()} records`)
    } else {
      // Keep counts current even if nothing new was imported.
      await refreshWorldCounts(worldId)
    }
  }
}
