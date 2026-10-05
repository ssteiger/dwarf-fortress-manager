import { type LegendsPayload, type LegendsRecord, postgres_db, schema } from '@fortress/db-drizzle'
import { type SQL, and, asc, eq, inArray, sql } from 'drizzle-orm'

import { describeEvent, num, objList, plusOf, str } from '../events'
import { racePlural, words } from '../model'
import {
  type Prose,
  andList,
  counted,
  displayName,
  flat,
  list,
  named,
  paragraph,
  said,
  withArticle,
} from '../prose'
import type { HeldPosition, NameIndex } from '../types'
import { curseFamily } from './chronicle'
import { figureEventCounts, recordEndYear } from './memo'
import { type RefSet, addRef, addRefs, lookupNames, resolvePositions } from './records'

/*
 * A figure's life told in sentences, from their record and the events that
 * name them. Every clause stands on a field of the export; where the record
 * is silent the telling leaves that part out rather than guess.
 *
 * Server only; the browser reaches it through `tellings.ts`.
 */

const R = schema.legends_records

export interface LifeStory {
  /** Origins, work and rank, deeds, bonds, and the end, as far as the record tells them. */
  paragraphs: Prose[]
  /** One sentence for cards and lists. */
  line: Prose
}

/** Events that move a life along, as opposed to the seasons of feasts and contests. */
const LIFE_TYPES = [
  'change hf job',
  'add hf entity link',
  'add hf hf link',
  'artifact created',
  'written content composed',
  'poetic form created',
  'musical form created',
  'dance form created',
  'knowledge discovered',
  'hf revived',
  'hf attacked site',
  'hf destroyed site',
  'created site',
  'hf abducted',
  'hf convicted',
  'changed creature type',
  'hf performed horrible experiments',
]

const GRUDGES = [
  'grudge',
  'jealous_obsession',
  'religious_persecution_grudge',
  'persecution_grudge',
  'jealous_relationship_grudge',
]

const FRIEND_VERBS: Record<string, string> = {
  childhood_friend: 'grew up with',
  war_buddy: 'fought beside',
  athlete_buddy: 'trained alongside',
  scholar_buddy: 'studied with',
  artistic_buddy: 'made art with',
}

/** How each recorded cause of death reads after "she". */
const DEATH_VERBS: Record<string, string> = {
  struck: 'was struck down',
  murdered: 'was murdered',
  shot: 'was shot',
  'old age': 'died of old age',
  'exec beheaded': 'was beheaded in an execution',
  'exec hacked to pieces': 'was hacked to pieces in an execution',
  'exec generic': 'was executed',
  'exec drowned': 'was drowned in an execution',
  'exec burned alive': 'was burned alive in an execution',
  'exec buried alive': 'was buried alive in an execution',
  'exec crucified': 'was crucified in an execution',
  'exec fed to beasts': 'was fed to beasts in an execution',
  drowned: 'drowned',
  bled: 'bled to death',
  thirst: 'died of thirst',
  starved: 'starved to death',
  infection: 'died of an infection',
  suffocated: 'suffocated',
  'scared to death': 'was scared to death',
  'burned alive': 'was burned alive',
  'crushed by a bridge': 'was crushed by a bridge',
  'cave in': 'was crushed in a cave-in',
  'fell to death': 'fell to their death',
  vanished: 'vanished',
}

interface Battle {
  id: number
  name: string | null
  year: number | null
  won: boolean | null
}

interface Relationship {
  other: number
  type: string
  /** True when this figure holds the feeling, false when it is held about them. */
  holds: boolean
}

interface LifeFacts {
  id: number
  name: string | null
  type: string | null
  p: LegendsPayload
  events: LegendsRecord[]
  death: LegendsRecord | null
  kills: { total: number; victims: number[] }
  devoured: { total: number; victims: number[] }
  bites: { total: number; action: string | null }
  bitten: LegendsRecord | null
  battles: Battle[]
  fights: number
  works: number
  relationships: Relationship[]
  worshippers: number
  positions: HeldPosition[]
  endYear: number | null
  fame: Map<number, number>
  names: NameIndex
}

// ---------------------------------------------------------------------------
// Reading the record

function hfLinkIds(p: LegendsPayload, ...types: string[]): number[] {
  return objList(p.hf_link)
    .filter((l) => types.includes(str(l.link_type) ?? ''))
    .map((l) => num(l.hfid))
    .filter((id): id is number => id !== null && id >= 0)
}

function entityLinkIds(p: LegendsPayload, type: string): number[] {
  return [
    ...new Set(
      objList(p.entity_link)
        .filter((l) => str(l.link_type) === type)
        .map((l) => num(l.entity_id))
        .filter((id): id is number => id !== null && id >= 0),
    ),
  ]
}

function raceOf(p: LegendsPayload, type: string | null): string {
  return words(str(plusOf(p).race) ?? type)
}

function intArray(ids: number[]): SQL {
  return sql`array[${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )}]::int[]`
}

