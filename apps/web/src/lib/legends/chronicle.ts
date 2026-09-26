import { type LegendsPayload, type LegendsRecord, postgres_db, schema } from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { type SQL, and, asc, desc, eq, ilike, inArray, isNotNull, sql } from 'drizzle-orm'

import { EVENT_CATEGORIES, eventCategory, num, numList, plusOf, str } from './events'
import { racePlural, raceToken, titleCase, words } from './model'
import { list, sentence } from './prose'
import { type RefSet, addRef, addRefs, describeRows, lookupNames } from './records'
import type { LegendsHit, NameIndex } from './server'

/*
 * Reading history rather than looking records up: what happened in a span of
 * years, how sites changed hands, and which stories the export holds. The
 * heavy aggregates run once per world and are kept until the world is
 * re-imported.
 */

const R = schema.legends_records

function eventsOf(worldId: number): SQL {
  return and(eq(R.world_id, worldId), eq(R.kind, 'historical_event')) as SQL
}

// ---------------------------------------------------------------------------
// Per-world memo

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

async function remember<T>(worldId: number, key: string, compute: () => Promise<T>): Promise<T> {
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

/** Historical events that mention each figure, for weighing people and deaths. */
function figureEventCounts(worldId: number): Promise<Map<number, number>> {
  return remember(worldId, 'figure-counts', async () => {
    const rows = await postgres_db.execute<{ hf: number; c: number }>(sql`
      select hf, count(*)::int as c
      from (select unnest(${R.hfids}) as hf from ${R} where ${eventsOf(worldId)}) s
      group by hf
    `)
    return new Map([...rows].map((row) => [Number(row.hf), Number(row.c)]))
  })
}

// ---------------------------------------------------------------------------
// Sites through time

export type SiteState = 'founded' | 'conquered' | 'ruined' | 'reclaimed'

export interface SiteChange {
  site: number
  year: number
  state: SiteState
  /** Civilization holding the site afterwards; null when it lies in ruins. */
  civ: number | null
  /** Who held it before, when the record says. */
  from: number | null
  /** The event behind the change. */
  event: number
}

export interface HistoryBattle {
  id: number
  name: string | null
  year: number
  x: number
  y: number
  casualties: number
}

export interface SiteHistory {
  changes: SiteChange[]
  /** Battles with a place on the map, for flares while the years roll by. */
  battles: HistoryBattle[]
  /** Every civilization the changes name, including ones that hold nothing today. */
  civs: Record<number, { name: string | null; race: string | null }>
  years: { min: number; max: number } | null
}

const SITE_EVENT_TYPES = [
  'created site',
  'site taken over',
  'hf destroyed site',
  'new site leader',
  'reclaim site',
]

/** Every change of hands the events record, oldest first. */
export const getSiteHistory = createServerFn({ method: 'GET' })
  .inputValidator((input: { worldId: number }) => input)
  .handler(
    async ({ data }): Promise<SiteHistory> =>
      remember(data.worldId, 'site-history', async () => {
        const W = eq(R.world_id, data.worldId)
        const [rows, yearRows, battleRows, fieldRows] = await Promise.all([
          postgres_db
            .select({ id: R.id, type: R.type, year: R.year, payload: R.payload })
            .from(R)
            .where(
              and(eventsOf(data.worldId), inArray(R.type, SITE_EVENT_TYPES), sql`${R.year} >= 0`),
            )
            .orderBy(
              asc(R.year),
              sql`(${R.payload}->>'seconds72')::int asc nulls first`,
              asc(R.id),
            ),
          postgres_db
            .select({
              min: sql<number | null>`min(${R.year})`,
              max: sql<number | null>`max(${R.year})`,
            })
            .from(R)
            .where(and(eventsOf(data.worldId), sql`${R.year} >= 0`)),
          postgres_db
            .select({ id: R.id, name: R.name, payload: R.payload })
            .from(R)
            .where(and(W, eq(R.kind, 'historical_event_collection'), eq(R.type, 'battle'))),
          postgres_db
            .select({ id: R.id, year: R.year, payload: R.payload })
            .from(R)
            .where(and(eventsOf(data.worldId), eq(R.type, 'field battle'))),
        ])
        // Battles at a site borrow the site's coordinates.
        const siteIds = new Set<number>()
        for (const b of battleRows) {
          const p = b.payload as LegendsPayload
          const site = num(p.site_id)
          if (site !== null && site >= 0 && !parseCoords(p.coords)) siteIds.add(site)
        }
        const siteCoords = new Map<number, { x: number; y: number }>()
        if (siteIds.size) {
          const sites = await postgres_db
            .select({ id: R.id, coords: sql<string | null>`${R.payload}->>'coords'` })
            .from(R)
            .where(and(W, eq(R.kind, 'site'), inArray(R.id, [...siteIds])))
          for (const site of sites) {
            const at = parseCoords(site.coords)
            if (at) siteCoords.set(site.id, at)
          }
        }
        const battles: HistoryBattle[] = []
        for (const b of battleRows) {
          const p = b.payload as LegendsPayload
          const year = num(p.start_year)
          const site = num(p.site_id)
          const at = parseCoords(p.coords) ?? (site !== null ? siteCoords.get(site) : undefined)
          if (year === null || year < 0 || !at) continue
          battles.push({ id: b.id, name: b.name, year, ...at, casualties: squadDeaths(p) })
        }
        for (const f of fieldRows) {
          const at = parseCoords((f.payload as LegendsPayload).coords)
          if (f.year === null || !at) continue
          battles.push({ id: -f.id, name: null, year: f.year, ...at, casualties: 0 })
        }
        const changes: SiteChange[] = []
        for (const row of rows) {
          const p = row.payload as LegendsPayload
          const site = num(p.site_id)
          if (site === null || site < 0 || row.year === null) continue
          const civ = (key: string) => {
            const id = num(p[key])
            return id !== null && id >= 0 ? id : null
          }
          switch (row.type) {
            case 'created site':
              changes.push({
                site,
                year: row.year,
                state: 'founded',
                civ: civ('civ_id') ?? civ('site_civ_id'),
                from: null,
                event: row.id,
              })
              break
            case 'site taken over':
            case 'new site leader':
              changes.push({
                site,
                year: row.year,
                state: 'conquered',
                civ: civ('attacker_civ_id'),
                from: civ('defender_civ_id'),
                event: row.id,
              })
              break
            case 'hf destroyed site':
              changes.push({
                site,
                year: row.year,
                state: 'ruined',
                civ: null,
                from: civ('defender_civ_id'),
                event: row.id,
              })
              break
            case 'reclaim site':
              changes.push({
                site,
                year: row.year,
                state: 'reclaimed',
                civ: civ('civ_id'),
                from: null,
                event: row.id,
              })
              break
          }
        }
        const civIds = new Set<number>()
        for (const c of changes) {
          if (c.civ !== null) civIds.add(c.civ)
          if (c.from !== null) civIds.add(c.from)
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
        const y = yearRows[0]
        return {
          changes,
          battles,
          civs: Object.fromEntries(civRows.map((c) => [c.id, { name: c.name, race: c.race }])),
          years:
            y && y.min !== null && y.max !== null
              ? { min: Number(y.min), max: Number(y.max) }
              : null,
        }
      }),
  )

// ---------------------------------------------------------------------------
// What happened in a span of years

export interface SpanQuery {
  worldId: number
  from: number
  to: number
}

export interface SpanPerson {
  id: number
  name: string | null
  race: string | null
  raceToken: string | null
  birthYear: number | null
  deathYear: number | null
  events: number
}

export interface SpanWar {
  id: number
  name: string | null
  startYear: number | null
  endYear: number | null
  aggressor: { id: number; name: string | null } | null
  defender: { id: number; name: string | null } | null
}

export interface SpanBattle {
  id: number
  name: string | null
  year: number | null
  casualties: number
  outcome: string | null
  site: { id: number; name: string | null } | null
  attacker: { id: number; name: string | null } | null
  defender: { id: number; name: string | null } | null
}

export type PinKind = 'battle' | 'attack' | 'founded' | 'conquered' | 'ruined'

export interface SpanPin {
  x: number
  y: number
  year: number
  kind: PinKind
  label: string | null
}

export interface SpanDigest {
  from: number
  to: number
  /** Events per category key, plus `total`. */
  counts: Record<string, number>
  /** Sites founded, conquered, ruined; artifacts made; works written; figures who died. */
  tally: {
    founded: number
    conquered: number
    ruined: number
    artifacts: number
    works: number
    deaths: number
    battles: number
  }
  /** The events worth reading, in order. */
  moments: LegendsRecord[]
  battles: SpanBattle[]
  wars: SpanWar[]
  people: SpanPerson[]
  pins: SpanPin[]
  names: NameIndex
}

interface MomentType {
  weight: number
  /** Only considered for spans up to this many years, so long spans stay readable. */
  maxSpan: number
}

const MOMENT_TYPES: Record<string, MomentType> = {
  'hf destroyed site': { weight: 70, maxSpan: Number.POSITIVE_INFINITY },
  'site taken over': { weight: 60, maxSpan: Number.POSITIVE_INFINITY },
  'field battle': { weight: 50, maxSpan: Number.POSITIVE_INFINITY },
  'entity dissolved': { weight: 50, maxSpan: Number.POSITIVE_INFINITY },
  'peace accepted': { weight: 45, maxSpan: Number.POSITIVE_INFINITY },
  'attacked site': { weight: 40, maxSpan: Number.POSITIVE_INFINITY },
  'created site': { weight: 40, maxSpan: Number.POSITIVE_INFINITY },
  'entity created': { weight: 35, maxSpan: Number.POSITIVE_INFINITY },
  'hf performed horrible experiments': { weight: 30, maxSpan: Number.POSITIVE_INFINITY },
  'plundered site': { weight: 30, maxSpan: Number.POSITIVE_INFINITY },
  'new site leader': { weight: 30, maxSpan: Number.POSITIVE_INFINITY },
  'entity alliance formed': { weight: 25, maxSpan: Number.POSITIVE_INFINITY },
  'knowledge discovered': { weight: 25, maxSpan: 1000 },
  'hf revived': { weight: 25, maxSpan: 300 },
  'peace rejected': { weight: 22, maxSpan: 1000 },
  'artifact created': { weight: 20, maxSpan: 200 },
  'hf abducted': { weight: 15, maxSpan: 300 },
  'created structure': { weight: 12, maxSpan: 200 },
  'hf convicted': { weight: 12, maxSpan: 100 },
  'body abused': { weight: 10, maxSpan: 100 },
  'written content composed': { weight: 8, maxSpan: 50 },
  'item stolen': { weight: 6, maxSpan: 30 },
}

const MAX_MOMENTS = 60

function refOf(
  names: NameIndex,
  kind: string,
  id: unknown,
): { id: number; name: string | null } | null {
  return typeof id === 'number' && id >= 0 ? { id, name: names[kind]?.[id] ?? null } : null
}

function squadDeaths(p: LegendsPayload): number {
  const sum = (v: unknown) => numList(v).reduce((a, b) => a + b, 0)
  return sum(p.attacking_squad_deaths) + sum(p.defending_squad_deaths)
}

function parseCoords(s: unknown): { x: number; y: number } | null {
  if (typeof s !== 'string') return null
  const [x, y] = s.split(',').map((v) => Number.parseInt(v, 10))
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 ? { x, y } : null
}

export const getSpanDigest = createServerFn({ method: 'GET' })
  .inputValidator((input: SpanQuery) => input)
  .handler(async ({ data }): Promise<SpanDigest> => {
    const from = Math.max(0, Math.floor(Math.min(data.from, data.to)))
    const to = Math.max(from, Math.floor(Math.max(data.from, data.to)))
    const span = to - from + 1
    const E = eventsOf(data.worldId)
    const inSpan = and(E, sql`${R.year} between ${from} and ${to}`) as SQL
    const W = eq(R.world_id, data.worldId)

    const types = Object.entries(MOMENT_TYPES)
      .filter(([, m]) => span <= m.maxSpan)
      .map(([type]) => type)

    const [countRows, typed, deathRows, people, warRows, battleRows, figureCounts] =
      await Promise.all([
        postgres_db
          .select({ type: R.type, count: sql<number>`count(*)::int` })
          .from(R)
          .where(inSpan)
          .groupBy(R.type),
        postgres_db
          .select()
          .from(R)
          .where(and(inSpan, inArray(R.type, types)))
          .limit(4000),
        postgres_db
          .select({
            id: R.id,
            hf: sql<number | null>`(${R.payload}->>'hfid')::int`,
            slayer: sql<number | null>`(${R.payload}->>'slayer_hfid')::int`,
          })
          .from(R)
          .where(and(inSpan, eq(R.type, 'hf died'))),
        postgres_db.execute<{ hf: number; c: number }>(sql`
        select hf, count(*)::int as c
        from (select unnest(${R.hfids}) as hf from ${R} where ${inSpan}) s
        group by hf order by c desc limit 12
      `),
        postgres_db
          .select({ id: R.id, name: R.name, payload: R.payload })
          .from(R)
          .where(
            and(
              W,
              eq(R.kind, 'historical_event_collection'),
              eq(R.type, 'war'),
              sql`(${R.payload}->>'start_year')::int <= ${to}`,
              sql`((${R.payload}->>'end_year')::int >= ${from} or (${R.payload}->>'end_year')::int < 0)`,
            ),
          )
          .orderBy(asc(R.year)),
        postgres_db
          .select({ id: R.id, name: R.name, payload: R.payload })
          .from(R)
          .where(
            and(
              W,
              eq(R.kind, 'historical_event_collection'),
              eq(R.type, 'battle'),
              sql`(${R.payload}->>'start_year')::int between ${from} and ${to}`,
            ),
          ),
        figureEventCounts(data.worldId),
      ])

    // Deaths weigh by how much history the dead had; a famous slayer adds to it.
    const deaths = deathRows
      .map((row) => {
        const victim = row.hf !== null ? (figureCounts.get(Number(row.hf)) ?? 0) : 0
        const slayer = row.slayer !== null ? (figureCounts.get(Number(row.slayer)) ?? 0) : 0
        return { id: row.id, score: 10 + Math.min(60, victim / 5) + (slayer > 20 ? 15 : 0) }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, span <= 10 ? 30 : 20)
    const deathEvents = deaths.length
      ? await postgres_db
          .select()
          .from(R)
          .where(
            and(
              E,
              inArray(
                R.id,
                deaths.map((d) => d.id),
              ),
            ),
          )
      : []
    const deathScore = new Map(deaths.map((d) => [d.id, d.score]))

    const scored = [
      ...typed.map((event) => ({ event, score: MOMENT_TYPES[event.type ?? '']?.weight ?? 0 })),
      ...deathEvents.map((event) => ({ event, score: deathScore.get(event.id) ?? 10 })),
    ]
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_MOMENTS)
      .map((s) => s.event)
      .sort(
        (a, b) =>
          (a.year ?? 0) - (b.year ?? 0) ||
          (num((a.payload as LegendsPayload).seconds72) ?? 0) -
            (num((b.payload as LegendsPayload).seconds72) ?? 0) ||
          a.id - b.id,
      )

    const refs: RefSet = {}
    for (const event of scored) addRefs(refs, event.payload)
    for (const war of warRows) addRefs(refs, war.payload)
    for (const battle of battleRows) {
      const p = battle.payload as LegendsPayload
      addRef(refs, 'site', p.site_id)
      addRef(refs, 'entity', p.attacking_enid)
      addRef(refs, 'entity', p.defending_enid)
    }
    const peopleIds = [...people].map((row) => Number(row.hf))
    const peopleRecords = peopleIds.length
      ? await postgres_db
          .select({ id: R.id, name: R.name, type: R.type, payload: R.payload })
          .from(R)
          .where(and(W, eq(R.kind, 'historical_figure'), inArray(R.id, peopleIds)))
      : []
    const peopleById = new Map(peopleRecords.map((r) => [r.id, r]))

    // Pins: where things happened, for the map.
    const siteIds = new Set<number>()
    for (const event of scored) {
      const site = num((event.payload as LegendsPayload).site_id)
      if (site !== null && site >= 0) siteIds.add(site)
    }
    for (const battle of battleRows) {
      const site = num((battle.payload as LegendsPayload).site_id)
      if (site !== null && site >= 0) siteIds.add(site)
    }
    const siteRows = siteIds.size
      ? await postgres_db
          .select({ id: R.id, name: R.name, coords: sql<string | null>`${R.payload}->>'coords'` })
          .from(R)
          .where(and(W, eq(R.kind, 'site'), inArray(R.id, [...siteIds])))
      : []
    const siteAt = new Map(siteRows.map((s) => [s.id, { name: s.name, at: parseCoords(s.coords) }]))
    for (const s of siteRows) addRef(refs, 'site', s.id)

    const names = await lookupNames(data.worldId, refs)

    const pins: SpanPin[] = []
    const pinKind: Record<string, PinKind> = {
      'created site': 'founded',
      'site taken over': 'conquered',
      'new site leader': 'conquered',
      'hf destroyed site': 'ruined',
      'attacked site': 'attack',
      'plundered site': 'attack',
      'field battle': 'battle',
    }
    for (const event of scored) {
      const kind = pinKind[event.type ?? '']
      if (!kind || event.year === null) continue
      const p = event.payload as LegendsPayload
      const site = num(p.site_id)
      const place = site !== null ? siteAt.get(site) : undefined
      const at = place?.at ?? parseCoords(p.coords)
      if (at) pins.push({ ...at, year: event.year, kind, label: place?.name ?? null })
    }
    for (const battle of battleRows) {
      const p = battle.payload as LegendsPayload
      const site = num(p.site_id)
      const at = parseCoords(p.coords) ?? (site !== null ? siteAt.get(site)?.at : null)
      const year = num(p.start_year)
      if (at && year !== null) pins.push({ ...at, year, kind: 'battle', label: battle.name })
    }

    const counts: Record<string, number> = { total: 0 }
    for (const row of countRows) {
      const n = Number(row.count)
      counts.total += n
      const key = eventCategory(row.type)?.key ?? 'other'
      counts[key] = (counts[key] ?? 0) + n
    }
    const typeCount = (type: string) => Number(countRows.find((r) => r.type === type)?.count ?? 0)

    return {
      from,
      to,
      counts,
      tally: {
        founded: typeCount('created site'),
        conquered: typeCount('site taken over') + typeCount('new site leader'),
        ruined: typeCount('hf destroyed site'),
        artifacts: typeCount('artifact created'),
        works: typeCount('written content composed'),
        deaths: typeCount('hf died'),
        battles: battleRows.length + typeCount('field battle'),
      },
      moments: scored,
      battles: battleRows
        .map((battle) => {
          const p = battle.payload as LegendsPayload
          return {
            id: battle.id,
            name: battle.name,
            year: num(p.start_year),
            casualties: squadDeaths(p),
            outcome: str(p.outcome),
            site: refOf(names, 'site', p.site_id),
            attacker: refOf(names, 'entity', p.attacking_enid),
            defender: refOf(names, 'entity', p.defending_enid),
          }
        })
        .sort((a, b) => b.casualties - a.casualties),
      wars: warRows.map((war) => {
        const p = war.payload as LegendsPayload
        return {
          id: war.id,
          name: war.name,
          startYear: num(p.start_year),
          endYear: num(p.end_year),
          aggressor: refOf(names, 'entity', p.aggressor_ent_id),
          defender: refOf(names, 'entity', p.defender_ent_id),
        }
      }),
      people: [...people].map((row) => {
        const record = peopleById.get(Number(row.hf))
        const p = (record?.payload ?? {}) as LegendsPayload
        return {
          id: Number(row.hf),
          name: record?.name ?? null,
          race: str(plusOf(p).race) ?? (record?.type ? words(record.type) : null),
          raceToken: record?.type ?? str(p.race),
          birthYear: num(p.birth_year),
          deathYear: num(p.death_year),
          events: Number(row.c),
        }
      }),
      pins,
      names,
    }
  })

// ---------------------------------------------------------------------------
// Stories worth reading

export interface StoryRef {
  kind: string
  id: number
  name: string | null
  /** Creature token for the sprite, when the record is a figure or a group. */
  race?: string | null
}

export interface Story {
  key: string
  title: string
  blurb: string
  year: number | null
  refs: StoryRef[]
  /** Events to show as sentences, when the story is best told by them. */
  events?: LegendsRecord[]
  score: number
}

export interface StoryGroup {
  key: string
  title: string
  description: string
  stories: Story[]
}

export interface Stories {
  groups: StoryGroup[]
  names: NameIndex
}

const PLAIN_DEATHS = ['struck', 'murdered', 'old age', 'shot']

function curseFamily(token: string): { key: string; label: string } {
  if (token.startsWith('DEITY_CURSE_WEREBEAST')) {
    const animal = token
      .replace('DEITY_CURSE_WEREBEAST_', '')
      .replace(/_?\d+.*$/, '')
      .replace(/_/g, ' ')
    return { key: `were-${animal}`, label: `were${animal.replace(/\s+/g, '')} curse` }
  }
  if (token.startsWith('SECRET_ANIMATE')) return { key: 'necromancer', label: 'necromancy' }
  if (token.startsWith('SECRET_UNDEAD')) return { key: 'undead', label: 'undeath' }
  if (token.startsWith('SECRET_GHOUL')) return { key: 'ghoul', label: 'ghoulishness' }
  if (token.includes('VAMP')) return { key: 'vampire', label: 'vampirism' }
  if (token.startsWith('DEITY_MAJOR_CURSE')) return { key: 'divine', label: 'a divine curse' }
  if (token.startsWith('MYTHICAL')) return { key: 'mythical', label: 'a mythical power' }
  if (token.startsWith('REGIONAL')) return { key: 'regional', label: 'the land itself' }
  return { key: 'other', label: 'a strange power' }
}

function nameOr(names: NameIndex, kind: string, id: number, fallback: string): string {
  const name = names[kind]?.[id]
  return name ? titleCase(name) : fallback
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

export const getStories = createServerFn({ method: 'GET' })
  .inputValidator((input: { worldId: number }) => input)
  .handler(
    async ({ data }): Promise<Stories> =>
      remember(data.worldId, 'stories', async () => {
        const worldId = data.worldId
        const W = eq(R.world_id, worldId)
        const E = eventsOf(worldId)
        const refs: RefSet = {}
        const groups: StoryGroup[] = []

        const [
          battleRows,
          slayerRows,
          eaterRows,
          longLived,
          figureCounts,
          cursedRows,
          civRows,
          siteCivRows,
          lossRows,
          lastSeenRows,
          contestedRows,
          artifactRows,
          loverRows,
          grudgeRows,
          strangeRows,
          authorRows,
          warRows,
        ] = await Promise.all([
          postgres_db
            .select({ id: R.id, name: R.name, payload: R.payload })
            .from(R)
            .where(and(W, eq(R.kind, 'historical_event_collection'), eq(R.type, 'battle'))),
          postgres_db.execute<{ hf: number; c: number; first: number; last: number }>(sql`
          select (${R.payload}->>'slayer_hfid')::int as hf, count(*)::int as c, min(${R.year}) as first, max(${R.year}) as last
          from ${R} where ${E} and ${R.type} = 'hf died' and (${R.payload}->>'slayer_hfid')::int >= 0
          group by 1 order by c desc limit 8
        `),
          postgres_db.execute<{ hf: number; c: number; first: number; last: number }>(sql`
          select (${R.payload}->'plus'->>'eater')::int as hf, count(*)::int as c, min(${R.year}) as first, max(${R.year}) as last
          from ${R} where ${E} and ${R.type} = 'creature devoured' and (${R.payload}->'plus'->>'eater')::int >= 0
          group by 1 order by c desc limit 6
        `),
          postgres_db
            .select({ id: R.id, name: R.name, type: R.type, payload: R.payload })
            .from(R)
            .where(
              and(
                W,
                eq(R.kind, 'historical_figure'),
                sql`not (${R.payload} ? 'deity') and not (${R.payload} ? 'force')`,
                sql`(${R.payload}->>'birth_year')::int >= 0 and (${R.payload}->>'death_year')::int >= 0`,
              ),
            )
            .orderBy(
              desc(sql`(${R.payload}->>'death_year')::int - (${R.payload}->>'birth_year')::int`),
            )
            .limit(6),
          figureEventCounts(worldId),
          postgres_db
            .select({
              id: R.id,
              name: R.name,
              type: R.type,
              curses: sql<unknown>`${R.payload}->'active_interaction'`,
            })
            .from(R)
            .where(
              and(W, eq(R.kind, 'historical_figure'), sql`${R.payload} ? 'active_interaction'`),
            ),
          postgres_db
            .select({
              id: R.id,
              name: R.name,
              race: sql<string | null>`${R.payload}->'plus'->>'race'`,
            })
            .from(R)
            .where(
              and(W, eq(R.kind, 'entity'), sql`${R.payload}->'plus'->>'type' = 'civilization'`),
            ),
          postgres_db
            .select({
              civ: sql<number>`(${R.payload}->'plus'->>'civ_id')::int`,
              count: sql<number>`count(*)::int`,
            })
            .from(R)
            .where(and(W, eq(R.kind, 'site'), sql`(${R.payload}->'plus'->>'civ_id')::int >= 0`))
            .groupBy(sql`1`),
          postgres_db.execute<{ civ: number; c: number; last: number }>(sql`
          select (${R.payload}->>'defender_civ_id')::int as civ, count(*)::int as c, max(${R.year}) as last
          from ${R} where ${E} and ${R.type} in ('site taken over', 'hf destroyed site')
          group by 1
        `),
          postgres_db.execute<{ en: number; last: number }>(sql`
          select en, max(year) as last
          from (select unnest(${R.entity_ids}) as en, ${R.year} as year from ${R} where ${E}) s
          group by en
        `),
          postgres_db.execute<{ site: number; c: number; first: number; last: number }>(sql`
          select (${R.payload}->>'site_id')::int as site, count(*)::int as c, min(${R.year}) as first, max(${R.year}) as last
          from ${R}
          where ${E} and ${R.type} in ('site taken over', 'attacked site', 'hf destroyed site', 'plundered site', 'new site leader')
            and (${R.payload}->>'site_id')::int >= 0
          group by 1 order by c desc limit 6
        `),
          postgres_db.execute<{ a: number; c: number; first: number }>(sql`
          select a, count(*)::int as c, min(year) as first
          from (select unnest(${R.artifact_ids}) as a, ${R.year} as year from ${R} where ${E}) s
          group by a order by c desc limit 8
        `),
          postgres_db.execute<{ hf: number; c: number }>(sql`
          select (${R.payload}->'plus'->>'source_hf')::int as hf, count(*)::int as c
          from ${R}
          where ${W} and ${R.kind} = 'historical_event_relationship'
            and ${R.payload}->'plus'->>'relationship' in ('lover', 'former_lover')
          group by 1 order by c desc limit 5
        `),
          postgres_db.execute<{
            source: number
            target: number
            relationship: string
            year: number | null
          }>(sql`
          select (${R.payload}->'plus'->>'source_hf')::int as source, (${R.payload}->'plus'->>'target_hf')::int as target,
                 ${R.payload}->'plus'->>'relationship' as relationship, (${R.payload}->'plus'->>'year')::int as year
          from ${R}
          where ${W} and ${R.kind} = 'historical_event_relationship'
            and ${R.payload}->'plus'->>'relationship' in ('grudge', 'jealous_obsession', 'religious_persecution_grudge')
          order by year asc limit 6
        `),
          postgres_db
            .select()
            .from(R)
            .where(
              and(
                E,
                eq(R.type, 'hf died'),
                sql`${R.payload} ? 'cause'`,
                sql`not (${R.payload}->>'cause' = any(${sql`array[${sql.join(
                  PLAIN_DEATHS.map((c) => sql`${c}`),
                  sql`, `,
                )}]::text[]`}))`,
              ),
            )
            .orderBy(asc(R.year))
            .limit(10),
          postgres_db.execute<{ hf: number; c: number }>(sql`
          select (${R.payload}->>'author_hfid')::int as hf, count(*)::int as c
          from ${R} where ${W} and ${R.kind} = 'written_content' and (${R.payload}->>'author_hfid')::int >= 0
          group by 1 order by c desc limit 6
        `),
          postgres_db
            .select({
              id: R.id,
              aggressor: sql<number | null>`(${R.payload}->>'aggressor_ent_id')::int`,
              defender: sql<number | null>`(${R.payload}->>'defender_ent_id')::int`,
            })
            .from(R)
            .where(and(W, eq(R.kind, 'historical_event_collection'), eq(R.type, 'war'))),
        ])

        // Battles name no civilizations; the war they belong to does.
        const wars = new Map(warRows.map((w) => [w.id, w]))
        const battleSides = (p: LegendsPayload) => {
          const war = wars.get(num(p.war_eventcol) ?? -1)
          const attacker = num(p.attacking_enid) ?? war?.aggressor ?? null
          const defender = num(p.defending_enid) ?? war?.defender ?? null
          return {
            attacker: attacker !== null && attacker >= 0 ? attacker : null,
            defender: defender !== null && defender >= 0 ? defender : null,
          }
        }

        // Everyone and everything the stories will name.
        for (const b of battleRows) {
          const p = b.payload as LegendsPayload
          const sides = battleSides(p)
          addRef(refs, 'site', p.site_id)
          addRef(refs, 'entity', sides.attacker)
          addRef(refs, 'entity', sides.defender)
        }
        for (const row of [...slayerRows, ...eaterRows, ...loverRows, ...authorRows])
          addRef(refs, 'historical_figure', Number(row.hf))
        for (const row of grudgeRows) {
          addRef(refs, 'historical_figure', Number(row.source))
          addRef(refs, 'historical_figure', Number(row.target))
        }
        for (const row of contestedRows) addRef(refs, 'site', Number(row.site))
        for (const row of artifactRows) addRef(refs, 'artifact', Number(row.a))
        for (const event of strangeRows) addRefs(refs, event.payload)
        const eventful = [...figureCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
        for (const [hf] of eventful) addRef(refs, 'historical_figure', hf)

        // Cursed: group by curse family, keep the most storied of each.
        const families = new Map<
          string,
          {
            label: string
            count: number
            members: { id: number; name: string | null; events: number }[]
          }
        >()
        for (const row of cursedRows) {
          const tokens = Array.isArray(row.curses) ? row.curses.map(String) : []
          const seen = new Set<string>()
          for (const token of tokens) {
            const family = curseFamily(token)
            if (seen.has(family.key)) continue
            seen.add(family.key)
            const entry = families.get(family.key) ?? { label: family.label, count: 0, members: [] }
            entry.count++
            entry.members.push({
              id: row.id,
              name: row.name,
              events: figureCounts.get(row.id) ?? 0,
            })
            families.set(family.key, entry)
          }
        }
        for (const family of families.values()) {
          family.members.sort((a, b) => b.events - a.events)
          family.members = family.members.slice(0, 3)
          for (const member of family.members) addRef(refs, 'historical_figure', member.id)
        }

        const names = await lookupNames(worldId, refs)
        const figureRecords = await postgres_db
          .select({ id: R.id, name: R.name, type: R.type, payload: R.payload })
          .from(R)
          .where(
            and(
              W,
              eq(R.kind, 'historical_figure'),
              inArray(R.id, [...new Set([...(refs.historical_figure ?? [])])].slice(0, 500)),
            ),
          )
        const figure = new Map(figureRecords.map((r) => [r.id, r]))
        const raceOf = (id: number) => {
          const r = figure.get(id)
          const p = (r?.payload ?? {}) as LegendsPayload
          return str(plusOf(p).race) ?? (r?.type ? words(r.type) : null)
        }
        const life = (id: number) => {
          const p = (figure.get(id)?.payload ?? {}) as LegendsPayload
          const birth = num(p.birth_year)
          const death = num(p.death_year)
          if (birth === null || birth < 0)
            return death !== null && death >= 0 ? `died ${death}` : ''
          return death !== null && death >= 0 ? `${birth}–${death}` : `born ${birth}, still alive`
        }
        const hfRef = (id: number): StoryRef => ({
          kind: 'historical_figure',
          id,
          name: names.historical_figure?.[id] ?? null,
          race: figure.get(id)?.type ?? null,
        })
        const hfName = (id: number) =>
          nameOr(
            names,
            'historical_figure',
            id,
            raceOf(id) ? `an unnamed ${raceOf(id)}` : 'someone',
          )

        // Great battles.
        const battles = battleRows
          .map((b) => ({
            b,
            p: b.payload as LegendsPayload,
            deaths: squadDeaths(b.payload as LegendsPayload),
          }))
          .filter((x) => x.deaths > 0)
          .sort((a, b) => b.deaths - a.deaths)
          .slice(0, 8)
        groups.push({
          key: 'battles',
          title: 'Great battles',
          description: 'Where the most fell.',
          stories: battles.map(({ b, p, deaths }) => {
            const { attacker, defender } = battleSides(p)
            const site = num(p.site_id)
            const year = num(p.start_year)
            const races = (key: 'attacking_squad_race' | 'defending_squad_race') => {
              const raw = p[key]
              const tokens = Array.isArray(raw) ? [...new Set(raw.map(String))] : []
              return tokens.length
                ? list(tokens.slice(0, 3).map((t) => `${words(t)}s`)) +
                    (tokens.length > 3 ? ' and others' : '')
                : null
            }
            const side = (
              id: number | null,
              key: 'attacking_squad_race' | 'defending_squad_race',
              fallback: string,
            ) => (id !== null ? nameOr(names, 'entity', id, fallback) : (races(key) ?? fallback))
            return {
              key: `battle-${b.id}`,
              title: b.name ? titleCase(b.name) : `Battle #${b.id}`,
              blurb: `${sentence(side(attacker, 'attacking_squad_race', 'unknown forces'))} fell upon ${side(defender, 'defending_squad_race', 'unknown defenders')}${site !== null && site >= 0 ? ` at ${nameOr(names, 'site', site, 'an unnamed site')}` : ''}${year !== null ? ` in ${year}` : ''}. ${plural(deaths, 'soldier')} fell${str(p.outcome) ? `; ${str(p.outcome)}` : ''}.`,
              year,
              refs: [
                { kind: 'historical_event_collection', id: b.id, name: b.name },
                ...(site !== null && site >= 0
                  ? [{ kind: 'site', id: site, name: names.site?.[site] ?? null }]
                  : []),
                ...[attacker, defender]
                  .filter((id): id is number => id !== null)
                  .map((id) => ({ kind: 'entity', id, name: names.entity?.[id] ?? null })),
              ],
              score: deaths,
            }
          }),
        })

        // Monsters and slayers.
        const slayerStories: Story[] = [...slayerRows].map((row) => {
          const id = Number(row.hf)
          return {
            key: `slayer-${id}`,
            title: hfName(id),
            blurb: `${raceOf(id) ? `A ${raceOf(id)}. ` : ''}${plural(Number(row.c), 'recorded kill')} between ${row.first} and ${row.last}.${life(id) ? ` ${sentence(life(id))}.` : ''}`,
            year: Number(row.first),
            refs: [hfRef(id)],
            score: Number(row.c),
          }
        })
        const eaterStories: Story[] = [...eaterRows]
          .filter((row) => !slayerRows.some((s) => Number(s.hf) === Number(row.hf)))
          .map((row) => {
            const id = Number(row.hf)
            return {
              key: `eater-${id}`,
              title: hfName(id),
              blurb: `${raceOf(id) ? `A ${raceOf(id)} that ` : 'A beast that '}devoured ${plural(Number(row.c), 'creature')} between ${row.first} and ${row.last}.`,
              year: Number(row.first),
              refs: [hfRef(id)],
              score: Number(row.c) / 4,
            }
          })
        groups.push({
          key: 'slayers',
          title: 'Monsters and slayers',
          description: 'The deadliest names in the records.',
          stories: [...slayerStories, ...eaterStories]
            .sort((a, b) => b.score - a.score)
            .slice(0, 10),
        })

        // Lives worth reading.
        const lives: Story[] = eventful.map(([id, count]) => ({
          key: `eventful-${id}`,
          title: hfName(id),
          blurb: `${raceOf(id) ? `${titleCase(raceOf(id) ?? '')}` : 'Figure'}${life(id) ? `, ${life(id)}` : ''}. Named in ${plural(count, 'event')}.`,
          year: num((figure.get(id)?.payload as LegendsPayload | undefined)?.birth_year),
          refs: [hfRef(id)],
          score: count,
        }))
        for (const row of longLived) {
          const p = row.payload as LegendsPayload
          const birth = num(p.birth_year) ?? 0
          const death = num(p.death_year) ?? 0
          const race = str(plusOf(p).race) ?? words(row.type)
          lives.push({
            key: `longlived-${row.id}`,
            title: row.name ? titleCase(row.name) : `An unnamed ${race}`,
            blurb: `${titleCase(race)} who lived ${death - birth} years, from ${birth} to ${death}.`,
            year: birth,
            refs: [{ kind: 'historical_figure', id: row.id, name: row.name, race: row.type }],
            score: death - birth,
          })
        }
        groups.push({
          key: 'lives',
          title: 'Lives worth reading',
          description: 'The most storied and the longest-lived.',
          stories: lives,
        })

        // The cursed.
        const cursed: Story[] = [...families.entries()]
          .sort((a, b) => b[1].count - a[1].count)
          .map(([key, family]) => {
            const lead = family.members[0]
            return {
              key: `curse-${key}`,
              title: `${titleCase(family.label)}`,
              blurb: `${plural(family.count, 'soul')} carry ${family.label}${lead ? `; the most storied is ${lead.name ? titleCase(lead.name) : 'an unnamed one'}, named in ${plural(lead.events, 'event')}` : ''}.`,
              year: null,
              refs: family.members.map((m) => hfRef(m.id)),
              score: family.count,
            }
          })
        groups.push({
          key: 'cursed',
          title: 'The cursed',
          description: 'Werebeasts, necromancers and the undead.',
          stories: cursed,
        })

        // Fallen civilizations.
        const held = new Map(siteCivRows.map((r) => [Number(r.civ), Number(r.count)]))
        const losses = new Map(
          [...lossRows].map((r) => [Number(r.civ), { c: Number(r.c), last: Number(r.last) }]),
        )
        const lastSeen = new Map([...lastSeenRows].map((r) => [Number(r.en), Number(r.last)]))
        // Named peoples first: the unnamed are mostly animal-folk bands with no story to tell.
        const fallen: Story[] = civRows
          .filter((civ) => !held.get(civ.id))
          .map((civ) => {
            const loss = losses.get(civ.id)
            const last = lastSeen.get(civ.id) ?? null
            return {
              key: `fallen-${civ.id}`,
              title: civ.name
                ? titleCase(civ.name)
                : `An unnamed ${civ.race ? `${words(civ.race)} ` : ''}people`,
              blurb: `${civ.race ? `A civilization of ${racePlural(civ.race)}. ` : ''}Holds no sites today${loss ? `; lost ${plural(loss.c, 'site')} to conquest or ruin, the last in ${loss.last}` : ''}.${last !== null ? ` Last heard of in ${last}.` : ''}`,
              year: last,
              refs: [{ kind: 'entity', id: civ.id, name: civ.name, race: raceToken(civ.race) }],
              score: (civ.name ? 1000 : 0) + (loss?.c ?? 0) * 10 + (last ?? 0) / 1000,
            }
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, 8)
        groups.push({
          key: 'fallen',
          title: 'Fallen civilizations',
          description: 'Peoples who hold nothing now.',
          stories: fallen,
        })

        // Contested sites.
        groups.push({
          key: 'contested',
          title: 'Contested ground',
          description: 'Sites attacked and taken again and again.',
          stories: [...contestedRows].map((row) => {
            const id = Number(row.site)
            return {
              key: `contested-${id}`,
              title: nameOr(names, 'site', id, `Site #${id}`),
              blurb: `Fought over ${plural(Number(row.c), 'time')} between ${row.first} and ${row.last}.`,
              year: Number(row.first),
              refs: [{ kind: 'site', id, name: names.site?.[id] ?? null }],
              score: Number(row.c),
            }
          }),
        })

        // Legendary artifacts.
        const artifactIds = [...artifactRows].map((r) => Number(r.a))
        const artifactHits: LegendsHit[] = artifactIds.length
          ? await describeRows(
              worldId,
              await postgres_db
                .select({
                  kind: R.kind,
                  id: R.id,
                  name: R.name,
                  type: R.type,
                  year: R.year,
                  payload: R.payload,
                })
                .from(R)
                .where(and(W, eq(R.kind, 'artifact'), inArray(R.id, artifactIds))),
            )
          : []
        const artifactById = new Map(artifactHits.map((h) => [h.id, h]))
        groups.push({
          key: 'artifacts',
          title: 'Legendary artifacts',
          description: 'Made, stolen, lost and found.',
          stories: [...artifactRows].map((row) => {
            const id = Number(row.a)
            const hit = artifactById.get(id)
            return {
              key: `artifact-${id}`,
              title: nameOr(names, 'artifact', id, `Artifact #${id}`),
              blurb: `${hit?.detail ? `${titleCase(hit.detail.charAt(0)) + hit.detail.slice(1)}. ` : ''}Named in ${plural(Number(row.c), 'event')} since ${row.first}.`,
              year: Number(row.first),
              refs: [{ kind: 'artifact', id, name: names.artifact?.[id] ?? null }],
              score: Number(row.c),
            }
          }),
        })

        // Loves and feuds.
        const hearts: Story[] = [...loverRows].map((row) => {
          const id = Number(row.hf)
          return {
            key: `lover-${id}`,
            title: hfName(id),
            blurb: `${raceOf(id) ? `${titleCase(raceOf(id) ?? '')}${life(id) ? `, ${life(id)}` : ''}. ` : ''}Took ${plural(Number(row.c), 'lover')} over a lifetime.`,
            year: null,
            refs: [hfRef(id)],
            score: Number(row.c),
          }
        })
        for (const row of grudgeRows) {
          const source = Number(row.source)
          const target = Number(row.target)
          hearts.push({
            key: `grudge-${source}-${target}`,
            title: `${hfName(source)} and ${hfName(target)}`,
            blurb: `${hfName(source)} formed ${words(row.relationship).replace('grudge', 'a grudge').replace('jealous obsession', 'a jealous obsession')} against ${hfName(target)}${row.year !== null ? ` in ${row.year}` : ''}.`,
            year: row.year,
            refs: [hfRef(source), hfRef(target)],
            score: 1,
          })
        }
        groups.push({
          key: 'hearts',
          title: 'Loves and feuds',
          description: 'Hearts given, and grudges kept.',
          stories: hearts,
        })

        // Strange ends.
        groups.push({
          key: 'ends',
          title: 'Strange ends',
          description: 'Deaths the chroniclers thought worth a word.',
          stories: strangeRows.length
            ? [
                {
                  key: 'strange-ends',
                  title: `${plural(strangeRows.length, 'unusual death')}`,
                  blurb: 'Executions, drownings and burnings, as the records tell them.',
                  year: strangeRows[0]?.year ?? null,
                  refs: [],
                  events: strangeRows,
                  score: strangeRows.length,
                },
              ]
            : [],
        })

        // Prolific authors.
        groups.push({
          key: 'authors',
          title: 'Written words',
          description: 'Those who wrote the most.',
          stories: [...authorRows].map((row) => {
            const id = Number(row.hf)
            return {
              key: `author-${id}`,
              title: hfName(id),
              blurb: `${raceOf(id) ? `${titleCase(raceOf(id) ?? '')}${life(id) ? `, ${life(id)}` : ''}. ` : ''}Wrote ${plural(Number(row.c), 'work')}.`,
              year: null,
              refs: [hfRef(id)],
              score: Number(row.c),
            }
          }),
        })

        return { groups: groups.filter((g) => g.stories.length), names }
      }),
  )

// ---------------------------------------------------------------------------
// Searching events

export interface EventSearchQuery {
  worldId: number
  from?: number
  to?: number
  /** Category keys from EVENT_CATEGORIES. */
  categories?: string[]
  hfid?: number
  entityId?: number
  siteId?: number
  artifactId?: number
  page?: number
  pageSize?: number
  order?: 'asc' | 'desc'
}

export interface EventSearchResult {
  events: LegendsRecord[]
  total: number
  page: number
  pageSize: number
  names: NameIndex
  /** Category key -> count for the same filters without the category filter. */
  byCategory: Record<string, number>
}

export const searchEvents = createServerFn({ method: 'GET' })
  .inputValidator((input: EventSearchQuery) => input)
  .handler(async ({ data }): Promise<EventSearchResult> => {
    const pageSize = Math.min(Math.max(data.pageSize ?? 50, 10), 200)
    const page = Math.max(data.page ?? 0, 0)
    const base: SQL[] = [eventsOf(data.worldId), sql`${R.year} >= 0`]
    if (data.from !== undefined) base.push(sql`${R.year} >= ${Math.floor(data.from)}`)
    if (data.to !== undefined) base.push(sql`${R.year} <= ${Math.floor(data.to)}`)
    if (data.hfid !== undefined) base.push(sql`${R.hfids} @> array[${data.hfid}]::int[]`)
    if (data.entityId !== undefined)
      base.push(sql`${R.entity_ids} @> array[${data.entityId}]::int[]`)
    if (data.siteId !== undefined) base.push(sql`${R.site_ids} @> array[${data.siteId}]::int[]`)
    if (data.artifactId !== undefined)
      base.push(sql`${R.artifact_ids} @> array[${data.artifactId}]::int[]`)
    const scope = and(...base) as SQL
    const types = (data.categories ?? []).flatMap(
      (key) => EVENT_CATEGORIES.find((c) => c.key === key)?.types ?? [],
    )
    const where = types.length ? (and(scope, inArray(R.type, types)) as SQL) : scope
    const order = data.order === 'desc' ? 'desc' : 'asc'
    const seconds = sql`(${R.payload}->>'seconds72')::int`
    const [countRows, byTypeRows, events] = await Promise.all([
      postgres_db.select({ count: sql<number>`count(*)::int` }).from(R).where(where),
      postgres_db
        .select({ type: R.type, count: sql<number>`count(*)::int` })
        .from(R)
        .where(scope)
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
    for (const event of events) addRefs(refs, event.payload)
    const names = await lookupNames(data.worldId, refs)
    const byCategory: Record<string, number> = {}
    for (const row of byTypeRows) {
      const key = eventCategory(row.type)?.key ?? 'other'
      byCategory[key] = (byCategory[key] ?? 0) + Number(row.count)
    }
    return { events, total: countRows[0]?.count ?? 0, page, pageSize, names, byCategory }
  })

// ---------------------------------------------------------------------------
// Jumping to a record by name

const QUICK_KIND_ORDER = [
  'historical_figure',
  'site',
  'entity',
  'artifact',
  'historical_event_collection',
  'region',
  'written_content',
]

export const quickSearch = createServerFn({ method: 'GET' })
  .inputValidator(
    (input: { worldId: number; q: string; kinds?: string[]; limit?: number }) => input,
  )
  .handler(async ({ data }): Promise<LegendsHit[]> => {
    const q = data.q.trim()
    if (q.length < 2) return []
    const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`
    const conditions: SQL[] = [
      eq(R.world_id, data.worldId),
      sql`${R.kind} <> 'historical_event'`,
      isNotNull(R.name),
      ilike(R.name, like),
    ]
    if (data.kinds?.length) conditions.push(inArray(R.kind, data.kinds))
    const kindOrder = sql`case ${R.kind} ${sql.join(
      QUICK_KIND_ORDER.map((k, i) => sql`when ${k} then ${i}`),
      sql` `,
    )} else 9 end`
    const rows = await postgres_db
      .select({
        kind: R.kind,
        id: R.id,
        name: R.name,
        type: R.type,
        year: R.year,
        payload: R.payload,
      })
      .from(R)
      .where(and(...conditions))
      .orderBy(
        sql`case when lower(${R.name}) = lower(${q}) then 0 when lower(${R.name}) like lower(${`${q}%`}) then 1 else 2 end`,
        kindOrder,
        asc(R.name),
      )
      .limit(Math.min(data.limit ?? 12, 50))
    return describeRows(data.worldId, rows)
  })
