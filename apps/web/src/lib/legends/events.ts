import type { JsonObject, LegendsPayload, LegendsRecord } from '@fortress/db-drizzle'
// Client-safe subpath: the package entry also creates the Postgres client.
import { DF_MONTHS } from '@fortress/db-drizzle/fortress-types'
import type { NameIndex } from './server'

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

function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
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

export function titleCase(s: string): string {
  return s.replace(/(^|\s|-)([a-z])/g, (_m, pre: string, c: string) => pre + c.toUpperCase())
}

function hf(ctx: Ctx, key: string, fallback = 'someone') {
  ref(ctx, 'historical_figure', num(ctx.p[key]) ?? num(ctx.plus[key]), fallback)
}

function site(ctx: Ctx, key = 'site_id') {
  const id = num(ctx.p[key]) ?? num(ctx.plus.site)
  if (id !== null && id >= 0) {
    text(ctx, ' in ')
    ref(ctx, 'site', id, 'a site')
  }
}

function place(ctx: Ctx) {
  const siteId = num(ctx.p.site_id)
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
  ref(ctx, 'artifact', num(ctx.p[key]), 'an artifact')
}

const TEMPLATES: Record<string, (ctx: Ctx) => void> = {
  'hf died': (ctx) => {
    hf(ctx, 'hfid')
    const cause = str(ctx.p.cause) ?? str(ctx.plus.death_cause)
    const slayer = num(ctx.p.slayer_hfid)
    if (slayer !== null && slayer >= 0) {
      text(ctx, ` was ${cause ? cause.replace(/_/g, ' ') : 'slain'} by `)
      hf(ctx, 'slayer_hfid')
    } else if (str(ctx.p.slayer_race)) {
      text(
        ctx,
        ` was ${cause ? cause.replace(/_/g, ' ') : 'slain'} by a ${String(ctx.p.slayer_race).toLowerCase().replace(/_/g, ' ')}`,
      )
    } else {
      text(ctx, cause ? ` died (${cause.replace(/_/g, ' ')})` : ' died')
    }
    place(ctx)
    text(ctx, '.')
  },
  'hf simple battle event': (ctx) => {
    hf(ctx, 'group_1_hfid')
    text(ctx, ` ${str(ctx.p.subtype)?.replace(/_/g, ' ') ?? 'fought'} `)
    hf(ctx, 'group_2_hfid')
    place(ctx)
    text(ctx, '.')
  },
  'hf wounded': (ctx) => {
    hf(ctx, 'woundee_hfid')
    text(ctx, ' was wounded by ')
    hf(ctx, 'wounder_hfid')
    const injury = str(ctx.plus.injury_type)
    if (injury) text(ctx, ` (${injury.replace(/_/g, ' ')})`)
    place(ctx)
    text(ctx, '.')
  },
  'creature devoured': (ctx) => {
    const eater = num(ctx.plus.eater)
    const race = str(ctx.plus.race)
    if (eater !== null && eater >= 0) {
      ref(ctx, 'historical_figure', eater, 'a creature')
      text(ctx, ` devoured ${race ? `a ${race}` : 'something'}`)
    } else {
      text(ctx, `${race ? `A ${race}` : 'A creature'} was devoured`)
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
    else if (link === 'member') text(ctx, ' joined ')
    else if (link === 'prisoner') text(ctx, ' was imprisoned by ')
    else if (link === 'slave') text(ctx, ' was enslaved by ')
    else if (link === 'enemy') text(ctx, ' became an enemy of ')
    else if (link === 'squad') text(ctx, ' joined a squad of ')
    else text(ctx, ` became ${link.replace(/_/g, ' ')} of `)
    entity(ctx, 'civ_id')
    text(ctx, '.')
  },
  'remove hf entity link': (ctx) => {
    hf(ctx, 'hfid')
    const link = str(ctx.p.link) ?? str(ctx.plus.link_type) ?? 'link'
    text(ctx, link === 'position' ? ' left a position in ' : ` left (${link.replace(/_/g, ' ')}) `)
    entity(ctx, 'civ_id')
    text(ctx, '.')
  },
  'add hf hf link': (ctx) => {
    hf(ctx, 'hfid')
    const link = str(ctx.plus.link_type)
    text(ctx, link ? ` became ${link.replace(/_/g, ' ')} of ` : ' became linked to ')
    hf(ctx, 'hfid_target')
    text(ctx, '.')
  },
  'remove hf hf link': (ctx) => {
    hf(ctx, 'hfid')
    const link = str(ctx.plus.link_type)
    text(ctx, link ? ` stopped being ${link.replace(/_/g, ' ')} of ` : ' broke a link with ')
    hf(ctx, 'hfid_target')
    text(ctx, '.')
  },
  'add hf site link': (ctx) => {
    hf(ctx, 'histfig')
    const link = str(ctx.plus.link_type)
    text(
      ctx,
      link === 'seat_of_power'
        ? ' took a seat of power'
        : link
          ? ` gained a ${link.replace(/_/g, ' ')}`
          : ' settled',
    )
    site(ctx)
    text(ctx, '.')
  },
  'remove hf site link': (ctx) => {
    hf(ctx, 'histfig')
    text(ctx, ' gave up a claim')
    site(ctx)
    text(ctx, '.')
  },
  'change hf state': (ctx) => {
    hf(ctx, 'hfid')
    const state = str(ctx.p.state) ?? 'changed state'
    const reason = str(ctx.plus.reason)
    text(
      ctx,
      ` ${state === 'settled' ? 'settled' : state === 'wandering' ? 'began wandering' : state === 'refugee' ? 'fled as a refugee' : state === 'visiting' ? 'went visiting' : state}`,
    )
    place(ctx)
    if (reason && reason !== 'none') text(ctx, ` (${reason.replace(/_/g, ' ')})`)
    text(ctx, '.')
  },
  'change hf job': (ctx) => {
    hf(ctx, 'hfid')
    const newJob = str(ctx.plus.new_job)
    const oldJob = str(ctx.plus.old_job)
    text(
      ctx,
      newJob
        ? ` became a ${newJob.replace(/_/g, ' ')}${oldJob && oldJob !== 'standard' ? ` (was ${oldJob.replace(/_/g, ' ')})` : ''}`
        : ' changed profession',
    )
    place(ctx)
    text(ctx, '.')
  },
  'change hf body state': (ctx) => {
    hf(ctx, 'hfid')
    text(ctx, ` ${str(ctx.plus.body_state)?.replace(/_/g, ' ') ?? 'changed bodily state'}`)
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
    text(ctx, ` tamed ${str(ctx.plus.pets) ?? 'a new pet'}`)
    place(ctx)
    text(ctx, '.')
  },
  'hf does interaction': (ctx) => {
    hf(ctx, 'doer_hfid')
    text(ctx, ` ${str(ctx.plus.interaction_action) ?? 'affected'} `)
    hf(ctx, 'target_hfid')
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
    text(ctx, ` came back from the dead${str(ctx.plus.ghost) ? ' as a ghost' : ''}`)
    place(ctx)
    text(ctx, '.')
  },
  'hf convicted': (ctx) => {
    hf(ctx, 'convicted_hfid')
    text(ctx, ` was convicted of ${str(ctx.plus.crime)?.replace(/_/g, ' ') ?? 'a crime'} by `)
    entity(ctx, 'convicter_enid')
    text(ctx, '.')
  },
  'hf preach': (ctx) => {
    hf(ctx, 'speaker_hfid')
    text(ctx, ` preached ${str(ctx.plus.topic)?.replace(/_/g, ' ') ?? ''} to `)
    entity(ctx, 'entity_1')
    text(ctx, '.')
  },
  'hf gains secret goal': (ctx) => {
    hf(ctx, 'hfid')
    text(
      ctx,
      ` began to secretly desire ${str(ctx.plus.secret_goal)?.replace(/_/g, ' ') ?? 'something'}.`,
    )
  },
  'hf profaned structure': (ctx) => {
    hf(ctx, 'hist_fig_id')
    text(ctx, ' profaned a structure')
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
  'artifact created': (ctx) => {
    hf(ctx, 'hist_figure_id')
    text(ctx, ' created ')
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
  'artifact claim formed': (ctx) => {
    hf(ctx, 'hist_figure_id')
    text(ctx, ' laid claim to ')
    artifact(ctx)
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
    text(ctx, item ? `a ${mat ? `${mat} ` : ''}${item}` : 'an item')
    const from = num(ctx.plus.site)
    if (from !== null && from >= 0) {
      text(ctx, ' from ')
      ref(ctx, 'site', from, 'a site')
    }
    text(ctx, '.')
  },
  'created site': (ctx) => {
    entity(ctx, 'site_civ_id')
    text(ctx, ' of ')
    entity(ctx, 'civ_id')
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
  'entity created': (ctx) => {
    entity(ctx, 'entity_id')
    text(ctx, ' was formed')
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
    text(ctx, '.')
  },
  'attacked site': (ctx) => {
    entity(ctx, 'attacker_civ_id')
    text(ctx, ' attacked ')
    ref(ctx, 'site', num(ctx.p.site_id), 'a site')
    text(ctx, ' held by ')
    entity(ctx, 'defender_civ_id')
    text(ctx, '.')
  },
  'entity persecuted': (ctx) => {
    entity(ctx, 'persecutor_enid')
    text(ctx, ' persecuted ')
    entity(ctx, 'target_enid')
    site(ctx)
    text(ctx, '.')
  },
  'written content composed': (ctx) => {
    hf(ctx, 'hist_figure_id')
    text(ctx, ' composed ')
    ref(ctx, 'written_content', num(ctx.p.wc_id), 'a work')
    place(ctx)
    text(ctx, '.')
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
    text(ctx, '.')
  },
  gamble: (ctx) => {
    hf(ctx, 'gambler_hfid')
    text(ctx, ' gambled')
    site(ctx)
    text(ctx, '.')
  },
  'assume identity': (ctx) => {
    hf(ctx, 'trickster_hfid')
    text(ctx, ' assumed a false identity')
    const target = num(ctx.p.target_enid)
    if (target !== null && target >= 0) {
      text(ctx, ' to fool ')
      entity(ctx, 'target_enid')
    }
    text(ctx, '.')
  },
  'agreement formed': (ctx) => {
    hf(ctx, 'concluder_hfid')
    text(
      ctx,
      ` formed an agreement${str(ctx.plus.reason) ? ` (${String(ctx.plus.reason).replace(/_/g, ' ')})` : ''}.`,
    )
  },
  'body abused': (ctx) => {
    text(ctx, 'A body was abused')
    place(ctx)
    text(ctx, '.')
  },
  'changed creature type': (ctx) => {
    hf(ctx, 'changee_hfid')
    text(ctx, ' was transformed by ')
    hf(ctx, 'changer_hfid')
    text(ctx, '.')
  },
  'create entity position': (ctx) => {
    hf(ctx, 'histfig')
    text(ctx, ` created the position of ${str(ctx.plus.position) ?? 'a new office'} in `)
    entity(ctx, 'civ')
    text(ctx, '.')
  },
  'failed intrigue corruption': (ctx) => {
    hf(ctx, 'corruptor_hfid')
    text(ctx, ' failed to corrupt ')
    hf(ctx, 'target_hfid')
    text(ctx, '.')
  },
  'hfs formed reputation relationship': (ctx) => {
    hf(ctx, 'hfid1')
    text(ctx, ' formed a reputation with ')
    hf(ctx, 'hfid2')
    text(ctx, '.')
  },
}

export function describeEvent(event: LegendsRecord, names: NameIndex): DescribedEvent {
  const p = event.payload as LegendsPayload
  const plus = (
    p.plus && typeof p.plus === 'object' && !Array.isArray(p.plus) ? p.plus : {}
  ) as JsonObject
  const ctx: Ctx = { p, plus, names, out: [] }
  const type = str(p.type) ?? str(plus.type)?.replace(/_/g, ' ') ?? 'event'
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
    text(ctx, `${key.replace(/_/g, ' ')} `)
    ref(ctx, kind, value, kind)
  }
  if (first) {
    const extras = Object.entries(p)
      .filter(
        ([k, v]) =>
          !['id', 'year', 'seconds72', 'type', 'plus'].includes(k) && typeof v === 'string',
      )
      .map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`)
    text(ctx, extras.join(', '))
  }
  return { fragments: ctx.out, known: false }
}