async function gatherLife(worldId: number, id: number): Promise<LifeFacts | null> {
  const W = eq(R.world_id, worldId)
  const mentions = sql`${R.hfids} @> ARRAY[${id}]::int[]`
  const E = and(W, eq(R.kind, 'historical_event'), mentions) as SQL
  const count = (where: SQL) =>
    postgres_db
      .select({ count: sql<number>`count(*)::int` })
      .from(R)
      .where(where)
      .then((rows) => Number(rows[0]?.count ?? 0))

  const rows = await postgres_db
    .select()
    .from(R)
    .where(and(W, eq(R.kind, 'historical_figure'), eq(R.id, id)))
    .limit(1)
  const record = rows[0]
  if (!record) return null
  const p = record.payload as LegendsPayload
  const killWhere = and(
    E,
    eq(R.type, 'hf died'),
    sql`(${R.payload}->>'slayer_hfid')::int = ${id}`,
  ) as SQL
  const eatWhere = and(
    E,
    eq(R.type, 'creature devoured'),
    sql`(${R.payload}->'plus'->>'eater')::int = ${id}`,
  ) as SQL
  const biteWhere = and(
    E,
    eq(R.type, 'hf does interaction'),
    sql`(${R.payload}->>'doer_hfid')::int = ${id}`,
  ) as SQL

  const [
    events,
    deathRows,
    killTotal,
    killRows,
    eatTotal,
    eatRows,
    biteTotal,
    biteRows,
    bittenRows,
    fights,
    battleRows,
    works,
    relationRows,
    worshippers,
    positions,
    endYear,
    fame,
  ] = await Promise.all([
    postgres_db
      .select()
      .from(R)
      .where(and(E, inArray(R.type, LIFE_TYPES)))
      .orderBy(asc(R.year), sql`(${R.payload}->>'seconds72')::int asc nulls first`, asc(R.id))
      .limit(400),
    postgres_db
      .select()
      .from(R)
      .where(and(E, eq(R.type, 'hf died'), sql`(${R.payload}->>'hfid')::int = ${id}`))
      .limit(1),
    count(killWhere),
    postgres_db
      .select({ victim: sql<number | null>`(${R.payload}->>'hfid')::int` })
      .from(R)
      .where(killWhere)
      .orderBy(asc(R.year))
      .limit(400),
    count(eatWhere),
    postgres_db
      .select({ victim: sql<number | null>`(${R.payload}->'plus'->>'victim')::int` })
      .from(R)
      .where(and(eatWhere, sql`(${R.payload}->'plus'->>'victim')::int >= 0`))
      .limit(100),
    count(biteWhere),
    postgres_db
      .select({ action: sql<string | null>`${R.payload}->'plus'->>'interaction_action'` })
      .from(R)
      .where(biteWhere)
      .limit(1),
    postgres_db
      .select()
      .from(R)
      .where(
        and(E, eq(R.type, 'hf does interaction'), sql`(${R.payload}->>'target_hfid')::int = ${id}`),
      )
      .orderBy(asc(R.year))
      .limit(1),
    count(and(E, eq(R.type, 'hf simple battle event')) as SQL),
    postgres_db
      .select({ id: R.id, name: R.name, payload: R.payload })
      .from(R)
      .where(and(W, eq(R.kind, 'historical_event_collection'), eq(R.type, 'battle'), mentions))
      .orderBy(asc(R.year), asc(R.id))
      .limit(100),
    count(
      and(
        W,
        eq(R.kind, 'written_content'),
        sql`(${R.payload}->>'author_hfid')::int = ${id}`,
      ) as SQL,
    ),
    postgres_db
      .select({ payload: R.payload })
      .from(R)
      .where(and(W, eq(R.kind, 'historical_event_relationship'), mentions))
      .limit(300),
    p.deity === true
      ? count(
          and(
            W,
            eq(R.kind, 'historical_figure'),
            sql`(${R.payload}->'hf_link' @> ${JSON.stringify([{ hfid: id, link_type: 'deity' }])}::jsonb
              or ${R.payload}->'hf_link' @> ${JSON.stringify({ hfid: id, link_type: 'deity' })}::jsonb)`,
          ) as SQL,
        )
      : Promise.resolve(0),
    resolvePositions(worldId, p),
    recordEndYear(worldId),
    figureEventCounts(worldId),
  ])

  const battles: Battle[] = battleRows.map((row) => {
    const bp = row.payload as LegendsPayload
    const attacking = Array.isArray(bp.attacking_hfid) && bp.attacking_hfid.includes(id)
    const defending = Array.isArray(bp.defending_hfid) && bp.defending_hfid.includes(id)
    const outcome = str(bp.outcome)
    const won =
      outcome === 'attacker won'
        ? attacking
          ? true
          : defending
            ? false
            : null
        : outcome === 'defender won'
          ? defending
            ? true
            : attacking
              ? false
              : null
          : null
    return { id: row.id, name: row.name, year: num(bp.start_year), won }
  })

  const relationships: Relationship[] = []
  for (const row of relationRows) {
    const rp = plusOf(row.payload as LegendsPayload)
    const source = num(rp.source_hf)
    const target = num(rp.target_hf)
    const type = str(rp.relationship)
    if (source === null || target === null || !type) continue
    if (source === id && target >= 0) relationships.push({ other: target, type, holds: true })
    else if (target === id && source >= 0) relationships.push({ other: source, type, holds: false })
  }

  const facts: LifeFacts = {
    id,
    name: record.name,
    type: record.type,
    p,
    events,
    death: deathRows[0] ?? null,
    kills: {
      total: killTotal,
      victims: killRows.map((r) => Number(r.victim)).filter((v) => Number.isInteger(v) && v >= 0),
    },
    devoured: {
      total: eatTotal,
      victims: eatRows.map((r) => Number(r.victim)).filter((v) => Number.isInteger(v) && v >= 0),
    },
    bites: { total: biteTotal, action: biteRows[0]?.action ?? null },
    bitten: bittenRows[0] ?? null,
    battles,
    fights,
    works,
    relationships,
    worshippers,
    positions,
    endYear,
    fame,
    names: {},
  }

  const refs: RefSet = {}
  addRefs(refs, p)
  for (const event of events) addRefs(refs, event.payload)
  if (facts.death) addRefs(refs, facts.death.payload)
  if (facts.bitten) addRefs(refs, facts.bitten.payload)
  for (const victim of [...facts.kills.victims, ...facts.devoured.victims])
    addRef(refs, 'historical_figure', victim)
  for (const rel of relationships) addRef(refs, 'historical_figure', rel.other)
  for (const battle of battles) addRef(refs, 'historical_event_collection', battle.id)
  facts.names = await lookupNames(worldId, refs)
  return facts
}

// ---------------------------------------------------------------------------
// Telling it

interface Voice {
  she: string
  her: string
  him: string
  was: string
  has: string
  /** "they" takes plural verbs. */
  plural: boolean
}

function voiceOf(p: LegendsPayload): Voice {
  const sex = num(plusOf(p).sex)
  if (sex === 0)
    return { she: 'she', her: 'her', him: 'her', was: 'was', has: 'has', plural: false }
  if (sex === 1) return { she: 'he', her: 'his', him: 'him', was: 'was', has: 'has', plural: false }
  return { she: 'they', her: 'their', him: 'them', was: 'were', has: 'have', plural: true }
}

/** Present tense while they live, past once they are gone: "carries" / "carry" / "carried". */
function tense(v: Voice, alive: boolean, singular: string, plural: string, past: string): string {
  if (!alive) return past
  return v.plural ? plural : singular
}

function withWas(v: Voice, phrase: string): string {
  return phrase.replace(/^was /, `${v.was} `)
}

function isAlive(p: LegendsPayload): boolean {
  const death = num(p.death_year)
  return death === null || death < 0
}

function payloadOf(event: LegendsRecord): LegendsPayload {
  return event.payload as LegendsPayload
}

function eventsOfType(f: LifeFacts, type: string, key: string): LegendsRecord[] {
  return f.events.filter((e) => e.type === type && num(payloadOf(e)[key]) === f.id)
}

/** The best-known named records first, the rest after. */
function byFame(f: LifeFacts, ids: number[]): number[] {
  return [...new Set(ids)]
    .filter((id) => f.names.historical_figure?.[id])
    .sort((a, b) => (f.fame.get(b) ?? 0) - (f.fame.get(a) ?? 0))
}

function hf(f: LifeFacts, id: number, fallback = 'someone the records do not name'): Prose {
  return [named(f.names, 'historical_figure', id, fallback)]
}

function who(f: LifeFacts): string {
  if (f.name) return displayName(f.name)
  const race = raceOf(f.p, f.type)
  return `This ${race || 'creature'}`
}

function inYear(year: number | null | undefined): string {
  return typeof year === 'number' && year >= 0 ? ` in ${year}` : ''
}

/** "In 231, " and the event's own sentence, for the turns a life takes once. */
function turn(f: LifeFacts, event: LegendsRecord): Prose {
  const year = event.year
  const sentence = describeEvent(event, f.names).fragments
  return flat(typeof year === 'number' && year >= 0 ? `In ${year}, ` : '', sentence)
}

