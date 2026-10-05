import type { FortAlert, FortSummary, FortUnit } from '@fortress/db-drizzle'
import { CARAVAN_TICKS_PER_DAY, MANDATE_WARN_LEFT } from '@fortress/db-drizzle/fortress-types'

import { isLiving, splitPascal, stressLabel, unitGroup, unitNeeds } from '../format'
import { emotionTone, fortFeelings, notableThought, thoughtPhrase } from '../people/thoughts'
import { SEVERITY_RANK, type Severity, listWords, moodConcern } from '../people/troubles'
import { firstName, isCitizenish, isGrownCitizen, isOwnGhost, remainsOf } from '../people/units'
import type { GameTime } from '../time'
import type { FortConcerns } from '../types'

/*
 * The fortress's troubles as the overview lists them: threats, moods, the
 * dead, the sick, unmet needs, stress, nobles, supplies, trade and work.
 * Each notice gathers the units it is about and a hint for what to do.
 * Client-safe.
 */

export type NoticeKind =
  | 'threat'
  | 'mood'
  | 'dead'
  | 'health'
  | 'needs'
  | 'stress'
  | 'nobles'
  | 'supply'
  | 'trade'
  | 'work'
  | 'comfort'

export interface NoticeLine {
  label: string
  detail?: string
  count?: number
  hint?: string
}

export interface Notice {
  key: string
  severity: Severity
  kind: NoticeKind
  title: string
  detail?: string
  hint?: string
  units?: FortUnit[]
  lines?: NoticeLine[]
  link?: {
    to: '/fortress/map' | '/fortress/work' | '/fortress/items'
    label: string
  }
}

