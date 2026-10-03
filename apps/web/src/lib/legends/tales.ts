import { type LegendsPayload, type LegendsRecord, postgres_db, schema } from '@fortress/db-drizzle'
import { type SQL, and, asc, desc, eq, inArray, sql } from 'drizzle-orm'

import { type Story, type StoryRef, curseFamily, getStories } from './chronicle'
import { ROUTINE_TYPES, describeEvent, num, numList, plusOf, str } from './events'
import { lifeLines, lifeParts } from './lives'
import { creaturePlurals, figureEventCounts, remember } from './memo'
import { racePlural, words } from './model'
import {
  type Prose,
  andList,
  appositive,
  counted,
  displayName,
  flat,
  list,
  named,
  paragraph,
  said,
  withArticle,
} from './prose'
import { type RefSet, addRef, addRefs, lookupNames } from './records'
import type { NameIndex } from './server'

/*
 * Each story on the Stories page told in full: who, where, what came of it,
 * in sentences built from the export alone. The events behind the telling
 * travel with it so the reader can check every line against the record.
 *
 * Server only; the browser reaches it through `tellings.ts`.
 */

const R = schema.legends_records

/** Events shown beneath a story; the total says how many more there are. */
const SHOWN = 120

export interface ToldStory {
  key: string
  group: { key: string; title: string }
  title: string
  blurb: string
  year: number | null
  paragraphs: Prose[]
  /** The events the telling stands on, oldest first. */
  events: LegendsRecord[]
  eventTotal: number
  /** The people, places and groups the story names, the leads first. */
  cast: StoryRef[]
  names: NameIndex
}

interface Telling {
  paragraphs: Prose[]
  events: LegendsRecord[]
  eventTotal: number
  cast: { kind: string; id: number }[]
  names: NameIndex
}

const ORDER = [asc(R.year), sql`(${R.payload}->>'seconds72')::int asc nulls first`, asc(R.id)]

function intArray(ids: number[]): SQL {
  return sql`array[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::int[]`
}

function eventWhere(worldId: number, ...where: (SQL | undefined)[]): SQL {
  return and(eq(R.world_id, worldId), eq(R.kind, 'historical_event'), ...where) as SQL
}

async function eventsAndTotal(
  where: SQL,
  limit = SHOWN,
): Promise<{ events: LegendsRecord[]; total: number }> {
  const [events, totals] = await Promise.all([
    postgres_db
      .select()
      .from(R)
      .where(where)
      .orderBy(...ORDER)
      .limit(limit),
    postgres_db.select({ total: sql<number>`count(*)::int` }).from(R).where(where),
  ])
  return { events, total: Number(totals[0]?.total ?? 0) }
}

async function lastEvent(where: SQL): Promise<LegendsRecord | null> {
  const rows = await postgres_db
    .select()
    .from(R)
    .where(where)
    .orderBy(desc(R.year), sql`(${R.payload}->>'seconds72')::int desc nulls last`, desc(R.id))
    .limit(1)
  return rows[0] ?? null
}

async function recordOf(worldId: number, kind: string, id: number): Promise<LegendsRecord | null> {
  const rows = await postgres_db
    .select()
    .from(R)
    .where(and(eq(R.world_id, worldId), eq(R.kind, kind), eq(R.id, id)))
    .limit(1)
  return rows[0] ?? null
}

function payloadOf(record: { payload: unknown } | null | undefined): LegendsPayload {
  return (record?.payload ?? {}) as LegendsPayload
}

function known(id: number | null | undefined): id is number {
  return id !== null && id !== undefined && id >= 0
}

/** The event's own sentence. */
function told(names: NameIndex, event: LegendsRecord): Prose {
  return describeEvent(event, names).fragments
}

/** "In 231, " and the event's own sentence. */
function turn(names: NameIndex, event: LegendsRecord): Prose {
  const year = event.year
  return said(typeof year === 'number' && year >= 0 ? `In ${year}, ` : '', told(names, event))
}

function refsOfEvents(refs: RefSet, events: LegendsRecord[]) {
  for (const event of events) addRefs(refs, event.payload)
}

/** Ids by how often the records name them, the best known first. */
function byFame(fame: Map<number, number>, ids: number[], names?: NameIndex): number[] {
  return [...new Set(ids)]
    .filter((id) => !names || names.historical_figure?.[id])
    .sort((a, b) => (fame.get(b) ?? 0) - (fame.get(a) ?? 0))
}

