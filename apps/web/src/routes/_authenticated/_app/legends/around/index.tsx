import { Badge, Button, Skeleton } from '@fortress/ui'
import { createFileRoute } from '@tanstack/react-router'
import * as React from 'react'

import { titleCase, words } from '~/lib/legends/model'
import type {
  AroundBeast,
  AroundFortress,
  AroundSite,
  BeastKind,
} from '~/lib/legends/server/around'
import { BeastRow, useAroundFortress } from '../-components/Around'
import { Yours } from '../-components/FortressTie'
import {
  LegendsShell,
  type LiveFortress,
  NamedRef,
  RecordLink,
  Section,
  SectionGrid,
  SectionStack,
  parseWorldSearch,
} from '../-components/LegendsChrome'

const AroundPage = () => {
  const { world } = Route.useSearch()
  return (
    <LegendsShell section="around" world={world}>
      {({ worldId, live, matchesLive }) => (
        <AroundBody worldId={worldId} live={live} matchesLive={matchesLive} />
      )}
    </LegendsShell>
  )
}

const BEAST_GROUPS: { kind: BeastKind; title: string; description: string }[] = [
  {
    kind: 'great',
    title: 'Great beasts',
    description: 'Megabeasts, titans, forgotten beasts, giants and demons still alive.',
  },
  {
    kind: 'night',
    title: 'Night creatures',
    description: 'Creatures of the dark that hunt the living.',
  },
  {
    kind: 'cursed',
    title: 'The cursed',
    description: 'Vampires, werebeasts and necromancers who walk among the living.',
  },
]

const AroundBody = ({
  worldId,
  live,
  matchesLive,
}: {
  worldId: number
  live: LiveFortress | null
  matchesLive: boolean
}) => {
  const around = useAroundFortress(worldId, live, matchesLive)
  const data = around.data

  if (!data) {
    return around.isError ? (
      <p className="p-4 text-sm text-destructive">
        The record could not be read just now. Reload the page to try again.
      </p>
    ) : (
      <div className="flex flex-col gap-4 p-4" aria-busy="true">
        <p className="text-sm text-muted-foreground">Counting the beasts of the world…</p>
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  const fortName = live?.fortName ? titleCase(live.fortName) : 'your fortress'
  return (
    <SectionStack className="border-b">
      <div className="max-w-[70ch] px-4 py-4 text-base leading-relaxed">
        {data.home ? (
          <p>
            What lives around {fortName}
            {data.endYear !== null ? ` when the records close, in the year ${data.endYear}` : ''}.
            Distances are counted in squares of the world map from{' '}
            <RecordLink kind="site" id={data.home.id} name={data.home.name} worldId={worldId} />.
            The export is a snapshot: beasts may have died or moved since.
          </p>
        ) : (
          <p className="text-muted-foreground">
            {matchesLive
              ? `${fortName} was founded after this export, so the beasts are listed without distances.`
              : 'Your fortress is not in this world, so the beasts are listed without distances.'}{' '}
            {data.endYear !== null ? `The list is the world as of the year ${data.endYear}.` : ''}
          </p>
        )}
      </div>

      <SectionGrid className="lg:grid-cols-3">
        {BEAST_GROUPS.map((group) => (
          <BeastList
            key={group.kind}
            title={group.title}
            description={group.description}
            beasts={data.beasts[group.kind]}
            total={data.totals[group.kind]}
            worldId={worldId}
            hasHome={!!data.home}
          />
        ))}
      </SectionGrid>

      {data.home ? (
        <SectionGrid className="lg:grid-cols-2">
          <Section
            title="Neighbours"
            description="The nearest sites people hold, and whether they are at war with you."
          >
            <SiteList
              sites={data.neighbours}
              data={data}
              worldId={worldId}
              empty="No held sites nearby."
            />
          </Section>
          <Section
            title="Places where something waits"
            description="Shrines, towers, vaults, labyrinths and dark fortresses nearby."
          >
            <SiteList sites={data.dangers} data={data} worldId={worldId} empty="None nearby." />
          </Section>
        </SectionGrid>
      ) : null}
    </SectionStack>
  )
}

const SHOWN = 8

const BeastList = ({
  title,
  description,
  beasts,
  total,
  worldId,
  hasHome,
}: {
  title: string
  description: string
  beasts: AroundBeast[]
  total: number
  worldId: number
  hasHome: boolean
}) => {
  const [all, setAll] = React.useState(false)
  const shown = all ? beasts : beasts.slice(0, SHOWN)
  return (
    <Section
      title={title}
      count={total}
      description={`${description} ${hasHome ? 'Nearest first.' : 'Deadliest first.'}`}
    >
      {beasts.length ? (
        <ul className="flex flex-col divide-y">
          {shown.map((beast) => (
            <BeastRow key={beast.id} beast={beast} worldId={worldId} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">None alive in the record.</p>
      )}
      {beasts.length > SHOWN ? (
        <Button variant="link" size="sm" className="px-0" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show ${beasts.length - SHOWN} more`}
        </Button>
      ) : null}
      {total > beasts.length && all ? (
        <p className="text-sm text-muted-foreground">
          {(total - beasts.length).toLocaleString()} more live further away; the archive lists them
          all.
        </p>
      ) : null}
    </Section>
  )
}

const SiteList = ({
  sites,
  data,
  worldId,
  empty,
}: {
  sites: AroundSite[]
  data: AroundFortress
  worldId: number
  empty: string
}) => {
  if (!sites.length) return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <ul className="flex flex-col divide-y">
      {sites.map((site) => (
        <li
          key={site.id}
          className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0"
        >
          <div className="min-w-0">
            <RecordLink kind="site" id={site.id} name={site.name} worldId={worldId} />
            <div className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
              <span>{site.type ? words(site.type) : 'site'}</span>
              {site.civ !== null ? (
                <>
                  <span>· held by</span>
                  <NamedRef kind="entity" id={site.civ} names={data.names} worldId={worldId} />
                </>
              ) : null}
              {site.ours ? <Yours>yours</Yours> : null}
              {site.atWar ? <Badge variant="destructive">at war with you</Badge> : null}
            </div>
          </div>
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
            {site.distance} squares
          </span>
        </li>
      ))}
    </ul>
  )
}

export const Route = createFileRoute('/_authenticated/_app/legends/around/')({
  validateSearch: parseWorldSearch,
  component: AroundPage,
})