function origins(f: LifeFacts, v: Voice): Prose {
  const { p } = f
  const name = who(f)
  const race = raceOf(p, f.type)
  const alive = isAlive(p)
  const spheres = Array.isArray(p.sphere) ? p.sphere.map((s) => words(String(s))) : []
  if (p.deity === true) {
    return paragraph([
      said(
        `${name} is a deity`,
        spheres.length ? ` of ${list(spheres)}` : '',
        race ? `, depicted as ${withArticle(race)}` : '',
      ),
      f.worshippers
        ? said(`${counted(f.worshippers, 'figure')} in the records worship ${v.him}`)
        : null,
    ])
  }
  if (p.force === true) {
    return said(`${name} is a force of nature`, spheres.length ? `, of ${list(spheres)}` : '')
  }
  const sex = num(plusOf(p).sex)
  const kind = race ? `${sex === 0 ? 'female ' : sex === 1 ? 'male ' : ''}${race}` : ''
  const parents = [...hfLinkIds(p, 'mother'), ...hfLinkIds(p, 'father')].map((id) => hf(f, id))
  const birth = num(p.birth_year)
  const described = f.name && kind ? `, ${withArticle(kind)},` : ''
  let first: Prose
  if (birth !== null && birth >= 0) {
    first = said(
      name,
      described,
      ` was born in ${birth}`,
      parents.length ? [' to ', ...andList(parents)] : '',
    )
  } else if (birth !== null) {
    first = said(
      name,
      described,
      alive ? ' is older than recorded history' : ' was older than recorded history',
      parents.length ? [', a child of ', ...andList(parents)] : '',
    )
  } else {
    first = said(
      name,
      kind ? ` ${alive ? 'is' : 'was'} ${withArticle(kind)}` : ' appears in the records',
    )
  }
  const appeared = num(p.appeared)
  const late =
    appeared !== null && appeared > 1 && (birth === null || birth < 0 || appeared - birth >= 5)
  return paragraph([first, late ? said(`The records first mention ${v.him} in ${appeared}`) : null])
}

function rank(f: LifeFacts, v: Voice): Prose {
  const { p, names } = f
  const alive = isAlive(p)
  const sentences: Prose[] = []

  const jobs: string[] = []
  for (const event of eventsOfType(f, 'change hf job', 'hfid')) {
    const job = words(str(plusOf(payloadOf(event)).new_job))
    if (job && job !== 'standard' && jobs[jobs.length - 1] !== job) jobs.push(job)
  }
  const trades = [...new Set(jobs)]
  if (trades.length === 1) sentences.push(said(v.she, ` worked as ${withArticle(trades[0])}`))
  else if (trades.length === 2)
    sentences.push(
      said(v.she, ` worked as ${withArticle(trades[0])} and later as ${withArticle(trades[1])}`),
    )
  else if (trades.length > 2)
    sentences.push(
      said(
        v.she,
        ` worked as ${list(trades.slice(0, 3).map(withArticle))}${trades.length > 3 ? ', among other trades' : ''}`,
      ),
    )

  const offices = f.positions.slice(0, 3)
  for (const office of offices) {
    const group = named(names, 'entity', office.entity.id, 'a group the records do not name')
    if (office.endYear === null) {
      sentences.push(
        said(
          v.she,
          ` became ${office.title} of `,
          group,
          inYear(office.startYear),
          alive
            ? ` and ${tense(v, true, 'still holds', 'still hold', '')} the office`
            : ' and held it to the end',
        ),
      )
    } else {
      const from = office.startYear !== null && office.startYear >= 0 ? office.startYear : null
      sentences.push(
        said(
          v.she,
          ` served as ${office.title} of `,
          group,
          from !== null ? ` from ${from} to ${office.endYear}` : ` until ${office.endYear}`,
        ),
      )
    }
  }
  if (f.positions.length > offices.length)
    sentences.push(
      said(v.she, ` held ${counted(f.positions.length - offices.length, 'other office')}`),
    )

  const inOffice = new Set(f.positions.map((pos) => pos.entity.id))
  const members = entityLinkIds(p, 'member').filter((id) => !inOffice.has(id) && names.entity?.[id])
  if (members.length) {
    const shown = members.slice(0, 4).map((id) => [named(names, 'entity', id, 'a group')])
    sentences.push(
      said(
        v.she,
        ` ${alive ? (v.plural ? 'are' : 'is') : v.was} a member of `,
        andList(
          members.length > 4
            ? [...shown, [{ text: counted(members.length - 4, 'other group') }]]
            : shown,
        ),
      ),
    )
  }
  const former = entityLinkIds(p, 'former member').filter((id) => names.entity?.[id])
  if (former.length)
    sentences.push(
      said(
        v.she,
        ' had once belonged to ',
        andList(former.slice(0, 3).map((id) => [named(names, 'entity', id, 'a group')])),
      ),
    )
  const captors: [string, string][] = [
    ['prisoner', ' held prisoner by '],
    ['former prisoner', ' once held prisoner by '],
    ['slave', ' enslaved by '],
    ['former slave', ' once enslaved by '],
    ['criminal', ' named a criminal by '],
  ]
  for (const [type, phrase] of captors) {
    const ids = entityLinkIds(p, type)
    if (ids.length)
      sentences.push(
        said(
          v.she,
          ` ${v.was}${phrase}`,
          andList(ids.slice(0, 2).map((id) => [named(names, 'entity', id, 'a group')])),
        ),
      )
  }
  return paragraph(sentences)
}

