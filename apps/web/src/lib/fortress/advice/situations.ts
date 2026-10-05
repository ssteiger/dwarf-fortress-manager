import type { DfhackAction, FortEvent } from '@fortress/db-drizzle'

import { isLiving, unitGroup } from '../format'
import { moodNeedsText } from '../people/troubles'
import { firstName, isCitizenish, isGrownCitizen } from '../people/units'
import { type GameTime, TICKS_PER_MONTH, absTicks, seasonOf } from '../time'
import { patientNeeds } from './health'
import { creatureCounts } from './notices'
import { fmt, names, plural } from './phrasing'
import type { AdvisorInput, Shortcut } from './types'

/*
 * What the season ahead brings, and the playbook for what is happening now:
 * a siege, a caravan, a strange mood. Each situation says how to get through
 * it. Client-safe.
 */

// ---------------------------------------------------------------------------
// The season ahead

export function seasonNotes(tick: number | null): { season: string; notes: string[] } | null {
  if (tick === null) return null
  const season = seasonOf(tick)
  const notes: Record<typeof season, string[]> = {
    spring: [
      'Surface crops can go in: plant your fields for the season.',
      'Migrants often arrive now. Have beds and a dormitory ready.',
      'Elven caravans come in spring, if you are at peace with them.',
    ],
    summer: [
      'Human caravans come in summer.',
      'As the fortress grows richer, thieves, ambushes and sieges become likelier. Train your squad.',
      'Harvest what you planted in spring and brew the surplus.',
    ],
    autumn: [
      'The dwarven caravan comes from the mountainhomes: have crafts waiting at the depot.',
      'Stock up drink and food before winter.',
      'The liaison may visit to talk trade and nobles.',
    ],
    winter: [
      'Surface water freezes and nothing grows outside. Rely on underground farms and a well.',
      'A quiet season: dig, build and smooth while the world sleeps.',
      'Plan for spring: seeds, beds for migrants, and work orders to keep everyone busy.',
    ],
  }
  return { season, notes: notes[season] }
}

// ---------------------------------------------------------------------------
// Situations, and how to get through them

export interface Situation {
  key: string
  title: string
  /** How you can tell it is happening. */
  signs: string
  steps: string[]
  actions?: DfhackAction[]
  dfhack?: Shortcut[]
  /** Why it looks like this is happening now, if it does. */
  now?: string
}

/** Events from the last month that pass `test`; undated ones count as recent. */
export const recentEvents = (
  events: FortEvent[],
  now: GameTime | null,
  test: (e: FortEvent) => boolean,
) =>
  events.filter(
    (e) =>
      test(e) &&
      (!now ||
        e.game_year === null ||
        e.game_tick === null ||
        absTicks(now) - absTicks({ year: e.game_year, tick: e.game_tick }) <= TICKS_PER_MONTH),
  )

