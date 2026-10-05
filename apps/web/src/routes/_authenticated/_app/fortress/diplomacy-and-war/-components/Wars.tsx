import type { FortDiplomacy, FortWar, FortWarEvent } from '@fortress/db-drizzle'
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@fortress/ui'
import { SwordsIcon } from 'lucide-react'
import * as React from 'react'

import { plural } from '~/lib/fortress/advice/phrasing'
import { isOngoing, warSpan, warTally } from '~/lib/fortress/diplomacy'
import { EntityName, LegendsLink, type OpenPower } from './shared'

const EVENTS_SHOWN = 3

/** Your civilization's wars, then the wars your neighbours fight among themselves. */
export function Wars({
  d,
  nearIds,
  worldId,
  onOpen,
}: {
  d: FortDiplomacy
  /** Powers the page lists as near; their wars with each other show on request. */
  nearIds: Set<number>
  worldId: number | null
  onOpen: OpenPower
}) {
  const [others, setOthers] = React.useState(false)
  const powerOf = (id: number) => d.entities[String(id)]?.power_id ?? id
  const ours = d.wars.filter((w) => w.ours)
  const between = d.wars.filter(
    (w) =>
      !w.ours &&
      isOngoing(w) &&
      [...w.attackers, ...w.defenders].some((id) => nearIds.has(powerOf(id))),
  )
  const ongoing = ours.filter(isOngoing).length

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <SwordsIcon className="size-4 text-primary" />
          Wars
        </CardTitle>
        <CardDescription>
          {ours.length === 0
            ? 'Your civilization fights in no war the histories record.'
            : `Your civilization has fought ${plural(ours.length, 'war')}${ongoing ? `, ${ongoing} still going` : ''}. Its enemies can raid and besiege your fortress even if the war began far away.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {ours.map((war) => (
          <WarItem key={war.id} d={d} war={war} worldId={worldId} onOpen={onOpen} />
        ))}
        {between.length ? (
          <div className="flex flex-col gap-3 border-t pt-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={others}
                onChange={(e) => setOthers(e.target.checked)}
              />
              Also the {plural(between.length, 'war')} your neighbours are fighting among themselves
            </label>
            {others
              ? between.map((war) => (
                  <WarItem key={war.id} d={d} war={war} worldId={worldId} onOpen={onOpen} />
                ))
              : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function Side({ d, ids, onOpen }: { d: FortDiplomacy; ids: number[]; onOpen: OpenPower }) {
  if (!ids.length) return <span>someone unknown</span>
  return (
    <>
      {ids.map((id, i) => (
        <React.Fragment key={id}>
          {i > 0 ? (i === ids.length - 1 ? ' and ' : ', ') : null}
          <EntityName d={d} id={id} onOpen={onOpen} />
          {id === d.civ_id ? (
            <span className="text-muted-foreground"> (your civilization)</span>
          ) : null}
        </React.Fragment>
      ))}
    </>
  )
}

export function WarItem({
  d,
  war,
  worldId,
  onOpen,
}: {
  d: FortDiplomacy
  war: FortWar
  worldId: number | null
  onOpen: OpenPower
}) {
  const [all, setAll] = React.useState(false)
  const events = all ? war.events : war.events.slice(0, EVENTS_SHOWN)
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{war.name ?? 'An unnamed war'}</span>
        {isOngoing(war) ? (
          <Badge variant="outline" className="border-transparent bg-red-600 font-normal text-white">
            Going on
          </Badge>
        ) : (
          <Badge variant="outline" className="font-normal text-muted-foreground">
            Over
          </Badge>
        )}
        <span className="ml-auto">
          <LegendsLink worldId={worldId} kind="historical_event_collection" id={war.id} />
        </span>
      </div>
      <p className="text-sm">
        <Side d={d} ids={war.attackers} onOpen={onOpen} /> against{' '}
        <Side d={d} ids={war.defenders} onOpen={onOpen} />.
      </p>
      <p className="text-sm text-muted-foreground">
        {warSpan(war, d.year)}. {warTally(war)}.
      </p>
      {events.length ? (
        <ul className="flex flex-col gap-1 border-l-2 pl-3 text-sm">
          {events.map((event, i) => (
            <li key={`${event.kind}-${event.year}-${i}`}>
              <WarEventText d={d} event={event} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      ) : null}
      {war.events.length > EVENTS_SHOWN || war.event_count > war.events.length ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {war.events.length > EVENTS_SHOWN ? (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground hover:underline"
              onClick={() => setAll(!all)}
            >
              {all ? 'Fewer events' : `All ${war.events.length} recent events`}
            </button>
          ) : null}
          {war.event_count > war.events.length ? (
            <span className="text-muted-foreground">
              {plural(war.event_count, 'event')} in all; the legends have the rest.
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function WarEventText({
  d,
  event,
  onOpen,
}: {
  d: FortDiplomacy
  event: FortWarEvent
  onOpen: OpenPower
}) {
  const attacker = <EntityName d={d} id={event.attacker} onOpen={onOpen} />
  const defender = <EntityName d={d} id={event.defender} onOpen={onOpen} />
  const site = event.site ?? 'an unknown place'
  const year = <span className="text-muted-foreground tabular-nums">Year {event.year}: </span>
  if (event.kind === 'BATTLE') {
    const deaths =
      event.attacker_deaths !== undefined || event.defender_deaths !== undefined
        ? ` ${plural(event.attacker_deaths ?? 0, 'attacker')} and ${plural(event.defender_deaths ?? 0, 'defender')} died.`
        : ''
    return (
      <>
        {year}
        {event.name ?? 'A battle'} at {site}.{' '}
        {event.outcome === 'ATTACKER_WON' ? (
          event.attacker != null ? (
            <>{attacker} won.</>
          ) : (
            'The attackers won.'
          )
        ) : event.outcome === 'DEFENDER_WON' ? (
          event.defender != null ? (
            <>{defender} held.</>
          ) : (
            'The defenders held.'
          )
        ) : null}
        {deaths}
      </>
    )
  }
  if (event.kind === 'SITE_CONQUERED')
    return (
      <>
        {year}
        {attacker} took {site} from {defender}.
      </>
    )
  const verb =
    event.kind === 'THEFT'
      ? 'stole from'
      : event.kind === 'ABDUCTION'
        ? 'carried people off from'
        : event.kind === 'RAID'
          ? 'raided'
          : 'struck at'
  return (
    <>
      {year}
      {attacker} {verb} {site}
      {event.defender != null ? (
        <>
          {', held by '}
          {defender}
        </>
      ) : null}
      .
    </>
  )
}