function deeds(f: LifeFacts, v: Voice): Prose {
  const { names } = f
  const sentences: Prose[] = []
  const battleRef = (b: Battle): Prose => [
    named(names, 'historical_event_collection', b.id, 'a battle the records do not name'),
  ]

  if (f.battles.length === 1) {
    const b = f.battles[0]
    sentences.push(
      said(
        v.she,
        ' fought in ',
        battleRef(b),
        inYear(b.year),
        b.won === null ? '' : b.won ? ', on the winning side' : ', on the losing side',
      ),
    )
  } else if (f.battles.length > 1) {
    const known = f.battles.filter((b) => b.won !== null)
    const wins = known.filter((b) => b.won).length
    sentences.push(
      said(
        v.she,
        ` fought in ${f.battles.length.toLocaleString()} battles, among them `,
        andList(
          f.battles
            .slice(0, 2)
            .map((b) => flat(battleRef(b), b.year !== null && b.year >= 0 ? ` (${b.year})` : '')),
        ),
        known.length
          ? `; ${v.her} side won ${wins === known.length ? (known.length === 2 ? 'both' : 'all of them') : `${wins} of ${known.length}`}`
          : '',
      ),
    )
  }
  if (f.fights > 0)
    sentences.push(
      said(v.she, f.battles.length ? ' also got into ' : ' got into ', counted(f.fights, 'fight')),
    )

  if (f.kills.total === 1 && f.kills.victims.length) {
    sentences.push(said(v.she, ' slew ', hf(f, f.kills.victims[0])))
  } else if (f.kills.total > 1) {
    const best = byFame(f, f.kills.victims).slice(0, 2)
    sentences.push(
      said(
        v.she,
        ` slew ${f.kills.total.toLocaleString()}`,
        best.length ? [', the best known of them ', ...andList(best.map((id) => hf(f, id)))] : '',
      ),
    )
  }
  if (f.devoured.total > 0) {
    const slain = new Set(f.kills.victims)
    const best = byFame(
      f,
      f.devoured.victims.filter((id) => !slain.has(id)),
    ).slice(0, 2)
    sentences.push(
      said(
        v.she,
        ` devoured ${counted(f.devoured.total, 'creature')}`,
        best.length ? [', among them ', ...andList(best.map((id) => hf(f, id)))] : '',
      ),
    )
  }
  if (f.bites.total > 0 && f.bites.action) {
    const curse = /^bit passing on (.+)$/.exec(f.bites.action)?.[1]
    if (curse)
      sentences.push(said(v.she, ` bit ${counted(f.bites.total, 'victim')}, passing on ${curse}`))
  }

  const siteRefs = (events: LegendsRecord[]): Prose[] =>
    events
      .slice(0, 2)
      .map((e) => flat(named(names, 'site', num(payloadOf(e).site_id), 'a site'), inYear(e.year)))
  const founded = eventsOfType(f, 'created site', 'builder_hfid')
  if (founded.length) sentences.push(said(v.she, ' founded ', andList(siteRefs(founded))))
  const attacked = eventsOfType(f, 'hf attacked site', 'attacker_hfid')
  if (attacked.length)
    sentences.push(
      said(
        v.she,
        ' attacked ',
        attacked.length > 2 ? `${attacked.length} sites, among them ` : '',
        andList(siteRefs(attacked)),
      ),
    )
  const razed = eventsOfType(f, 'hf destroyed site', 'attacker_hfid')
  if (razed.length)
    sentences.push(
      said(
        v.she,
        ' laid waste to ',
        razed.length > 2 ? `${razed.length} sites, among them ` : '',
        andList(siteRefs(razed)),
      ),
    )

  const made = eventsOfType(f, 'artifact created', 'hist_figure_id')
  if (made.length)
    sentences.push(
      said(
        v.she,
        ' made ',
        made.length > 3 ? `${made.length} artifacts, among them ` : '',
        andList(
          made
            .slice(0, 3)
            .map((e) =>
              flat(
                named(names, 'artifact', num(payloadOf(e).artifact_id), 'an artifact'),
                inYear(e.year),
              ),
            ),
        ),
      ),
    )
  const written = eventsOfType(f, 'written content composed', 'hist_figure_id')
    .map((e) => num(payloadOf(e).wc_id))
    .filter((id): id is number => id !== null && id >= 0 && !!names.written_content?.[id])
  if (f.works === 1 && written.length)
    sentences.push(said(v.she, ' wrote ', named(names, 'written_content', written[0], 'a work')))
  else if (f.works > 1)
    sentences.push(
      said(
        v.she,
        ` wrote ${f.works.toLocaleString()} works`,
        written.length
          ? [
              ', among them ',
              ...andList(
                written.slice(0, 2).map((id) => [named(names, 'written_content', id, 'a work')]),
              ),
            ]
          : '',
      ),
    )
  const forms = [
    ...eventsOfType(f, 'poetic form created', 'hist_figure_id').map(
      (e) => ['poetic_form', e] as const,
    ),
    ...eventsOfType(f, 'musical form created', 'hist_figure_id').map(
      (e) => ['musical_form', e] as const,
    ),
    ...eventsOfType(f, 'dance form created', 'hist_figure_id').map(
      (e) => ['dance_form', e] as const,
    ),
  ]
  if (forms.length)
    sentences.push(
      said(
        v.she,
        ' devised ',
        andList(
          forms
            .slice(0, 3)
            .map(([kind, e]) => [
              named(names, kind, num(payloadOf(e).form_id), `a new ${words(kind)}`),
            ]),
        ),
      ),
    )
  const firsts = eventsOfType(f, 'knowledge discovered', 'hfid')
    .filter((e) => payloadOf(e).first === true)
    .map((e) => {
      const parts = (str(payloadOf(e).knowledge) ?? '').split(':')
      return words(parts[parts.length - 1])
    })
    .filter(Boolean)
  if (firsts.length)
    sentences.push(
      said(v.she, ` ${v.was} the first to discover ${list([...new Set(firsts)].slice(0, 3))}`),
    )

  const raised = eventsOfType(f, 'hf revived', 'actor_hfid')
    .map((e) => num(payloadOf(e).hfid))
    .filter((id): id is number => id !== null && id >= 0)
  if (raised.length) {
    const best = byFame(f, raised).slice(0, 2)
    sentences.push(
      said(
        v.she,
        ` raised ${counted(raised.length, 'figure')} from the dead`,
        best.length ? [', among them ', ...andList(best.map((id) => hf(f, id)))] : '',
      ),
    )
  }
  const experiments = eventsOfType(f, 'hf performed horrible experiments', 'group_hfid')
  if (experiments.length) {
    const where = num(payloadOf(experiments[0]).site_id)
    sentences.push(
      said(
        v.she,
        ' performed horrible experiments',
        where !== null && where >= 0 ? flat(' in ', named(names, 'site', where, 'a site')) : '',
        inYear(experiments[0].year),
      ),
    )
  }

  const turns = f.events.filter(
    (e) =>
      (e.type === 'hf abducted' &&
        (num(payloadOf(e).target_hfid) === f.id || num(payloadOf(e).snatcher_hfid) === f.id)) ||
      (e.type === 'hf convicted' && num(payloadOf(e).convicted_hfid) === f.id),
  )
  for (const event of turns.slice(0, 2)) sentences.push(said(turn(f, event)))
  return paragraph(sentences)
}