function tally<T>(items: T[]): [T, number][] {
  const counts = new Map<T, number>()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

/** "once", "twice", "5 times". */
function times(n: number): string {
  return n === 1 ? 'once' : n === 2 ? 'twice' : `${n.toLocaleString()} times`
}

function sum(v: unknown): number {
  return numList(v).reduce((a, b) => a + b, 0)
}

function hf(names: NameIndex, id: number | null, fallback = 'someone the records do not name') {
  return named(names, 'historical_figure', id, fallback)
}

function mergeNames(...indexes: NameIndex[]): NameIndex {
  const out: NameIndex = {}
  for (const index of indexes)
    for (const [kind, byId] of Object.entries(index)) out[kind] = { ...(out[kind] ?? {}), ...byId }
  return out
}

// ---------------------------------------------------------------------------
// Battles

/** What befell a site soon after a battle there. */
const AFTERMATH = [
  'site taken over',
  'hf destroyed site',
  'plundered site',
  'new site leader',
  'site abandoned',
  'razed structure',
]

async function tellBattle(worldId: number, id: number): Promise<Telling | null> {
  const W = eq(R.world_id, worldId)
  const battle = await recordOf(worldId, 'historical_event_collection', id)
  if (!battle) return null
  const p = payloadOf(battle)
  const warId = num(p.war_eventcol)
  const site = num(p.site_id)
  const year = num(p.start_year)
  const eventIds = numList(p.event)
  const [war, battlesInWar, inner, after, fame] = await Promise.all([
    known(warId) ? recordOf(worldId, 'historical_event_collection', warId) : null,
    known(warId)
      ? postgres_db
          .select({ c: sql<number>`count(*)::int` })
          .from(R)
          .where(
            and(
              W,
              eq(R.kind, 'historical_event_collection'),
              eq(R.type, 'battle'),
              sql`(${R.payload}->>'war_eventcol')::int = ${warId}`,
            ),
          )
          .then((rows) => Number(rows[0]?.c ?? 0))
      : 0,
    eventIds.length
      ? postgres_db
          .select()
          .from(R)
          .where(eventWhere(worldId, inArray(R.id, eventIds.slice(0, 3000))))
          .orderBy(...ORDER)
      : [],
    known(site) && year !== null
      ? postgres_db
          .select()
          .from(R)
          .where(
            eventWhere(
              worldId,
              inArray(R.type, AFTERMATH),
              sql`(${R.payload}->>'site_id')::int = ${site}`,
              sql`${R.year} between ${year} and ${year + 1}`,
            ),
          )
          .orderBy(...ORDER)
          .limit(8)
      : [],
    figureEventCounts(worldId),
  ])
  const wp = payloadOf(war)
  const side = (own: unknown, fromWar: unknown) => {
    const a = num(own)
    if (known(a)) return a
    const b = num(fromWar)
    return known(b) ? b : null
  }
  const attacker = side(p.attacking_enid, wp.aggressor_ent_id)
  const defender = side(p.defending_enid, wp.defender_ent_id)
  const attackers = numList(p.attacking_hfid)
  const defenders = numList(p.defending_hfid)
  const own = new Set(eventIds)
  const aftermath = after.filter((e) => !own.has(e.id)).slice(0, 2)
  const deaths = inner.filter((e) => e.type === 'hf died')

  const refs: RefSet = {}
  addRef(refs, 'historical_event_collection', id)
  if (war) addRef(refs, 'historical_event_collection', war.id)
  addRef(refs, 'site', site)
  addRef(refs, 'entity', attacker)
  addRef(refs, 'entity', defender)
  for (const figure of [...attackers, ...defenders]) addRef(refs, 'historical_figure', figure)
  refsOfEvents(refs, [...inner.slice(0, SHOWN), ...deaths.slice(0, 60), ...aftermath])
  const [names, plurals] = await Promise.all([lookupNames(worldId, refs), creaturePlurals(worldId)])

  const races = (raw: unknown) => {
    const tokens = Array.isArray(raw) ? [...new Set(raw.map(String))] : []
    // Experiment creatures carry generated tokens like HFEXP3247_E_HUM1.
    return tokens
      .filter((t) => !/\d/.test(t))
      .map((t) => plurals.get(t.toUpperCase()) ?? racePlural(t))
  }
  const attackerRaces = races(p.attacking_squad_race)
  const defenderRaces = races(p.defending_squad_race)
  const host = (entity: number | null, raceList: string[], fallback: string): Prose =>
    known(entity) && names.entity?.[entity]
      ? [named(names, 'entity', entity, fallback)]
      : raceList.length
        ? flat('a host of ', andList(raceList.slice(0, 3).map((r) => flat(r))))
        : flat(fallback)

  const opening: Prose[] = []
  opening.push(
    said(
      year !== null ? `In ${year}` : 'Once',
      war ? flat(', during ', named(names, 'historical_event_collection', war.id, 'a war')) : '',
      ', ',
      host(attacker, attackerRaces, 'unknown forces'),
      ' fell upon ',
      host(defender, defenderRaces, 'unknown defenders'),
      known(site) ? flat(' at ', named(names, 'site', site, 'a place without a name')) : '',
    ),
  )
  const attackerCount = sum(p.attacking_squad_number)
  const defenderCount = sum(p.defending_squad_number)
  const strength = (n: number, raceList: string[], verb: string) =>
    n > 0
      ? said(
          `${n.toLocaleString()} ${verb}`,
          raceList.length > 1 ? `: ${list(raceList.slice(0, 5))}` : '',
        )
      : []
  opening.push(
    strength(attackerCount, attackerRaces, 'came to attack'),
    strength(defenderCount, defenderRaces, 'stood in defence'),
  )
  const champions = (ids: number[], label: string) => {
    const best = byFame(fame, ids, names).slice(0, 3)
    if (!best.length) return null
    const rest = ids.length - best.length
    return said(
      `Among the ${label} were `,
      andList([
        ...best.map((figure) => flat(hf(names, figure))),
        ...(rest > 0 ? [flat(`${counted(rest, 'other named figure')}`)] : []),
      ]),
    )
  }
  opening.push(champions(attackers, 'attackers') ?? [], champions(defenders, 'defenders') ?? [])

  const fallen: Prose[] = []
  const lostA = sum(p.attacking_squad_deaths)
  const lostD = sum(p.defending_squad_deaths)
  if (lostA + lostD > 0)
    fallen.push(
      lostA && lostD
        ? said(
            `${counted(lostA + lostD, 'soldier')} fell, ${lostA.toLocaleString()} of the attackers and ${lostD.toLocaleString()} of the defenders`,
          )
        : lostD
          ? said(`The defenders lost ${lostD.toLocaleString()}; not one attacker fell`)
          : said(`The attackers lost ${lostA.toLocaleString()}; not one defender fell`),
    )
  const namedDead = deaths
    .map((e) => ({ e, victim: num(payloadOf(e).hfid), slayer: num(payloadOf(e).slayer_hfid) }))
    .filter((d) => known(d.victim) && names.historical_figure?.[d.victim])
    .sort((a, b) => (fame.get(b.victim ?? -1) ?? 0) - (fame.get(a.victim ?? -1) ?? 0))
    .slice(0, 3)
  if (namedDead.length)
    fallen.push(
      said(
        'Among the dead were ',
        andList(
          namedDead.map((d) =>
            flat(
              hf(names, d.victim),
              known(d.slayer) && names.historical_figure?.[d.slayer]
                ? flat(', slain by ', hf(names, d.slayer))
                : '',
            ),
          ),
          'and',
          namedDead.some((d) => known(d.slayer) && names.historical_figure?.[d.slayer])
            ? '; '
            : ', ',
        ),
      ),
    )

  const ending: Prose[] = []
  const outcome = str(p.outcome)
  if (outcome === 'attacker won')
    ending.push(said(host(attacker, attackerRaces, 'the attackers'), ' won the day'))
  else if (outcome === 'defender won')
    ending.push(said(host(defender, defenderRaces, 'the defenders'), ' held'))
  else if (outcome) ending.push(said(`The record gives the outcome as ${words(outcome)}`))
  for (const event of aftermath) ending.push(turn(names, event))
  if (war && battlesInWar > 1) {
    const from = num(wp.start_year)
    const to = num(wp.end_year)
    ending.push(
      said(
        `It was one of ${battlesInWar.toLocaleString()} battles of `,
        named(names, 'historical_event_collection', war.id, 'the war'),
        from !== null
          ? known(to)
            ? `, fought from ${from} to ${to}`
            : `, begun in ${from} and still unended when the records close`
          : '',
      ),
    )
  }

  return {
    paragraphs: [paragraph(opening), paragraph(fallen), paragraph(ending)],
    events: inner.slice(0, SHOWN),
    eventTotal: inner.length,
    cast: [
      { kind: 'historical_event_collection', id },
      ...(war ? [{ kind: 'historical_event_collection', id: war.id }] : []),
      ...(known(site) ? [{ kind: 'site', id: site }] : []),
      ...[attacker, defender].filter(known).map((entity) => ({ kind: 'entity', id: entity })),
      ...byFame(fame, [...attackers, ...defenders], names)
        .slice(0, 6)
        .map((figure) => ({ kind: 'historical_figure', id: figure })),
    ],
    names,
  }
}

// ---------------------------------------------------------------------------
// Slayers and eaters

async function tellSlayer(worldId: number, id: number, eater: boolean): Promise<Telling | null> {
  const where = eater
    ? and(
        eq(R.type, 'creature devoured'),
        sql`(${R.payload}->'plus'->>'eater')::int = ${id}`,
        sql`${R.hfids} @> ARRAY[${id}]::int[]`,
      )
    : and(
        eq(R.type, 'hf died'),
        sql`(${R.payload}->>'slayer_hfid')::int = ${id}`,
        sql`${R.hfids} @> ARRAY[${id}]::int[]`,
      )
  const all = eventWhere(worldId, where)
  const [parts, { events, total }, last, places, victims, fame] = await Promise.all([
    lifeParts(worldId, id),
    eventsAndTotal(all),
    lastEvent(all),
    postgres_db.execute<{ site: number; c: number }>(sql`
      select (${R.payload}->>'site_id')::int as site, count(*)::int as c
      from ${R} where ${all} and (${R.payload}->>'site_id')::int >= 0
      group by 1 order by c desc limit 3`),
    postgres_db.execute<{ hf: number }>(sql`
      select ${eater ? sql`(${R.payload}->'plus'->>'victim')::int` : sql`(${R.payload}->>'hfid')::int`} as hf
      from ${R} where ${all}`),
    figureEventCounts(worldId),
  ])
  if (!parts) return null
  const victimIds = [...victims].map((r) => Number(r.hf)).filter(known)
  const best = byFame(fame, victimIds).slice(0, 8)
  const refs: RefSet = {}
  refsOfEvents(refs, [...events, ...(last ? [last] : [])])
  for (const row of places) addRef(refs, 'site', Number(row.site))
  for (const victim of best) addRef(refs, 'historical_figure', victim)
  const names = mergeNames(parts.names, await lookupNames(worldId, refs))

  const who = parts.name ? displayName(parts.name) : 'This creature'
  const first = events[0]
  const tale: Prose[] = []
  if (total && first) {
    const span =
      last?.year !== undefined && last?.year !== null && first.year !== last.year
        ? ` between ${first.year} and ${last.year}`
        : typeof first.year === 'number'
          ? ` in ${first.year}`
          : ''
    tale.push(
      said(
        who,
        eater
          ? ` devoured ${counted(total, 'creature')}`
          : ` took ${total === 1 ? 'one life' : `${total.toLocaleString()} lives`}`,
        span,
      ),
    )
    tale.push(said(`It began in ${first.year}: `, told(names, first)))
    const firstVictim = num(eater ? plusOf(payloadOf(first)).victim : payloadOf(first).hfid)
    const famous = best
      .filter((victim) => victim !== firstVictim && names.historical_figure?.[victim])
      .slice(0, 3)
    if (famous.length)
      tale.push(
        said('The best known of the dead were ', andList(famous.map((v) => flat(hf(names, v))))),
      )
    const top = [...places].filter((row) => Number(row.c) > 1)
    if (top.length === 1 && Number(top[0].c) === total)
      tale.push(
        said('All of it happened at ', named(names, 'site', Number(top[0].site), 'one place')),
      )
    else if (top.length)
      tale.push(
        said(
          'Most of it happened at ',
          andList(
            top
              .slice(0, 2)
              .map((row) =>
                flat(named(names, 'site', Number(row.site), 'a place'), ` (${Number(row.c)})`),
              ),
          ),
        ),
      )
    if (last && last.id !== first.id)
      tale.push(said(`The last came in ${last.year}: `, told(names, last)))
  }
  return {
    paragraphs: [parts.origins, paragraph(tale), parts.end],
    events,
    eventTotal: total,
    cast: [
      { kind: 'historical_figure', id },
      ...best.slice(0, 5).map((victim) => ({ kind: 'historical_figure', id: victim })),
      ...[...places].slice(0, 2).map((row) => ({ kind: 'site', id: Number(row.site) })),
    ],
    names,
  }
}

// ---------------------------------------------------------------------------
// Lives

async function tellALife(worldId: number, id: number): Promise<Telling | null> {
  const [parts, totals] = await Promise.all([
    lifeParts(worldId, id),
    postgres_db
      .select({ c: sql<number>`count(*)::int` })
      .from(R)
      .where(eventWhere(worldId, sql`${R.hfids} @> ARRAY[${id}]::int[]`)),
  ])
  if (!parts) return null
  return {
    paragraphs: [parts.origins, parts.rank, parts.deeds, parts.bonds, parts.end],
    events: parts.events.slice(0, SHOWN),
    eventTotal: Math.max(parts.events.length, Number(totals[0]?.c ?? 0)),
    cast: [{ kind: 'historical_figure', id }],
    names: parts.names,
  }
}

// ---------------------------------------------------------------------------
// The cursed

function carry(family: string, label: string, many: boolean): string {
  const v = (one: string, more: string) => (many ? more : one)
  if (family.startsWith('were-')) return `${v('carries', 'carry')} the ${label}`
  switch (family) {
    case 'necromancer':
      return `${v('knows', 'know')} the secret of raising the dead`
    case 'undead':
      return `${v('is', 'are')} undead`
    case 'ghoul':
      return v('is a ghoul', 'are ghouls')
    case 'vampire':
      return v('is a vampire', 'are vampires')
    case 'divine':
      return `${v('lives', 'live')} under a divine curse`
    case 'mythical':
      return `${v('holds', 'hold')} a mythical power`
    case 'regional':
      return `${v('is', 'are')} bound to the land itself`
    default:
      return `${v('carries', 'carry')} a strange power`
  }
}

async function tellCurse(worldId: number, family: string): Promise<Telling | null> {
  const rows = await postgres_db
    .select({
      id: R.id,
      type: R.type,
      curses: sql<unknown>`${R.payload}->'active_interaction'`,
      race: sql<string | null>`${R.payload}->'plus'->>'race'`,
      death: sql<number | null>`(${R.payload}->>'death_year')::int`,
    })
    .from(R)
    .where(
      and(
        eq(R.world_id, worldId),
        eq(R.kind, 'historical_figure'),
        sql`${R.payload} ? 'active_interaction'`,
      ),
    )
  let label = ''
  const members = rows.filter((row) => {
    const tokens = Array.isArray(row.curses) ? row.curses.map(String) : []
    return tokens.some((token) => {
      const f = curseFamily(token)
      if (f.key !== family) return false
      label = f.label
      return true
    })
  })
  if (!members.length) return null
  const ids = members.map((m) => m.id)
  const fame = await figureEventCounts(worldId)
  const storied = byFame(fame, ids).slice(0, 3)
  const spread = eventWhere(
    worldId,
    inArray(R.type, ['hf does interaction', 'hf learns secret', 'changed creature type']),
    sql`${R.hfids} && ${intArray(ids.slice(0, 5000))}`,
  )
  const [{ events, total }, lines] = await Promise.all([
    eventsAndTotal(spread),
    lifeLines(worldId, storied),
  ])
  const refs: RefSet = {}
  refsOfEvents(refs, events)
  for (const id of storied) addRef(refs, 'historical_figure', id)
  const names = await lookupNames(worldId, refs)

  const many = members.length > 1
  const races = tally(members.map((m) => words(m.race ?? m.type)).filter(Boolean))
  const alive = members.filter((m) => !known(m.death)).length
  const opening = paragraph([
    said(
      many
        ? `${members.length.toLocaleString()} souls in the records ${carry(family, label, true)}`
        : `One soul in the records ${carry(family, label, false)}`,
    ),
    many && races.length
      ? said(
          'They are ',
          andList([
            ...races
              .slice(0, 3)
              .map(([race, n]) =>
                flat(n === 1 ? withArticle(race) : `${n.toLocaleString()} ${racePlural(race)}`),
              ),
            ...(races.length > 3 ? [flat('others besides')] : []),
          ]),
        )
      : null,
    many
      ? said(
          alive === members.length
            ? 'All of them still live when the records end'
            : alive === 0
              ? 'None of them still lives when the records end'
              : `${alive.toLocaleString()} of them still live when the records end`,
        )
      : null,
  ])
  const traces = paragraph([
    events[0]
      ? said(`The earliest trace comes in ${events[0].year}: `, told(names, events[0]))
      : null,
    total > 1 ? said(`The records hold ${counted(total, 'such event')} in all`) : null,
  ])
  const people = paragraph(
    storied.map((id, i) => {
      const line = lines.get(id)
      const name = hf(names, id, 'one without a name')
      return said(
        i === 0 ? 'The most storied is ' : i === 1 ? 'Next comes ' : 'Then ',
        line ? appositive(name, line) : [name],
      )
    }),
  )
  return {
    paragraphs: [opening, traces, people],
    events,
    eventTotal: total,
    cast: storied.map((id) => ({ kind: 'historical_figure', id })),
    names,
  }
}

// ---------------------------------------------------------------------------
// Fallen civilizations

const LOSS_TYPES = ['site taken over', 'hf destroyed site']

async function tellFallen(worldId: number, civ: number): Promise<Telling | null> {
  const W = eq(R.world_id, worldId)
  const entity = await recordOf(worldId, 'entity', civ)
  if (!entity) return null
  const race = str(plusOf(payloadOf(entity)).race)
  const theirs = sql`${R.entity_ids} @> ARRAY[${civ}]::int[]`
  const lossWhere = eventWhere(
    worldId,
    theirs,
    inArray(R.type, LOSS_TYPES),
    sql`(${R.payload}->>'defender_civ_id')::int = ${civ}`,
  )
  const foundWhere = eventWhere(
    worldId,
    theirs,
    eq(R.type, 'created site'),
    sql`(${R.payload}->>'civ_id')::int = ${civ}`,
  )
  const anyWhere = eventWhere(
    worldId,
    theirs,
    sql`not (${R.type} = any(${sql`array[${sql.join(
      ROUTINE_TYPES.map((t) => sql`${t}`),
      sql`, `,
    )}]::text[]`}))`,
  )
  const [losses, founded, record, last, wars] = await Promise.all([
    eventsAndTotal(lossWhere, 4),
    eventsAndTotal(foundWhere, 1),
    eventsAndTotal(anyWhere),
    lastEvent(anyWhere),
    postgres_db
      .select({ id: R.id, name: R.name })
      .from(R)
      .where(
        and(
          W,
          eq(R.kind, 'historical_event_collection'),
          eq(R.type, 'war'),
          sql`((${R.payload}->>'aggressor_ent_id')::int = ${civ} or (${R.payload}->>'defender_ent_id')::int = ${civ})`,
        ),
      )
      .orderBy(asc(R.year), asc(R.id)),
  ])
  const refs: RefSet = {}
  addRef(refs, 'entity', civ)
  refsOfEvents(refs, [
    ...losses.events,
    ...founded.events,
    ...record.events,
    ...(last ? [last] : []),
  ])
  for (const war of wars.slice(0, 3)) addRef(refs, 'historical_event_collection', war.id)
  const names = await lookupNames(worldId, refs)
  const name = named(names, 'entity', civ, '')
  const people = race ? `civilization of ${racePlural(race)}` : 'civilization'

  const firstYear = record.events[0]?.year
  const opening = paragraph([
    name.text
      ? said(name, ` was a ${people}`)
      : said(
          'The records give no name for this ',
          'link' in name ? { link: name.link, text: people } : people,
        ),
    typeof firstYear === 'number' && firstYear >= 0
      ? said(`The records first speak of them in ${firstYear}`)
      : null,
    founded.total
      ? said(
          `They founded ${counted(founded.total, 'site')}`,
          founded.events[0] && typeof founded.events[0].year === 'number'
            ? `, the first in ${founded.events[0].year}`
            : '',
        )
      : null,
  ])
  const decline = paragraph([
    wars.length
      ? said(
          `They fought ${counted(wars.length, 'war')}`,
          wars.some((w) => w.name)
            ? flat(
                ', among them ',
                andList(
                  wars
                    .filter((w) => w.name)
                    .slice(0, 2)
                    .map((w) => flat(named(names, 'historical_event_collection', w.id, 'a war'))),
                ),
              )
            : '',
        )
      : null,
    losses.total ? said(`They lost ${counted(losses.total, 'site')} to conquest or ruin`) : null,
    ...losses.events.slice(0, 3).map((e) => turn(names, e)),
  ])
  const ending = paragraph([
    last && typeof last.year === 'number'
      ? said(`The last word of them comes in ${last.year}: `, told(names, last))
      : null,
    said('When the records end, they hold no sites'),
  ])
  return {
    paragraphs: [opening, decline, ending],
    events: record.events,
    eventTotal: record.total,
    cast: [
      { kind: 'entity', id: civ },
      ...wars.slice(0, 3).map((w) => ({ kind: 'historical_event_collection', id: w.id })),
    ],
    names,
  }
}

// ---------------------------------------------------------------------------
// Contested ground

const CONTEST_TYPES = [
  'site taken over',
  'attacked site',
  'hf destroyed site',
  'plundered site',
  'new site leader',
]

async function tellContested(worldId: number, site: number): Promise<Telling | null> {
  const record = await recordOf(worldId, 'site', site)
  if (!record) return null
  const contest = eventWhere(
    worldId,
    sql`${R.site_ids} @> ARRAY[${site}]::int[]`,
    inArray(R.type, CONTEST_TYPES),
    sql`(${R.payload}->>'site_id')::int = ${site}`,
  )
  const takeovers = and(contest, eq(R.type, 'site taken over')) as SQL
  const [{ events, total }, last, attackers, taken, lastTaken] = await Promise.all([
    eventsAndTotal(contest),
    lastEvent(contest),
    postgres_db.execute<{ civ: number; c: number }>(sql`
      select (${R.payload}->>'attacker_civ_id')::int as civ, count(*)::int as c
      from ${R} where ${contest} and (${R.payload}->>'attacker_civ_id')::int >= 0
      group by 1 order by c desc limit 3`),
    eventsAndTotal(takeovers, 1),
    lastEvent(takeovers),
  ])
  const refs: RefSet = {}
  addRef(refs, 'site', site)
  refsOfEvents(refs, [
    ...events,
    ...(last ? [last] : []),
    ...taken.events,
    ...(lastTaken ? [lastTaken] : []),
  ])
  for (const row of attackers) addRef(refs, 'entity', Number(row.civ))
  const names = await lookupNames(worldId, refs)

  const first = events[0]
  const type = words(record.type)
  const opening = paragraph([
    said(
      named(names, 'site', site, 'This place'),
      type ? `, ${withArticle(type)},` : '',
      ` was fought over ${times(total)}`,
      first && last && first.year !== last.year ? ` between ${first.year} and ${last.year}` : '',
    ),
    attackers.length
      ? said(
          andList(
            [...attackers]
              .slice(0, 2)
              .map((row, i) =>
                flat(
                  named(names, 'entity', Number(row.civ), 'a people the records do not name'),
                  i === 0 ? ` came against it ${times(Number(row.c))}` : ` ${times(Number(row.c))}`,
                ),
              ),
          ),
        )
      : null,
  ])
  const firstTaken = taken.events[0]
  const hands = paragraph([
    taken.total ? said(`It changed hands ${times(taken.total)}`) : null,
    firstTaken
      ? said(
          taken.total > 1 && typeof firstTaken.year === 'number'
            ? `The first time was in ${firstTaken.year}: `
            : '',
          taken.total > 1 ? told(names, firstTaken) : turn(names, firstTaken),
        )
      : null,
    lastTaken && lastTaken.id !== firstTaken?.id && typeof lastTaken.year === 'number'
      ? said(`The last was in ${lastTaken.year}: `, told(names, lastTaken))
      : null,
  ])
  const ending = paragraph([
    last && typeof last.year === 'number'
      ? said(`The last word of it comes in ${last.year}: `, told(names, last))
      : null,
  ])
  return {
    paragraphs: [opening, hands, ending],
    events,
    eventTotal: total,
    cast: [
      { kind: 'site', id: site },
      ...[...attackers].slice(0, 3).map((row) => ({ kind: 'entity', id: Number(row.civ) })),
    ],
    names,
  }
}

// ---------------------------------------------------------------------------
// Artifacts

async function tellArtifact(worldId: number, id: number): Promise<Telling | null> {
  const record = await recordOf(worldId, 'artifact', id)
  if (!record) return null
  const p = payloadOf(record)
  const plus = plusOf(p)
  const theirs = eventWhere(worldId, sql`${R.artifact_ids} @> ARRAY[${id}]::int[]`)
  const [{ events, total }, last] = await Promise.all([eventsAndTotal(theirs), lastEvent(theirs)])
  const holder = num(p.holder_hfid)
  const refs: RefSet = {}
  addRef(refs, 'artifact', id)
  addRef(refs, 'historical_figure', holder)
  refsOfEvents(refs, [...events, ...(last ? [last] : [])])
  const names = await lookupNames(worldId, refs)

  const item = words(str(plus.item_subtype) ?? str(plus.item_type))
  const mat = words(str(plus.mat))
  const what = [mat, item].filter(Boolean).join(' ')
  const made = events.find((e) => e.type === 'artifact created')
  const opening = paragraph([
    said(
      named(names, 'artifact', id, 'This artifact'),
      what ? ` is ${withArticle(what)}` : ' is an artifact',
    ),
    made ? turn(names, made) : null,
  ])
  const journey = events.filter((e) => e.id !== made?.id)
  const moves: LegendsRecord[] = []
  for (const event of journey) {
    if (moves.length >= 4) break
    if (moves[moves.length - 1]?.type === event.type) continue
    moves.push(event)
  }
  const rest = total - (made ? 1 : 0) - moves.length
  const travels = paragraph([
    ...moves.map((e) => turn(names, e)),
    rest > 0
      ? said(`The records follow it through ${counted(rest, 'more event')} after that`)
      : null,
  ])
  const now = paragraph([
    known(holder) && names.historical_figure?.[holder]
      ? said('When the records end, it is held by ', hf(names, holder))
      : last?.type === 'artifact lost'
        ? said(`When the records end, it is lost; it went missing in ${last.year}`)
        : last && last.id !== made?.id
          ? said(`The last word of it comes in ${last.year}: `, told(names, last))
          : null,
  ])
  return {
    paragraphs: [opening, travels, now],
    events,
    eventTotal: total,
    cast: [
      { kind: 'artifact', id },
      ...(known(holder) ? [{ kind: 'historical_figure', id: holder }] : []),
    ],
    names,
  }
}

// ---------------------------------------------------------------------------
// Loves and feuds

async function tellLover(worldId: number, id: number): Promise<Telling | null> {
  const [parts, affairs] = await Promise.all([
    lifeParts(worldId, id),
    postgres_db.execute<{ other: number; relationship: string; year: number | null }>(sql`
      select case when (${R.payload}->'plus'->>'source_hf')::int = ${id}
                  then (${R.payload}->'plus'->>'target_hf')::int
                  else (${R.payload}->'plus'->>'source_hf')::int end as other,
             ${R.payload}->'plus'->>'relationship' as relationship,
             (${R.payload}->'plus'->>'year')::int as year
      from ${R}
      where ${R.world_id} = ${worldId} and ${R.kind} = 'historical_event_relationship'
        and ${R.hfids} @> ARRAY[${id}]::int[]
        and ${R.payload}->'plus'->>'relationship' in ('lover', 'former_lover')
      order by year asc nulls last`),
  ])
  if (!parts) return null
  const rows = [...affairs].filter((r) => known(Number(r.other)))
  const lovers = [...new Set(rows.map((r) => Number(r.other)))]
  const refs: RefSet = {}
  for (const other of lovers) addRef(refs, 'historical_figure', other)
  const names = mergeNames(parts.names, await lookupNames(worldId, refs))

  const dated = rows.filter(
    (r) => typeof r.year === 'number' && r.year >= 0 && names.historical_figure?.[Number(r.other)],
  )
  const first = dated[0]
  const last = dated[dated.length - 1]
  const ended = new Set(
    rows.filter((r) => r.relationship === 'former_lover').map((r) => Number(r.other)),
  ).size
  const affairsTold = paragraph([
    first
      ? said(
          'The first lover the records name is ',
          hf(names, Number(first.other)),
          `, in ${first.year}`,
          last && Number(last.other) !== Number(first.other)
            ? flat('; the last is ', hf(names, Number(last.other)), `, in ${last.year}`)
            : '',
        )
      : null,
    ended && lovers.length > 1
      ? said(
          ended === lovers.length
            ? 'Every one of these affairs ended'
            : `${ended === 1 ? 'One' : ended.toLocaleString()} of the ${lovers.length.toLocaleString()} affairs ended`,
        )
      : null,
  ])
  const links = parts.events.filter((e) => e.type === 'add hf hf link')
  return {
    paragraphs: [parts.origins, parts.bonds, affairsTold, parts.end],
    events: (links.length ? links : parts.events).slice(0, SHOWN),
    eventTotal: links.length || parts.events.length,
    cast: [
      { kind: 'historical_figure', id },
      ...lovers.slice(0, 6).map((other) => ({ kind: 'historical_figure', id: other })),
    ],
    names,
  }
}

const GRUDGE_WORDS: Record<string, string> = {
  grudge: 'a grudge',
  jealous_obsession: 'a jealous obsession',
  religious_persecution_grudge: 'a grudge of religious persecution',
  persecution_grudge: 'a grudge of persecution',
  jealous_relationship_grudge: 'a jealous grudge',
}

async function tellGrudge(
  worldId: number,
  source: number,
  target: number,
): Promise<Telling | null> {
  const both = eventWhere(worldId, sql`${R.hfids} @> ARRAY[${source}, ${target}]::int[]`)
  const deathOf = (id: number) =>
    postgres_db
      .select()
      .from(R)
      .where(
        eventWhere(
          worldId,
          eq(R.type, 'hf died'),
          sql`${R.hfids} @> ARRAY[${id}]::int[]`,
          sql`(${R.payload}->>'hfid')::int = ${id}`,
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null)
  const [relations, shared, lines, deathS, deathT] = await Promise.all([
    postgres_db.execute<{ relationship: string; year: number | null; source: number }>(sql`
      select ${R.payload}->'plus'->>'relationship' as relationship,
             (${R.payload}->'plus'->>'year')::int as year,
             (${R.payload}->'plus'->>'source_hf')::int as source
      from ${R}
      where ${R.world_id} = ${worldId} and ${R.kind} = 'historical_event_relationship'
        and ${R.hfids} @> ARRAY[${source}, ${target}]::int[]
      order by year asc nulls last`),
    eventsAndTotal(both),
    lifeLines(worldId, [source, target]),
    deathOf(source),
    deathOf(target),
  ])
  const refs: RefSet = {}
  addRef(refs, 'historical_figure', source)
  addRef(refs, 'historical_figure', target)
  refsOfEvents(refs, [...shared.events, ...(deathS ? [deathS] : []), ...(deathT ? [deathT] : [])])
  const names = await lookupNames(worldId, refs)
  const grudge = [...relations].find(
    (r) => GRUDGE_WORDS[r.relationship] && Number(r.source) === source,
  )
  const others = [...relations].filter((r) => r !== grudge && r.relationship)

  const opening = paragraph([
    said(
      hf(names, source),
      ` formed ${GRUDGE_WORDS[grudge?.relationship ?? 'grudge'] ?? 'a grudge'} against `,
      hf(names, target),
      typeof grudge?.year === 'number' && grudge.year >= 0 ? ` in ${grudge.year}` : '',
    ),
    ...others
      .slice(0, 2)
      .map((r) =>
        said(
          'The records also call ',
          Number(r.source) === source ? hf(names, source) : hf(names, target),
          ` ${words(r.relationship).replace(/_/g, ' ')} to `,
          Number(r.source) === source ? hf(names, target) : hf(names, source),
        ),
      ),
  ])
  const who = paragraph(
    [source, target].map((id) => {
      const line = lines.get(id)
      return line ? said(appositive(hf(names, id), line)) : null
    }),
  )
  const together = paragraph([
    shared.total
      ? said(`The records name them together in ${counted(shared.total, 'event')}`)
      : said('No event in the records names them both'),
    shared.events[0] ? said('The first: ', turn(names, shared.events[0])) : null,
  ])
  const ends = paragraph([deathS ? turn(names, deathS) : null, deathT ? turn(names, deathT) : null])
  return {
    paragraphs: [opening, who, together, ends],
    events: shared.events,
    eventTotal: shared.total,
    cast: [
      { kind: 'historical_figure', id: source },
      { kind: 'historical_figure', id: target },
    ],
    names,
  }
}

// ---------------------------------------------------------------------------
// Strange ends and written words

const PLAIN_DEATHS = ['struck', 'murdered', 'old age', 'shot']

/** Causes of death as counted nouns: "12 beheadings". */
const DEATH_NOUNS: Record<string, [string, string]> = {
  'exec beheaded': ['beheading', 'beheadings'],
  'exec hacked to pieces': ['execution by hacking', 'executions by hacking'],
  'exec generic': ['other execution', 'other executions'],
  'exec burned alive': ['burning alive', 'burnings alive'],
  'exec drowned': ['execution by drowning', 'executions by drowning'],
  'exec buried alive': ['burial alive', 'burials alive'],
  'exec crucified': ['crucifixion', 'crucifixions'],
  'exec fed to beasts': ['feeding to beasts', 'feedings to beasts'],
  drowned: ['drowning', 'drownings'],
  bled: ['death by bleeding', 'deaths by bleeding'],
  thirst: ['death of thirst', 'deaths of thirst'],
  starved: ['starvation', 'starvations'],
  infection: ['death by infection', 'deaths by infection'],
  suffocated: ['suffocation', 'suffocations'],
  'burned alive': ['burning', 'burnings'],
  'cave in': ['cave-in', 'cave-ins'],
  'fell to death': ['fatal fall', 'fatal falls'],
}

function deathNoun(cause: string, n: number): string {
  const nouns = DEATH_NOUNS[cause]
  return nouns ? counted(n, nouns[0], nouns[1]) : `${n.toLocaleString()} ${words(cause)}`
}

async function tellStrangeEnds(worldId: number): Promise<Telling> {
  const strange = eventWhere(
    worldId,
    eq(R.type, 'hf died'),
    sql`${R.payload} ? 'cause'`,
    sql`not (${R.payload}->>'cause' = any(${sql`array[${sql.join(
      PLAIN_DEATHS.map((c) => sql`${c}`),
      sql`, `,
    )}]::text[]`}))`,
  )
  const [{ events, total }, causes] = await Promise.all([
    eventsAndTotal(strange),
    postgres_db.execute<{ cause: string; c: number }>(sql`
      select ${R.payload}->>'cause' as cause, count(*)::int as c
      from ${R} where ${strange} group by 1 order by c desc limit 4`),
  ])
  const refs: RefSet = {}
  refsOfEvents(refs, events)
  const names = await lookupNames(worldId, refs)
  return {
    paragraphs: [
      paragraph([
        said(
          'Most deaths in the records are plain ones: struck down, murdered, shot, or of old age',
        ),
        said(`${counted(total, 'death')} were not`),
        causes.length
          ? said(
              'Among them are ',
              andList([...causes].map((row) => flat(deathNoun(row.cause, Number(row.c))))),
            )
          : null,
        said('Below they are set down in the order they happened'),
      ]),
    ],
    events,
    eventTotal: total,
    cast: [],
    names,
  }
}

async function tellAuthor(worldId: number, id: number): Promise<Telling | null> {
  const composed = eventWhere(
    worldId,
    eq(R.type, 'written content composed'),
    sql`${R.hfids} @> ARRAY[${id}]::int[]`,
  )
  const [parts, works, { events, total }, last] = await Promise.all([
    lifeParts(worldId, id),
    postgres_db
      .select({ id: R.id, form: sql<string | null>`${R.payload}->>'form'` })
      .from(R)
      .where(
        and(
          eq(R.world_id, worldId),
          eq(R.kind, 'written_content'),
          sql`(${R.payload}->>'author_hfid')::int = ${id}`,
        ),
      ),
    eventsAndTotal(composed),
    lastEvent(composed),
  ])
  if (!parts) return null
  const refs: RefSet = {}
  refsOfEvents(refs, [...events, ...(last ? [last] : [])])
  const names = mergeNames(parts.names, await lookupNames(worldId, refs))

  const who = parts.name ? displayName(parts.name) : 'This figure'
  const forms = tally(works.map((w) => words(w.form)).filter(Boolean))
  const workOf = (e: LegendsRecord) => num(payloadOf(e).wc_id)
  const first = events[0]
  const writing = paragraph([
    said(
      who,
      ` wrote ${counted(works.length, 'work')}`,
      forms.length
        ? flat(
            ': ',
            andList(
              forms
                .slice(0, 4)
                .map(([form, n]) => flat(n === 1 ? withArticle(form) : `${n} ${racePlural(form)}`)),
            ),
            forms.length > 4 ? ' and more besides' : '',
          )
        : '',
    ),
    first && known(workOf(first))
      ? said(
          'The first was ',
          named(names, 'written_content', workOf(first), 'a work'),
          ` in ${first.year}`,
        )
      : null,
    last && last.id !== first?.id && known(workOf(last))
      ? said(
          'The last was ',
          named(names, 'written_content', workOf(last), 'a work'),
          ` in ${last.year}`,
        )
      : null,
  ])
  return {
    paragraphs: [parts.origins, writing, parts.end],
    events,
    eventTotal: total,
    cast: [{ kind: 'historical_figure', id }],
    names,
  }
}

// ---------------------------------------------------------------------------
// Entry points

function tellerFor(worldId: number, story: Story): Promise<Telling | null> {
  const key = story.key
  if (key === 'strange-ends') return tellStrangeEnds(worldId)
  const grudge = /^grudge-(\d+)-(\d+)$/.exec(key)
  if (grudge) return tellGrudge(worldId, Number(grudge[1]), Number(grudge[2]))
  const curse = /^curse-(.+)$/.exec(key)
  if (curse) return tellCurse(worldId, curse[1])
  const match = /^([a-z]+)-(\d+)$/.exec(key)
  if (!match) return Promise.resolve(null)
  const id = Number(match[2])
  switch (match[1]) {
    case 'battle':
      return tellBattle(worldId, id)
    case 'slayer':
      return tellSlayer(worldId, id, false)
    case 'eater':
      return tellSlayer(worldId, id, true)
    case 'eventful':
    case 'longlived':
      return tellALife(worldId, id)
    case 'fallen':
      return tellFallen(worldId, id)
    case 'contested':
      return tellContested(worldId, id)
    case 'artifact':
      return tellArtifact(worldId, id)
    case 'lover':
      return tellLover(worldId, id)
    case 'author':
      return tellAuthor(worldId, id)
    default:
      return Promise.resolve(null)
  }
}

/** One story from the Stories page, told in full. */
export function tellStory(worldId: number, key: string): Promise<ToldStory | null> {
  return remember(worldId, `story:${key}`, async () => {
    const stories = await getStories({ data: { worldId } })
    const group = stories.groups.find((g) => g.stories.some((s) => s.key === key))
    const story = group?.stories.find((s) => s.key === key)
    if (!group || !story) return null
    const telling = await tellerFor(worldId, story)
    const paragraphs = telling?.paragraphs.filter((p) => p.length) ?? []
    const names = mergeNames(stories.names, telling?.names ?? {})
    const cast: StoryRef[] = []
    const seen = new Set<string>()
    const refs: Partial<StoryRef>[] = [...story.refs, ...(telling?.cast ?? [])]
    for (const ref of refs) {
      if (ref.kind === undefined || ref.id === undefined) continue
      const id = `${ref.kind}:${ref.id}`
      if (seen.has(id)) continue
      seen.add(id)
      cast.push({
        kind: ref.kind,
        id: ref.id,
        name: ref.name ?? names[ref.kind]?.[ref.id] ?? null,
        race: ref.race ?? null,
      })
    }
    return {
      key,
      group: { key: group.key, title: group.title },
      title: story.title,
      blurb: story.blurb,
      year: story.year,
      paragraphs: paragraphs.length ? paragraphs : [said(story.blurb)],
      events: telling?.events ?? story.events ?? [],
      eventTotal: telling?.eventTotal ?? story.events?.length ?? 0,
      cast,
      names,
    }
  })
}
