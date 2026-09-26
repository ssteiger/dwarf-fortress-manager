import type { DfhackAction, FortUnit } from '@fortress/db-drizzle'

import {
  AREAS,
  type Advice,
  type AdviceArea,
  type AdviceStatus,
  type JobGroup,
  type Shortcut,
  type Situation,
  WORKSHOPS,
  type WorkshopRow,
  compact,
  fmt,
  names,
  situations,
} from './advisor'
import { skillRank, splitPascal } from './format'
import { type Concern, type Notice, firstName } from './insights'
import { ITEM_VIEW_INFO, type ItemView, type PlanRow } from './stores'

/*
 * Client-safe: one shape for every "how do I fix this" in the app, whether it
 * started as advice, a situation, a notice on the overview, a workshop, or a
 * dwarf's trouble. The guide drawer renders it.
 */

export interface Guide {
  /** Stable, so ticked-off steps survive a reload. */
  key: string
  title: string
  /** Small line above the title: the area, or where the guide came from. */
  eyebrow?: string
  status?: AdviceStatus
  area?: AdviceArea
  /** What the dump shows. */
  why?: string
  /** How to tell it is happening. */
  signs?: string
  steps: string[]
  actions?: DfhackAction[]
  dfhack?: Shortcut[]
  units?: FortUnit[]
  link?: {
    to:
      | '/fortress/dwarves'
      | '/fortress/items'
      | '/fortress/map'
      | '/fortress/chronicle'
      | '/fortress/work'
    label: string
    /** Which view of the item list to open, for links to the items page. */
    view?: ItemView
  }
}

export function adviceGuide(advice: Advice): Guide {
  return {
    key: `advice-${advice.key}`,
    title: advice.title,
    eyebrow: AREAS[advice.area].label,
    status: advice.status,
    area: advice.area,
    why: advice.why,
    steps: advice.steps,
    actions: advice.actions,
    dfhack: advice.dfhack,
    units: advice.units,
    link: advice.link,
  }
}

export function situationGuide(situation: Situation, units?: FortUnit[]): Guide {
  return {
    key: `situation-${situation.key}`,
    title: situation.title,
    eyebrow: situation.now ? 'Happening now' : 'When it happens',
    status: situation.now ? 'attention' : undefined,
    why: situation.now,
    signs: situation.signs,
    steps: situation.steps,
    actions: situation.actions,
    dfhack: situation.dfhack,
    units,
  }
}

/** The playbook entries on their own, for guides that need no fortress data. */
function playbook(key: string): Situation | undefined {
  return situations({
    summary: null,
    units: [],
    buildings: [],
    jobs: [],
    concerns: null,
    supplies: null,
    events: [],
    now: null,
  }).find((s) => s.key === key)
}