function bonds(f: LifeFacts, v: Voice): Prose {
  const { p, names } = f
  const sentences: Prose[] = []
  const married = new Map<number, number>()
  for (const event of f.events) {
    if (event.type !== 'add hf hf link') continue
    const ep = payloadOf(event)
    if (str(plusOf(ep).link_type) !== 'spouse') continue
    const a = num(ep.hfid)
    const b = num(ep.hfid_target)
    const other = a === f.id ? b : b === f.id ? a : null
    if (other !== null && other >= 0 && event.year !== null) married.set(other, event.year)
  }
  const spouses: [string, (id: number) => Prose][] = [
    ['spouse', (id) => said(v.she, ' married ', hf(f, id), inYear(married.get(id)))],
    [
      'deceased spouse',
      (id) => said(v.she, ' married ', hf(f, id), inYear(married.get(id)), ` and ${v.was} widowed`),
    ],
    ['former spouse', (id) => said(v.she, ` ${v.was} once married to `, hf(f, id))],
  ]
  const partnered = new Set<number>()
  const marriages: { id: number; tell: (id: number) => Prose }[] = []
  let untold = 0
  let unnamed = 0
  for (const [type, tell] of spouses) {
    let told = 0
    for (const id of hfLinkIds(p, type)) {
      if (partnered.has(id)) continue
      partnered.add(id)
      if (!names.historical_figure?.[id]) unnamed++
      if (!names.historical_figure?.[id] || told >= 2) untold++
      else {
        marriages.push({ id, tell })
        told++
      }
    }
  }
  marriages.sort(
    (a, b) =>
      (married.get(a.id) ?? Number.POSITIVE_INFINITY) -
      (married.get(b.id) ?? Number.POSITIVE_INFINITY),
  )
  for (const marriage of marriages) sentences.push(marriage.tell(marriage.id))
  if (untold) {
    const times = untold === 1 ? 'once' : untold === 2 ? 'twice' : `${untold} times`
    const whom = untold === 1 ? 'someone' : 'people'
    sentences.push(
      said(
        v.she,
        ` ${v.was} ${marriages.length ? 'also ' : ''}married ${times}`,
        untold === unnamed ? `, to ${whom} the records do not name` : '',
      ),
    )
  }

  const lovers = [
    ...new Set([
      ...hfLinkIds(p, 'lover', 'former lover'),
      ...f.relationships
        .filter((r) => r.type === 'lover' || r.type === 'former_lover')
        .map((r) => r.other),
    ]),
  ]
  if (lovers.length === 1) {
    if (!partnered.has(lovers[0]))
      sentences.push(said(v.she, ' took ', hf(f, lovers[0]), ' as a lover'))
  } else if (lovers.length > 1) {
    const best = byFame(
      f,
      lovers.filter((id) => !partnered.has(id)),
    ).slice(0, 1)
    sentences.push(
      said(
        v.she,
        ` took ${counted(lovers.length, 'lover')}`,
        best.length ? [', among them ', ...hf(f, best[0])] : '',
      ),
    )
  }

  const children = hfLinkIds(p, 'child')
  if (children.length === 1) sentences.push(said(v.she, ' had one child, ', hf(f, children[0])))
  else if (children.length > 1) {
    const best = byFame(f, children).slice(0, 2)
    sentences.push(
      said(
        v.she,
        ` had ${counted(children.length, 'child', 'children')}`,
        best.length ? [', among them ', ...andList(best.map((id) => hf(f, id)))] : '',
      ),
    )
  }

  const masters = hfLinkIds(p, 'master', 'former master')
  if (masters.length)
    sentences.push(said(v.she, ` learned ${v.her} trade from `, hf(f, masters[0])))
  const apprentices = hfLinkIds(p, 'apprentice', 'former apprentice')
  if (apprentices.length)
    sentences.push(
      said(v.she, ' trained ', andList(apprentices.slice(0, 2).map((id) => hf(f, id)))),
    )

  for (const [type, verb] of Object.entries(FRIEND_VERBS)) {
    const friends = byFame(
      f,
      f.relationships.filter((r) => r.type === type).map((r) => r.other),
    ).slice(0, 2)
    if (friends.length)
      sentences.push(said(v.she, ` ${verb} `, andList(friends.map((id) => hf(f, id)))))
  }

  const held = f.relationships.filter((r) => r.holds && GRUDGES.includes(r.type))
  for (const rel of held.slice(0, 2)) {
    const phrase =
      rel.type === 'jealous_obsession'
        ? ` ${v.was} jealously obsessed with `
        : ' held a grudge against '
    sentences.push(
      said(
        v.she,
        phrase,
        hf(f, rel.other),
        rel.type.includes('religious') ? ' over matters of faith' : '',
      ),
    )
  }
  const against = byFame(
    f,
    f.relationships.filter((r) => !r.holds && GRUDGES.includes(r.type)).map((r) => r.other),
  ).slice(0, 2)
  if (against.length)
    sentences.push(said(andList(against.map((id) => hf(f, id))), ` held a grudge against ${v.him}`))

  const gods = objList(p.hf_link)
    .filter((l) => str(l.link_type) === 'deity')
    .map((l) => ({ id: num(l.hfid) ?? -1, strength: num(l.link_strength) ?? 0 }))
    .filter((g) => g.id >= 0)
    .sort((a, b) => b.strength - a.strength)
  if (gods.length === 1) sentences.push(said(v.she, ' worshipped ', hf(f, gods[0].id, 'a god')))
  else if (gods.length > 1)
    sentences.push(
      said(
        v.she,
        ` worshipped ${gods.length.toLocaleString()} gods, most devotedly `,
        hf(f, gods[0].id, 'a god the records do not name'),
      ),
    )
  return paragraph(sentences)
}

function curseSentence(family: string, label: string, v: Voice, alive: boolean): string {
  if (family.startsWith('were-'))
    return `${v.she} ${tense(v, alive, 'carries', 'carry', 'carried')} the ${label}`
  switch (family) {
    case 'necromancer':
      return `${v.she} ${tense(v, alive, 'knows', 'know', 'knew')} the secret of raising the dead`
    case 'undead':
      return `${v.she} ${alive ? (v.plural ? 'are' : 'is') : v.was} undead`
    case 'ghoul':
      return `${v.she} ${alive ? (v.plural ? 'are' : 'is') : v.was} a ghoul`
    case 'vampire':
      return `${v.she} ${alive ? (v.plural ? 'are' : 'is') : v.was} a vampire`
    case 'divine':
      return `${v.she} ${tense(v, alive, 'lives', 'live', 'lived')} under a divine curse`
    case 'mythical':
      return `${v.she} ${tense(v, alive, 'holds', 'hold', 'held')} a mythical power`
    case 'regional':
      return `${v.she} ${alive ? (v.plural ? 'are' : 'is') : v.was} bound to the land itself`
    default:
      return `${v.she} ${tense(v, alive, 'carries', 'carry', 'carried')} a strange power`
  }
}

function theEnd(f: LifeFacts, v: Voice): Prose {
  const { p, names } = f
  const sentences: Prose[] = []
  const alive = isAlive(p)
  const birth = num(p.birth_year)
  const deathYear = num(p.death_year)

  const bitten = f.bitten ? payloadOf(f.bitten) : null
  if (f.bitten && bitten) {
    const action = str(plusOf(bitten).interaction_action)
    const curse = action ? /^bit passing on (.+)$/.exec(action)?.[1] : null
    const doer = num(bitten.doer_hfid)
    if (action && doer !== null)
      sentences.push(
        curse
          ? said(`In ${f.bitten.year},`, ' ', hf(f, doer), ` bit ${v.him}, passing on ${curse}`)
          : said(`In ${f.bitten.year}, ${v.she} ${v.was} ${action} by `, hf(f, doer)),
      )
  }
  for (const event of f.events
    .filter(
      (e) =>
        (e.type === 'changed creature type' && num(payloadOf(e).changee_hfid) === f.id) ||
        (e.type === 'hf revived' && num(payloadOf(e).hfid) === f.id),
    )
    .slice(0, 2))
    sentences.push(said(turn(f, event)))

  const families = new Map<string, string>()
  for (const token of Array.isArray(p.active_interaction) ? p.active_interaction.map(String) : []) {
    const family = curseFamily(token)
    if (!families.has(family.key)) families.set(family.key, family.label)
  }
  for (const [family, label] of families)
    sentences.push(said(curseSentence(family, label, v, alive)))

  if (!alive && deathYear !== null) {
    const age = birth !== null && birth >= 0 ? deathYear - birth : null
    const dp = f.death ? payloadOf(f.death) : null
    const cause = dp ? str(dp.cause) : null
    const slayerId = dp ? num(dp.slayer_hfid) : null
    const slayerRace = dp ? str(dp.slayer_race) : null
    const slayer: Prose | null =
      slayerId !== null && slayerId >= 0
        ? hf(f, slayerId, 'someone the records do not name')
        : slayerRace
          ? [{ text: withArticle(words(slayerRace.replace(/_\d+$/, ''))) }]
          : null
    const siteId = dp ? num(dp.site_id) : null
    const regionId = dp ? num(dp.subregion_id) : null
    const place: Prose | null =
      siteId !== null && siteId >= 0
        ? [named(names, 'site', siteId, 'a site')]
        : regionId !== null && regionId >= 0
          ? [named(names, 'region', regionId, 'the wilds')]
          : null
    const verb = cause ? (DEATH_VERBS[cause] ?? `died (${words(cause)})`) : 'died'
    sentences.push(
      said(
        `In ${deathYear}`,
        age !== null ? `, aged ${age}` : '',
        `, ${v.she} ${withWas(v, verb).replace('their death', `${v.her} death`)}`,
        slayer ? flat(' by ', slayer) : '',
        place ? flat(' in ', place) : '',
      ),
    )
  } else if (p.deity !== true && p.force !== true) {
    const unliving = families.has('undead') || families.has('ghoul') || p.animated === true
    sentences.push(
      said(
        v.she,
        unliving
          ? ' still walked when the records end'
          : ` ${v.was} still alive when the records end`,
        f.endYear !== null ? `, in ${f.endYear}` : '',
      ),
    )
  }
  if (p.animated === true)
    sentences.push(
      said(
        `${v.her} body rose again`,
        str(p.animated_string) ? ` as ${withArticle(words(str(p.animated_string)))}` : '',
      ),
    )
  if (p.ghost === true) sentences.push(said(`${v.her} ghost walks the world`))
  return paragraph(sentences)
}

