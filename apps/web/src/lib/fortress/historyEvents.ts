import type { FortHistoryRow, FortUnit, HistoryFieldValue } from '@fortress/db-drizzle'

import { words } from '../legends/model'
import { deathPhrase } from './death'
import { type TextPart, cleanAnnouncement, firstName } from './insights'
import type { LifeTone } from './lifeEvents'

/*
 * The world's history events at the fortress, read live from the game, told
 * as plain sentences. Field names are the game's own; each sentence looks for
 * the names the event types use and falls back to the figures in order.
 * Client-safe.
 */

export type HistoryEventLike = Pick<
  FortHistoryRow,
  'type' | 'here' | 'hfids' | 'fields' | 'extra' | 'game_year' | 'game_tick'
>

const GOOD = new Set([
  'MASTERPIECE_CREATED_ITEM',
  'MASTERPIECE_CREATED_ARCH_CONSTRUCT',
  'MASTERPIECE_CREATED_ENGRAVING',
  'MASTERPIECE_CREATED_FOOD',
  'MASTERPIECE_CREATED_DYE_ITEM',
  'MASTERPIECE_CREATED_ITEM_IMPROVEMENT',
  'ARTIFACT_CREATED',
  'WRITTEN_CONTENT_COMPOSED',
])
const BAD = new Set(['HIST_FIGURE_DIED', 'HF_WOUNDED', 'CREATURE_DEVOURED', 'ITEM_STOLEN'])

export function historyTone(event: Pick<FortHistoryRow, 'type' | 'fields'>): LifeTone {
  if (GOOD.has(event.type)) return 'good'
  if (BAD.has(event.type)) return 'bad'
  if (
    event.type === 'ADD_HF_HF_LINK' &&
    (event.fields.type === 'SPOUSE' || event.fields.type === 'LOVER')
  )
    return 'good'
  return 'neutral'
}

/** Worth a line in "since your last look" and on the overview. */
export function isHistoryHeadline(event: Pick<FortHistoryRow, 'type'>): boolean {
  return event.type !== 'CHANGE_HF_STATE' && event.type !== 'REMOVE_HF_ENTITY_LINK'
}

const num = (v: HistoryFieldValue | undefined): number | null =>
  typeof v === 'number' && v >= 0 ? v : null
const token = (v: HistoryFieldValue | undefined): string | null =>
  typeof v === 'string' && v !== '' ? v : null
