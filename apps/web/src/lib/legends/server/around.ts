import { type LegendsPayload, postgres_db, schema } from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { and, eq, inArray, or, sql } from 'drizzle-orm'

import { num, objList, str } from '../events'
import { words } from '../model'
import type { Prose } from '../prose'
import type { NameIndex } from '../types'
import { curseFamily } from './chronicle'
import { lifeLines } from './lives'
import { recordEndYear, remember } from './memo'
import { type RefSet, addRef, lookupNames } from './records'

/*
 * What lives around the fortress as of the export: the great beasts, night
 * creatures and cursed figures still alive, where they lair, and the sites
 * nearby. Distances are in world-map squares between site coordinates; a
 * beast without a recorded place has none.
 */

const R = schema.legends_records

export type BeastKind = 'great' | 'night' | 'cursed'

export interface AroundBeast {
  id: number
  name: string | null
  kind: BeastKind
  /** "dragon", "forgotten beast", "vampire". */
  what: string
  line: Prose
  kills: number
  /** The site they lair or live in, when the record names one. */
  place: { id: number; name: string | null; type: string | null; link: string } | null
  distance: number | null
}

export interface AroundSite {
  id: number
  name: string | null
  type: string | null
  distance: number
  civ: number | null
  /** The holder is at war with your civilization when the records close. */
  atWar: boolean
  ours: boolean
}

export interface AroundFortress {
  /** Your site, when this world has it and it has coordinates. */
  home: { id: number; name: string | null } | null
  beasts: Record<BeastKind, AroundBeast[]>
  /** Living beasts of each kind before the cap. */
  totals: Record<BeastKind, number>
  neighbours: AroundSite[]
  /** Lairs, towers, vaults, dark fortresses and the like. */
  dangers: AroundSite[]
  names: NameIndex
  endYear: number | null
}

/** Places where something waits, as opposed to the sites people hold. */
const DANGER_TYPES = new Set([
  'shrine',
  'tower',
  'vault',
  'dark fortress',
  'dark pits',
  'labyrinth',
  'mysterious lair',
  'mysterious dungeon',
  'mysterious palace',
])
const RADIUS = 24
const SHOWN_NEIGHBOURS = 12
const SHOWN_DANGERS = 10
const SHOWN_BEASTS = 40
const CURSES = new Set(['vampire', 'necromancer', 'undead', 'ghoul'])

/** A figure can carry several curses; the most telling one names them. */
function curseRank(key: string): number {
  if (key === 'vampire') return 0
  if (key === 'necromancer') return 1
  if (key.startsWith('were-')) return 2
  if (key === 'ghoul') return 3
  return 4
}

function parseCoord(s: unknown): { x: number; y: number } | null {
  if (typeof s !== 'string') return null
  const [x, y] = s.split(',').map((v) => Number.parseInt(v, 10))
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 ? { x, y } : null
}

interface CreatureKind {
  great: boolean
  night: boolean
  label: string | null
}

/** Each creature token's standing: a great beast, a night creature, or neither. */
function creatureKinds(worldId: number): Promise<Map<string, CreatureKind>> {
  return remember(worldId, 'creature-kinds', async () => {
    const rows = await postgres_db.execute<{
      token: string | null
      singular: string | null
      mega: boolean | null
      semi: boolean | null
      titan: boolean | null
      feature: boolean | null
      demon: boolean | null
      night: boolean | null
    }>(sql`
      select ${R.payload}->'plus'->>'creature_id' as token,
        ${R.payload}->'plus'->>'name_singular' as singular,
        (${R.payload}->'plus'->>'has_any_megabeast')::boolean as mega,
        (${R.payload}->'plus'->>'has_any_semimegabeast')::boolean as semi,
        (${R.payload}->'plus'->>'has_any_titan')::boolean as titan,
        (${R.payload}->'plus'->>'has_any_feature_beast')::boolean as feature,
        (${R.payload}->'plus'->>'has_any_demon')::boolean as demon,
        (${R.payload}->'plus'->>'has_any_night_creature')::boolean as night
      from ${R} where ${R.world_id} = ${worldId} and ${R.kind} = 'creature'`)
    const out = new Map<string, CreatureKind>()
    for (const r of rows) {
      if (!r.token) continue
      const great = !!(r.mega || r.semi || r.titan || r.feature || r.demon)
      out.set(r.token.toUpperCase(), {
        great,
        night: !great && !!r.night,
        label: r.feature
          ? 'forgotten beast'
          : r.titan
            ? 'titan'
            : r.demon && r.singular && !/demon/i.test(r.singular)
              ? `${r.singular}, a demon`
              : (r.singular ?? null),
      })
    }
    return out
  })
}