// ---------------------------------------------------------------------------
// One line

interface LineFacts {
  name: string | null
  type: string | null
  p: LegendsPayload
  office: { title: string; entityId: number } | null
  job: string | null
  kills: number
  artifacts: number
  works: number
  battles: number
  names: NameIndex
}

function telling(f: LineFacts): Prose {
  const { p, names } = f
  const spheres = Array.isArray(p.sphere) ? p.sphere.map((s) => words(String(s))) : []
  if (p.deity === true)
    return said(`A deity${spheres.length ? ` of ${list(spheres.slice(0, 3))}` : ''}`)
  if (p.force === true)
    return said(`A force of nature${spheres.length ? `: ${list(spheres.slice(0, 3))}` : ''}`)
  const race = raceOf(p, f.type) || 'creature'
  const head: Prose = f.office
    ? flat(
        withArticle(`${race} ${f.office.title}`),
        ' of ',
        named(names, 'entity', f.office.entityId, 'a group'),
      )
    : flat(withArticle(f.job ? `${race} ${f.job}` : race))
  const birth = num(p.birth_year)
  const death = num(p.death_year)
  const span =
    birth === null
      ? ''
      : birth < 0
        ? ', older than recorded history'
        : death !== null && death >= 0
          ? `, ${birth} to ${death}`
          : `, born in ${birth}`
  const children = hfLinkIds(p, 'child').length
  const deed = f.kills
    ? `, who slew ${f.kills === 1 ? 'one' : f.kills.toLocaleString()}`
    : f.artifacts
      ? `, who made ${counted(f.artifacts, 'artifact')}`
      : f.works
        ? `, who wrote ${counted(f.works, 'work')}`
        : f.battles
          ? `, who fought in ${counted(f.battles, 'battle')}`
          : children
            ? `, with ${counted(children, 'child', 'children')}`
            : ''
  return said(head, span, deed)
}

function lineFromLife(f: LifeFacts): Prose {
  const current = f.positions.find((pos) => pos.endYear === null) ?? null
  const jobs = eventsOfType(f, 'change hf job', 'hfid')
    .map((e) => words(str(plusOf(payloadOf(e)).new_job)))
    .filter((job) => job && job !== 'standard')
  return telling({
    name: f.name,
    type: f.type,
    p: f.p,
    office: current ? { title: current.title, entityId: current.entity.id } : null,
    job: jobs[jobs.length - 1] ?? null,
    kills: f.kills.total,
    artifacts: eventsOfType(f, 'artifact created', 'hist_figure_id').length,
    works: f.works,
    battles: f.battles.length,
    names: f.names,
  })
}

// ---------------------------------------------------------------------------
// Entry points

export interface LifeParts {
  name: string | null
  origins: Prose
  rank: Prose
  deeds: Prose
  bonds: Prose
  end: Prose
  line: Prose
  /** The events the telling draws on, oldest first. */
  events: LegendsRecord[]
  names: NameIndex
}

/** A life in its separate parts, so a story can tell only the ones it needs. */
export async function lifeParts(worldId: number, id: number): Promise<LifeParts | null> {
  const facts = await gatherLife(worldId, id)
  if (!facts) return null
  const v = voiceOf(facts.p)
  return {
    name: facts.name,
    origins: origins(facts, v),
    rank: rank(facts, v),
    deeds: deeds(facts, v),
    bonds: bonds(facts, v),
    end: theEnd(facts, v),
    line: lineFromLife(facts),
    events: facts.death ? [...facts.events, facts.death] : facts.events,
    names: facts.names,
  }
}

/** The whole life of one figure, for their page and for stories about them. */
export async function tellLife(worldId: number, id: number): Promise<LifeStory | null> {
  const parts = await lifeParts(worldId, id)
  if (!parts) return null
  const paragraphs = [parts.origins, parts.rank, parts.deeds, parts.bonds, parts.end].filter(
    (para) => para.length,
  )
  return { paragraphs, line: parts.line }
}