const article = (word: string) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`)

const HF_LINK_VERBS: Record<string, string> = {
  SPOUSE: 'married',
  LOVER: 'became the lover of',
  CHILD: 'became the parent of',
  MOTHER: 'was born to',
  FATHER: 'was born to',
  DEITY: 'began to worship',
  MASTER: 'became the apprentice of',
  APPRENTICE: 'took as an apprentice',
  COMPANION: 'became the companion of',
  PRISONER: 'was imprisoned by',
  IMPRISONER: 'imprisoned',
  PET_OWNER: 'was adopted as a pet by',
}

const HF_UNLINK_VERBS: Record<string, string> = {
  SPOUSE: 'is no longer married to',
  LOVER: 'is no longer the lover of',
  MASTER: 'is no longer the apprentice of',
  APPRENTICE: 'is no longer the master of',
  PRISONER: 'is no longer held by',
}

const STATE_VERBS: Record<string, string> = {
  settled: 'settled',
  wandering: 'began wandering',
  wanderer: 'began wandering',
  refugee: 'fled as a refugee',
  visiting: 'went visiting',
  scouting: 'went scouting',
  hunting: 'went hunting',
  thief: 'went thieving',
  snatcher: 'went snatching children',
}

const MASTERPIECE_VERBS: Record<string, string> = {
  MASTERPIECE_CREATED_ITEM: 'made a masterpiece',
  MASTERPIECE_CREATED_ARCH_CONSTRUCT: 'built a masterpiece',
  MASTERPIECE_CREATED_ENGRAVING: 'engraved a masterpiece',
  MASTERPIECE_CREATED_FOOD: 'cooked a masterpiece',
  MASTERPIECE_CREATED_DYE_ITEM: 'dyed a masterpiece',
  MASTERPIECE_CREATED_ITEM_IMPROVEMENT: 'decorated a masterpiece',
}

/**
 * The sentence for one history event as parts: citizens on the map link to
 * their pages, other figures carry `hf` for a link to their legends.
 * With `subject` set, a line on that figure's own page leaves out their name.
 */
export function historyEventParts(
  event: HistoryEventLike,
  units: Map<number, FortUnit>,
  { subject }: { subject?: number } = {},
): TextPart[] {
  const f = event.fields
  const figures = event.extra.figures ?? {}
  const byHf = new Map<number, FortUnit>()
  for (const unit of units.values())
    if (unit.hist_figure_id >= 0) byHf.set(unit.hist_figure_id, unit)

  const used = new Set<number>()
  /** The first of these fields that holds a figure, else the next figure not yet named. */
  const pick = (...keys: string[]): number | null => {
    for (const key of keys) {
      const id = num(f[key])
      if (id !== null) {
        used.add(id)
        return id
      }
    }
    const next = event.hfids.find((id) => !used.has(id))
    if (next === undefined) return null
    used.add(next)
    return next
  }
  const person = (id: number | null, fallback = 'someone'): TextPart => {
    if (id === null) return { text: fallback }
    const unit = byHf.get(id)
    if (unit) return { text: firstName(unit), unit }
    const figure = figures[String(id)]
    const name = figure?.[0] ?? figure?.[1]
    if (!name) return { text: fallback }
    const race = figure?.[2]
    return {
      text: `${cleanAnnouncement(name)}${race && race !== 'dwarf' ? `, ${article(race)}` : ''}`,
      hf: id,
    }
  }

  const extra = event.extra
  let actor: number | null = null
  let rest: (string | TextPart)[]
  switch (event.type) {
    case 'HIST_FIGURE_DIED': {
      actor = pick('victim_hf', 'victim', 'hfid')
      const slayer = num(f.slayer_hf) ?? num(f.slayer)
      rest = [deathPhrase(token(f.death_cause))]
      if (slayer !== null) rest.push(', slain by ', person(slayer))
      else if (extra.race) rest.push(`, slain by ${article(extra.race)}`)
      break
    }
    case 'HF_WOUNDED':
      actor = pick('woundee', 'woundee_hfid')
      rest = ['was wounded by ', person(pick('wounder', 'wounder_hfid'))]
      break
    case 'HF_REVIVED':
      actor = pick('histfig', 'hfid', 'hf')
      rest = ['came back from the dead']
      break
    case 'ADD_HF_HF_LINK': {
      actor = pick('hf', 'hfid')
      const link = token(f.type) ?? ''
      rest = [
        `${HF_LINK_VERBS[link] ?? `became ${words(link) || 'linked to'} of`} `,
        person(pick('hf_target', 'hfid_target')),
      ]
      break
    }
    case 'REMOVE_HF_HF_LINK': {
      actor = pick('hf', 'hfid')
      const link = token(f.type) ?? ''
      rest = [
        `${HF_UNLINK_VERBS[link] ?? 'parted ways with'} `,
        person(pick('hf_target', 'hfid_target')),
      ]
      break
    }
    case 'ADD_HF_ENTITY_LINK': {
      actor = pick('histfig', 'hfid', 'hf')
      const link = token(f.link_type)
      const group = extra.entity ? cleanAnnouncement(extra.entity) : 'a group'
      rest = [
        link === 'POSITION'
          ? `became ${extra.position ?? 'an officer'}${extra.entity ? ` of ${group}` : ''}`
          : link === 'MEMBER'
            ? `joined ${group}`
            : link === 'SQUAD'
              ? `joined a squad of ${group}`
              : link === 'PRISONER'
                ? `was imprisoned by ${group}`
                : link === 'ENEMY'
                  ? `became an enemy of ${group}`
                  : `became ${words(link) || 'linked to'} of ${group}`,
      ]
      const appointer = num(f.appointer_hfid) ?? num(f.appointer_hf)
      if (appointer !== null) rest.push(', appointed by ', person(appointer))
      break
    }
    case 'REMOVE_HF_ENTITY_LINK': {
      actor = pick('histfig', 'hfid', 'hf')
      const link = token(f.link_type)
      const group = extra.entity ? cleanAnnouncement(extra.entity) : 'a group'
      rest = [
        link === 'POSITION'
          ? `is no longer ${extra.position ?? 'an officer'}${extra.entity ? ` of ${group}` : ''}`
          : link === 'MEMBER'
            ? `left ${group}`
            : `is no longer ${words(link) || 'linked to'} of ${group}`,
      ]
      break
    }
    case 'CHANGE_HF_JOB': {
      actor = pick('hfid', 'histfig', 'hf')
      const to = token(f.new_job)
      const from = token(f.old_job)
      rest = [
        to
          ? `became ${article(words(to))}${from && from !== 'STANDARD' && from !== 'NONE' ? `, after being ${article(words(from))}` : ''}`
          : 'changed profession',
      ]
      break
    }
    case 'CHANGE_HF_STATE': {
      actor = pick('hfid', 'histfig', 'hf')
      const state = words(token(f.state))
      rest = [STATE_VERBS[state] ?? (state ? `changed state: ${state}` : 'moved on')]
      break
    }
    case 'ARTIFACT_CREATED': {
      actor = pick('creator_hfid', 'creator_hf', 'hfid', 'histfig')
      const name = extra.artifact_native ?? extra.artifact
      rest = [
        name
          ? `created the artifact ${cleanAnnouncement(name)}${extra.artifact && extra.artifact !== name ? ` (“${extra.artifact}”)` : ''}`
          : 'created an artifact',
      ]
      break
    }
    case 'WRITTEN_CONTENT_COMPOSED':
      actor = pick('histfig', 'hfid', 'hf')
      rest = [extra.title ? `wrote “${extra.title}”` : 'wrote a new work']
      break
    case 'CREATURE_DEVOURED':
      actor = pick('eater', 'eater_hf')
      rest = [
        'devoured ',
        num(f.victim) !== null
          ? person(pick('victim'))
          : { text: extra.race ? article(extra.race) : 'something' },
      ]
      break
    case 'ITEM_STOLEN':
      actor = pick('histfig', 'hfid', 'hf')
      rest = [`stole ${extra.item ?? 'an item'}${event.here ? ' from the fortress' : ''}`]
      break
    case 'HF_DOES_INTERACTION':
      actor = pick('doer', 'doer_hf')
      rest = ['used a power on ', person(pick('target', 'target_hf'))]
      break
    case 'CREATED_BUILDING':
      actor = pick('builder_hf', 'builder')
      rest = ['raised a new building at the fortress']
      break
    default: {
      const verb = MASTERPIECE_VERBS[event.type]
      actor = pick('maker', 'maker_hf', 'hfid')
      rest = verb
        ? [`${verb}${extra.item ? `: ${extra.item}` : ''}`]
        : [words(event.type) || 'something happened']
    }
  }
  if (event.type === 'HIST_FIGURE_DIED' && !event.here && num(f.site) !== null)
    rest.push(' away from the fortress')

  const parts: TextPart[] = []
  const own = actor !== null && actor === subject
  if (!own) {
    parts.push(person(actor))
    parts.push({ text: ' ' })
  }
  for (const piece of rest) parts.push(typeof piece === 'string' ? { text: piece } : { ...piece })
  parts[0] = { ...parts[0], text: parts[0].text.charAt(0).toUpperCase() + parts[0].text.slice(1) }
  parts.push({ text: '.' })
  return parts
}
