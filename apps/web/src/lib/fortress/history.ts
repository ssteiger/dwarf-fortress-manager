import {
  type FortDeadUnit,
  type FortHistoryRow,
  type FortLifeEvent,
  type FortUnit,
  type SnapshotTotals,
  fortKeyOf,
  gameDay,
  postgres_db,
  schema,
} from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { type AnyColumn, and, desc, eq, inArray, sql } from 'drizzle-orm'

import { dumpTable, readDump } from './dumpCache'
import { isOwnGhost } from './insights'
import type { GameTime } from './insights'
import {
  type RecapSource,
  type SeasonRef,
  type SnapshotPoint,
  TICKS_PER_SEASON,
  seasonFromIndex,
  seasonIndex,
  seasonSpan,
} from './recap'

/*
 * The fortress over time, from the worker's daily snapshots and the life
 * events between them. Everything is read for the loaded fortress up to its
 * present, so a future undone by loading an earlier save never shows.
 */

const S = schema.fort_snapshots
const L = schema.fort_life_events
const A = schema.fort_unit_archive
const H = schema.fort_history_events
const E = schema.fort_events

const SINGLETON_ID = 1

interface Present {
  fortKey: string
  year: number
  tick: number
}

async function present(): Promise<Present | null> {
  const rows = await postgres_db
    .select({ world: schema.fort_state.world })
    .from(schema.fort_state)
    .where(eq(schema.fort_state.id, SINGLETON_ID))
    .limit(1)
  const world = rows[0]?.world
  const fortKey = fortKeyOf(world)
  if (!world || !fortKey) return null
  return { fortKey, year: world.year, tick: world.tick }
}

/** A table dated in game time. Not `typeof` a table: that would keep the tables, and Postgres, in the client bundle. */
type Timed = { game_year: AnyColumn; game_tick: AnyColumn }
const upTo = (t: Timed, p: Present) =>
  sql`(${t.game_year}, ${t.game_tick}) <= (${p.year}, ${p.tick})`

export interface TrendPoint {
  day: number
  year: number
  tick: number
  totals: SnapshotTotals
}

const TREND_POINTS = 160

/** The fortress's daily totals, thinned to at most TREND_POINTS days, oldest first. */
export const getFortTrends = createServerFn({ method: 'GET' }).handler(
  async (): Promise<TrendPoint[]> => {
    const p = await present()
    if (!p) return []
    const rows = await postgres_db.execute<{
      day: number
      game_year: number
      game_tick: number
      totals: SnapshotTotals
    }>(sql`
      select day, game_year, game_tick, totals from (
        select day, game_year, game_tick, totals,
          row_number() over (order by day desc) - 1 as rn,
          count(*) over () as n
        from ${S}
        where ${S.fort_key} = ${p.fortKey} and ${S.day} <= ${gameDay(p.year, p.tick)}
      ) s
      where rn % greatest(1, ceil(n / ${TREND_POINTS}::numeric)::int) = 0
      order by day
    `)
    return [...rows].map((r) => ({
      day: Number(r.day),
      year: Number(r.game_year),
      tick: Number(r.game_tick),
      totals: r.totals,
    }))
  },
)

export interface UnitHistory {
  /** Their life events, newest first. */
  events: FortLifeEvent[]
  /** Their stress by day over the last year, oldest first. */
  stress: { day: number; year: number; tick: number; stress: number; category: number }[]
}

const UNIT_STRESS_DAYS = 336

export const getUnitHistory = createServerFn({ method: 'GET' })
  .inputValidator((input: { unitId: number }) => input)
  .handler(async ({ data }): Promise<UnitHistory> => {
    const p = await present()
    if (!p || !Number.isFinite(data.unitId)) return { events: [], stress: [] }
    const id = String(data.unitId)
    const today = gameDay(p.year, p.tick)
    const [events, stress] = await Promise.all([
      postgres_db
        .select()
        .from(L)
        .where(and(eq(L.fort_key, p.fortKey), eq(L.unit_id, data.unitId), upTo(L, p)))
        .orderBy(desc(L.game_year), desc(L.game_tick), desc(L.id))
        .limit(200),
      postgres_db.execute<{
        day: number
        game_year: number
        game_tick: number
        stress: number | null
        category: number | null
      }>(sql`
        select day, game_year, game_tick,
          (units -> ${id} ->> 'stress')::int as stress,
          (units -> ${id} ->> 'stress_category')::int as category
        from ${S}
        where ${S.fort_key} = ${p.fortKey}
          and ${S.day} between ${today - UNIT_STRESS_DAYS} and ${today}
          and (units -> ${id}) is not null
        order by day
      `),
    ])
    return {
      events,
      stress: [...stress]
        .filter((r) => r.stress !== null && r.category !== null)
        .map((r) => ({
          day: Number(r.day),
          year: Number(r.game_year),
          tick: Number(r.game_tick),
          stress: Number(r.stress),
          category: Number(r.category),
        })),
    }
  })