const KIND_ORDER: NoticeKind[] = [
  'threat',
  'mood',
  'dead',
  'health',
  'needs',
  'stress',
  'nobles',
  'supply',
  'trade',
  'work',
  'comfort',
]

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function listNames(units: FortUnit[], max = 3): string {
  const names = units.slice(0, max).map(firstName)
  const rest = units.length - names.length
  if (rest > 0) return `${names.join(', ')} and ${rest} more`
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

const IRREGULAR: Record<string, string> = {
  dwarf: 'dwarves',
  elf: 'elves',
  wolf: 'wolves',
}

/** "fiend of shadow" -> "fiends of shadow", "magma man" -> "magma men". */
export function creaturePlural(race: string): string {
  const [head, ...tail] = race.split(' of ')
  const words = head.split(' ')
  const last = words.pop() ?? ''
  const plural =
    IRREGULAR[last] ??
    (/man$/.test(last)
      ? last.replace(/man$/, 'men')
      : /(s|x|ch|sh)$/.test(last)
        ? `${last}es`
        : /[^aeiou]y$/.test(last)
          ? `${last.slice(0, -1)}ies`
          : `${last}s`)
  return [...words, plural].join(' ') + (tail.length ? ` of ${tail.join(' of ')}` : '')
}

/** "3 goblins and a troll". */
export function creatureCounts(units: Pick<FortUnit, 'race'>[]): string {
  const counts = new Map<string, number>()
  for (const u of units) counts.set(u.race, (counts.get(u.race) ?? 0) + 1)
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([race, n]) =>
      n === 1 ? `${/^[aeiou]/i.test(race) ? 'an' : 'a'} ${race}` : `${n} ${creaturePlural(race)}`,
    )
  return parts.length <= 1
    ? (parts[0] ?? 'something')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

const CANCELLATION_HINTS: [RegExp, string][] = [
  [/potash/i, 'Make potash from ash at an ashery.'],
  [
    /charcoal|coke|fuel/i,
    'Make charcoal from logs at a wood furnace, or coke from coal at a smelter.',
  ],
  [/iron bars|bars/i, 'Smelt ore into bars at a smelter, or trade for them.'],
  [
    /boulders|stone/i,
    'Mine more stone, or check that the stone you have is not forbidden or reserved.',
  ],
  [/logs|wood/i, 'Cut down trees, or buy wood from a caravan.'],
  [/empty cage/i, 'Build more cages at a carpenter’s or metalsmith’s forge.'],
  [/cloth/i, 'Weave thread into cloth at a loom.'],
  [/thread/i, 'Spin thread from plant fiber or wool.'],
  [
    /processable plant|unrotten/i,
    'Grow or gather plants, and cancel repeating jobs you have no plants for.',
  ],
  [/spawn|seeds/i, 'Gather or buy seeds for this crop.'],
  [/table|chair|bed|door|cabinet|coffer/i, 'Build the furniture it needs first.'],
  [
    /interrupted|dangerous|hostile/i,
    'Something scared them off the job. Check the area for danger.',
  ],
]

export function cancellationHint(reason: string): string | undefined {
  return CANCELLATION_HINTS.find(([re]) => re.test(reason))?.[1]
}

export function fortNotices({
  summary,
  units,
  concerns,
  now,
}: {
  summary: FortSummary | null
  units: FortUnit[]
  concerns: FortConcerns | null
  now: GameTime | null
}): Notice[] {
  const notices: Notice[] = []
  const living = units.filter(isLiving)
  const citizens = living.filter(isCitizenish)
  const soldiers = citizens.filter((u) => u.squad).length

  // Threats: what is on the map, split by whether your dwarves have seen it.
  const hostiles = living.filter((u) => unitGroup(u) === 'hostile')
  const seen = hostiles.filter((u) => !u.flags.includes('hidden'))
  const unseen = hostiles.filter((u) => u.flags.includes('hidden'))
  if (seen.length) {
    const invaders = seen.some((u) => u.flags.includes('invader'))
    notices.push({
      key: 'threat-seen',
      severity: 'danger',
      kind: 'threat',
      title: `${creatureCounts(seen)} ${seen.length === 1 ? 'is' : 'are'} on the map`,
      detail: invaders
        ? 'Invaders have come for the fortress.'
        : 'Dangerous creatures roam in sight.',
      hint: soldiers
        ? 'Send your squads, and keep everyone else indoors.'
        : 'You have no squads. Pull up the drawbridge and keep everyone inside, or arm some dwarves.',
      units: seen,
      link: { to: '/fortress/map', label: 'Open the map' },
    })
  }
  if (unseen.length) {
    const depths = unseen.map((u) => u.z).filter((z): z is number => z !== null)
    const low = depths.length ? Math.min(...depths) : null
    const high = depths.length ? Math.max(...depths) : null
    notices.push({
      key: 'threat-unseen',
      severity: 'warning',
      kind: 'threat',
      title: `${creatureCounts(unseen)} ${unseen.length === 1 ? 'lurks' : 'lurk'} unseen`,
      detail:
        low !== null
          ? `Deep down, at z${low === high ? low : `${low}–${high}`}. Your dwarves have not come across ${unseen.length === 1 ? 'it' : 'them'} yet.`
          : 'Your dwarves have not come across them yet.',
      hint: 'Keep cavern entrances walled off or behind a hatch until you are ready for them.',
    })
  }

  // Strange moods and madness: each one is its own story.
  for (const unit of citizens) {
    const mood = moodConcern(unit)
    if (!mood) continue
    notices.push({
      key: `mood-${unit.id}`,
      severity: mood.severity,
      kind: 'mood',
      title: `${firstName(unit)} is ${mood.label.charAt(0).toLowerCase()}${mood.label.slice(1)}`,
      detail: unit.job && !unit.strange_mood?.job_id ? `Now: ${unit.job}.` : undefined,
      hint: mood.hint,
      units: [unit],
    })
  }

  // The unburied dead.
  if (concerns?.unburied.length) {
    const byId = new Map(units.map((u) => [u.id, u]))
    const dead = concerns.unburied
      .map((b) => byId.get(b.unitId))
      .filter((u): u is FortUnit => u !== undefined)
    const [only] = concerns.unburied
    const onlyOwner = byId.get(only.unitId)
    notices.push({
      key: 'dead-unburied',
      severity: 'warning',
      kind: 'dead',
      title:
        concerns.unburied.length === 1
          ? `${onlyOwner ? firstName(onlyOwner) : only.name} lies unburied`
          : `${concerns.unburied.length} of your dead lie unburied`,
      lines: concerns.unburied.map((b) => ({
        label: remainsOf(b, byId.get(b.unitId)),
        detail: b.x !== null ? `${b.x},${b.y} z${b.z}` : undefined,
      })),
      hint: `Seeing the dead shakes your dwarves, and the unburied dead of a fortress can return as ghosts. ${concerns.coffins ? `You have ${plural(concerns.coffins, 'coffin')} built: put ${concerns.coffins === 1 ? 'it' : 'them'} in a tomb zone.` : 'Build a coffin and place it in a tomb zone.'}`,
      units: dead,
    })
  }

  // Ghosts: the dead who found no rest.
  const ghosts = units.filter(isOwnGhost)
  if (ghosts.length) {
    notices.push({
      key: 'dead-ghosts',
      severity: 'danger',
      kind: 'dead',
      title:
        ghosts.length === 1
          ? `The ghost of ${firstName(ghosts[0])} walks the fortress`
          : `${ghosts.length} ghosts walk the fortress`,
      detail: 'Ghosts frighten the living and haunt their dreams, and some of them do harm.',
      hint: 'A ghost rests once its body lies in a coffin in a tomb, or once a memorial slab engraved for it is placed. Slabs are made at a mason’s workshop and engraved at a craftsdwarf’s workshop.',
      units: ghosts,
    })
  }

  // The hurt.
  const hurt = citizens.filter((u) => u.wounds > 0)
  if (hurt.length) {
    const doctor = citizens.find((u) => u.positions.some((p) => /medical/i.test(p)))
    const hospital = (concerns?.zones.Hospital ?? 0) > 0
    const bleeding = hurt.some(
      (u) => u.blood !== null && u.blood_max && u.blood / u.blood_max < 0.6,
    )
    notices.push({
      key: 'health-hurt',
      severity: bleeding ? 'danger' : 'warning',
      kind: 'health',
      title:
        hurt.length === 1 ? `${firstName(hurt[0])} is hurt` : `${hurt.length} dwarves are hurt`,
      detail: doctor
        ? `${firstName(doctor)} is your chief medical dwarf.`
        : 'Nobody is appointed chief medical dwarf.',
      hint: hospital
        ? 'They will heal fastest resting in the hospital.'
        : concerns
          ? `You have no hospital. Designate a hospital zone with beds${doctor ? '' : ', and appoint a chief medical dwarf'}.`
          : undefined,
      units: hurt,
    })
  }

  // Needs gone critical.
  const critical = citizens.filter((u) => unitNeeds(u).some((n) => n.severity === 'danger'))
  if (critical.length) {
    const labels = [
      ...new Set(
        critical.flatMap((u) =>
          unitNeeds(u)
            .filter((n) => n.severity === 'danger')
            .map((n) => n.label.toLowerCase()),
        ),
      ),
    ]
    notices.push({
      key: 'needs-critical',
      severity: 'danger',
      kind: 'needs',
      title: `${listNames(critical)} ${critical.length === 1 ? 'is' : 'are'} ${labels.join(' and ')}`,
      hint: 'Check that food, drink and beds are stocked and nothing blocks the way to them.',
      units: critical,
    })
  }

  // Unhappiness.
  const unhappy = citizens
    .filter((u) => u.stress_category <= 2)
    .sort((a, b) => a.stress_category - b.stress_category)
  if (unhappy.length) {
    const worst = unhappy[0].stress_category
    notices.push({
      key: 'stress',
      severity: worst === 0 ? 'danger' : worst === 1 ? 'warning' : 'info',
      kind: 'stress',
      title:
        unhappy.length === 1
          ? `${firstName(unhappy[0])} is ${stressLabel(worst)}`
          : `${unhappy.length} dwarves are unhappy`,
      lines: unhappy.map((u) => {
        const t = notableThought(u, now)
        return {
          label: `${firstName(u)}: ${stressLabel(u.stress_category)}`,
          detail:
            t && emotionTone(t[1]) === 'bad' ? `lately ${thoughtPhrase(t[0], t[1])}` : undefined,
        }
      }),
      hint: 'Unhappy dwarves throw tantrums, and tantrums spread. Good meals, finer bedrooms and time with friends turn it around.',
      units: unhappy,
    })
  }

  // What the nobles have ordered, banned and demanded.
  const unitById = new Map(units.map((u) => [u.id, u]))
  const nobleOf = (id: number | null) => (id !== null ? unitById.get(id) : undefined)
  for (const [i, m] of (summary?.mandates ?? []).entries()) {
    const noble = nobleOf(m.unit_id)
    const who = m.position ? `The ${m.position}` : noble ? firstName(noble) : 'A noble'
    const left = m.timeout_limit - m.timeout_counter
    const punishment = m.hammerstrikes
      ? `If it is not done in time, the ${m.position ?? 'noble'} has someone beaten with ${plural(m.hammerstrikes, 'hammerstrike')}${m.prison_time ? ' and locked up' : ''}.`
      : `If it is not done in time, the ${m.position ?? 'noble'} punishes someone.`
    if (m.kind === 'Export') {
      notices.push({
        key: `nobles-ban-${i}`,
        severity: 'info',
        kind: 'nobles',
        title: `${who} has banned the export of ${m.item}`,
        hint: `Keep them out of the trade depot. ${punishment}`,
        units: noble ? [noble] : undefined,
      })
      continue
    }
    if (m.amount_remaining <= 0) continue
    const near = left < MANDATE_WARN_LEFT
    notices.push({
      key: `nobles-mandate-${i}`,
      severity: near ? 'warning' : 'info',
      kind: 'nobles',
      title: `${who} wants ${m.amount_remaining} more ${m.item} made`,
      detail: near
        ? 'The deadline is less than a month away.'
        : `${Math.round((left / Math.max(m.timeout_limit, 1)) * 100)}% of the time is left.`,
      hint: `Queue a work order for them at the manager. ${punishment}`,
      units: noble ? [noble] : undefined,
      link: { to: '/fortress/work', label: 'Open work' },
    })
  }
  for (const [i, d] of (summary?.demands ?? []).entries()) {
    const noble = nobleOf(d.unit_id)
    const place = splitPascal(d.place).toLowerCase()
    notices.push({
      key: `nobles-demand-${i}`,
      severity: 'info',
      kind: 'nobles',
      title: `${noble ? firstName(noble) : d.name} demands ${/^[aeiou]/.test(place) ? 'an' : 'a'} ${place}${d.item ? ` with ${d.item}` : ''}`,
      hint: `Build one fit for ${d.position ? `a ${d.position}` : 'them'} and assign it to them from the room's settings. Unmet demands make nobles unhappy.`,
      units: noble ? [noble] : undefined,
    })
  }

  // Caravans on their way or at the depot.
  for (const c of summary?.caravans ?? []) {
    if (c.state !== 'Approaching' && c.state !== 'AtDepot' && c.state !== 'Stuck') continue
    const days = Math.floor(c.time_remaining / CARAVAN_TICKS_PER_DAY)
    const who = `${c.race ? `${/^[aeiou]/i.test(c.race) ? 'An' : 'A'} ${c.race}` : 'A'} caravan${c.civ ? ` from ${c.civ}` : ''}`
    const trouble = c.trouble.length
      ? ` They have had trouble: ${listWords(c.trouble.map((t) => t.replace(/_/g, ' ')))}.`
      : ''
    notices.push({
      key: `trade-caravan-${c.index}`,
      severity: c.state === 'Stuck' ? 'warning' : 'info',
      kind: 'trade',
      title:
        c.state === 'AtDepot'
          ? `${who} is at the depot`
          : c.state === 'Stuck'
            ? `${who} cannot reach the depot`
            : `${who} is on its way`,
      detail:
        c.state === 'Stuck'
          ? `Their wagons have found no way to the trade depot.${trouble}`
          : `${days > 0 ? `${plural(days, 'day')} left to trade.` : 'They are about to leave.'}${trouble}`,
      hint:
        c.state === 'Stuck'
          ? 'Wagons need a path three tiles wide from the map edge to the depot, with no stairs in the way.'
          : 'Haul goods to the trade depot and have a broker meet them there.',
      link: { to: '/fortress/items', label: 'Browse the stores' },
    })
  }

  // Supplies and failing jobs, as the game dump counts them.
  const alerts: FortAlert[] = summary?.alerts ?? []
  for (const alert of alerts.filter((a) => a.kind === 'supply')) {
    notices.push({
      key: `supply-${alert.title}`,
      severity: alert.severity,
      kind: 'supply',
      title: alert.title,
      detail: alert.detail,
      hint: /drink/i.test(alert.title)
        ? 'Brew more: a still, barrels and plants to ferment.'
        : 'Cook meals, farm, fish or hunt. Buy food from caravans.',
      link: { to: '/fortress/items', label: 'Browse the stores' },
    })
  }
  const failing = alerts.filter((a) => a.kind === 'cancellation')
  if (failing.length) {
    notices.push({
      key: 'work-failing',
      severity: 'warning',
      kind: 'work',
      title: `${plural(failing.length, 'job keeps', 'jobs keep')} failing`,
      lines: failing.map((a) => ({
        label: a.title.replace(/ keeps failing$/, ''),
        detail: a.detail,
        count: a.count,
        hint: cancellationHint(a.detail),
      })),
      hint: 'Repeating orders retry forever. Supply what they need, or cancel them in the game.',
      link: { to: '/fortress/work', label: 'Open work' },
    })
  }

  const idle = citizens.filter((u) => isGrownCitizen(u) && !u.job && !u.squad && !u.mood)
  if (idle.length) {
    notices.push({
      key: 'work-idle',
      severity: 'info',
      kind: 'work',
      title: `${listNames(idle)} ${idle.length === 1 ? 'has' : 'have'} nothing to do`,
      hint: 'Queue work orders at the manager, or give them more labors.',
      units: idle,
    })
  }
  if (summary?.jobs_suspended) {
    notices.push({
      key: 'work-suspended',
      severity: 'info',
      kind: 'work',
      title: `${plural(summary.jobs_suspended, 'job is', 'jobs are')} suspended`,
      hint: 'Suspended jobs usually lack materials or are blocked. Unsuspend them in the game once that is fixed.',
      link: { to: '/fortress/work', label: 'Open work' },
    })
  }

  // Small unhappinesses many dwarves share, with what fixes them.
  for (const feeling of fortFeelings(units, now)) {
    if (feeling.tone !== 'bad' || !feeling.hint || feeling.units.length < 2) continue
    let hint = feeling.hint
    if (feeling.thought === 'DrinkWithoutCup' && concerns)
      hint = `${hint} ${concerns.cups ? `The fortress has ${plural(concerns.cups, 'cup')}.` : 'The fortress has no cups at all.'}`
    notices.push({
      key: `comfort-${feeling.thought}`,
      severity: 'info',
      kind: 'comfort',
      title: `${feeling.units.length} dwarves ${feeling.phrase}`,
      hint,
      units: feeling.units,
    })
  }

  return notices.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  )
}
