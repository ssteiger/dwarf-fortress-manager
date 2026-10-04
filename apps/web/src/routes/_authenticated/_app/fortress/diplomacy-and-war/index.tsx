import type { FortCaravan, FortDiplomacy, FortPower, FortUnit } from '@fortress/db-drizzle'
import { createFileRoute } from '@tanstack/react-router'
import * as React from 'react'

import {
  type Stance,
  caravansOf,
  diplomacyHeadline,
  isNearPower,
  presenceByPower,
  stanceOf,
} from '~/lib/fortress/diplomacy'
import { useFortDiplomacy, useFortOverview, useFortUnits } from '~/lib/fortress/queries'
import { EmptyState, PageHeader, StatusBanner } from '../-components/FortChrome'
import { UnitDrawer } from '../dwarves/-components/UnitDrawer'
import { useFortLegendsWorldId } from '../dwarves/-components/UnitLinks'
import { Forecast } from './-components/Forecast'
import { NeighbourMap } from './-components/NeighbourMap'
import { Neighbours } from './-components/Neighbours'
import { Petitions } from './-components/Petitions'
import { Playbook } from './-components/Playbook'
import { PowerDrawer } from './-components/PowerDrawer'
import { RelationsGrid } from './-components/RelationsGrid'
import { RightNow } from './-components/RightNow'
import { Wars } from './-components/Wars'

/**
 * Worth listing without asking: your civilization, anyone at war with it or
 * on the map, and settled groups nearby or in contact. Far-off strangers and
 * groups holding only tombs wait behind the toggle.
 */
function isListed(power: FortPower, stance: Stance, here: boolean, trading: boolean): boolean {
  if (power.own || here || trading) return true
  if (stance.hostile && power.relation) return true
  if (power.site_count === 0) return false
  return isNearPower(power) || Boolean(power.relation)
}

function usePowers(
  d: FortDiplomacy | null,
  units: FortUnit[] | undefined,
  caravans: FortCaravan[] | undefined,
) {
  return React.useMemo(() => {
    if (!d) return null
    const stances = new Map(d.powers.map((p) => [p.id, stanceOf(p)]))
    const presence = presenceByPower(d, units ?? [])
    const listed = d.powers.filter((p) => {
      const stance = stances.get(p.id)
      if (!stance) return false
      const trading = caravansOf(d, caravans ?? [], p.id).some((c) => c.state !== 'None')
      return isListed(p, stance, presence.has(p.id), trading)
    })
    return { stances, presence, listed }
  }, [d, units, caravans])
}

function DiplomacyAndWarPage() {
  const overview = useFortOverview()
  const { data, isFetching, refetch } = useFortDiplomacy()
  const units = useFortUnits()
  const worldId = useFortLegendsWorldId()
  const [powerId, setPowerId] = React.useState<number | null>(null)
  const [unit, setUnit] = React.useState<FortUnit | null>(null)
  const [showDistant, setShowDistant] = React.useState(false)

  const d = data?.diplomacy ?? null
  const caravans = data?.caravans ?? []
  const derived = usePowers(d, units.data?.units, data?.caravans)
  const values = {
    citizens: data?.citizens ?? 0,
    createdWealth: data?.createdWealth ?? null,
    exportedWealth: data?.exportedWealth ?? null,
  }

  const header = (
    <PageHeader
      title="Diplomacy & War"
      description={
        d
          ? diplomacyHeadline(d)
          : 'Your neighbours, their wars, and what draws caravans, thieves and sieges to your fortress.'
      }
      updatedAt={data?.capturedAt}
      isFetching={isFetching}
      onRefresh={() => refetch()}
    />
  )

  if (!d || !derived)
    return (
      <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
        {header}
        <StatusBanner state={overview.data?.state} />
        {data ? (
          <EmptyState title="Neighbours and wars come with the next read">
            The last read of your game is from before the app learnt to read diplomacy. Read the
            game again and this page fills in.
          </EmptyState>
        ) : null}
      </div>
    )

  const { stances, presence, listed } = derived
  const powers = showDistant ? d.powers : listed
  const nearIds = new Set(listed.map((p) => p.id))
  const power = powerId !== null ? (d.powers.find((p) => p.id === powerId) ?? null) : null

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      {header}
      <StatusBanner state={overview.data?.state} />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <RightNow
          d={d}
          presence={presence}
          caravans={caravans}
          onOpenPower={setPowerId}
          onOpenUnit={setUnit}
        />
        <Forecast d={d} powers={listed} stances={stances} values={values} onOpen={setPowerId} />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_28rem]">
        <Neighbours
          d={d}
          powers={powers}
          stances={stances}
          presence={presence}
          caravans={caravans}
          showDistant={showDistant}
          onShowDistant={setShowDistant}
          distantCount={d.powers.length - listed.length}
          onOpen={setPowerId}
        />
        <div className="xl:sticky xl:top-4">
          <NeighbourMap
            powers={powers}
            stances={stances}
            selectedId={powerId}
            onOpen={setPowerId}
          />
        </div>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Wars d={d} nearIds={nearIds} worldId={worldId} onOpen={setPowerId} />
        <RelationsGrid powers={listed} onOpen={setPowerId} />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Petitions d={d} onOpen={setPowerId} />
        <Playbook d={d} stances={stances} />
      </div>

      <PowerDrawer
        d={d}
        power={power}
        stance={power ? (stances.get(power.id) ?? null) : null}
        here={power ? (presence.get(power.id) ?? []) : []}
        caravans={power ? caravansOf(d, caravans, power.id) : []}
        values={values}
        worldId={worldId}
        onClose={() => setPowerId(null)}
        onOpenPower={setPowerId}
        onOpenUnit={(u) => {
          setPowerId(null)
          setUnit(u)
        }}
      />
      <UnitDrawer unit={unit} onClose={() => setUnit(null)} />
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/_app/fortress/diplomacy-and-war/')({
  component: DiplomacyAndWarPage,
})