const HISTORY_LIMIT = 400

/**
 * The world's history events at the fortress or naming its people, newest
 * first; with `hf`, only those naming that figure.
 */
export const getFortHistory = createServerFn({ method: 'GET' })
  .inputValidator((input: { hf?: number; limit?: number }) => input)
  .handler(async ({ data }): Promise<FortHistoryRow[]> => {
    const p = await present()
    if (!p) return []
    const limit = Math.min(Math.max(data.limit ?? HISTORY_LIMIT, 1), 2000)
    const hf = typeof data.hf === 'number' && Number.isInteger(data.hf) ? data.hf : null
    return postgres_db
      .select()
      .from(H)
      .where(
        and(
          eq(H.fort_key, p.fortKey),
          sql`(${H.game_year}, ${H.game_tick}) <= (${p.year}, ${p.tick})`,
          hf !== null ? sql`${H.hfids} @> array[${hf}]::int[]` : undefined,
        ),
      )
      .orderBy(desc(H.game_year), desc(H.game_tick), desc(H.event_id))
      .limit(limit)
  })

// ---------------------------------------------------------------------------
// Recaps: what a span of the fortress's life is told from

/** Announcements of the loaded fortress, as the chronicle keys them. */
const ofFortress = (p: Present) => sql`starts_with(${E.dedupe_key}, ${`${p.fortKey}:`})`
const notCancelled = sql`coalesce(${E.type}, '') <> 'CANCEL_JOB'`
const RECAP_ANNOUNCEMENTS = 6000

const atOrAfter = (t: Timed, at: GameTime) =>
  sql`(${t.game_year}, ${t.game_tick}) >= (${at.year}, ${at.tick})`
const beforeTime = (t: Timed, at: GameTime) =>
  sql`(${t.game_year}, ${t.game_tick}) < (${at.year}, ${at.tick})`

/** The span's announcements, life events and history events, oldest first. */
async function recapEvents(p: Present, from: GameTime, to: GameTime) {
  const [announcements, lifeEvents, history] = await Promise.all([
    postgres_db
      .select()
      .from(E)
      .where(and(ofFortress(p), notCancelled, atOrAfter(E, from), beforeTime(E, to), upTo(E, p)))
      .orderBy(E.game_year, E.game_tick, E.id)
      .limit(RECAP_ANNOUNCEMENTS),
    postgres_db
      .select()
      .from(L)
      .where(and(eq(L.fort_key, p.fortKey), atOrAfter(L, from), beforeTime(L, to), upTo(L, p)))
      .orderBy(L.game_year, L.game_tick, L.id),
    postgres_db
      .select({
        event_id: H.event_id,
        type: H.type,
        here: H.here,
        hfids: H.hfids,
        fields: H.fields,
        extra: H.extra,
        game_year: H.game_year,
        game_tick: H.game_tick,
      })
      .from(H)
      .where(and(eq(H.fort_key, p.fortKey), atOrAfter(H, from), beforeTime(H, to), upTo(H, p)))
      .orderBy(H.game_year, H.game_tick, H.event_id),
  ])
  return { announcements, lifeEvents, history }
}

/** The first and last day the worker kept of each season in the span, by season index. */
async function seasonDays(
  p: Present,
  from: GameTime,
  to: GameTime,
): Promise<Map<number, { first: SnapshotPoint; last: SnapshotPoint }>> {
  const today = gameDay(p.year, p.tick)
  const ends = await postgres_db.execute<{ idx: number; first_day: number; last_day: number }>(sql`
    select game_year * 4 + least(3, game_tick / ${TICKS_PER_SEASON}) as idx,
      min(day) as first_day, max(day) as last_day
    from ${S}
    where ${S.fort_key} = ${p.fortKey}
      and ${S.day} >= ${gameDay(from.year, from.tick)}
      and ${S.day} < ${gameDay(to.year, to.tick)}
      and ${S.day} <= ${today}
    group by 1
  `)
  const days = [...ends].flatMap((r) => [Number(r.first_day), Number(r.last_day)])
  if (!days.length) return new Map()
  const rows = await postgres_db
    .select({ day: S.day, year: S.game_year, tick: S.game_tick, totals: S.totals })
    .from(S)
    .where(and(eq(S.fort_key, p.fortKey), inArray(S.day, [...new Set(days)])))
  const byDay = new Map(rows.map((r) => [r.day, { year: r.year, tick: r.tick, totals: r.totals }]))
  const out = new Map<number, { first: SnapshotPoint; last: SnapshotPoint }>()
  for (const r of ends) {
    const first = byDay.get(Number(r.first_day))
    const last = byDay.get(Number(r.last_day))
    if (first && last) out.set(Number(r.idx), { first, last })
  }
  return out
}

