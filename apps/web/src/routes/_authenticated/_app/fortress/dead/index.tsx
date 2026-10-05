import { Badge } from '@fortress/ui'
import { Link, createFileRoute } from '@tanstack/react-router'
import { BookOpenIcon, GhostIcon } from 'lucide-react'
import * as React from 'react'

import { deathPhrase } from '~/lib/fortress/death'
import { formatGameTick } from '~/lib/fortress/format'
import type { FortDead, FortDeparted, FortFallen } from '~/lib/fortress/history'
import { cleanAnnouncement, pronouns } from '~/lib/fortress/insights'
import { useFortDead, useFortOverview } from '~/lib/fortress/queries'
import { EmptyState, PageHeader, StatusBanner } from '../-components/FortChrome'
import { RunActionButton } from '../-components/Guide'
import { Section, SheetMissing, capitalize } from '../dwarves/-components/SheetParts'
import { useFortLegendsWorldId, useKnownHistFigures } from '../dwarves/-components/UnitLinks'

function headline(data: FortDead | undefined): string {
  if (!data) return 'Who died in the fortress, how, and who still walks as a ghost.'
  const { dead } = data
  if (!dead.length)
    return data.complete
      ? 'None of your people have died here.'
      : 'The worker has not seen any of your people die.'
  const ghosts = dead.filter((d) => d.ghost).length
  const unburied = dead.filter((d) => !d.ghost && d.body === 'unburied').length
  return [
    dead.length === 1
      ? 'One of your people has died here.'
      : `${dead.length} of your people have died here.`,
    ghosts ? `${ghosts === 1 ? 'One walks' : `${ghosts} walk`} the fortress as a ghost.` : null,
    unburied ? `${unburied === 1 ? 'One lies' : `${unburied} lie`} unburied.` : null,
  ]
    .filter(Boolean)
    .join(' ')
}

const nameOf = (person: { name: string }) => cleanAnnouncement(person.name)

function FallenName({ fallen }: { fallen: Pick<FortFallen, 'id' | 'name' | 'page'> }) {
  return fallen.page ? (
    <Link
      to="/fortress/dwarves/$id"
      params={{ id: String(fallen.id) }}
      className="font-medium hover:underline"
    >
      {nameOf(fallen)}
    </Link>
  ) : (
    <span className="font-medium">{nameOf(fallen)}</span>
  )
}

/** "4 Granite 1432, aged 54. Bled to death. Slain by Ngutek, a goblin." */
function deathLine(fallen: FortFallen): string {
  const when = formatGameTick(fallen.died_year, fallen.died_tick)
  const age =
    fallen.died_year !== null && fallen.born_year !== null
      ? fallen.died_year - fallen.born_year
      : null
  const p = pronouns(fallen)
  return [
    when ? `${when}${age !== null ? `, aged ${age}` : ''}.` : null,
    `${capitalize(p.they)} ${deathPhrase(fallen.cause)}.`,
    fallen.slayer
      ? `Slain by ${cleanAnnouncement(fallen.slayer)}${fallen.slayer_race ? `, a ${fallen.slayer_race}` : ''}.`
      : null,
  ]
    .filter(Boolean)
    .join(' ')
}

/** Where their remains are and what remembers them. */
function restLine(fallen: FortFallen): string | null {
  const p = pronouns(fallen)
  const body =
    fallen.body === 'buried'
      ? `${capitalize(p.their)} remains lie in a coffin.`
      : fallen.body === 'unburied'
        ? `${capitalize(p.their)} remains lie unburied.`
        : fallen.body === 'none'
          ? `No remains of ${p.them} are left.`
          : null
  const memorial = fallen.memorial ? `A memorial slab names ${p.them}.` : null
  return [body, memorial].filter(Boolean).join(' ') || null
}

function LegendsLink({ hf, worldId }: { hf: number; worldId: number }) {
  return (
    <Link
      to="/legends/$kind/$id"
      params={{ kind: 'historical_figure', id: String(hf) }}
      search={{ world: worldId }}
      title="Their legends"
      className="text-muted-foreground hover:text-foreground"
    >
      <BookOpenIcon className="size-3.5" />
    </Link>
  )
}

function FallenRow({ fallen, worldId }: { fallen: FortFallen; worldId: number | null }) {
  const rest = restLine(fallen)
  return (
    <li className="flex flex-col gap-0.5 border-b py-2 last:border-b-0">
      <span className="flex flex-wrap items-center gap-2">
        <FallenName fallen={fallen} />
        {fallen.profession ? (
          <span className="text-sm text-muted-foreground">{fallen.profession}</span>
        ) : null}
        {worldId !== null && fallen.hf !== null ? (
          <LegendsLink hf={fallen.hf} worldId={worldId} />
        ) : null}
        {fallen.ghost ? (
          <Badge variant="destructive" className="gap-1">
            <GhostIcon className="size-3" aria-hidden />
            Ghost
          </Badge>
        ) : null}
        {fallen.kills ? (
          <Badge variant="outline" className="tabular-nums">
            {fallen.kills} {fallen.kills === 1 ? 'kill' : 'kills'}
          </Badge>
        ) : null}
      </span>
      <span className="text-sm">{deathLine(fallen)}</span>
      {rest ? <span className="text-sm text-muted-foreground">{rest}</span> : null}
    </li>
  )
}

