import type { JsonObject, LegendsPayload, LegendsRecord } from '@fortress/db-drizzle'
// Client-safe subpath: the package entry also creates the Postgres client.
import { DF_MONTHS } from '@fortress/db-drizzle/fortress-types'
import { titleCase, words } from './model'
import type { NameIndex } from './server'

export { titleCase }

/**
 * Turn a legends event record into a sentence. Field names follow the vanilla
 * legends.xml export; legends_plus details live under `payload.plus`.
 */

export const TICKS_PER_YEAR = 403_200
const TICKS_PER_MONTH = 33_600
const TICKS_PER_DAY = 1_200

export function legendsDate(
  year: number | null | undefined,
  seconds72: number | null | undefined,
): string {
  if (year === null || year === undefined) return 'unknown date'
  if (year < 0) return 'before time'
  if (seconds72 === null || seconds72 === undefined || seconds72 < 0) return `year ${year}`
  const month = Math.floor(seconds72 / TICKS_PER_MONTH)
  const day = Math.floor((seconds72 % TICKS_PER_MONTH) / TICKS_PER_DAY) + 1
  return `${day} ${DF_MONTHS[month] ?? '?'}, ${year}`
}

/** "1–14" or "year 3" or "since 12". */
export function yearSpan(start: number | null | undefined, end: number | null | undefined): string {
  const s = typeof start === 'number' && start >= 0 ? start : null
  const e = typeof end === 'number' && end >= 0 ? end : null
  if (s === null && e === null) return ''
  if (s !== null && e !== null) return s === e ? `year ${s}` : `${s}–${e}`
  if (s !== null) return `since ${s}`
  return `until ${e}`
}

/** The legends_plus half of a payload, if any. */
export function plusOf(payload: LegendsPayload): JsonObject {
  const plus = payload.plus
  return plus && typeof plus === 'object' && !Array.isArray(plus) ? (plus as JsonObject) : {}
}

export function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null
}

export function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

export function numList(v: unknown): number[] {
  if (Array.isArray(v)) return v.filter((x): x is number => typeof x === 'number')
  return typeof v === 'number' ? [v] : []
}

export function objList(v: unknown): JsonObject[] {
  if (Array.isArray(v)) return v.filter((x): x is JsonObject => !!x && typeof x === 'object')
  return v && typeof v === 'object' ? [v as JsonObject] : []
}

/**
 * Dwarf Fortress skill levels from cumulative experience. Level n needs
 * 450n + 50n² points: Novice at 500, Legendary at 18000.
 */
export const SKILL_LEVELS = [
  'Dabbling',
  'Novice',
  'Adequate',
  'Competent',
  'Skilled',
  'Proficient',
  'Talented',
  'Adept',
  'Expert',
  'Professional',
  'Accomplished',
  'Great',
  'Master',
  'High Master',
  'Grand Master',
  'Legendary',
] as const

export function skillLevel(totalIp: number): { level: number; label: string } {
  const level = Math.max(0, Math.floor((-450 + Math.sqrt(450 * 450 + 200 * totalIp)) / 100))
  if (level >= 15) return { level, label: level > 15 ? `Legendary +${level - 15}` : 'Legendary' }
  return { level, label: SKILL_LEVELS[level] ?? 'Dabbling' }
}

/** Groups of event types, for filtering timelines and colouring history. */
export interface EventCategory {
  key: string
  label: string
  types: string[]
}

export const EVENT_CATEGORIES: EventCategory[] = [
  {
    key: 'war',
    label: 'War & battle',
    types: [
      'hf simple battle event',
      'hf wounded',
      'field battle',
      'attacked site',
      'hf attacked site',
      'hf destroyed site',
      'site conquered',
      'site taken over',
      'plundered site',
      'razed structure',
      'new site leader',
      'peace accepted',
      'peace rejected',
      'entity alliance formed',
      'hf equipment purchase',
      'entity equipment purchase',
      'hf recruited unit type for entity',
      'beast attack',
      'squad vs squad',
    ],
  },
  {
    key: 'death',
    label: 'Deaths',
    types: ['hf died', 'creature devoured', 'body abused', 'hf revived', 'change hf body state'],
  },
  {
    key: 'life',
    label: 'Lives & families',
    types: [
      'change hf state',
      'change hf job',
      'hf travel',
      'hf new pet',
      'hf reunion',
      'hf relationship denied',
      'add hf hf link',
      'remove hf hf link',
      'hfs formed reputation relationship',
      'changed creature type',
      'building profile acquired',
      'regionpop incorporated into entity',
    ],
  },
  {
    key: 'power',
    label: 'Power & society',
    types: [
      'add hf entity link',
      'remove hf entity link',
      'add hf site link',
      'remove hf site link',
      'create entity position',
      'entity created',
      'entity dissolved',
      'created site',
      'created structure',
      'entity law',
      'entity primary criminals',
      'agreement formed',
      'site dispute',
      'entity persecuted',
      'hf preach',
      'hf convicted',
    ],
  },
  {
    key: 'culture',
    label: 'Art, faith & knowledge',
    types: [
      'ceremony',
      'performance',
      'procession',
      'competition',
      'gamble',
      'written content composed',
      'poetic form created',
      'dance form created',
      'musical form created',
      'knowledge discovered',
      'hf prayed inside structure',
      'hf profaned structure',
      'artifact created',
      'artifact stored',
      'artifact lost',
      'artifact found',
      'artifact possessed',
      'artifact given',
      'artifact claim formed',
      'artifact copied',
      'artifact recovered',
      'artifact destroyed',
      'artifact transformed',
    ],
  },
  {
    key: 'intrigue',
    label: 'Crime & intrigue',
    types: [
      'item stolen',
      'assume identity',
      'failed intrigue corruption',
      'hfs formed intrigue relationship',
      'failed frame attempt',
      'hf gains secret goal',
      'hf learns secret',
      'hf does interaction',
      'hf performed horrible experiments',
      'hf confronted',
      'hf abducted',
    ],
  },
]