export interface FortRecapSource extends RecapSource {
  /** The loaded fortress's present, which no span reaches past. */
  present: GameTime | null
}

const NO_SOURCE: RecapSource = {
  announcements: [],
  lifeEvents: [],
  history: [],
  first: null,
  last: null,
}

/** What a span of the fortress's life is told from: `from` included, `to` (or the present) the end. */
export const getFortRecap = createServerFn({ method: 'GET' })
  .inputValidator((input: { from: GameTime; to?: GameTime }) => input)
  .handler(async ({ data }): Promise<FortRecapSource> => {
    const p = await present()
    if (!p) return { ...NO_SOURCE, present: null }
    const end = data.to ?? { year: p.year, tick: p.tick + 1 }
    const [events, firstRows, lastRows] = await Promise.all([
      recapEvents(p, data.from, end),
      postgres_db
        .select({ year: S.game_year, tick: S.game_tick, totals: S.totals })
        .from(S)
        .where(
          and(
            eq(S.fort_key, p.fortKey),
            sql`${S.day} >= ${gameDay(data.from.year, data.from.tick)}`,
            sql`${S.day} <= ${gameDay(p.year, p.tick)}`,
          ),
        )
        .orderBy(S.day)
        .limit(1),
      postgres_db
        .select({ year: S.game_year, tick: S.game_tick, totals: S.totals })
        .from(S)
        .where(
          and(
            eq(S.fort_key, p.fortKey),
            sql`(${S.game_year}, ${S.game_tick}) < (${end.year}, ${end.tick})`,
            sql`${S.day} <= ${gameDay(p.year, p.tick)}`,
          ),
        )
        .orderBy(desc(S.day))
        .limit(1),
    ])
    return {
      ...events,
      first: firstRows[0] ?? null,
      last: lastRows[0] ?? null,
      present: { year: p.year, tick: p.tick },
    }
  })

export interface FortSeason {
  season: SeasonRef
  source: RecapSource
}

export interface FortSeasons {
  /** Newest first. */
  seasons: FortSeason[]
  /** The season index to ask for next, older; null when there is nothing older. */
  next: number | null
  /** The first announcement the worker kept of this fortress; earlier seasons come from history alone. */
  readingSince: GameTime | null
  present: GameTime | null
}

const SEASONS_PER_PAGE = 4