function Restless({ ghosts, worldId }: { ghosts: FortFallen[]; worldId: number | null }) {
  return (
    <Section
      title="Still walking as ghosts"
      count={ghosts.length}
      description="Ghosts frighten the living and haunt their dreams. A ghost rests once its body lies in a coffin in a tomb, or once a memorial slab engraved for it is placed. Slabs are made at a mason’s workshop and engraved at a craftsdwarf’s workshop."
      className="border-red-500/40"
    >
      <ul className="flex flex-col">
        {ghosts.map((g) => (
          <FallenRow key={g.id} fallen={g} worldId={worldId} />
        ))}
      </ul>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <RunActionButton action="autoslab" />
        <RunActionButton action="burial" />
      </div>
    </Section>
  )
}

function Unburied({ dead, worldId }: { dead: FortFallen[]; worldId: number | null }) {
  return (
    <Section
      title="Lying unburied"
      count={dead.length}
      description="Seeing the dead shakes the living, and the unburied dead of a fortress can return as ghosts. Place a coffin in a tomb zone and your dwarves carry them there."
    >
      <ul className="flex flex-col">
        {dead.map((d) => (
          <FallenRow key={d.id} fallen={d} worldId={worldId} />
        ))}
      </ul>
      <div className="mt-3">
        <RunActionButton action="burial" />
      </div>
    </Section>
  )
}

function Causes({ dead }: { dead: FortFallen[] }) {
  const counts = React.useMemo(() => {
    const byPhrase = new Map<string, number>()
    for (const d of dead) {
      if (!d.cause) continue
      const phrase = deathPhrase(d.cause)
      byPhrase.set(phrase, (byPhrase.get(phrase) ?? 0) + 1)
    }
    return [...byPhrase.entries()].sort((a, b) => b[1] - a[1])
  }, [dead])
  if (!counts.length) return null
  return (
    <Section title="How they died">
      <ul className="flex flex-col gap-1 text-sm">
        {counts.map(([phrase, n]) => (
          <li key={phrase} className="flex justify-between gap-3">
            <span>{capitalize(phrase)}</span>
            <span className="text-muted-foreground tabular-nums">{n}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Departed({ departed }: { departed: FortDeparted[] }) {
  if (!departed.length) return null
  return (
    <Section
      title="Left the fortress"
      count={departed.length}
      description="Citizens who left the map and have not come back. Their pages show them as the worker last read them."
    >
      <ul className="flex flex-col gap-1 text-sm">
        {departed.map((d) => (
          <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="flex items-baseline gap-2">
              <FallenName fallen={{ ...d, page: true }} />
              {d.profession ? <span className="text-muted-foreground">{d.profession}</span> : null}
            </span>
            <span className="text-muted-foreground">left {formatGameTick(d.year, d.tick)}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function DeadPage() {
  const overview = useFortOverview()
  const { data, isFetching, refetch } = useFortDead()
  const worldId = useFortLegendsWorldId()
  const dead = data?.dead ?? []
  const known = useKnownHistFigures(
    worldId,
    dead.map((d) => d.hf ?? -1),
  )
  const linkable = worldId !== null && known.size ? worldId : null
  const withLegends = (d: FortFallen): FortFallen =>
    d.hf !== null && known.has(d.hf) ? d : { ...d, hf: null }

  const ghosts = dead.filter((d) => d.ghost).map(withLegends)
  const unburied = dead.filter((d) => !d.ghost && d.body === 'unburied').map(withLegends)
  const byYear = React.useMemo(() => {
    const years = new Map<number | null, FortFallen[]>()
    for (const d of dead) {
      const list = years.get(d.died_year) ?? []
      list.push(d)
      years.set(d.died_year, list)
    }
    return [...years.entries()]
  }, [dead])

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        title="The dead"
        description={headline(data)}
        updatedAt={data?.capturedAt}
        isFetching={isFetching}
        onRefresh={() => refetch()}
      />
      <StatusBanner state={overview.data?.state} />
      {data && !data.complete ? (
        <SheetMissing what="Causes of death, and the deaths from before the worker started watching," />
      ) : null}

      {ghosts.length ? <Restless ghosts={ghosts} worldId={linkable} /> : null}
      {unburied.length ? <Unburied dead={unburied} worldId={linkable} /> : null}

      {data && !dead.length && !data.departed.length ? (
        <EmptyState title="No one has died">
          When one of your people dies, they are listed here with how and when it happened, and
          where their remains lie.
        </EmptyState>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {byYear.length ? (
          <Section title="The roll of the dead" count={dead.length}>
            <div className="flex flex-col gap-4">
              {byYear.map(([year, list]) => (
                <div key={year ?? 'unknown'}>
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    {year !== null ? `Year ${year}` : 'When is not known'}
                  </h3>
                  <ul className="flex flex-col">
                    {list.map((d) => (
                      <FallenRow key={d.id} fallen={withLegends(d)} worldId={linkable} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Section>
        ) : (
          <div />
        )}
        <div className="flex flex-col gap-6">
          <Causes dead={dead} />
          <Departed departed={data?.departed ?? []} />
        </div>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/_app/fortress/dead/')({
  component: DeadPage,
})