/** One line each for many figures at once, for cards: what they were, when, and their mark. */
export async function lifeLines(worldId: number, ids: number[]): Promise<Map<number, Prose>> {
  const figureIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id >= 0))].slice(0, 200)
  const out = new Map<number, Prose>()
  if (!figureIds.length) return out
  const W = eq(R.world_id, worldId)
  const wanted = intArray(figureIds)
  const E = and(W, eq(R.kind, 'historical_event'), sql`${R.hfids} && ${wanted}`) as SQL
  const [records, kills, made, works, battles, jobs] = await Promise.all([
    postgres_db
      .select()
      .from(R)
      .where(and(W, eq(R.kind, 'historical_figure'), inArray(R.id, figureIds))),
    postgres_db.execute<{ hf: number; c: number }>(sql`
      select (${R.payload}->>'slayer_hfid')::int as hf, count(*)::int as c
      from ${R} where ${E} and ${R.type} = 'hf died'
        and (${R.payload}->>'slayer_hfid')::int = any(${wanted})
      group by 1`),
    postgres_db.execute<{ hf: number; c: number }>(sql`
      select (${R.payload}->>'hist_figure_id')::int as hf, count(*)::int as c
      from ${R} where ${E} and ${R.type} = 'artifact created'
        and (${R.payload}->>'hist_figure_id')::int = any(${wanted})
      group by 1`),
    postgres_db.execute<{ hf: number; c: number }>(sql`
      select (${R.payload}->>'author_hfid')::int as hf, count(*)::int as c
      from ${R} where ${W} and ${R.kind} = 'written_content'
        and (${R.payload}->>'author_hfid')::int = any(${wanted})
      group by 1`),
    postgres_db.execute<{ hf: number; c: number }>(sql`
      select u.hf, count(*)::int as c
      from ${R} b, unnest(b.hfids) as u(hf)
      where b.world_id = ${worldId} and b.kind = 'historical_event_collection' and b.type = 'battle'
        and b.hfids && ${wanted} and u.hf = any(${wanted})
      group by 1`),
    postgres_db.execute<{ hf: number; job: string | null }>(sql`
      select distinct on ((${R.payload}->>'hfid')::int) (${R.payload}->>'hfid')::int as hf,
        ${R.payload}->'plus'->>'new_job' as job
      from ${R} where ${E} and ${R.type} = 'change hf job'
        and (${R.payload}->>'hfid')::int = any(${wanted})
      order by (${R.payload}->>'hfid')::int, ${R.year} desc, ${R.id} desc`),
  ])
  const tally = (rows: Iterable<{ hf: number; c: number }>) =>
    new Map([...rows].map((r) => [Number(r.hf), Number(r.c)]))
  const killCount = tally(kills)
  const madeCount = tally(made)
  const workCount = tally(works)
  const battleCount = tally(battles)
  const lastJob = new Map([...jobs].map((r) => [Number(r.hf), words(r.job)]))

  const positions = await Promise.all(
    records.map((r) => resolvePositions(worldId, r.payload as LegendsPayload)),
  )
  const refs: RefSet = {}
  const offices = new Map<number, HeldPosition | null>()
  records.forEach((r, i) => {
    const office = positions[i].find((pos) => pos.endYear === null) ?? null
    offices.set(r.id, office)
    if (office) addRef(refs, 'entity', office.entity.id)
  })
  const names = await lookupNames(worldId, refs)
  for (const r of records) {
    const office = offices.get(r.id) ?? null
    const job = lastJob.get(r.id)
    out.set(
      r.id,
      telling({
        name: r.name,
        type: r.type,
        p: r.payload as LegendsPayload,
        office: office ? { title: office.title, entityId: office.entity.id } : null,
        job: job && job !== 'standard' ? job : null,
        kills: killCount.get(r.id) ?? 0,
        artifacts: madeCount.get(r.id) ?? 0,
        works: workCount.get(r.id) ?? 0,
        battles: battleCount.get(r.id) ?? 0,
        names,
      }),
    )
  }
  return out
}

// ---------------------------------------------------------------------------
// Your fortress in the record

export interface FortressDweller {
  figureId: number
  unitId: number
}

export interface FortressKin {
  /** The relative, who has a record of their own. */
  figureId: number
  /** What they are to the dweller: "mother", "grandfather", "spouse", "late spouse". */
  relation: string
  dweller: FortressDweller
}

export interface StoriedDweller extends FortressDweller {
  line: Prose
  /** Their best-known relative, when the record has one worth naming. */
  kin: Prose | null
}

export interface FortressTie {
  /** Citizens and residents with a historical figure, known to the export or not. */
  dwellers: number
  /** Dwellers the export knows. */
  living: FortressDweller[]
  kin: FortressKin[]
  /** The few with the most storied pasts or famous kin. */
  storied: StoriedDweller[]
  /** The civilization's past: its first site, its wars, the sites it lost. */
  civ: Prose
  names: NameIndex
}

const STORIED_OWN = 4
const STORIED_BY_KIN = 2
/** Events a relative needs before they count as famous. */
const FAMOUS_KIN = 10

function sexed(sex: number | null, female: string, male: string, other: string): string {
  return sex === 0 ? female : sex === 1 ? male : other
}

/** What the dweller is to their relative: "Daughter of", "Grandson of", "Married to". */
function kinNote(relation: string, dwellerSex: number | null): string {
  if (relation === 'mother' || relation === 'father')
    return sexed(dwellerSex, 'Daughter of ', 'Son of ', 'Child of ')
  if (relation.startsWith('grand'))
    return sexed(dwellerSex, 'Granddaughter of ', 'Grandson of ', 'Grandchild of ')
  if (relation === 'late spouse') return 'Married to the late '
  return 'Married to '
}

async function civPast(worldId: number, civId: number): Promise<Prose> {
  const W = eq(R.world_id, worldId)
  const events = and(W, eq(R.kind, 'historical_event')) as SQL
  const [civRows, founded, wars, lost] = await Promise.all([
    postgres_db
      .select({ payload: R.payload })
      .from(R)
      .where(and(W, eq(R.kind, 'entity'), eq(R.id, civId)))
      .limit(1),
    postgres_db.execute<{ site: number; year: number | null }>(sql`
      select (${R.payload}->>'site_id')::int as site, ${R.year} as year
      from ${R} where ${events} and ${R.type} = 'created site'
        and (${R.payload}->>'civ_id')::int = ${civId}
      order by ${R.year} asc, ${R.id} asc`),
    postgres_db.execute<{
      id: number
      start: number | null
      end: number | null
      aggressor: number | null
      defender: number | null
    }>(sql`
      select ${R.id} as id,
        (${R.payload}->>'start_year')::int as start, (${R.payload}->>'end_year')::int as "end",
        (${R.payload}->>'aggressor_ent_id')::int as aggressor,
        (${R.payload}->>'defender_ent_id')::int as defender
      from ${R}
      where ${W} and ${R.kind} = 'historical_event_collection' and ${R.type} = 'war'
        and ${civId} in ((${R.payload}->>'aggressor_ent_id')::int, (${R.payload}->>'defender_ent_id')::int)
      order by 2 asc, ${R.id} asc`),
    postgres_db.execute<{
      site: number
      year: number | null
      civ: number | null
      hf: number | null
    }>(sql`
      select (${R.payload}->>'site_id')::int as site, ${R.year} as year,
        (${R.payload}->>'attacker_civ_id')::int as civ, (${R.payload}->>'attacker_hfid')::int as hf
      from ${R} where ${events} and ${R.type} in ('site taken over', 'hf destroyed site')
        and (${R.payload}->>'defender_civ_id')::int = ${civId}
      order by ${R.year} desc, ${R.id} desc`),
  ])
  const firstSite = [...founded][0]
  const warList = [...wars]
  const lostList = [...lost]
  const lastLost = lostList[0]
  const foeOf = (w: (typeof warList)[number]) => (w.aggressor === civId ? w.defender : w.aggressor)

  const refs: RefSet = {}
  addRef(refs, 'entity', civId)
  if (firstSite) addRef(refs, 'site', firstSite.site)
  for (const w of [warList[0], warList[warList.length - 1]]) {
    if (!w) continue
    addRef(refs, 'historical_event_collection', w.id)
    addRef(refs, 'entity', foeOf(w))
  }
  if (lastLost) {
    addRef(refs, 'site', lastLost.site)
    addRef(refs, 'entity', lastLost.civ)
    addRef(refs, 'historical_figure', lastLost.hf)
  }
  const names = await lookupNames(worldId, refs)
  const race = str(plusOf((civRows[0]?.payload ?? {}) as LegendsPayload).race)
  const civName = named(names, 'entity', civId, 'Your civilization')
  const against = (w: (typeof warList)[number]) => {
    const foe = foeOf(w)
    return foe !== null && foe >= 0 && names.entity?.[foe]
      ? flat(' against ', named(names, 'entity', foe, 'a foe'))
      : ''
  }
  const war = (w: (typeof warList)[number]) =>
    named(names, 'historical_event_collection', w.id, 'a war the records do not name')

  const sentences: (Prose | null)[] = []
  sentences.push(
    firstSite
      ? said(
          civName,
          race ? `, a civilization of ${racePlural(race)},` : '',
          ' founded its first site, ',
          named(names, 'site', firstSite.site, 'a site the records do not name'),
          inYear(firstSite.year) ? `,${inYear(firstSite.year)}` : '',
          founded.length > 1 ? `, and ${counted(founded.length, 'site')} in all` : '',
        )
      : race
        ? said(civName, ` is a civilization of ${racePlural(race)}`)
        : null,
  )
  const first = warList[0]
  const latest = warList[warList.length - 1]
  if (first && warList.length === 1) {
    sentences.push(said('It fought one war, ', war(first), against(first), inYear(first.start)))
  } else if (first && latest) {
    const ongoing = latest.end === null || latest.end < 0
    sentences.push(
      said(`It fought ${counted(warList.length, 'war')}`),
      said('The first was ', war(first), against(first), inYear(first.start)),
      said(
        'The latest, ',
        war(latest),
        against(latest),
        ', began',
        inYear(latest.start),
        ongoing
          ? ' and was still unended when the records close'
          : latest.end === latest.start
            ? ' and ended the same year'
            : ` and ended in ${latest.end}`,
      ),
    )
  }
  if (lastLost) {
    const by =
      lastLost.civ !== null && names.entity?.[lastLost.civ]
        ? flat(' to ', named(names, 'entity', lastLost.civ, 'a foe'))
        : lastLost.hf !== null && names.historical_figure?.[lastLost.hf]
          ? flat(' to ', named(names, 'historical_figure', lastLost.hf, 'a foe'))
          : ''
    sentences.push(
      said(
        `It lost ${counted(lostList.length, 'site')} to conquest or ruin`,
        lostList.length > 1 ? ', the last ' : ', ',
        named(names, 'site', lastLost.site, 'a site the records do not name'),
        by,
        inYear(lastLost.year),
      ),
    )
  }
  return paragraph(sentences)
}

