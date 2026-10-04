import type { FortDiplomacy, FortPower } from '@fortress/db-drizzle'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from '@fortress/ui'
import { TrendingUpIcon } from 'lucide-react'

import { plural } from '~/lib/fortress/advisor'
import {
  type FortProgressValues,
  MEASURES,
  type Measure,
  type PowerForecast,
  type Stance,
  amountText,
  forecastOf,
  measureValue,
  peopleOf,
  powerName,
  thresholdOf,
  triggerText,
} from '~/lib/fortress/diplomacy'
import type { OpenPower } from './shared'

const LEVELS = [1, 2, 3, 4, 5]

/** "Sends caravans already" or "Starts coming once you have 80 citizens (15 more)". */
export function noticeText(forecast: PowerForecast): string {
  if (forecast.notice.met) return 'Already takes notice of your fortress.'
  if (forecast.notice.next)
    return `Takes notice once you have ${triggerText(forecast.notice.next)}.`
  if (!forecast.notice.checks.length)
    return 'How big your fortress grows makes no difference to it.'
  return 'Takes notice once your fortress grows further.'
}

export function siegeText(forecast: PowerForecast, atWar: boolean): string {
  if (!forecast.siege.checks.length) return 'It never lays siege.'
  if (forecast.siege.met)
    return atWar
      ? 'Can besiege your fortress now: it is at war with you.'
      : 'Could besiege your fortress now, if it were at war with you.'
  const when = forecast.siege.next
    ? `once you have ${triggerText(forecast.siege.next)}`
    : 'once your fortress grows further'
  return atWar ? `Can lay siege ${when}.` : `If ever at war with you, it can lay siege ${when}.`
}

/** How close the fortress is to drawing caravans, thieves and sieges. */
export function Forecast({
  d,
  powers,
  stances,
  values,
  onOpen,
}: {
  d: FortDiplomacy
  powers: FortPower[]
  stances: Map<number, Stance>
  values: FortProgressValues
  onOpen: OpenPower
}) {
  const groups = new Map<string, FortPower[]>()
  for (const power of powers) {
    if (power.own || !power.triggers) continue
    const key = power.raw ?? power.race ?? String(power.id)
    const group = groups.get(key)
    if (group) group.push(power)
    else groups.set(key, [power])
  }
  const rows = [...groups.values()]
    .map((members) => ({ members, forecast: forecastOf(d, members[0], values) }))
    .filter(
      (row): row is { members: FortPower[]; forecast: PowerForecast } =>
        row.forecast !== null &&
        (row.forecast.notice.checks.length > 0 || row.forecast.siege.checks.length > 0),
    )
  const rules = d.invasion_rules

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUpIcon className="size-4 text-primary" />
          What draws them
        </CardTitle>
        <CardDescription>
          Caravans, thieves and sieges come as your fortress grows. The game rates three things from
          level 0 to 5, and each people has its own levels at which it takes notice and at which it
          can lay siege.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-4">
          {MEASURES.map((m) => (
            <MeasureBar key={m.key} d={d} measure={m.key} label={m.label} values={values} />
          ))}
        </div>

        {rows.length ? (
          <ul className="flex flex-col gap-3 border-t pt-4">
            {rows.map(({ members, forecast }) => {
              const atWar = members.some((p) => stances.get(p.id)?.hostile && p.relation)
              return (
                <li key={members[0].id} className="flex flex-col gap-0.5 text-sm">
                  <p>
                    <span className="font-medium capitalize">{peopleOf(members[0])}</span>{' '}
                    <span className="text-muted-foreground">
                      (
                      {members.slice(0, 3).map((p, i) => (
                        <span key={p.id}>
                          {i > 0 ? ', ' : null}
                          <button
                            type="button"
                            className="hover:underline"
                            onClick={() => onOpen(p.id)}
                          >
                            {powerName(p)}
                          </button>
                        </span>
                      ))}
                      {members.length > 3 ? ` and ${members.length - 3} more` : null})
                    </span>
                  </p>
                  <p className="text-muted-foreground">
                    {noticeText(forecast)} {siegeText(forecast, atWar)}
                  </p>
                </li>
              )
            })}
          </ul>
        ) : null}

        {rules ? (
          <p className="border-t pt-4 text-sm text-muted-foreground">
            Your difficulty settings: at least {plural(rules.min_raids_before_siege, 'raid')} before
            the first siege, and {plural(rules.min_raids_between_sieges, 'raid')} between sieges.
            {d.invaders_repelled
              ? ` Your fortress has driven off ${plural(d.invaders_repelled, 'attack')} so far.`
              : ''}
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function MeasureBar({
  d,
  measure,
  label,
  values,
}: {
  d: FortDiplomacy
  measure: Measure
  label: string
  values: FortProgressValues
}) {
  const level = d.progress[measure]
  const value = measureValue(measure, values)
  const thresholds = LEVELS.map((l) => thresholdOf(d, measure, l))
  const top = thresholds[4] ?? null
  const scale = top ? top * 1.05 : null
  const next = level < 5 ? thresholdOf(d, measure, level + 1) : null
  const pct = (amount: number) => (scale ? Math.min(100, (amount / scale) * 100) : 0)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {value !== null ? `${amountText(measure, value)}, ` : ''}level {level} of 5
          {next !== null
            ? `; level ${level + 1} at ${measure === 'population' ? next : `${next.toLocaleString()}☼`}`
            : ''}
        </span>
      </div>
      {scale ? (
        <div className="relative h-2.5 rounded-full bg-muted">
          <div
            className={cn('absolute inset-y-0 left-0 rounded-full bg-primary')}
            style={{ width: `${pct(value ?? 0)}%` }}
          />
          {thresholds.map((t, i) =>
            t !== null ? (
              <span
                key={LEVELS[i]}
                className="absolute -top-0.5 h-3.5 w-px bg-foreground/40"
                style={{ left: `${pct(t)}%` }}
                title={`Level ${LEVELS[i]}: ${amountText(measure, t)}`}
              />
            ) : null,
          )}
        </div>
      ) : null}
    </div>
  )
}
