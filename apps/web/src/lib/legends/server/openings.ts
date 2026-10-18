import { type LegendsPayload, postgres_db, schema } from '@fortress/db-drizzle'
import { type SQL, and, asc, eq, inArray, sql } from 'drizzle-orm'

import { num, numList, plusOf, str } from '../events'
import { type Prose, andList, counted, flat, named, paragraph, said } from '../prose'
import { civPast } from './lives'
import { type RefSet, addRef, lookupNames } from './records'

/*
 * The paragraph a site, civilization or war page opens with. Every clause
 * stands on an event or field of the export; what the record does not say,
 * the opening leaves out.
 *
 * Server only; reached through `getLegendsRecord`.
 */

const R = schema.legends_records

function inYear(year: number | null | undefined): string {
  return typeof year === 'number' && year >= 0 ? ` in ${year}` : ''
}

const idOf = (p: LegendsPayload, key: string) => {
  const id = num(p[key])
  return id !== null && id >= 0 ? id : null
}

/** Who founded the site, who held it, how it changed hands, the battles fought there. */
export async function siteOpening(
  worldId: number,
  siteId: number,
  payload: LegendsPayload,
): Promise<Prose> {
  const W = eq(R.world_id, worldId)
  const atSite = sql`${R.site_ids} @> ARRAY[${siteId}]::int[]`
  const [changes, battles] = await Promise.all([
    postgres_db
      .select({ type: R.type, year: R.year, payload: R.payload })
      .from(R)
      .where(
        and(
          W,
          eq(R.kind, 'historical_event'),
          atSite,
          inArray(R.type, ['created site', 'site taken over', 'hf destroyed site', 'reclaim site']),
          sql`(${R.payload}->>'site_id')::int = ${siteId}`,
        ),
      )
      .orderBy(asc(R.year), asc(R.id)),
    postgres_db
      .select({ id: R.id, year: R.year, payload: R.payload })
      .from(R)
      .where(
        and(
          W,
          eq(R.kind, 'historical_event_collection'),
          eq(R.type, 'battle'),
          atSite,
          sql`(${R.payload}->>'site_id')::int = ${siteId}`,
        ),
      )
      .orderBy(asc(R.year), asc(R.id)),
  ])
  const ev = changes.map((c) => ({ ...c, p: c.payload as LegendsPayload }))
  const founding = ev.find((e) => e.type === 'created site')
  const conquests = ev.filter((e) => e.type === 'site taken over')
  const ruins = ev.filter((e) => e.type === 'hf destroyed site')
  const reclaims = ev.filter((e) => e.type === 'reclaim site')
  const lastConquest = conquests[conquests.length - 1]
  const lastRuin = ruins[ruins.length - 1]
  const lastReclaim = reclaims[reclaims.length - 1]
  const last = ev[ev.length - 1]
  const holder = idOf(plusOf(payload), 'civ_id')
  const latestBattle = battles[battles.length - 1]

  const refs: RefSet = {}
  addRef(refs, 'site', siteId)
  if (founding) {
    addRef(refs, 'entity', idOf(founding.p, 'civ_id'))
    addRef(refs, 'entity', idOf(founding.p, 'site_civ_id'))
    addRef(refs, 'historical_figure', idOf(founding.p, 'builder_hfid'))
  }
  if (lastConquest) {
    addRef(refs, 'entity', idOf(lastConquest.p, 'attacker_civ_id'))
    addRef(refs, 'entity', idOf(lastConquest.p, 'defender_civ_id'))
  }
  if (lastRuin) {
    addRef(refs, 'historical_figure', idOf(lastRuin.p, 'attacker_hfid'))
    addRef(refs, 'entity', idOf(lastRuin.p, 'attacker_civ_id'))
  }
  if (lastReclaim) addRef(refs, 'entity', idOf(lastReclaim.p, 'civ_id'))
  addRef(refs, 'entity', holder)
  if (latestBattle) addRef(refs, 'historical_event_collection', latestBattle.id)
  const names = await lookupNames(worldId, refs)
  const civ = (id: number | null, fallback: string) => named(names, 'entity', id, fallback)
  const site = named(names, 'site', siteId, 'This place')

  const sentences: (Prose | null)[] = []
  if (founding) {
    const by = idOf(founding.p, 'civ_id') ?? idOf(founding.p, 'site_civ_id')
    const builder = idOf(founding.p, 'builder_hfid')
    sentences.push(
      said(
        site,
        ' was founded',
        inYear(founding.year),
        by !== null && names.entity?.[by] ? flat(' by ', civ(by, 'a people')) : '',
        builder !== null && names.historical_figure?.[builder]
          ? flat(', its builder ', named(names, 'historical_figure', builder, 'a builder'))
          : '',
      ),
    )
  }
  if (lastConquest) {
    const taker = idOf(lastConquest.p, 'attacker_civ_id')
    const loser = idOf(lastConquest.p, 'defender_civ_id')
    sentences.push(
      said(
        conquests.length === 1
          ? 'It was conquered once'
          : `It was conquered ${conquests.length} times`,
        conquests.length > 1 ? ', most recently' : '',
        inYear(lastConquest.year),
        taker !== null && names.entity?.[taker]
          ? flat(', when ', civ(taker, 'a foe'), ' took it')
          : '',
        loser !== null && names.entity?.[loser] ? flat(' from ', civ(loser, 'its holders')) : '',
      ),
    )
  }
  if (lastRuin) {
    const hf = idOf(lastRuin.p, 'attacker_hfid')
    const by = idOf(lastRuin.p, 'attacker_civ_id')
    sentences.push(
      said(
        ruins.length > 1
          ? `It was laid waste ${ruins.length} times, the last`
          : 'It was laid waste',
        inYear(lastRuin.year),
        hf !== null && names.historical_figure?.[hf]
          ? flat(' by ', named(names, 'historical_figure', hf, 'a destroyer'))
          : by !== null && names.entity?.[by]
            ? flat(' by ', civ(by, 'a foe'))
            : '',
      ),
    )
  }
  if (lastReclaim) {
    const by = idOf(lastReclaim.p, 'civ_id')
    sentences.push(
      said(
        'It was reclaimed',
        inYear(lastReclaim.year),
        by !== null && names.entity?.[by] ? flat(' by ', civ(by, 'settlers')) : '',
      ),
    )
  }
  if (battles.length) {
    sentences.push(
      said(
        battles.length === 1
          ? 'One battle was fought here: '
          : `${counted(battles.length, 'battle')} were fought here, the latest `,
        named(
          names,
          'historical_event_collection',
          latestBattle.id,
          'a battle the records do not name',
        ),
        inYear(latestBattle.year),
      ),
    )
  }
  if (last?.type === 'hf destroyed site' && holder === null)
    sentences.push(said('It lies in ruins when the records close'))
  else if (
    holder !== null &&
    names.entity?.[holder] &&
    (founding || conquests.length || ruins.length)
  )
    sentences.push(said('When the records close it is held by ', civ(holder, 'a people')))
  else if (holder !== null && names.entity?.[holder])
    sentences.push(said(site, ' is held by ', civ(holder, 'a people')))
  return paragraph(sentences)
}