const CATEGORY_BY_TYPE = new Map<string, EventCategory>()
for (const category of EVENT_CATEGORIES) {
  for (const type of category.types) CATEGORY_BY_TYPE.set(type, category)
}

export function eventCategory(type: string | null | undefined): EventCategory | null {
  return type ? (CATEGORY_BY_TYPE.get(type) ?? null) : null
}

export type Fragment = { text: string } | { link: { kind: string; id: number }; text: string }

export interface DescribedEvent {
  fragments: Fragment[]
  /** True when a template existed for this event type. */
  known: boolean
}

type Ctx = {
  p: LegendsPayload
  plus: JsonObject
  names: NameIndex
  out: Fragment[]
}

function text(ctx: Ctx, s: string) {
  ctx.out.push({ text: s })
}

function ref(ctx: Ctx, kind: string, id: number | null, fallback: string) {
  if (id === null || id < 0) {
    text(ctx, fallback)
    return
  }
  const name = ctx.names[kind]?.[id]
  ctx.out.push({ link: { kind, id }, text: name ? titleCase(name) : `${fallback} #${id}` })
}

function hf(ctx: Ctx, key: string, fallback = 'someone') {
  ref(ctx, 'historical_figure', num(ctx.p[key]) ?? num(ctx.plus[key]), fallback)
}

function hfList(ctx: Ctx, ids: number[], fallback = 'someone') {
  ids.forEach((id, i) => {
    if (i > 0) text(ctx, i === ids.length - 1 ? ' and ' : ', ')
    ref(ctx, 'historical_figure', id, fallback)
  })
}

function site(ctx: Ctx, key = 'site_id') {
  const id = num(ctx.p[key]) ?? num(ctx.plus.site)
  if (id !== null && id >= 0) {
    text(ctx, ' in ')
    ref(ctx, 'site', id, 'a site')
  }
}

function place(ctx: Ctx) {
  const siteId = num(ctx.p.site_id) ?? num(ctx.plus.site)
  const region = num(ctx.p.subregion_id)
  if (siteId !== null && siteId >= 0) {
    text(ctx, ' in ')
    ref(ctx, 'site', siteId, 'a site')
  } else if (region !== null && region >= 0) {
    text(ctx, ' in ')
    ref(ctx, 'region', region, 'a region')
  }
}

function entity(ctx: Ctx, key: string, fallback = 'a group') {
  ref(ctx, 'entity', num(ctx.p[key]) ?? num(ctx.plus[key]), fallback)
}

function artifact(ctx: Ctx, key = 'artifact_id') {
  ref(ctx, 'artifact', num(ctx.p[key]) ?? num(ctx.plus.artifact), 'an artifact')
}

function has(ctx: Ctx, key: string): boolean {
  const v = num(ctx.p[key]) ?? num(ctx.plus[key])
  return v !== null && v >= 0
}