/** When legends_plus is missing: the raw tokens the game gives these creatures. */
function kindFromToken(token: string): CreatureKind | null {
  if (token.startsWith('FORGOTTEN_BEAST'))
    return { great: true, night: false, label: 'forgotten beast' }
  if (token.startsWith('TITAN')) return { great: true, night: false, label: 'titan' }
  if (token.startsWith('DEMON')) return { great: true, night: false, label: 'demon' }
  if (token.startsWith('NIGHT_CREATURE'))
    return { great: false, night: true, label: 'night creature' }
  if (['DRAGON', 'HYDRA', 'BIRD_ROC', 'COLOSSUS_BRONZE'].includes(token))
    return { great: true, night: false, label: words(token.replace('BIRD_', '')) }
  if (['GIANT', 'ETTIN', 'CYCLOPS', 'MINOTAUR'].includes(token))
    return { great: true, night: false, label: words(token) }
  return null
}

const PLACE_ORDER = ['lair', 'home structure', 'seat of power', 'occupation']

async function aroundFortress(
  worldId: number,
  siteId: number | null,
  civId: number | null,
): Promise<AroundFortress> {
  return remember(worldId, `around:${siteId ?? '-'}:${civId ?? '-'}`, async () => {
    const W = eq(R.world_id, worldId)
    const [kinds, sites, endYear, wars] = await Promise.all([
      creatureKinds(worldId),
      postgres_db
        .select({
          id: R.id,
          name: R.name,
          type: sql<string | null>`${R.payload}->>'type'`,
          coords: sql<string | null>`${R.payload}->>'coords'`,
          civ: sql<number | null>`(${R.payload}->'plus'->>'civ_id')::int`,
        })
        .from(R)
        .where(and(W, eq(R.kind, 'site'))),
      recordEndYear(worldId),
      civId !== null
        ? postgres_db.execute<{ a: number | null; d: number | null }>(sql`
            select (${R.payload}->>'aggressor_ent_id')::int as a, (${R.payload}->>'defender_ent_id')::int as d
            from ${R} where ${W} and ${R.kind} = 'historical_event_collection' and ${R.type} = 'war'
              and coalesce((${R.payload}->>'end_year')::int, -1) < 0
              and ${civId} in ((${R.payload}->>'aggressor_ent_id')::int, (${R.payload}->>'defender_ent_id')::int)`)
        : Promise.resolve([]),
    ])
    const foes = new Set<number>()
    for (const w of wars) {
      const other = Number(w.a) === civId ? w.d : w.a
      if (other !== null) foes.add(Number(other))
    }
    const siteById = new Map(sites.map((s) => [s.id, { ...s, at: parseCoord(s.coords) }]))
    const homeSite = siteId !== null ? siteById.get(siteId) : undefined
    const homeAt = homeSite?.at ?? null
    const distanceTo = (id: number) => {
      const at = siteById.get(id)?.at
      if (!homeAt || !at) return null
      return Math.round(Math.hypot(at.x - homeAt.x, at.y - homeAt.y))
    }

    const tokens = [...kinds.entries()].filter(([, k]) => k.great || k.night).map(([t]) => t)
    const figures = await postgres_db
      .select({
        id: R.id,
        name: R.name,
        type: R.type,
        links: sql<unknown>`${R.payload}->'site_link'`,
        curses: sql<unknown>`${R.payload}->'active_interaction'`,
      })
      .from(R)
      .where(
        and(
          W,
          eq(R.kind, 'historical_figure'),
          sql`coalesce((${R.payload}->>'death_year')::int, -1) < 0`,
          sql`coalesce((${R.payload}->>'deity')::boolean, false) = false`,
          sql`coalesce((${R.payload}->>'force')::boolean, false) = false`,
          or(
            tokens.length ? inArray(R.type, tokens) : undefined,
            sql`${R.type} ~ '^(FORGOTTEN_BEAST|TITAN|NIGHT_CREATURE|DEMON)_'`,
            sql`${R.payload} ? 'active_interaction'`,
          ),
        ),
      )

    const found: Omit<AroundBeast, 'line' | 'kills'>[] = []
    for (const f of figures) {
      const token = (f.type ?? '').toUpperCase()
      const known = kinds.get(token) ?? kindFromToken(token)
      const curseTokens = (Array.isArray(f.curses) ? f.curses : f.curses ? [f.curses] : []).map(
        String,
      )
      const curse = curseTokens
        .map(curseFamily)
        .filter((c) => CURSES.has(c.key) || c.key.startsWith('were-'))
        .sort((a, b) => curseRank(a.key) - curseRank(b.key))[0]
      const kind: BeastKind | null = known?.great
        ? 'great'
        : known?.night
          ? 'night'
          : curse
            ? 'cursed'
            : null
      if (!kind) continue
      const links = objList(f.links)
        .map((l) => ({ site: num(l.site_id), link: str(l.link_type) ?? 'linked' }))
        .filter((l): l is { site: number; link: string } => l.site !== null && l.site >= 0)
        .sort((a, b) => PLACE_ORDER.indexOf(a.link) - PLACE_ORDER.indexOf(b.link))
      const where = links[0]
      const site = where ? siteById.get(where.site) : undefined
      const curseWhat =
        curse?.key === 'vampire'
          ? 'vampire'
          : curse?.key === 'necromancer'
            ? 'necromancer'
            : curse?.key.startsWith('were-')
              ? `were${curse.key.slice(5).replace(/\s+/g, '')}`
              : curse
                ? curse.label
                : null
      found.push({
        id: f.id,
        name: f.name,
        kind,
        what:
          kind === 'cursed'
            ? [words(known?.label ?? f.type ?? ''), curseWhat].filter(Boolean).join(' ')
            : (known?.label ?? words(token)),
        place: where
          ? { id: where.site, name: site?.name ?? null, type: site?.type ?? null, link: where.link }
          : null,
        distance: where ? distanceTo(where.site) : null,
      })
    }

    const byNear = (a: { distance: number | null }, b: { distance: number | null }) =>
      (a.distance ?? Number.MAX_SAFE_INTEGER) - (b.distance ?? Number.MAX_SAFE_INTEGER)
    const ids = found.map((b) => b.id)
    const idArray = sql`array[${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )}]::int[]`
    const killRows = ids.length
      ? await postgres_db.execute<{ hf: number; c: number }>(sql`
          select (${R.payload}->>'slayer_hfid')::int as hf, count(*)::int as c
          from ${R} where ${W} and ${R.kind} = 'historical_event' and ${R.type} = 'hf died'
            and ${R.hfids} && ${idArray}
            and (${R.payload}->>'slayer_hfid')::int = any(${idArray})
          group by 1`)
      : []
    const kills = new Map([...killRows].map((r) => [Number(r.hf), Number(r.c)]))
    const grouped: Record<BeastKind, Omit<AroundBeast, 'line'>[]> = {
      great: [],
      night: [],
      cursed: [],
    }
    for (const b of found) grouped[b.kind].push({ ...b, kills: kills.get(b.id) ?? 0 })
    const totals = {
      great: grouped.great.length,
      night: grouped.night.length,
      cursed: grouped.cursed.length,
    }
    for (const k of Object.keys(grouped) as BeastKind[])
      grouped[k] = grouped[k]
        .sort((a, b) => byNear(a, b) || b.kills - a.kills || a.id - b.id)
        .slice(0, SHOWN_BEASTS)
    const shown = [...grouped.great, ...grouped.night, ...grouped.cursed]
    const lines = await lifeLines(
      worldId,
      shown.map((b) => b.id),
    )

    const near: AroundSite[] = []
    if (homeAt)
      for (const s of siteById.values()) {
        if (s.id === siteId || !s.at) continue
        const distance = Math.round(Math.hypot(s.at.x - homeAt.x, s.at.y - homeAt.y))
        if (distance > RADIUS) continue
        near.push({
          id: s.id,
          name: s.name,
          type: s.type,
          distance,
          civ: s.civ !== null && Number(s.civ) >= 0 ? Number(s.civ) : null,
          atWar: s.civ !== null && foes.has(Number(s.civ)),
          ours: civId !== null && s.civ !== null && Number(s.civ) === civId,
        })
      }
    near.sort((a, b) => a.distance - b.distance || a.id - b.id)
    const neighbours = near
      .filter(
        (s) =>
          !DANGER_TYPES.has(s.type ?? '') &&
          (s.civ !== null || (s.type !== 'lair' && s.type !== 'cave')),
      )
      .slice(0, SHOWN_NEIGHBOURS)
    const dangers = near.filter((s) => DANGER_TYPES.has(s.type ?? '')).slice(0, SHOWN_DANGERS)

    const refs: RefSet = {}
    for (const s of [...neighbours, ...dangers]) addRef(refs, 'entity', s.civ)
    const names = await lookupNames(worldId, refs)
    const withLine = (list: Omit<AroundBeast, 'line'>[]) =>
      list.map((b) => ({ ...b, line: lines.get(b.id) ?? [] }))
    return {
      home: homeSite && homeAt ? { id: homeSite.id, name: homeSite.name } : null,
      beasts: {
        great: withLine(grouped.great),
        night: withLine(grouped.night),
        cursed: withLine(grouped.cursed),
      },
      totals,
      neighbours,
      dangers,
      names,
      endYear,
    }
  })
}

export const getAroundFortress = createServerFn({ method: 'GET' })
  .inputValidator(
    (input: { worldId: number; siteId: number | null; civId: number | null }) => input,
  )
  .handler(
    async ({ data }): Promise<AroundFortress> =>
      aroundFortress(
        data.worldId,
        Number.isInteger(data.siteId) && (data.siteId ?? -1) >= 0 ? data.siteId : null,
        Number.isInteger(data.civId) && (data.civId ?? -1) >= 0 ? data.civId : null,
      ),
  )