/** The seasons the app knows anything of, newest first, a page at a time. */
export const getFortSeasons = createServerFn({ method: 'GET' })
  .inputValidator((input: { before?: number; limit?: number }) => input)
  .handler(async ({ data }): Promise<FortSeasons> => {
    const p = await present()
    if (!p) return { seasons: [], next: null, readingSince: null, present: null }
    const limit = Math.min(Math.max(data.limit ?? SEASONS_PER_PAGE, 1), 12)
    const before =
      typeof data.before === 'number' && Number.isInteger(data.before) ? data.before : null
    const today = gameDay(p.year, p.tick)
    const idx = (t: Timed) =>
      sql`${t.game_year} * 4 + least(3, ${t.game_tick} / ${TICKS_PER_SEASON})`
    const [indexRows, firstRows] = await Promise.all([
      postgres_db.execute<{ idx: number }>(sql`
        select idx from (
          select ${idx(E)} as idx from ${E}
            where ${ofFortress(p)} and ${notCancelled} and ${E.game_year} is not null and ${upTo(E, p)}
          union
          select ${idx(L)} from ${L} where ${L.fort_key} = ${p.fortKey} and ${upTo(L, p)}
          union
          select ${idx(H)} from ${H} where ${H.fort_key} = ${p.fortKey} and ${upTo(H, p)}
          union
          select ${S.game_year} * 4 + least(3, ${S.game_tick} / ${TICKS_PER_SEASON}) from ${S}
            where ${S.fort_key} = ${p.fortKey} and ${S.day} <= ${today}
        ) s
        ${before !== null ? sql`where idx < ${before}` : sql``}
        order by idx desc
        limit ${limit + 1}
      `),
      postgres_db
        .select({ year: E.game_year, tick: E.game_tick })
        .from(E)
        .where(and(ofFortress(p), sql`${E.game_year} is not null`))
        .orderBy(E.game_year, E.game_tick)
        .limit(1),
    ])
    const indices = [...indexRows].map((r) => Number(r.idx))
    const page = indices.slice(0, limit)
    const first = firstRows[0]
    const readingSince =
      first && first.year !== null && first.tick !== null
        ? { year: first.year, tick: first.tick }
        : null
    if (!page.length) return { seasons: [], next: null, readingSince, present: p }

    const from = seasonSpan(seasonFromIndex(page[page.length - 1])).from
    const to = seasonSpan(seasonFromIndex(page[0])).to
    const [events, days] = await Promise.all([recapEvents(p, from, to), seasonDays(p, from, to)])
    const seasonOf = (year: number, tick: number) =>
      seasonIndex({ year, season: Math.min(3, Math.floor(tick / TICKS_PER_SEASON)) })
    const seasons = page.map((i): FortSeason => {
      const inSeason = <T extends { game_year: number | null; game_tick: number | null }>(
        rows: T[],
      ) =>
        rows.filter(
          (r) =>
            r.game_year !== null &&
            r.game_tick !== null &&
            seasonOf(r.game_year, r.game_tick) === i,
        )
      const kept = days.get(i)
      return {
        season: seasonFromIndex(i),
        source: {
          announcements: inSeason(events.announcements),
          lifeEvents: inSeason(events.lifeEvents),
          history: inSeason(events.history),
          first: kept?.first ?? null,
          last: kept?.last ?? null,
        },
      }
    })
    return {
      seasons,
      next: indices.length > limit ? page[page.length - 1] : null,
      readingSince,
      present: { year: p.year, tick: p.tick },
    }
  })

/** One of the fortress's dead; fields the game did not say are null. */
export interface FortFallen {
  id: number
  hf: number | null
  name: string
  name_english: string | null
  nickname: string | null
  race: string | null
  sex: number
  profession: string | null
  born_year: number | null
  died_year: number | null
  died_tick: number | null
  cause: string | null
  slayer: string | null
  slayer_race: string | null
  ghost: boolean
  body: FortDeadUnit['body'] | null
  memorial: boolean | null
  kills: number | null
  /** Their page still opens, from the dump or the last sheet the worker kept. */
  page: boolean
}

export interface FortDeparted {
  id: number
  name: string
  profession: string | null
  year: number
  tick: number
}

export interface FortDead {
  capturedAt: string | null
  /** The dump lists every one of the dead (version 12 on); otherwise only those the worker saw. */
  complete: boolean
  /** Newest death first. */
  dead: FortFallen[]
  /** Citizens who left the map and have not come back, newest first. */
  departed: FortDeparted[]
}

const fromUnit = (
  u: Pick<
    FortUnit,
    'id' | 'name' | 'name_english' | 'nickname' | 'race' | 'sex' | 'profession' | 'hist_figure_id'
  >,
  page: boolean,
): FortFallen => ({
  id: u.id,
  hf: u.hist_figure_id >= 0 ? u.hist_figure_id : null,
  name: u.name,
  name_english: u.name_english || null,
  nickname: u.nickname,
  race: u.race,
  sex: u.sex,
  profession: u.profession || null,
  born_year: null,
  died_year: null,
  died_tick: null,
  cause: null,
  slayer: null,
  slayer_race: null,
  ghost: false,
  body: null,
  memorial: null,
  kills: null,
  page,
})

