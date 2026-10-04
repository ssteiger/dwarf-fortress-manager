import type { FortCaravan, FortDiplomacy, FortPower, FortUnit } from '@fortress/db-drizzle'
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Tabs,
  TabsList,
  TabsTrigger,
  cn,
} from '@fortress/ui'
import { UsersRoundIcon } from 'lucide-react'
import * as React from 'react'

import { plural } from '~/lib/fortress/advisor'
import {
  BEHAVIOUR,
  NEAR_TILES,
  type Stance,
  caravansOf,
  peopleLabel,
  powerName,
  presenceText,
  siteText,
  warSpan,
} from '~/lib/fortress/diplomacy'
import { type OpenPower, StanceBadge } from './shared'

type Filter = 'all' | 'hostile' | 'friendly' | 'unknown'

const FILTERS: Record<Filter, string> = {
  all: 'All',
  hostile: 'Hostile',
  friendly: 'Friendly',
  unknown: 'No contact',
}

function matches(filter: Filter, stance: Stance): boolean {
  if (filter === 'hostile') return stance.hostile
  if (filter === 'friendly') return stance.friendly
  if (filter === 'unknown') return stance.key === 'no-contact'
  return true
}

/** "4 settlements; nearest: Lipvirgil, a cave, 5 tiles to the west." */
export function holdingsText(power: FortPower): string {
  const site = power.sites[0]
  if (!site) return 'Holds no sites anywhere.'
  if (power.site_count === 0) return `No settlements; it holds ${siteText(site)}.`
  if (power.site_count === 1) return `${siteText(site)}.`
  return `${plural(power.site_count, 'settlement')}; nearest: ${siteText(site)}.`
}

/** Every power the page lists, nearest first, with its stance and who of it is here. */
export function Neighbours({
  d,
  powers,
  stances,
  presence,
  caravans,
  showDistant,
  onShowDistant,
  distantCount,
  onOpen,
}: {
  d: FortDiplomacy
  powers: FortPower[]
  stances: Map<number, Stance>
  presence: Map<number, FortUnit[]>
  caravans: FortCaravan[]
  showDistant: boolean
  onShowDistant: (value: boolean) => void
  distantCount: number
  onOpen: OpenPower
}) {
  const [filter, setFilter] = React.useState<Filter>('all')
  const counts = Object.fromEntries(
    (Object.keys(FILTERS) as Filter[]).map((key) => [
      key,
      powers.filter((p) => {
        const stance = stances.get(p.id)
        return stance ? matches(key, stance) : false
      }).length,
    ]),
  ) as Record<Filter, number>
  const shown = powers.filter((p) => {
    const stance = stances.get(p.id)
    return stance ? matches(filter, stance) : false
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UsersRoundIcon className="size-4 text-primary" />
          Neighbours
        </CardTitle>
        <CardDescription>
          Civilizations and groups with settlements within {NEAR_TILES} world tiles, and any farther
          off that your civilization deals with. Select one for its leaders, wars and how to handle
          it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList className="flex-wrap">
              {(Object.keys(FILTERS) as Filter[]).map((key) => (
                <TabsTrigger key={key} value={key} className="gap-1.5">
                  {FILTERS[key]}
                  <span className="text-xs text-muted-foreground tabular-nums">{counts[key]}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {distantCount > 0 ? (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={showDistant}
                onChange={(e) => onShowDistant(e.target.checked)}
              />
              Also {plural(distantCount, 'group')} far away or holding only tombs
            </label>
          ) : null}
        </div>

        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">None of your neighbours fit this filter.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {shown.map((power) => {
              const stance = stances.get(power.id)
              if (!stance) return null
              return (
                <li key={power.id}>
                  <NeighbourRow
                    d={d}
                    power={power}
                    stance={stance}
                    here={presence.get(power.id) ?? []}
                    caravans={caravansOf(d, caravans, power.id)}
                    onOpen={onOpen}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function NeighbourRow({
  d,
  power,
  stance,
  here,
  caravans,
  onOpen,
}: {
  d: FortDiplomacy
  power: FortPower
  stance: Stance
  here: FortUnit[]
  caravans: FortCaravan[]
  onOpen: OpenPower
}) {
  const war =
    stance.hostile && power.war_id != null ? d.wars.find((w) => w.id === power.war_id) : undefined
  const behaviour = power.behaviour.filter((flag) => BEHAVIOUR[flag])
  const trading = caravans.filter((c) => c.state !== 'None')
  return (
    <button
      type="button"
      onClick={() => onOpen(power.id)}
      className="flex w-full flex-col gap-2 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50 sm:flex-row sm:items-start sm:gap-4"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{powerName(power)}</span>
          <StanceBadge stance={stance} />
        </div>
        <p className="text-sm text-muted-foreground">
          {peopleLabel(power)}. {holdingsText(power)}
        </p>
        {behaviour.length ? (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {behaviour.map((flag) => (
              <Badge
                key={flag}
                variant="outline"
                title={BEHAVIOUR[flag].detail}
                className={cn(
                  'font-normal',
                  BEHAVIOUR[flag].hostile &&
                    'border-amber-500/40 text-amber-900 dark:text-amber-200',
                )}
              >
                {BEHAVIOUR[flag].label}
              </Badge>
            ))}
          </div>
        ) : null}
      </div>
      {here.length || trading.length || war ? (
        <div className="flex shrink-0 flex-col gap-1 text-sm sm:items-end sm:text-right">
          {here.length ? (
            <span className="font-medium">{presenceText(here)} on the map</span>
          ) : null}
          {trading.length ? (
            <span className="text-muted-foreground">
              {trading.some((c) => c.state === 'AtDepot')
                ? 'Caravan at the depot'
                : 'Caravan coming'}
            </span>
          ) : null}
          {war ? <span className="text-muted-foreground">{warSpan(war, d.year)}</span> : null}
        </div>
      ) : null}
    </button>
  )
}
