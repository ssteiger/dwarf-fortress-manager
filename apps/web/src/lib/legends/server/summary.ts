import { type LegendsPayload, postgres_db, schema } from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'

import { EVENT_CATEGORIES, num, plusOf, str } from '../events'
import { raceToken, words } from '../model'
import type { LegendsRef } from '../types'
import { type RefSet, addRef, lookupNames } from './records'

/*
 * Server function: a world at a glance, with its civilizations, wars,
 * notable figures and deities, and its history binned into a timeline.
 */

const R = schema.legends_records

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