export function situations({ units, summary, concerns, events, now }: AdvisorInput): Situation[] {
  const living = units.filter(isLiving)
  const citizens = living.filter(isCitizenish)
  const hostiles = living.filter((u) => unitGroup(u) === 'hostile')
  const inSight = hostiles.filter((u) => !u.flags.includes('hidden'))
  const unseen = hostiles.filter((u) => u.flags.includes('hidden'))
  const moody = citizens.filter(
    (u) => u.mood && ['Fey', 'Secretive', 'Possessed', 'Macabre', 'Fell'].includes(u.mood),
  )
  const mad = citizens.filter(
    (u) =>
      u.stress_category <= 1 ||
      (u.mood && ['Melancholy', 'Raving', 'Berserk', 'Traumatized'].includes(u.mood)),
  )
  const hurt = citizens.filter((u) => u.wounds > 0)
  const waiting = (concerns?.health?.patients ?? []).filter((p) => patientNeeds(p).length).length
  const ghosts = living.filter((u) => u.flags.includes('ghost'))
  const undead = hostiles.filter(
    (u) => u.flags.includes('undead') || u.flags.includes('opposed_to_life'),
  )
  const shortage = (summary?.alerts ?? []).filter((a) => a.kind === 'supply')
  const failing = (summary?.alerts ?? []).filter((a) => a.kind === 'cancellation')
  const damp = recentEvents(events, now, (e) => /DIG_CANCEL_(DAMP|WARM)/.test(e.type ?? ''))
  const migrants = recentEvents(events, now, (e) => /MIGRANT/.test(e.type ?? ''))
  const idle = citizens.filter((u) => isGrownCitizen(u) && !u.job && !u.squad && !u.mood)
  const tired = citizens.filter((u) => u.sleepiness >= 57_600)

  const all: Situation[] = [
    {
      key: 'siege',
      title: 'Invaders or monsters at the gates',
      signs: 'A siege or ambush announcement, or dangerous creatures in sight on the map.',
      steps: [
        'Raise the drawbridge or lock the outer doors.',
        'Send civilians indoors: a burrow for everyone plus the civilian alert in the Squads screen.',
        'Station squads at a choke point, behind cage and weapon traps if you have them.',
        'Against archers, build fortifications (arrow slits) so your marksdwarves can shoot back from cover.',
        'When it is over, haul the enemy dead to a refuse pile and bury your own.',
      ],
      now: inSight.length ? `${creatureCounts(inSight)} in sight.` : undefined,
    },
    {
      key: 'caverns',
      title: 'Something lurks in the caverns',
      signs: 'A forgotten beast or titan is announced, or creatures show as unseen deep below.',
      steps: [
        'Wall off or hatch-cover every tunnel into the caverns until you are ready.',
        'Read the creature’s description: poison breath, webs or fire decide what armor and tactics work.',
        'Lure it into cage traps or over a long drop, or meet it with a full squad in metal armor.',
        'Keep woodcutters, fishers and gatherers out of the caverns meanwhile.',
      ],
      now: unseen.length ? `${creatureCounts(unseen)} unseen below.` : undefined,
    },
    {
      key: 'mood',
      title: 'A dwarf is taken by a strange mood',
      signs: '"…is taken by a fey mood", or secretive, possessed, macabre or fell.',
      steps: [
        'They claim a free workshop of their best craft, so keep one of each kind free.',
        'Select the workshop to see what they demand. Dwarves fetch it if the fortress has it; otherwise mine, make or trade for it fast.',
        'Macabre moods want bones, skulls and shells. Fell moods kill someone first.',
        'Success brings a legendary artifact and skill. Failure ends in melancholy, raving or a berserk rage.',
      ],
      now: moody.length
        ? [
            `${names(moody)} ${moody.length === 1 ? 'is' : 'are'} in a mood.`,
            ...moody.map((u) => {
              const needs = moodNeedsText(u.strange_mood)
              return needs ? `${firstName(u)}: ${needs}` : null
            }),
          ]
            .filter(Boolean)
            .join(' ')
        : undefined,
    },
    {
      key: 'madness',
      title: 'Tantrums, melancholy and madness',
      signs:
        'Unhappy or miserable dwarves, tantrums that smash furniture, dwarves stricken by melancholy.',
      steps: [
        'Read their thoughts on the dwarves page: the cause is usually something you can fix.',
        'Fix the big comforts first: an own bedroom, a dining hall, good meals, drink in a mug.',
        'Meet their needs: a temple, a tavern, a library, time with friends and family.',
        'Give a tantrum space; a berserk dwarf must be locked up or stopped by the militia.',
        'Melancholy and raving dwarves do not recover. Bury them properly when they die so the grief does not spread.',
      ],
      now: mad.length
        ? `${names(mad)} ${mad.length === 1 ? 'is' : 'are'} in a bad way.`
        : undefined,
    },
    {
      key: 'hurt',
      title: 'Someone is hurt',
      signs: 'Wounded dwarves, bleeding, or dwarves lying down where they fell.',
      steps: [
        'Designate a hospital zone with beds, near water.',
        'Appoint a chief medical dwarf and enable Diagnosis, Surgery, Suturing, Bone setting and Wound dressing on your doctors.',
        'Stock thread, cloth, splints, crutches, soap and buckets in or near the hospital.',
        'Keep Recovering wounded enabled on plenty of dwarves, so the hurt get carried in.',
      ],
      now: hurt.length
        ? `${names(hurt)} ${hurt.length === 1 ? 'is' : 'are'} hurt${waiting ? `; ${fmt(waiting)} still ${waiting === 1 ? 'waits' : 'wait'} for treatment` : ''}.`
        : undefined,
    },
    {
      key: 'dead',
      title: 'A death, and a ghost',
      signs: '"…has been found dead", bodies left where they fell, or a ghost haunting the halls.',
      steps: [
        'Place coffins in tomb zones: dwarves bury citizens on their own when a coffin is free.',
        'Bodies that cannot be recovered need a memorial slab, engraved at a mason’s workshop with their name.',
        'A ghost means someone lies unburied or unremembered: bury the body or place a slab, and it will rest.',
        'Grieving friends and family need time, good rooms and meals.',
      ],
      actions: ['burial'],
      now: ghosts.length
        ? `${plural(ghosts.length, 'ghost')} walk the fortress.`
        : concerns?.unburied.length
          ? `${plural(concerns.unburied.length, 'body lies', 'bodies lie')} unburied.`
          : undefined,
    },
    {
      key: 'hunger',
      title: 'Running out of food or drink',
      signs: 'Low stocks, thirsty or hungry dwarves, cooks and brewers idle for lack of plants.',
      steps: [
        'Brew first: without drink dwarves slow down, and dehydration kills within days.',
        'Keep farm plots planted every season; plump helmets grow underground all year.',
        'Fish, hunt, gather plants and butcher surplus animals.',
        'Trade with the next caravan for food and drink.',
      ],
      actions: ['seedwatch', 'seedwatchAll', 'autofarm'],
      now: shortage.length ? `${shortage.map((a) => a.title).join('. ')}.` : undefined,
    },
    {
      key: 'sleep',
      title: 'Dwarves who cannot sleep',
      signs: 'Drowsy or exhausted dwarves, or thoughts about being woken by noise.',
      steps: [
        'Build enough beds: one each in bedrooms, or a dormitory with several for now.',
        'Keep bedrooms away from workshops, busy halls and pump stacks; noise wakes dwarves.',
        'Make sure the way to the beds is open: locked doors and flooded halls keep them from rest.',
      ],
      now: tired.length
        ? `${names(tired)} ${tired.length === 1 ? 'is' : 'are'} drowsy or worse.`
        : undefined,
    },
    {
      key: 'failing',
      title: 'Jobs keep getting cancelled',
      signs: '"…cancels X: needs Y" over and over in the chronicle.',
      steps: [
        '"Needs X" means there is no X the worker can reach and use.',
        'Check the item is not forbidden, already in use, behind a locked door or in an unreachable cave.',
        'Make, mine or buy the missing input, or cancel the repeating order.',
        'A workshop also needs a free dwarf with that labor enabled.',
        'Orders whose materials ran out keep failing until the manager re-checks them.',
      ],
      actions: ['recheckOrders'],
      now: failing.length
        ? `${plural(failing.length, 'job keeps', 'jobs keep')} failing.`
        : undefined,
    },
    {
      key: 'idle',
      title: 'Dwarves with nothing to do',
      signs: 'Idle dwarves at the meeting hall while designations wait.',
      steps: [
        'Queue work orders so workshops always have something to make.',
        'Give idle dwarves more labors in the Labor screen, starting with hauling.',
        'Dig new rooms, smooth and engrave walls: busy dwarves are happier and the fortress grows richer.',
      ],
      actions: ['basicOrders'],
      now: idle.length ? `${names(idle)} ${idle.length === 1 ? 'is' : 'are'} idle.` : undefined,
    },
    {
      key: 'undead',
      title: 'The dead walk',
      signs:
        '"The dead walk", zombies or skeletons at the gates, a necromancer nearby, or evil weather.',
      steps: [
        'Close the gates: the undead never tire and never flee.',
        'Deal with corpses before they rise: burn them, drop them into magma, or seal them in a pit.',
        'Blunt weapons break skeletons; axes and swords cut zombies apart.',
        'Keep civilians inside while evil clouds or rain pass over.',
      ],
      now: undead.length ? `${creatureCounts(undead)} on the map.` : undefined,
    },
    {
      key: 'night',
      title: 'Vampires and werebeasts',
      signs:
        'Dwarves found dead and drained of blood, a dwarf who never eats, drinks or sleeps; or a citizen who turns into a beast.',
      steps: [
        'Read the cause of each death and who was nearby: a pattern points to the culprit.',
        'Lock a suspected vampire in a room or wall them in; they cannot be cured but need no food.',
        'Lock a werebeast away before the full moon, or send them off. Anyone they bite may catch the curse.',
      ],
    },
    {
      key: 'water',
      title: 'Water or magma near the digging',
      signs: '"Damp stone located" or "Warm stone located": digging stops next to water or magma.',
      steps: [
        'Do not dig on: the warning means the next tile may flood.',
        'Plan first: floodgates, hatches or walls to hold it, then channel or pump it where you want it.',
        'If water breaks through, evacuate the level and close the doors and hatches behind you.',
      ],
      now: damp.length ? 'Your miners hit damp or warm stone this month.' : undefined,
    },
    {
      key: 'caravan',
      title: 'A caravan has arrived',
      signs: 'Merchants at the depot, and wagons on the map.',
      steps: [
        'Bring goods to the depot: crafts, cut gems and fine furniture sell well.',
        'Send your broker; appraisal and social skills get better prices.',
        'Buy what you cannot make: metal, cloth, food, animals.',
        'Gifts improve relations; the liaison takes orders for next year.',
        'Merchants who stay at the edge of the map long after trading are stuck, and keep the next caravan away.',
      ],
      actions: ['fixStuckMerchants'],
      now: summary?.merchants ? `${plural(summary.merchants, 'merchant')} on the map.` : undefined,
    },
    {
      key: 'migrants',
      title: 'New arrivals',
      signs: '"Some migrants have arrived."',
      steps: [
        'Look through their skills on the dwarves page and put them to work where you are short.',
        'Give them beds; a dormitory will do until they get rooms.',
        'Watch the first months: newcomers bring grudges, curses and sometimes worse.',
        'If migrants stop coming to an old fortress, the game’s list of units may be full of the long dead.',
      ],
      actions: ['fixDeadUnits'],
      now: migrants.length ? 'Migrants arrived this month.' : undefined,
    },
  ]
  return all.sort((a, b) => Number(Boolean(b.now)) - Number(Boolean(a.now)))
}
