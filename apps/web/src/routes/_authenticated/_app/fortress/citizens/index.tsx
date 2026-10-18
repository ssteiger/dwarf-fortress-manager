import type { FortUnit } from '@fortress/db-drizzle'
import { Button, Input } from '@fortress/ui'
import { Link, createFileRoute } from '@tanstack/react-router'
import { PawPrintIcon } from 'lucide-react'
import * as React from 'react'

import { useFortOverview, useFortPeople, useFortUnits } from '~/lib/fortress/client/queries'
import { useWatchList } from '~/lib/fortress/client/watch'
import { isLiving, unitGroup } from '~/lib/fortress/format'
import { concernScore, unitConcerns } from '~/lib/fortress/people/troubles'
import { gameTimeOf } from '~/lib/fortress/time'
import {
  EmptyState,
  PageHeader,
  SectionGrid,
  SectionStack,
  StatusBand,
} from '../-components/FortChrome'
import {
  Bonds,
  CitizenFilter,
  HelpList,
  JustArrived,
  SkillCoverage,
  Squads,
  TheYoung,
  Watching,
  WorkGroups,
} from './-components/PeoplePanels'
import { UnitDrawer } from './-components/UnitDrawer'
import { useLegendsCurses } from './-components/UnitLinks'

function count(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

const CitizensPage = () => {
  const overview = useFortOverview()
  const { data, isFetching, refetch } = useFortUnits()
  const [selected, setSelected] = React.useState<FortUnit | null>(null)
  const [query, setQuery] = React.useState('')
  const now = gameTimeOf(overview.data?.state)

  const units = data?.units ?? []
  const citizens = React.useMemo(
    () => units.filter((u) => isLiving(u) && unitGroup(u) === 'citizen'),
    [units],
  )
  const curses = useLegendsCurses(citizens)
  const helpWanted = React.useMemo(() => {
    const extra = new Map(curses.map((c) => [c.unitId, c]))
    return citizens
      .map((unit) => {
        const concerns = unitConcerns(unit, now)
        const curse = extra.get(unit.id)
        if (curse)
          concerns.unshift({
            key: `curse-${curse.kind}`,
            severity: 'danger',
            label: curse.what,
            hint: 'A curse the world’s history records. Watch them, and keep the others safe.',
          })
        return { unit, concerns }
      })
      .filter((entry) => entry.concerns.length > 0)
      .sort((a, b) => concernScore(b.concerns) - concernScore(a.concerns))
  }, [citizens, now, curses])
  const concernById = React.useMemo(
    () => new Map(helpWanted.map((entry) => [entry.unit.id, entry.concerns])),
    [helpWanted],
  )
  const people = useFortPeople()
  const { ids: watched } = useWatchList()
  const watching = React.useMemo(
    () => citizens.filter((unit) => watched.has(unit.id)),
    [citizens, watched],
  )
  const summary = overview.data?.state?.summary ?? null

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        className="border-b p-4"
        title="Citizens"
        description={
          summary ? (
            <>
              {count(citizens.length, 'citizen')}: {count(summary.adults, 'adult')},{' '}
              {count(summary.children, 'child', 'children')} and{' '}
              {count(summary.babies, 'baby', 'babies')} · {summary.working} at work, {summary.idle}{' '}
              idle · {summary.military} in squads
              {helpWanted.length ? ` · ${helpWanted.length} could use your help` : ''}
            </>
          ) : (
            'Who lives here, what they do, what they are good at and who they are to each other.'
          )
        }
        updatedAt={data?.capturedAt}
        isFetching={isFetching}
        onRefresh={() => {
          void refetch()
          void people.refetch()
        }}
        actions={
          <>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find someone"
              className="h-8 w-44"
              aria-label="Find a citizen by name"
            />
            <Button asChild variant="outline" size="sm">
              <Link to="/fortress/dwarves-and-creatures">
                <PawPrintIcon className="size-4" />
                Everyone on the map
              </Link>
            </Button>
          </>
        }
      />
      <StatusBand state={overview.data?.state} />

      {citizens.length ? (
        <CitizenFilter.Provider value={query.trim()}>
          <SectionStack className="border-b">
            <HelpList entries={helpWanted} onOpen={setSelected} />
            <Watching units={watching} concerns={concernById} onOpen={setSelected} />
            <JustArrived
              arrivals={people.data?.arrivals ?? []}
              units={citizens}
              onOpen={setSelected}
            />
            <TheYoung
              citizens={citizens}
              expecting={people.data?.expecting ?? []}
              bonds={people.data?.bonds ?? []}
              onOpen={setSelected}
            />
            <Bonds
              citizens={citizens}
              bonds={people.data?.bonds ?? []}
              loading={people.isPending}
              onOpen={setSelected}
            />
            <SectionGrid className="xl:grid-cols-2">
              <WorkGroups citizens={citizens} onOpen={setSelected} />
              <SkillCoverage
                citizens={citizens}
                wasted={people.data?.wasted ?? []}
                loading={people.isPending}
                onOpen={setSelected}
              />
            </SectionGrid>
            <Squads squads={people.data?.squads ?? []} units={units} onOpen={setSelected} />
          </SectionStack>
        </CitizenFilter.Provider>
      ) : (
        <EmptyState title="No citizens yet" className="m-4">
          {units.length
            ? 'Nobody on the map is a citizen of the fortress. Everyone else is under Everyone on the map.'
            : 'No dump has been taken yet.'}
        </EmptyState>
      )}

      <UnitDrawer unit={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/_app/fortress/citizens/')({
  component: CitizensPage,
})