export function workshopGuide(row: WorkshopRow, idle: FortUnit[]): Guide {
  const { info } = row
  const trainees = idle.slice(0, 3)
  if (row.count === 0)
    return {
      key: `workshop-build-${row.key}`,
      title: `Build a ${info.label.charAt(0).toLowerCase()}${info.label.slice(1)}`,
      eyebrow: 'Workshops',
      status: info.essential ? 'attention' : undefined,
      why: `There is none yet. It makes ${info.makes}.`,
      steps: [
        `Build → Workshops → ${info.label}. Put it near the stockpile that holds what it uses, with a stockpile for what it makes close by.`,
        info.skills.length
          ? `Give someone the ${info.skillLabel} labor in the Labor screen${trainees.length ? `: ${trainees.map(firstName).join(', ')} ${trainees.length === 1 ? 'is' : 'are'} idle` : ''}.`
          : 'Give someone the matching labor in the Labor screen.',
        'Queue work at it: select the workshop and add a task, or add a work order with a stock condition.',
      ],
      units: trainees,
    }
  if (info.skills.length && !row.skilled.length)
    return {
      key: `workshop-train-${row.key}`,
      title: `Train someone in ${info.skillLabel}`,
      eyebrow: info.label,
      status: info.essential ? 'attention' : undefined,
      why: `You have ${row.count === 1 ? 'a' : row.count} ${info.label.toLowerCase()}${row.count === 1 ? '' : 's'}, but nobody has done any ${info.skillLabel}. It makes ${info.makes}.`,
      steps: [
        trainees.length
          ? `Pick a dwarf to learn it: ${trainees.map(firstName).join(', ')} ${trainees.length === 1 ? 'is' : 'are'} idle right now.`
          : 'Pick a dwarf to learn it; one who is not your only hand at something vital.',
        `Open the Labor screen and enable ${info.skillLabel} for them.`,
        `Queue work at the ${info.label.toLowerCase()} so they practise: skill only grows by doing.`,
        'Novices work slowly and make plain goods; within a season or two they improve.',
      ],
      units: trainees,
    }
  return {
    key: `workshop-use-${row.key}`,
    title: `Put the ${info.label.toLowerCase()} to work`,
    eyebrow: info.label,
    why: `${row.count} built, ${row.jobs ? `${row.jobs} jobs queued` : 'nothing queued'}. It makes ${info.makes}. Best hands: ${row.skilled
      .slice(0, 3)
      .map((s) => `${firstName(s.unit)} (${skillRank(s.rating).toLowerCase()})`)
      .join(', ')}.`,
    steps: [
      `Add a work order for what you need from it, with a condition such as "only while fewer than 20 in stock".`,
      `Make sure ${firstName(row.skilled[0].unit)} has the ${info.skillLabel} labor enabled; the best hands make the finest goods.`,
      'Keep its inputs in a stockpile nearby so workers do not walk far.',
    ],
    actions: ['sortOrders'],
    units: row.skilled.slice(0, 5).map((s) => s.unit),
  }
}

export function jobGroupGuide(group: JobGroup, advice: Advice[]): Guide | null {
  const find = (key: string) => advice.find((a) => a.key === key)
  if (group.suspended) {
    const suspended = find('suspended')
    if (suspended) return adviceGuide(suspended)
  }
  if (/^(Dig|Carve|Smooth|Detail)/.test(group.type)) {
    const digging = find('digging')
    if (digging) return adviceGuide(digging)
  }
  if (/StoreItem|Haul/.test(group.type))
    return {
      key: 'job-hauling',
      title: 'Keep the hauling moving',
      eyebrow: 'Work queue',
      why: `${group.total} hauling jobs, ${group.working.length} being done right now.`,
      steps: [
        'Most dwarves should keep the hauling labors on; turn them off only for your most skilled craftsdwarves.',
        'Put stockpiles close to the workshops that use and make their goods.',
        'Let stockpiles take wheelbarrows (stockpile settings) for heavy stone, and bins and barrels for small goods.',
        'A long queue that never shrinks usually means a stockpile is full or unreachable.',
      ],
      units: group.working,
    }
  return null
}

/** How to make something the stores are short of. */
export function planGuide(row: PlanRow): Guide {
  const info = WORKSHOPS[row.shop]
  const place = (info?.label ?? splitPascal(row.shop)).toLowerCase()
  const enough = row.have >= row.want
  return {
    key: `plan-${row.key}`,
    title: enough ? `${row.label}: enough for now` : `Make ${row.label.toLowerCase()}`,
    eyebrow: 'Worth making',
    status: row.status,
    why: `${fmt(row.have)} in store; a fortress this size wants about ${fmt(row.want)}. ${row.why}`,
    steps: compact([
      !row.built && `Build a ${place} first, from the Build menu.`,
      info?.skills.length &&
        (row.hands.length
          ? `${names(row.hands)} ${row.hands.length === 1 ? 'has' : 'have'} done ${info.skillLabel} before: make sure the labor is on.`
          : `Nobody has done any ${info.skillLabel} yet: enable it for a dwarf in the Labor screen.`),
      `Add a work order for "${row.task}" at the ${place}, with the condition "only while fewer than ${fmt(row.want)} in stock", so it repeats on its own.`,
      `Each takes ${row.from}.`,
    ]),
    actions: row.actions,
    units: row.hands.slice(0, 5),
  }
}

