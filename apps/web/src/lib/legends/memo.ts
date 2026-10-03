import { postgres_db, schema } from '@fortress/db-drizzle'
import { type SQL, and, eq, sql } from 'drizzle-orm'

/*
 * Server only: per-world aggregates kept until the world is re-imported.
 * Import this from other server modules or from inside server-function
 * handlers, never from a module the browser loads for its exports.
 */

const R = schema.legends_records

function eventsOf(worldId: number): SQL {
  return and(eq(R.world_id, worldId), eq(R.kind, 'historical_event')) as SQL
}

const memo = new Map<string, { version: string; value: Promise<unknown> }>()

async function worldVersion(worldId: number): Promise<string> {
  const [world, imports] = await Promise.all([
    postgres_db
      .select({ at: schema.legends_worlds.imported_at })
      .from(schema.legends_worlds)
      .where(eq(schema.legends_worlds.id, worldId))
      .limit(1),
    postgres_db
      .select({ at: sql<string | null>`max(${schema.legends_imports.imported_at})` })
      .from(schema.legends_imports)
      .where(eq(schema.legends_imports.world_id, worldId)),
  ])
  return `${world[0]?.at ?? ''}|${imports[0]?.at ?? ''}`
}

export async function remember<T>(
  worldId: number,
  key: string,
  compute: () => Promise<T>,
): Promise<T> {
  const version = await worldVersion(worldId)
  const cacheKey = `${worldId}:${key}`
  const hit = memo.get(cacheKey)
  if (hit && hit.version === version) return hit.value as Promise<T>
  const value = compute().catch((error) => {
    memo.delete(cacheKey)
    throw error
  })
  memo.set(cacheKey, { version, value })
  return value
}

/** The last year any event is dated, where the record ends. */
export function recordEndYear(worldId: number): Promise<number | null> {
  return remember(worldId, 'end-year', async () => {
    const rows = await postgres_db
      .select({ year: sql<number | null>`max(${R.year})` })
      .from(R)
      .where(eventsOf(worldId))
    const year = rows[0]?.year
    return year === null || year === undefined ? null : Number(year)
  })
}

/** The game's own plural for each raw creature token: TOAD_GIANT_CAVE -> "giant cave toads". */
export function creaturePlurals(worldId: number): Promise<Map<string, string>> {
  return remember(worldId, 'creature-plurals', async () => {
    const rows = await postgres_db.execute<{ token: string | null; plural: string | null }>(sql`
      select ${R.payload} -> 'plus' ->> 'creature_id' as token,
             ${R.payload} -> 'plus' ->> 'name_plural' as plural
      from ${R}
      where ${R.world_id} = ${worldId} and ${R.kind} = 'creature'
    `)
    const out = new Map<string, string>()
    for (const row of rows) {
      if (row.token && row.plural) out.set(row.token.toUpperCase(), row.plural)
    }
    return out
  })
}

/** Historical events that mention each figure, for weighing people and deaths. */
export function figureEventCounts(worldId: number): Promise<Map<number, number>> {
  return remember(worldId, 'figure-counts', async () => {
    const rows = await postgres_db.execute<{ hf: number; c: number }>(sql`
      select hf, count(*)::int as c
      from (select unnest(${R.hfids}) as hf from ${R} where ${eventsOf(worldId)}) s
      group by hf
    `)
    return new Map([...rows].map((row) => [Number(row.hf), Number(row.c)]))
  })
}
