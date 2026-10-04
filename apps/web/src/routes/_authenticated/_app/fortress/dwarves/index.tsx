import type { FortUnit } from '@fortress/db-drizzle'
import { Button } from '@fortress/ui'
import { Link, createFileRoute } from '@tanstack/react-router'
import { PawPrintIcon } from 'lucide-react'
import * as React from 'react'

import { isLiving, unitGroup } from '~/lib/fortress/format'
import { concernScore, gameTimeOf, unitConcerns } from '~/lib/fortress/insights'
import { useFortOverview, useFortPeople, useFortUnits } from '~/lib/fortress/queries'
import { EmptyState, PageHeader, StatusBanner } from '../-components/FortChrome'
import { Bonds, HelpList, SkillCoverage, Squads, WorkGroups } from './-components/PeoplePanels'
import { UnitDrawer } from './-components/UnitDrawer'

function count(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

function DwarvesPage() {
  const overview = useFortOverview()
  const { data, isFetching, refetch } = useFortUnits()
  const [selected, setSelected] = React.useState<FortUnit | null>(null)
  const now = gameTimeOf(overview.data?.state)

  const units = data?.units ?? []
  const citizens = React.useMemo(
    () => units.filter((u) => isLiving(u) && unitGroup(u) === 'citizen'),
    [units],
  )
  const helpWanted = React.useMemo(
    () =>
      citizens
        .map((unit) => ({ unit, concerns: unitConcerns(unit, now) }))
        .filter((entry) => entry.concerns.length > 0)
        .sort((a, b) => concernScore(b.concerns) - concernScore(a.concerns)),
    [citizens, now],
  )
  const people = useFortPeople()
  const summary = overview.data?.state?.summary ?? null

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        title="Dwarves"
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
          <Button asChild variant="outline" size="sm">
            <Link to="/fortress/dwarves-and-creatures">
              <PawPrintIcon className="size-4" />
              Everyone on the map
            </Link>
          </Button>
        }
      />
      <StatusBanner state={overview.data?.state} />

      {citizens.length ? (
        <>
          <HelpList entries={helpWanted} onOpen={setSelected} />
          <div className="grid items-start gap-4 xl:grid-cols-2">
            <WorkGroups citizens={citizens} onOpen={setSelected} />
            <SkillCoverage
              citizens={citizens}
              wasted={people.data?.wasted ?? []}
              loading={people.isPending}
              onOpen={setSelected}
            />
          </div>
          <Squads squads={people.data?.squads ?? []} units={units} onOpen={setSelected} />
          <Bonds
            citizens={citizens}
            bonds={people.data?.bonds ?? []}
            loading={people.isPending}
            onOpen={setSelected}
          />
        </>
      ) : (
        <EmptyState title="No citizens yet">
          {units.length
            ? 'Nobody on the map is a citizen of the fortress. Everyone else is under Everyone on the map.'
            : 'No dump has been taken yet.'}
        </EmptyState>
      )}

      <UnitDrawer unit={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/_app/fortress/dwarves/')({
  component: DwarvesPage,
})