/** What to do about the items one view of the list shows. */
export function viewGuide(view: ItemView, count: number): Guide | null {
  const info = ITEM_VIEW_INFO[view]
  if (!info.steps?.length) return null
  return {
    key: `view-${view}`,
    title: info.label,
    eyebrow: 'Items',
    status: count > 0 && view !== 'merchant' && view !== 'artifacts' ? 'attention' : undefined,
    why: `${fmt(count)} item${count === 1 ? '' : 's'}. ${info.blurb}`,
    steps: info.steps,
    actions: info.actions,
    dfhack: info.dfhack,
  }
}

/** Which advice or playbook entry answers a notice from the overview. */
const NOTICE_ADVICE: Record<string, string> = {
  'threat-seen': 'threat',
  'threat-unseen': 'caverns',
  'dead-unburied': 'burial',
  'health-hurt': 'hospital',
  stress: 'unhappy',
  'work-failing': 'failing',
  'work-idle': 'idle',
  'work-suspended': 'suspended',
  'comfort-DrinkWithoutCup': 'cups',
  'comfort-NeedsUnfulfilled': 'needs',
  'comfort-Miasma': 'refuse',
  'comfort-EatLikeAnimal': 'dining',
}

const NOTICE_SITUATION: Record<string, string> = {
  'threat-seen': 'siege',
  'needs-critical': 'hunger',
  'comfort-Trauma': 'madness',
  'comfort-SawDeadBody': 'dead',
  'comfort-Argument': 'madness',
}

const INSANE_MOODS = new Set(['Melancholy', 'Raving', 'Berserk', 'Traumatized'])

export function noticeGuide(notice: Notice, advice: Advice[], all: Situation[]): Guide {
  const adviceKey =
    NOTICE_ADVICE[notice.key] ??
    (notice.key.startsWith('supply-') ? (/drink/i.test(notice.title) ? 'drink' : 'food') : null)
  const match = adviceKey ? advice.find((a) => a.key === adviceKey) : undefined
  if (match)
    return {
      ...adviceGuide(match),
      title: notice.title,
      units: notice.units ?? match.units,
    }

  const situationKey = notice.key.startsWith('mood-')
    ? notice.units?.[0]?.mood && INSANE_MOODS.has(notice.units[0].mood)
      ? 'madness'
      : 'mood'
    : NOTICE_SITUATION[notice.key]
  const situation = situationKey
    ? (all.find((s) => s.key === situationKey) ?? playbook(situationKey))
    : undefined
  if (situation)
    return {
      ...situationGuide(situation, notice.units),
      key: `notice-${notice.key}`,
      title: notice.title,
      why: [notice.detail, notice.hint].filter(Boolean).join(' '),
    }

  return {
    key: `notice-${notice.key}`,
    title: notice.title,
    eyebrow: 'Needs your attention',
    status: notice.severity === 'danger' ? 'problem' : 'attention',
    why: notice.detail,
    steps: [
      ...(notice.lines ?? []).map((line) =>
        [line.label, line.detail, line.hint].filter(Boolean).join(': '),
      ),
      ...(notice.hint ? [notice.hint] : []),
    ],
    units: notice.units,
    link: notice.link,
  }
}

/** One dwarf's trouble, with the playbook entry that deals with it. */
export function concernGuide(concern: Concern, unit: FortUnit): Guide {
  const key = concern.key.startsWith('need-')
    ? /Exhausted|Drowsy/.test(concern.key)
      ? 'sleep'
      : 'hunger'
    : concern.key === 'wounds'
      ? 'hurt'
      : concern.key === 'mood'
        ? unit.mood && INSANE_MOODS.has(unit.mood)
          ? 'madness'
          : 'mood'
        : concern.key === 'stress' || concern.key === 'insane'
          ? 'madness'
          : concern.key === 'idle'
            ? 'idle'
            : null
  const situation = key ? playbook(key) : undefined
  return {
    key: `concern-${unit.id}-${concern.key}`,
    title: `${firstName(unit)}: ${concern.label.charAt(0).toLowerCase()}${concern.label.slice(1)}`,
    eyebrow: situation?.title,
    status: concern.severity === 'danger' ? 'problem' : 'attention',
    why: concern.hint,
    signs: situation?.signs,
    steps: situation?.steps ?? (concern.hint ? [concern.hint] : []),
    actions: situation?.actions,
    units: [unit],
  }
}