const TEMPLATES: Record<string, (ctx: Ctx) => void> = {
  'hf died': (ctx) => {
    hf(ctx, 'hfid')
    const cause = str(ctx.p.cause) ?? str(ctx.plus.death_cause)
    const slayer = num(ctx.p.slayer_hfid)
    if (slayer !== null && slayer >= 0) {
      text(ctx, ` was ${cause ? words(cause) : 'slain'} by `)
      hf(ctx, 'slayer_hfid')
    } else if (str(ctx.p.slayer_race)) {
      text(ctx, ` was ${cause ? words(cause) : 'slain'} by a ${words(String(ctx.p.slayer_race))}`)
    } else {
      text(ctx, cause ? ` died: ${words(cause)}` : ' died')
    }
    place(ctx)
    text(ctx, '.')
  },
  'hf simple battle event': (ctx) => {
    hf(ctx, 'group_1_hfid')
    text(ctx, ` ${words(str(ctx.p.subtype)) || 'fought'} `)
    hf(ctx, 'group_2_hfid')
    place(ctx)
    text(ctx, '.')
  },
  'hf wounded': (ctx) => {
    hf(ctx, 'woundee_hfid')
    text(ctx, ' was wounded by ')
    hf(ctx, 'wounder_hfid')
    const injury = str(ctx.plus.injury_type)
    if (injury) text(ctx, ` (${words(injury)})`)
    if (str(ctx.plus.part_lost) === 'true') text(ctx, ', losing a body part')
    place(ctx)
    text(ctx, '.')
  },
  'creature devoured': (ctx) => {
    const eater = num(ctx.plus.eater)
    const victim = num(ctx.plus.victim)
    const race = str(ctx.plus.race)
    if (eater !== null && eater >= 0) {
      ref(ctx, 'historical_figure', eater, 'a creature')
      text(ctx, ' devoured ')
      if (victim !== null && victim >= 0) ref(ctx, 'historical_figure', victim, 'someone')
      else text(ctx, race ? `a ${words(race)}` : 'something')
    } else {
      text(ctx, `${race ? `A ${words(race)}` : 'A creature'} was devoured`)
    }
    place(ctx)
    text(ctx, '.')
  },
  'beast attack': (ctx) => {
    text(ctx, 'A beast attacked')
    place(ctx)
    text(ctx, '.')
  },
  'add hf entity link': (ctx) => {
    hf(ctx, 'hfid')
    const link = str(ctx.p.link) ?? str(ctx.plus.link_type) ?? 'became linked to'
    const position = str(ctx.plus.position)
    if (link === 'position' && position) text(ctx, ` became ${position} of `)
    else if (link === 'position') text(ctx, ' took a position in ')
    else if (link === 'member') text(ctx, ' joined ')
    else if (link === 'prisoner') text(ctx, ' was imprisoned by ')
    else if (link === 'slave') text(ctx, ' was enslaved by ')
    else if (link === 'enemy') text(ctx, ' became an enemy of ')
    else if (link === 'squad') text(ctx, ' joined a squad of ')
    else text(ctx, ` became ${words(link)} of `)
    entity(ctx, 'civ_id')
    if (has(ctx, 'appointer_hfid')) {
      text(ctx, ', appointed by ')
      hf(ctx, 'appointer_hfid')
    }
    text(ctx, '.')
  },
  'remove hf entity link': (ctx) => {
    hf(ctx, 'hfid')
    const link = str(ctx.p.link) ?? str(ctx.plus.link_type) ?? 'link'
    if (link === 'position') text(ctx, ' left a position in ')
    else if (link === 'member') text(ctx, ' left ')
    else if (link === 'prisoner') text(ctx, ' was freed from ')
    else text(ctx, ` stopped being ${words(link)} of `)
    entity(ctx, 'civ_id')
    text(ctx, '.')
  },
  'add hf hf link': (ctx) => {
    hf(ctx, 'hfid')
    const link = str(ctx.plus.link_type)
    if (link === 'spouse') text(ctx, ' married ')
    else if (link === 'deity') text(ctx, ' began worshipping ')
    else if (link === 'lover') text(ctx, ' became the lover of ')
    else if (link === 'child') text(ctx, ' became the parent of ')
    else if (link === 'apprentice') text(ctx, ' took as apprentice ')
    else if (link === 'master') text(ctx, ' became the apprentice of ')
    else if (link === 'pet owner') text(ctx, ' was adopted as a pet by ')
    else text(ctx, link ? ` became ${words(link)} of ` : ' became linked to ')
    hf(ctx, 'hfid_target')
    text(ctx, '.')
  },
  'remove hf hf link': (ctx) => {
    hf(ctx, 'hfid')
    const link = str(ctx.plus.link_type)
    text(ctx, link ? ` stopped being ${words(link)} of ` : ' parted ways with ')
    hf(ctx, 'hfid_target')
    text(ctx, '.')
  },
  'add hf site link': (ctx) => {
    hf(ctx, 'histfig')
    const link = str(ctx.plus.link_type)
    if (link === 'seat_of_power') text(ctx, ' took a seat of power')
    else if (link === 'home_site_building' || link === 'home_site_abstract_building')
      text(ctx, ' made a home')
    else if (link === 'lair') text(ctx, ' made a lair')
    else if (link === 'occupation') text(ctx, ' took up an occupation')
    else if (link === 'hangout') text(ctx, ' started frequenting a place')
    else text(ctx, link ? ` gained a ${words(link)}` : ' settled')
    site(ctx)
    text(ctx, '.')
  },
  'remove hf site link': (ctx) => {
    hf(ctx, 'histfig')
    const link = str(ctx.plus.link_type)
    text(ctx, link === 'seat_of_power' ? ' gave up a seat of power' : ' gave up a claim')
    site(ctx)
    text(ctx, '.')
  },
  'change hf state': (ctx) => {
    hf(ctx, 'hfid')
    const state = str(ctx.p.state) ?? str(ctx.plus.state) ?? 'changed state'
    const reason = str(ctx.plus.reason)
    const verbs: Record<string, string> = {
      settled: 'settled',
      settler: 'settled',
      wandering: 'began wandering',
      wanderer: 'began wandering',
      refugee: 'fled as a refugee',
      visiting: 'went visiting',
      visitor: 'went visiting',
      scouting: 'went scouting',
      scout: 'went scouting',
      hunting: 'went hunting',
      thief: 'went thieving',
      snatcher: 'went snatching',
      returned: 'returned home',
    }
    text(ctx, ` ${verbs[state] ?? words(state)}`)
    place(ctx)
    if (reason && reason !== 'none') text(ctx, `, ${words(reason)}`)
    text(ctx, '.')
  },
  'change hf job': (ctx) => {
    hf(ctx, 'hfid')
    const newJob = str(ctx.plus.new_job)
    const oldJob = str(ctx.plus.old_job)
    text(
      ctx,
      newJob
        ? ` became a ${words(newJob)}${oldJob && oldJob !== 'standard' ? `, having been a ${words(oldJob)}` : ''}`
        : ' changed profession',
    )
    place(ctx)
    text(ctx, '.')
  },
  'change hf body state': (ctx) => {
    hf(ctx, 'hfid')
    text(
      ctx,
      ` was ${words(str(ctx.p.body_state) ?? str(ctx.plus.body_state)) || 'changed in body'}`,
    )
    place(ctx)
    text(ctx, '.')
  },
  'hf travel': (ctx) => {
    hf(ctx, 'group_hfid')
    text(ctx, ' travelled')
    place(ctx)
    text(ctx, '.')
  },
  'hf new pet': (ctx) => {
    hf(ctx, 'group_hfid')
    text(ctx, ` tamed ${str(ctx.plus.pets) ? `a ${words(str(ctx.plus.pets))}` : 'a new pet'}`)
    place(ctx)
    text(ctx, '.')
  },
  'hf does interaction': (ctx) => {
    hf(ctx, 'doer_hfid')
    text(ctx, ` ${str(ctx.plus.interaction_action) ?? 'affected'} `)
    hf(ctx, 'target_hfid')
    place(ctx)
    text(ctx, '.')
  },
  'hf abducted': (ctx) => {
    hf(ctx, 'target_hfid')
    text(ctx, ' was abducted by ')
    hf(ctx, 'snatcher_hfid')
    place(ctx)
    text(ctx, '.')
  },
  'hf revived': (ctx) => {
    hf(ctx, 'hfid')
    if (has(ctx, 'actor_hfid')) {
      text(ctx, ' was raised from the dead by ')
      hf(ctx, 'actor_hfid')
    } else text(ctx, ` came back from the dead${str(ctx.plus.ghost) ? ' as a ghost' : ''}`)
    place(ctx)
    text(ctx, '.')
  },
  'hf convicted': (ctx) => {
    hf(ctx, 'convicted_hfid')
    text(
      ctx,
      ` was convicted of ${words(str(ctx.p.crime) ?? str(ctx.plus.crime)) || 'a crime'} by `,
    )
    entity(ctx, 'convicter_enid')
    const months = num(ctx.p.prison_months)
    if (months) text(ctx, ` and sentenced to ${months} months in prison`)
    if (ctx.p.death_penalty === true) text(ctx, ' and sentenced to death')
    text(ctx, '.')
  },
  'hf preach': (ctx) => {
    hf(ctx, 'speaker_hfid')
    const topic = str(ctx.p.topic) ?? str(ctx.plus.topic)
    if (topic === 'set entity 1 against entity 2') {
      text(ctx, ' preached to ')
      entity(ctx, 'entity_1')
      text(ctx, ' against ')
      entity(ctx, 'entity_2')
    } else {
      text(ctx, ` preached ${topic ? words(topic) : ''} to `)
      entity(ctx, 'entity_1')
    }
    text(ctx, '.')
  },
  'hf gains secret goal': (ctx) => {
    hf(ctx, 'hfid')
    text(
      ctx,
      ` began to secretly desire ${words(str(ctx.p.secret_goal) ?? str(ctx.plus.secret_goal)) || 'something'}.`,
    )
  },
  'hf learns secret': (ctx) => {
    hf(ctx, 'student_hfid')
    text(ctx, ` learned ${str(ctx.plus.secret_text) ?? 'a secret'}`)
    if (has(ctx, 'teacher_hfid')) {
      text(ctx, ' from ')
      hf(ctx, 'teacher_hfid')
    } else if (has(ctx, 'artifact_id')) {
      text(ctx, ' from ')
      artifact(ctx)
    }
    text(ctx, '.')
  },
  'hf profaned structure': (ctx) => {
    hf(ctx, 'hist_fig_id')
    text(ctx, ' profaned a temple')
    site(ctx)
    text(ctx, '.')
  },
  'hf prayed inside structure': (ctx) => {
    hf(ctx, 'hist_fig_id')
    text(ctx, ' prayed in a temple')
    site(ctx)
    text(ctx, '.')
  },
  'hf destroyed site': (ctx) => {
    hf(ctx, 'attacker_hfid')
    text(ctx, ' destroyed ')
    ref(ctx, 'site', num(ctx.p.site_id), 'a site')
    text(ctx, ', settled by ')
    entity(ctx, 'defender_civ_id')
    text(ctx, '.')
  },
  'hf attacked site': (ctx) => {
    hf(ctx, 'attacker_hfid')
    text(ctx, ' attacked ')
    ref(ctx, 'site', num(ctx.p.site_id), 'a site')
    text(ctx, ', held by ')
    entity(ctx, 'defender_civ_id')
    text(ctx, '.')
  },
  'hf confronted': (ctx) => {
    hf(ctx, 'hfid')
    const reason = str(ctx.p.reason)
    const situation = str(ctx.p.situation)
    text(
      ctx,
      ` was confronted${reason ? ` over being ${words(reason)}` : ''}${situation ? ` (${words(situation)})` : ''}`,
    )
    place(ctx)
    text(ctx, '.')
  },
  'hf reunion': (ctx) => {
    hf(ctx, 'group_1_hfid')
    text(ctx, ' was reunited with ')
    hf(ctx, 'group_2_hfid')
    place(ctx)
    text(ctx, '.')
  },
  'hf relationship denied': (ctx) => {
    hf(ctx, 'seeker_hfid')
    const rel = str(ctx.p.relationship)
    text(ctx, ` asked to become the ${rel ? words(rel) : 'companion'} of `)
    hf(ctx, 'target_hfid')
    const reason = str(ctx.p.reason)
    text(ctx, reason ? ` and was refused: ${words(reason)}.` : ' and was refused.')
  },
  'hf equipment purchase': (ctx) => {
    hf(ctx, 'group_hfid')
    const quality = num(ctx.p.quality)
    text(ctx, ` bought ${quality ? `quality ${quality} ` : ''}equipment`)
    place(ctx)
    text(ctx, '.')
  },
  'hf performed horrible experiments': (ctx) => {
    hf(ctx, 'group_hfid')
    text(ctx, ' performed horrible experiments')
    place(ctx)
    text(ctx, '.')
  },
  'hf recruited unit type for entity': (ctx) => {
    hf(ctx, 'hfid')
    text(ctx, ` recruited ${words(str(ctx.p.unit_type)) || 'followers'}s for `)
    entity(ctx, 'entity_id')
    place(ctx)
    text(ctx, '.')
  },
  'artifact created': (ctx) => {
    if (has(ctx, 'hist_figure_id')) {
      hf(ctx, 'hist_figure_id')
      text(ctx, ' created ')
    } else text(ctx, 'Someone created ')
    artifact(ctx)
    place(ctx)
    text(ctx, '.')
  },
  'artifact stored': (ctx) => {
    hf(ctx, 'hist_figure_id')
    text(ctx, ' stored ')
    artifact(ctx)
    place(ctx)
    text(ctx, '.')
  },
  'artifact lost': (ctx) => {
    artifact(ctx)
    text(ctx, ' was lost')
    place(ctx)
    text(ctx, '.')
  },
  'artifact found': (ctx) => {
    hf(ctx, 'hist_figure_id')
    text(ctx, ' found ')
    artifact(ctx)
    place(ctx)
    text(ctx, '.')
  },
  'artifact possessed': (ctx) => {
    hf(ctx, 'hist_figure_id')
    text(ctx, ' took possession of ')
    artifact(ctx)
    place(ctx)
    text(ctx, '.')
  },
  'artifact given': (ctx) => {
    if (has(ctx, 'giver_hist_figure_id')) hf(ctx, 'giver_hist_figure_id')
    else entity(ctx, 'giver_entity_id')
    text(ctx, ' gave ')
    artifact(ctx)
    text(ctx, ' to ')
    if (has(ctx, 'receiver_hist_figure_id')) {
      hf(ctx, 'receiver_hist_figure_id')
      if (has(ctx, 'receiver_entity_id')) {
        text(ctx, ' of ')
        entity(ctx, 'receiver_entity_id')
      }
    } else entity(ctx, 'receiver_entity_id')
    text(ctx, '.')
  },
  'artifact claim formed': (ctx) => {
    if (has(ctx, 'hist_figure_id')) hf(ctx, 'hist_figure_id')
    else entity(ctx, 'entity_id')
    const claim = Array.isArray(ctx.p.claim) ? String(ctx.p.claim[0] ?? '') : str(ctx.p.claim)
    text(ctx, claim === 'symbol' ? ' claimed ' : ' laid claim to ')
    artifact(ctx)
    if (claim === 'symbol') text(ctx, ' as a symbol of office')
    else if (claim) text(ctx, ` (${words(claim)})`)
    text(ctx, '.')
  },
  'item stolen': (ctx) => {
    const thief = num(ctx.plus.histfig)
    if (thief !== null && thief >= 0) {
      ref(ctx, 'historical_figure', thief, 'a thief')
      text(ctx, ' stole ')
    } else text(ctx, 'Someone stole ')
    const item = str(ctx.plus.item_type)
    const mat = str(ctx.plus.mat)
    text(ctx, item ? `a ${mat ? `${mat} ` : ''}${words(item)}` : 'an item')
    const from = num(ctx.plus.site)
    if (from !== null && from >= 0) {
      text(ctx, ' from ')
      ref(ctx, 'site', from, 'a site')
    }
    const stash = num(ctx.plus.stash_site)
    if (stash !== null && stash >= 0) {
      text(ctx, ' and stashed it in ')
      ref(ctx, 'site', stash, 'a site')
    }
    text(ctx, '.')
  },
  'created site': (ctx) => {
    entity(ctx, 'site_civ_id')
    if (has(ctx, 'civ_id')) {
      text(ctx, ' of ')
      entity(ctx, 'civ_id')
    }
    text(ctx, ' founded ')
    ref(ctx, 'site', num(ctx.p.site_id), 'a site')
    text(ctx, '.')
  },
  'created structure': (ctx) => {
    const builder = num(ctx.p.builder_hfid)
    if (builder !== null && builder >= 0) {
      hf(ctx, 'builder_hfid')
      text(ctx, ' built a structure')
    } else {
      entity(ctx, 'site_civ_id')
      text(ctx, ' built a structure')
    }
    site(ctx)
    text(ctx, '.')
  },
  'razed structure': (ctx) => {
    entity(ctx, 'civ_id')
    text(ctx, ' razed a structure')
    site(ctx)
    text(ctx, '.')
  },
  'building profile acquired': (ctx) => {
    hf(ctx, 'acquirer_hfid')
    const how =
      ctx.p.inherited === true
        ? ' inherited'
        : ctx.p.purchased_unowned === true
          ? ' bought'
          : ' acquired'
    text(
      ctx,
      `${how} a building${ctx.p.rebuilt_ruined === true ? ' and rebuilt it from ruin' : ''}`,
    )
    site(ctx)
    text(ctx, '.')
  },
  'entity created': (ctx) => {
    entity(ctx, 'entity_id')
    text(ctx, ' was formed')
    site(ctx)
    text(ctx, '.')
  },
  'entity dissolved': (ctx) => {
    entity(ctx, 'entity_id')
    const reason = str(ctx.p.reason)
    text(ctx, ` dissolved${reason ? ` after ${words(reason)}` : ''}.`)
  },
  'entity law': (ctx) => {
    if (has(ctx, 'hist_figure_id')) {
      hf(ctx, 'hist_figure_id')
      text(ctx, ' made the laws of ')
    } else text(ctx, 'The laws of ')
    entity(ctx, 'entity_id')
    const add = str(ctx.p.law_add)
    const remove = str(ctx.p.law_remove)
    text(
      ctx,
      add
        ? ` ${has(ctx, 'hist_figure_id') ? '' : 'became '}${words(add)}er.`
        : remove
          ? ` ${has(ctx, 'hist_figure_id') ? 'less' : 'became less'} ${words(remove)}.`
          : ' changed.',
    )
  },
  'entity primary criminals': (ctx) => {
    ref(ctx, 'entity', num(ctx.p.entity_id) ?? num(ctx.plus.entity), 'A group')
    text(ctx, ' became the leading criminals')
    site(ctx)
    text(ctx, '.')
  },
  'entity equipment purchase': (ctx) => {
    entity(ctx, 'entity_id')
    const level = num(ctx.p.new_equipment_level)
    text(ctx, ` improved its equipment${level ? ` to level ${level}` : ''}.`)
  },
  'entity alliance formed': (ctx) => {
    entity(ctx, 'initiating_enid')
    text(ctx, ' formed an alliance with ')
    const joining = numList(ctx.p.joining_enid)
    joining.forEach((id, i) => {
      if (i > 0) text(ctx, i === joining.length - 1 ? ' and ' : ', ')
      ref(ctx, 'entity', id, 'a group')
    })
    text(ctx, '.')
  },
  'entity persecuted': (ctx) => {
    entity(ctx, 'persecutor_enid')
    text(ctx, ' persecuted ')
    entity(ctx, 'target_enid')
    site(ctx)
    const expelled = num(ctx.p.expelled_number)
    const shrines = num(ctx.p.shrine_amount_destroyed)
    const bits: string[] = []
    if (expelled) bits.push(`expelling ${expelled}`)
    if (shrines) bits.push(`destroying ${shrines} shrine${shrines === 1 ? '' : 's'}`)
    if (has(ctx, 'persecutor_hfid')) {
      text(ctx, bits.length ? `, ${bits.join(' and ')}, led by ` : ', led by ')
      hf(ctx, 'persecutor_hfid')
    } else if (bits.length) text(ctx, `, ${bits.join(' and ')}`)
    text(ctx, '.')
  },
  'regionpop incorporated into entity': (ctx) => {
    const moved = num(ctx.p.pop_number_moved)
    text(ctx, `${moved ? `${moved} creatures` : 'A wild population'} joined `)
    entity(ctx, 'join_entity_id')
    site(ctx)
    text(ctx, '.')
  },
  'site conquered': (ctx) => {
    entity(ctx, 'attacker_civ_id')
    text(ctx, ' conquered ')
    ref(ctx, 'site', num(ctx.p.site_id), 'a site')
    text(ctx, ' from ')
    entity(ctx, 'defender_civ_id')
    text(ctx, '.')
  },
  'site taken over': (ctx) => {
    entity(ctx, 'attacker_civ_id')
    text(ctx, ' took over ')
    ref(ctx, 'site', num(ctx.p.site_id), 'a site')
    text(ctx, ' from ')
    entity(ctx, 'defender_civ_id')
    if (has(ctx, 'new_site_civ_id')) {
      text(ctx, ' and installed ')
      entity(ctx, 'new_site_civ_id')
    }
    text(ctx, '.')
  },
  'new site leader': (ctx) => {
    entity(ctx, 'attacker_civ_id')
    text(ctx, ' installed ')
    entity(ctx, 'new_site_civ_id')
    text(ctx, ' to rule ')
    ref(ctx, 'site', num(ctx.p.site_id), 'a site')
    text(ctx, ', displacing ')
    entity(ctx, 'defender_civ_id')
    text(ctx, '.')
  },
  'attacked site': (ctx) => {
    entity(ctx, 'attacker_civ_id')
    if (has(ctx, 'attacker_general_hfid')) {
      text(ctx, ', led by ')
      hf(ctx, 'attacker_general_hfid')
      text(ctx, ',')
    }
    text(ctx, ' attacked ')
    ref(ctx, 'site', num(ctx.p.site_id), 'a site')
    text(ctx, ' held by ')
    entity(ctx, 'defender_civ_id')
    if (has(ctx, 'defender_general_hfid')) {
      text(ctx, ' under ')
      hf(ctx, 'defender_general_hfid')
    }
    text(ctx, '.')
  },
  'plundered site': (ctx) => {
    entity(ctx, 'attacker_civ_id')
    text(ctx, ' plundered ')
    ref(ctx, 'site', num(ctx.p.site_id), 'a site')
    text(ctx, ', held by ')
    entity(ctx, 'defender_civ_id')
    text(ctx, ctx.p.detected === true ? ', and was noticed.' : '.')
  },
  'field battle': (ctx) => {
    entity(ctx, 'attacker_civ_id')
    if (has(ctx, 'attacker_general_hfid')) {
      text(ctx, ', led by ')
      hf(ctx, 'attacker_general_hfid')
      text(ctx, ',')
    }
    text(ctx, ' met ')
    entity(ctx, 'defender_civ_id')
    if (has(ctx, 'defender_general_hfid')) {
      text(ctx, ' under ')
      hf(ctx, 'defender_general_hfid')
    }
    text(ctx, ' in battle')
    place(ctx)
    text(ctx, '.')
  },
  'peace accepted': (ctx) => {
    ref(ctx, 'entity', num(ctx.plus.destination), 'A group')
    text(ctx, ' accepted an offer of peace from ')
    ref(ctx, 'entity', num(ctx.plus.source), 'a group')
    text(ctx, '.')
  },
  'peace rejected': (ctx) => {
    ref(ctx, 'entity', num(ctx.plus.destination), 'A group')
    text(ctx, ' rejected an offer of peace from ')
    ref(ctx, 'entity', num(ctx.plus.source), 'a group')
    text(ctx, '.')
  },
  'site dispute': (ctx) => {
    entity(ctx, 'entity_id_1')
    text(ctx, ' of ')
    ref(ctx, 'site', num(ctx.p.site_id_1), 'a site')
    text(ctx, ' and ')
    entity(ctx, 'entity_id_2')
    text(ctx, ' of ')
    ref(ctx, 'site', num(ctx.p.site_id_2), 'a site')
    text(ctx, ` disputed ${words(str(ctx.p.dispute)) || 'their borders'}.`)
  },
  'agreement formed': (ctx) => {
    if (has(ctx, 'concluder_hfid')) {
      hf(ctx, 'concluder_hfid')
      text(ctx, ' concluded an agreement')
    } else text(ctx, 'An agreement was formed')
    const reason = str(ctx.plus.reason)
    text(ctx, reason ? ` (${words(reason)}).` : '.')
  },
  'create entity position': (ctx) => {
    hf(ctx, 'histfig')
    const position = str(ctx.plus.position)
    text(ctx, ` created the position of ${position ?? 'a new office'} in `)
    entity(ctx, 'civ')
    const reason = str(ctx.plus.reason)
    if (reason && reason !== 'as_a_matter_of_course') text(ctx, `, ${words(reason)}`)
    text(ctx, '.')
  },
  'written content composed': (ctx) => {
    hf(ctx, 'hist_figure_id')
    text(ctx, ' composed ')
    ref(ctx, 'written_content', num(ctx.p.wc_id), 'a work')
    place(ctx)
    text(ctx, '.')
  },
  'poetic form created': (ctx) => {
    hf(ctx, 'hist_figure_id')
    text(ctx, ' devised ')
    ref(ctx, 'poetic_form', num(ctx.p.form_id), 'a poetic form')
    place(ctx)
    const how = str(ctx.p.circumstance)
    text(ctx, how ? `, inspired by a ${words(how)}.` : '.')
  },
  'musical form created': (ctx) => {
    hf(ctx, 'hist_figure_id')
    text(ctx, ' devised ')
    ref(ctx, 'musical_form', num(ctx.p.form_id), 'a musical form')
    place(ctx)
    const how = str(ctx.p.circumstance)
    text(ctx, how ? `, inspired by a ${words(how)}.` : '.')
  },
  'dance form created': (ctx) => {
    hf(ctx, 'hist_figure_id')
    text(ctx, ' devised ')
    ref(ctx, 'dance_form', num(ctx.p.form_id), 'a dance form')
    place(ctx)
    const how = str(ctx.p.circumstance)
    text(ctx, how ? `, inspired by a ${words(how)}.` : '.')
  },
  'knowledge discovered': (ctx) => {
    hf(ctx, 'hfid')
    const knowledge = str(ctx.p.knowledge)
    const parts = knowledge ? knowledge.split(':') : []
    const topic = parts.length ? parts[parts.length - 1] : 'something new'
    const field = parts.length > 1 ? parts[0] : null
    text(
      ctx,
      ` ${ctx.p.first === true ? 'was the first to discover' : 'discovered'} ${words(topic)}${field ? ` (${words(field)})` : ''}.`,
    )
  },
  ceremony: (ctx) => {
    entity(ctx, 'civ_id')
    text(ctx, ' held a ceremony')
    place(ctx)
    text(ctx, '.')
  },
  performance: (ctx) => {
    entity(ctx, 'civ_id')
    text(ctx, ' held a performance')
    place(ctx)
    text(ctx, '.')
  },
  procession: (ctx) => {
    entity(ctx, 'civ_id')
    text(ctx, ' held a procession')
    place(ctx)
    text(ctx, '.')
  },
  competition: (ctx) => {
    entity(ctx, 'civ_id')
    text(ctx, ' held a competition')
    place(ctx)
    const competitors = numList(ctx.p.competitor_hfid)
    if (has(ctx, 'winner_hfid')) {
      text(ctx, '; ')
      hf(ctx, 'winner_hfid')
      text(ctx, competitors.length > 1 ? ` won against ${competitors.length - 1} others` : ' won')
    }
    text(ctx, '.')
  },
  gamble: (ctx) => {
    hf(ctx, 'gambler_hfid')
    text(ctx, ' gambled')
    site(ctx)
    const before = num(ctx.p.old_account)
    const after = num(ctx.p.new_account)
    if (before !== null && after !== null && before !== after)
      text(
        ctx,
        after > before
          ? `, winning ${(after - before).toLocaleString()}`
          : `, losing ${(before - after).toLocaleString()}`,
      )
    text(ctx, '.')
  },
  'assume identity': (ctx) => {
    hf(ctx, 'trickster_hfid')
    const alias = str(ctx.plus.identity_name)
    text(ctx, alias ? ` assumed the false identity of ${alias}` : ' assumed a false identity')
    if (has(ctx, 'target_enid')) {
      text(ctx, ' to fool ')
      entity(ctx, 'target_enid')
    }
    text(ctx, '.')
  },
  'body abused': (ctx) => {
    const bodies = numList(ctx.plus.bodies)
    const abuse = str(ctx.plus.abuse_type)
    if (has(ctx, 'histfig')) hf(ctx, 'histfig')
    else if (has(ctx, 'civ')) entity(ctx, 'civ')
    else text(ctx, 'Someone')
    const verb =
      abuse === 'hung'
        ? ' hung'
        : abuse === 'impaled'
          ? ' impaled'
          : abuse === 'piled'
            ? ' piled up'
            : abuse === 'flayed'
              ? ' flayed'
              : abuse === 'mutilated'
                ? ' mutilated'
                : abuse === 'animated'
                  ? ' reanimated'
                  : ' abused'
    text(ctx, `${verb} the ${bodies.length === 1 ? 'body' : 'bodies'} of `)
    if (bodies.length) hfList(ctx, bodies.slice(0, 6), 'someone')
    else text(ctx, 'the fallen')
    if (bodies.length > 6) text(ctx, ` and ${bodies.length - 6} others`)
    place(ctx)
    text(ctx, '.')
  },
  'changed creature type': (ctx) => {
    hf(ctx, 'changee_hfid')
    const to = str(ctx.plus.new_race) ?? str(ctx.p.new_race)
    text(ctx, ` was transformed${to ? ` into a ${words(to)}` : ''} by `)
    hf(ctx, 'changer_hfid')
    text(ctx, '.')
  },
  'failed intrigue corruption': (ctx) => {
    hf(ctx, 'corruptor_hfid')
    const action = str(ctx.p.action)
    const method = str(ctx.p.method)
    text(
      ctx,
      ` tried to ${action ? words(action) : 'corrupt'}${method ? ` through ${words(method)}` : ''} but failed to sway `,
    )
    hf(ctx, 'target_hfid')
    place(ctx)
    text(ctx, '.')
  },
  'hfs formed intrigue relationship': (ctx) => {
    hf(ctx, 'corruptor_hfid')
    const action = str(ctx.p.action)
    const method = str(ctx.p.method)
    const ok = ctx.p.successful === true
    text(ctx, ` ${ok ? 'managed' : 'tried'} to ${action ? words(action) : 'recruit'} `)
    hf(ctx, 'target_hfid')
    if (method) text(ctx, ` through ${words(method)}`)
    const seenAs = str(ctx.p.target_seen_as)
    if (ok && seenAs) text(ctx, `, treating them as a ${words(seenAs)}`)
    place(ctx)
    text(ctx, '.')
  },
  'failed frame attempt': (ctx) => {
    hf(ctx, 'framer_hfid')
    text(ctx, ' failed to frame ')
    hf(ctx, 'target_hfid')
    const crime = str(ctx.p.crime)
    if (crime) text(ctx, ` for ${words(crime)}`)
    if (has(ctx, 'convicter_enid')) {
      text(ctx, ' before ')
      entity(ctx, 'convicter_enid')
    }
    if (has(ctx, 'plotter_hfid')) {
      text(ctx, ', a plot of ')
      hf(ctx, 'plotter_hfid')
    }
    text(ctx, '.')
  },
  'hfs formed reputation relationship': (ctx) => {
    hf(ctx, 'hfid1')
    const rep1 = str(ctx.p.hf_rep_1_of_2)
    const rep2 = str(ctx.p.hf_rep_2_of_1)
    text(ctx, rep1 ? ' came to see ' : ' formed a reputation with ')
    hf(ctx, 'hfid2')
    if (rep1) text(ctx, ` as ${words(rep1)}`)
    if (rep2) text(ctx, `, and was seen as ${words(rep2)} in return`)
    place(ctx)
    text(ctx, '.')
  },
}

