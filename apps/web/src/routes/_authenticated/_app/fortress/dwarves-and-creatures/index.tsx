import type { FortUnit } from '@fortress/db-drizzle'
import { createFileRoute } from '@tanstack/react-router'
import * as React from 'react'

import { isLiving, unitGroup } from '~/lib/fortress/format'
import { gameTimeOf } from '~/lib/fortress/insights'
import { useFortOverview, useFortUnits } from '~/lib/fortress/queries'
import { PageHeader, StatusBanner } from '../-components/FortChrome'
import { UnitDrawer } from '../dwarves/-components/UnitDrawer'
import { GROUP_LABELS, type Group, Roster } from './-components/Roster'

/** "145 on the map: 65 citizens, 66 animals and 4 hostiles". */
function onTheMap(units: FortUnit[]): string {
  const living = units.filter(isLiving)
  const counts = new Map<Group, number>()
  for (const unit of living) counts.set(unitGroup(unit), (counts.get(unitGroup(unit)) ?? 0) + 1)
  const parts = (Object.keys(GROUP_LABELS) as Group[])
    .filter((group) => group !== 'all' && counts.get(group))
    .map((group) => `${counts.get(group)?.toLocaleString()} ${GROUP_LABELS[group].toLowerCase()}`)
  const list =
    parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  return `${living.length.toLocaleString()} on the map${list ? `: ${list}` : ''}`
}

function DwarvesAndCreaturesPage() {
  const overview = useFortOverview()
  const { data, isFetching, refetch } = useFortUnits()
  const [selected, setSelected] = React.useState<FortUnit | null>(null)
  const units = data?.units ?? []
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        title="Dwarves and creatures"
        description={
          units.length
            ? onTheMap(units)
            : 'Every citizen, resident, visitor, animal and hostile the game knows about.'
        }
        updatedAt={data?.capturedAt}
        isFetching={isFetching}
        onRefresh={() => refetch()}
      />
      <StatusBanner state={overview.data?.state} />
      <Roster units={units} now={gameTimeOf(overview.data?.state)} onOpen={setSelected} />
      <UnitDrawer unit={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/_app/fortress/dwarves-and-creatures/')({
  component: DwarvesAndCreaturesPage,
})