/** Where the fortress's people stand in the record: who is known, their kin, their civilization. */
export async function fortressInLegends(
  worldId: number,
  dwellers: FortressDweller[],
  civId: number | null,
): Promise<FortressTie> {
  const W = eq(R.world_id, worldId)
  const byFigure = new Map(
    dwellers
      .filter((d) => Number.isInteger(d.figureId) && d.figureId >= 0)
      .map((d) => [d.figureId, d]),
  )
  const ids = [...byFigure.keys()].slice(0, 2000)
  const linksOf = (where: SQL) =>
    postgres_db
      .select({
        id: R.id,
        sex: sql<number | null>`(${R.payload}->'plus'->>'sex')::int`,
        links: sql<unknown>`${R.payload}->'hf_link'`,
      })
      .from(R)
      .where(and(W, eq(R.kind, 'historical_figure'), where))
  const [figures, counts, past] = await Promise.all([
    ids.length ? linksOf(inArray(R.id, ids)) : Promise.resolve([]),
    figureEventCounts(worldId),
    civId !== null ? civPast(worldId, civId) : Promise.resolve(null),
  ])
  const fame = (id: number) => counts.get(id) ?? 0
  const living = figures.map((f) => byFigure.get(f.id)).filter((d): d is FortressDweller => !!d)
  const sexOf = new Map(figures.map((f) => [f.id, f.sex === null ? null : Number(f.sex)]))

  const direct: FortressKin[] = []
  for (const f of figures) {
    const dweller = byFigure.get(f.id)
    if (!dweller) continue
    const p = { hf_link: f.links } as LegendsPayload
    for (const type of ['mother', 'father', 'spouse', 'deceased spouse'])
      for (const kin of hfLinkIds(p, type))
        direct.push({
          figureId: kin,
          relation: type === 'deceased spouse' ? 'late spouse' : type,
          dweller,
        })
  }
  const parents = direct.filter((k) => k.relation === 'mother' || k.relation === 'father')
  const kinRows = direct.length
    ? await linksOf(inArray(R.id, [...new Set(direct.map((k) => k.figureId))].slice(0, 4000)))
    : []
  const kinById = new Map(kinRows.map((row) => [row.id, row]))
  const grand: FortressKin[] = []
  for (const parent of parents) {
    const row = kinById.get(parent.figureId)
    if (!row) continue
    const p = { hf_link: row.links } as LegendsPayload
    for (const type of ['mother', 'father'])
      for (const kin of hfLinkIds(p, type))
        grand.push({ figureId: kin, relation: `grand${type}`, dweller: parent.dweller })
  }
  const grandRows = grand.length
    ? await postgres_db
        .select({ id: R.id })
        .from(R)
        .where(
          and(
            W,
            eq(R.kind, 'historical_figure'),
            inArray(R.id, [...new Set(grand.map((k) => k.figureId))].slice(0, 4000)),
          ),
        )
    : []
  const knownGrand = new Set(grandRows.map((row) => row.id))
  const seen = new Set<string>()
  const kin = [
    ...direct.filter((k) => kinById.has(k.figureId)),
    ...grand.filter((k) => knownGrand.has(k.figureId)),
  ].filter((k) => {
    const key = `${k.figureId}:${k.dweller.figureId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const famousKinOf = new Map<number, FortressKin>()
  for (const k of kin) {
    if (byFigure.has(k.figureId) || fame(k.figureId) < FAMOUS_KIN) continue
    const best = famousKinOf.get(k.dweller.figureId)
    if (!best || fame(k.figureId) > fame(best.figureId)) famousKinOf.set(k.dweller.figureId, k)
  }
  const chosen = living
    .filter((d) => fame(d.figureId) > 0)
    .sort((a, b) => fame(b.figureId) - fame(a.figureId))
    .slice(0, STORIED_OWN)
  const chosenIds = new Set(chosen.map((d) => d.figureId))
  const byKin = [...famousKinOf.values()]
    .filter((k) => !chosenIds.has(k.dweller.figureId))
    .sort((a, b) => fame(b.figureId) - fame(a.figureId))
    .slice(0, STORIED_BY_KIN)
    .map((k) => k.dweller)
  const storiedDwellers = [...chosen, ...byKin]

  const refs: RefSet = {}
  for (const d of living) addRef(refs, 'historical_figure', d.figureId)
  for (const k of kin) addRef(refs, 'historical_figure', k.figureId)
  const [names, lines] = await Promise.all([
    lookupNames(worldId, refs),
    lifeLines(
      worldId,
      storiedDwellers.map((d) => d.figureId),
    ),
  ])
  const storied = storiedDwellers.map((d): StoriedDweller => {
    const famous = famousKinOf.get(d.figureId)
    return {
      ...d,
      line: lines.get(d.figureId) ?? [],
      kin: famous
        ? said(
            kinNote(famous.relation, sexOf.get(d.figureId) ?? null),
            named(names, 'historical_figure', famous.figureId, 'someone the records do not name'),
          )
        : null,
    }
  })
  return { dwellers: byFigure.size, living, kin, storied, civ: past ?? [], names }
}