export function describeEvent(event: LegendsRecord, names: NameIndex): DescribedEvent {
  const p = event.payload as LegendsPayload
  const plus = plusOf(p)
  const ctx: Ctx = { p, plus, names, out: [] }
  const type = str(p.type) ?? words(str(plus.type)) ?? 'event'
  const template = TEMPLATES[type]
  if (template) {
    template(ctx)
    return { fragments: ctx.out, known: true }
  }
  // Generic fallback: the type, followed by every id we can name.
  text(ctx, `${titleCase(type)}: `)
  let first = true
  for (const [key, value] of Object.entries({ ...plus, ...p })) {
    if (key === 'plus' || key === 'id' || key === 'year' || key === 'seconds72' || key === 'type')
      continue
    if (typeof value !== 'number' || value < 0) continue
    let kind: string | null = null
    if (/civ|entity|enid/i.test(key)) kind = 'entity'
    else if (/site/i.test(key)) kind = 'site'
    else if (/artifact/i.test(key)) kind = 'artifact'
    else if (/hfid|hist_?fig|histfig|(^|_)hf$/i.test(key)) kind = 'historical_figure'
    if (!kind) continue
    const name = names[kind]?.[value]
    if (!name) continue
    if (!first) text(ctx, ', ')
    first = false
    text(ctx, `${words(key)} `)
    ref(ctx, kind, value, kind)
  }
  if (first) {
    const extras = Object.entries(p)
      .filter(
        ([k, v]) =>
          !['id', 'year', 'seconds72', 'type', 'plus'].includes(k) && typeof v === 'string',
      )
      .map(([k, v]) => `${words(k)} ${v}`)
    text(ctx, extras.join(', '))
  }
  return { fragments: ctx.out, known: false }
}
