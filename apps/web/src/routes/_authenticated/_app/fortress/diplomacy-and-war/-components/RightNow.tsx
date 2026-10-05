import type { FortCaravan, FortDiplomacy, FortUnit } from '@fortress/db-drizzle'
import { CARAVAN_TICKS_PER_DAY } from '@fortress/db-drizzle/fortress-types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from '@fortress/ui'
import { RadarIcon } from 'lucide-react'

import { plural } from '~/lib/fortress/advice/phrasing'
import { powerById, powerIdOf, presenceRole, presenceText } from '~/lib/fortress/diplomacy'
import { humanize } from '~/lib/fortress/format'
import { type OpenUnit, UnitChips } from '../../-components/Insights'
import { EntityName, type OpenPower } from './shared'

const CARAVAN_STATE: Record<string, string> = {
  Approaching: 'is on its way to the depot',
  AtDepot: 'is at the depot',
  Leaving: 'is leaving',
  Stuck: 'cannot reach the depot',
}

/** "is at the depot, 9 days left to trade". */
export function caravanText(c: FortCaravan): string {
  const state = CARAVAN_STATE[c.state] ?? humanize(c.state).toLowerCase()
  const days = Math.floor(c.time_remaining / CARAVAN_TICKS_PER_DAY)
  const left =
    c.state === 'AtDepot' || c.state === 'Approaching'
      ? days > 0
        ? `, ${plural(days, 'day')} left to trade`
        : ', about to leave'
      : ''
  const trouble = c.trouble.length
    ? `. Trouble on the way: ${c.trouble.map((t) => t.replace(/_/g, ' ')).join(', ')}`
    : ''
  return `${state}${left}${trouble}`
}

/** Army goals in plain words. */
const GOAL_WORDS: Record<string, string> = {
  SITE_INVASION: 'an invasion',
  MAKE_REQUEST: 'a demand',
  RESCUE_HF: 'a rescue',
  RECOVER_ARTIFACT: 'recovering an artifact',
  RAID: 'a raid',
  PILLAGE: 'pillaging',
  ATTACK_SITE: 'an attack',
  CONQUER_SITE: 'a conquest',
  REQUEST_TRIBUTE: 'demanding tribute',
  BRING_BACK_HF: 'bringing someone back',
  POSSIBLE_THREAT: 'scouting a threat',
}

const goalText = (goal: string) => GOAL_WORDS[goal] ?? humanize(goal).toLowerCase()

interface Line {
  key: string
  tone: 'danger' | 'warn' | 'info'
  body: React.ReactNode
  units?: FortUnit[]
}

/** Invaders, envoys, caravans and armies: what is happening between the fortress and the world now. */
export function RightNow({
  d,
  presence,
  caravans,
  onOpenPower,
  onOpenUnit,
}: {
  d: FortDiplomacy
  presence: Map<number, FortUnit[]>
  caravans: FortCaravan[]
  onOpenPower: OpenPower
  onOpenUnit: OpenUnit
}) {
  const name = (id: number) => <EntityName d={d} id={id} onOpen={onOpenPower} />
  const lines: Line[] = []

  for (const invasion of d.invasions) {
    if (!invasion.flags.includes('active')) continue
    lines.push({
      key: `invasion-${invasion.id}`,
      tone: 'danger',
      body: (
        <>
          {invasion.flags.includes('siege') ? 'A siege by ' : 'An invasion by '}
          {name(invasion.civ_id)}
          {invasion.size ? `, ${invasion.size} strong` : ''}. They are on the map or close to it.
        </>
      ),
    })
  }

  for (const army of d.incoming)
    lines.push({
      key: `incoming-${army.id}`,
      tone: army.goal === 'SITE_INVASION' ? 'danger' : 'warn',
      body: (
        <>
          An army of {name(army.entity_id)} is marching here for {goalText(army.goal)}.
        </>
      ),
    })

  const groups = [...presence.entries()]
    .map(([id, units]) => ({
      id,
      units,
      hostile: units.some((u) => presenceRole(u) === 'hostile'),
    }))
    .sort((a, b) => Number(b.hostile) - Number(a.hostile) || b.units.length - a.units.length)
  for (const group of groups)
    lines.push({
      key: `presence-${group.id}`,
      tone: group.hostile ? 'danger' : 'info',
      body: (
        <>
          {presenceText(group.units)} from {name(group.id)} on the map.
        </>
      ),
      units: group.units,
    })

  for (const caravan of caravans) {
    if (caravan.state === 'None') continue
    const known = powerById(d, powerIdOf(d, caravan.entity_id))
    lines.push({
      key: `caravan-${caravan.index}`,
      tone: caravan.state === 'Stuck' || caravan.trouble.length ? 'warn' : 'info',
      body: (
        <>
          {caravan.race ? `The ${caravan.race} caravan from ` : 'A caravan from '}
          {known ? name(caravan.entity_id) : (caravan.civ ?? 'somewhere')} {caravanText(caravan)}.
        </>
      ),
    })
  }

  for (const mission of d.missions)
    lines.push({
      key: `mission-${mission.id}`,
      tone: 'info',
      body: (
        <>
          Your squad is away on {goalText(mission.goal)}
          {mission.site ? ` at ${mission.site}` : ''}.
        </>
      ),
    })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <RadarIcon className="size-4 text-primary" />
          Right now
        </CardTitle>
        <CardDescription>
          Invaders, envoys, caravans and armies on the move, as of the last read.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            All quiet: no invaders, envoys or caravans on the map, and no armies on the move.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {lines.map((line) => (
              <li key={line.key} className="flex gap-3">
                <span
                  className={cn(
                    'mt-1.5 size-2 shrink-0 rounded-full',
                    line.tone === 'danger'
                      ? 'bg-red-600'
                      : line.tone === 'warn'
                        ? 'bg-amber-500'
                        : 'bg-sky-500',
                  )}
                />
                <div className="flex min-w-0 flex-col gap-1.5 text-sm">
                  <p>{line.body}</p>
                  {line.units?.length ? (
                    <UnitChips units={line.units} onOpen={onOpenUnit} max={8} />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