/** The fortress's dead and departed, from the dump, the archive and the life events. */
export const getFortDead = createServerFn({ method: 'GET' }).handler(
  async (): Promise<FortDead> => {
    const p = await present()
    const [dump, archive, deaths, recorded] = await Promise.all([
      readDump(),
      p
        ? postgres_db
            .select({
              id: A.unit_id,
              reason: A.reason,
              year: A.game_year,
              tick: A.game_tick,
              name: sql<string>`${A.unit} ->> 'name'`,
              name_english: sql<string>`${A.unit} ->> 'name_english'`,
              nickname: sql<string | null>`${A.unit} ->> 'nickname'`,
              race: sql<string>`${A.unit} ->> 'race'`,
              sex: sql<number>`(${A.unit} ->> 'sex')::int`,
              profession: sql<string>`${A.unit} ->> 'profession'`,
              hist_figure_id: sql<number>`(${A.unit} ->> 'hist_figure_id')::int`,
            })
            .from(A)
            .where(eq(A.fort_key, p.fortKey))
        : [],
      p
        ? postgres_db
            .select({ unit_id: L.unit_id, year: L.game_year, tick: L.game_tick })
            .from(L)
            .where(and(eq(L.fort_key, p.fortKey), eq(L.kind, 'died'), upTo(L, p)))
        : [],
      p
        ? postgres_db
            .select({
              hfids: H.hfids,
              fields: H.fields,
              extra: H.extra,
              year: H.game_year,
              tick: H.game_tick,
            })
            .from(H)
            .where(and(eq(H.fort_key, p.fortKey), eq(H.type, 'HIST_FIGURE_DIED')))
        : [],
    ])
    const deathOf = new Map<number, (typeof recorded)[number]>()
    for (const r of recorded) {
      const victim = typeof r.fields.victim_hf === 'number' ? r.fields.victim_hf : r.hfids[0]
      if (typeof victim === 'number') deathOf.set(victim, r)
    }
    const units = dumpTable<FortUnit>(dump, 'units')
    const onMap = new Map(units.map((u) => [u.id, u]))
    const kept = new Set(archive.map((a) => a.id))
    const diedAt = new Map(deaths.map((d) => [d.unit_id, d]))
    const ghosts = new Set(units.filter(isOwnGhost).map((u) => u.id))

    const byId = new Map<number, FortFallen>()
    for (const a of archive) {
      if (a.reason !== 'died') continue
      byId.set(a.id, {
        ...fromUnit({ ...a, nickname: a.nickname ?? null }, true),
        died_year: a.year,
        died_tick: a.tick,
      })
    }
    for (const u of units) {
      if (byId.has(u.id) || !(u.flags.includes('dead') || u.flags.includes('ghost'))) continue
      const own =
        u.flags.includes('citizen') || u.flags.includes('own_civ') || u.flags.includes('resident')
      if (!own || u.hist_figure_id < 0 || u.flags.includes('animal')) continue
      const died = diedAt.get(u.id)
      byId.set(u.id, {
        ...fromUnit(u, true),
        died_year: died?.year ?? null,
        died_tick: died?.tick ?? null,
      })
    }
    const listed = dump?.row.dead ? dump.table<FortDeadUnit>('dead') : null
    for (const d of listed ?? []) {
      byId.set(d.id, {
        ...d,
        name: d.name ?? `Unit ${d.id}`,
        hf: d.hf >= 0 ? d.hf : null,
        born_year: d.born_year >= 0 ? d.born_year : null,
        died_year: d.died_year >= 0 ? d.died_year : null,
        died_tick: d.died_tick >= 0 ? d.died_tick : null,
        ghost: d.ghost || ghosts.has(d.id),
        page: kept.has(d.id) || onMap.has(d.id),
      })
    }
    for (const id of ghosts) {
      const fallen = byId.get(id)
      if (fallen) fallen.ghost = true
    }
    for (const fallen of byId.values()) {
      const death = fallen.hf !== null ? deathOf.get(fallen.hf) : undefined
      if (!death) continue
      const slayerHf = death.fields.slayer_hf
      const slayer =
        typeof slayerHf === 'number' ? death.extra.figures?.[String(slayerHf)] : undefined
      fallen.died_year ??= death.year
      fallen.died_tick ??= death.tick
      if (!fallen.cause && typeof death.fields.death_cause === 'string')
        fallen.cause = death.fields.death_cause
      fallen.slayer ??= slayer?.[0] ?? null
      fallen.slayer_race ??= slayer?.[2] ?? death.extra.race ?? null
    }

    const dead = [...byId.values()].sort(
      (a, b) =>
        (b.died_year ?? -1) - (a.died_year ?? -1) || (b.died_tick ?? -1) - (a.died_tick ?? -1),
    )
    const departed = archive
      .filter((a) => a.reason === 'left' && !onMap.has(a.id))
      .map((a) => ({
        id: a.id,
        name: a.name,
        profession: a.profession || null,
        year: a.year,
        tick: a.tick,
      }))
      .sort((a, b) => b.year - a.year || b.tick - a.tick)
    return { capturedAt: dump?.row.captured_at ?? null, complete: listed !== null, dead, departed }
  },
)