/** The two sides, the years, the battles and conquests, and how it ended. */
export async function warOpening(
  worldId: number,
  warId: number,
  payload: LegendsPayload,
): Promise<Prose> {
  const W = eq(R.world_id, worldId)
  const aggressor = idOf(payload, 'aggressor_ent_id')
  const defender = idOf(payload, 'defender_ent_id')
  const start = num(payload.start_year)
  const end = num(payload.end_year)
  const childIds = numList(payload.eventcol).slice(0, 2000)
  const eventIds = numList(payload.event).slice(0, 2000)
  const [children, peace] = await Promise.all([
    childIds.length
      ? postgres_db
          .select({ id: R.id, type: R.type, year: R.year, payload: R.payload })
          .from(R)
          .where(and(W, eq(R.kind, 'historical_event_collection'), inArray(R.id, childIds)))
          .orderBy(asc(R.year), asc(R.id))
      : Promise.resolve([]),
    eventIds.length
      ? postgres_db
          .select({ type: R.type, year: R.year })
          .from(R)
          .where(
            and(
              W,
              eq(R.kind, 'historical_event'),
              inArray(R.id, eventIds),
              inArray(R.type, ['peace accepted', 'peace rejected']),
            ) as SQL,
          )
          .orderBy(asc(R.year), asc(R.id))
      : Promise.resolve([]),
  ])
  const battles = children.filter((c) => c.type === 'battle')
  const conquered = children.filter((c) => c.type === 'site conquered')
  const outcome = (c: (typeof battles)[number]) => str((c.payload as LegendsPayload).outcome)
  const won = battles.filter((b) => outcome(b) === 'attacker won').length
  const held = battles.filter((b) => outcome(b) === 'defender won').length
  const deaths = (c: (typeof battles)[number]) => {
    const p = c.payload as LegendsPayload
    const sum = (v: unknown) => numList(v).reduce((a, b) => a + b, 0)
    return sum(p.attacking_squad_deaths) + sum(p.defending_squad_deaths)
  }
  const bloodiest = [...battles].sort((a, b) => deaths(b) - deaths(a))[0]
  const takenSites = [
    ...new Set(
      conquered
        .map((c) => idOf(c.payload as LegendsPayload, 'site_id'))
        .filter((id): id is number => id !== null),
    ),
  ]
  const accepted = peace.find((e) => e.type === 'peace accepted')
  const refused = peace.filter((e) => e.type === 'peace rejected').length

  const refs: RefSet = {}
  addRef(refs, 'historical_event_collection', warId)
  addRef(refs, 'entity', aggressor)
  addRef(refs, 'entity', defender)
  if (bloodiest && deaths(bloodiest) > 0) addRef(refs, 'historical_event_collection', bloodiest.id)
  for (const s of takenSites.slice(0, 3)) addRef(refs, 'site', s)
  const names = await lookupNames(worldId, refs)
  const side = (id: number | null, fallback: string) => named(names, 'entity', id, fallback)
  const ongoing = end === null || end < 0

  const sentences: (Prose | null)[] = []
  sentences.push(
    said(
      named(names, 'historical_event_collection', warId, 'This war'),
      ' was waged by ',
      side(aggressor, 'a people the records do not name'),
      ' against ',
      side(defender, 'a people the records do not name'),
      start === null || start < 0
        ? ''
        : ongoing
          ? `, beginning in ${start}; it was still unended when the records close`
          : end === start
            ? `, all within the year ${start}`
            : `, from ${start} to ${end}`,
    ),
  )
  const parts: string[] = []
  if (battles.length) parts.push(counted(battles.length, 'battle'))
  if (conquered.length) parts.push(counted(conquered.length, 'conquest'))
  const many = (n: number) => (n === 1 ? 'one' : n.toLocaleString())
  const result =
    won && held
      ? `; the attackers won ${many(won)} and the defenders held ${many(held)}`
      : won
        ? won === battles.length
          ? `; the attackers won ${won === 1 ? 'it' : `all ${many(won)}`}`
          : `; the attackers won ${many(won)}`
        : held
          ? held === battles.length
            ? `; the defenders held ${held === 1 ? 'it' : `all ${many(held)}`}`
            : `; the defenders held ${many(held)}`
          : ''
  if (parts.length) sentences.push(said(`It saw ${parts.join(' and ')}`, result))
  if (takenSites.length)
    sentences.push(
      said(
        takenSites.length > 3
          ? 'Among the sites taken were '
          : takenSites.length === 1
            ? 'The site taken was '
            : 'The sites taken were ',
        andList(takenSites.slice(0, 3).map((s) => flat(named(names, 'site', s, 'a site')))),
      ),
    )
  if (bloodiest && deaths(bloodiest) > 0 && battles.length > 1)
    sentences.push(
      said(
        'The bloodiest battle was ',
        named(names, 'historical_event_collection', bloodiest.id, 'one the records do not name'),
        inYear(bloodiest.year),
        `, where ${counted(deaths(bloodiest), 'soldier')} fell`,
      ),
    )
  if (accepted)
    sentences.push(
      said(
        refused ? `After ${counted(refused, 'refused offer')} of peace, it` : 'It',
        ' ended in an accepted peace',
        inYear(accepted.year),
      ),
    )
  else if (refused)
    sentences.push(
      said(
        refused === 1
          ? 'Peace was offered once and refused'
          : `Peace was offered ${refused} times and refused`,
      ),
    )
  return paragraph(sentences)
}

/** The opening for a record page, or an empty paragraph when the kind has none. */
export async function openingFor(
  worldId: number,
  kind: string,
  id: number,
  payload: LegendsPayload,
): Promise<Prose> {
  if (kind === 'site') return siteOpening(worldId, id, payload)
  if (kind === 'historical_event_collection' && str(payload.type) === 'war')
    return warOpening(worldId, id, payload)
  if (kind === 'entity' && str(plusOf(payload).type) === 'civilization') return civPast(worldId, id)
  return []
}
