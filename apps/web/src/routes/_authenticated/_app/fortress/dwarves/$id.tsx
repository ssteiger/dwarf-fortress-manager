import { Badge, Button } from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { BookOpenIcon } from 'lucide-react'

import { UnitPortrait } from '~/lib/df-assets/components'
import { humanize, isLiving, sexLabel, unitDisplayName, unitGroup } from '~/lib/fortress/format'
import { useFortOverview, useFortUnit } from '~/lib/fortress/queries'
import { getKnownFigures, getLegendsOverview } from '~/lib/legends/server'
import { FortBreadcrumbs, MoodBadge, PageHeader, StatusBanner } from '../-components/FortChrome'
import { DwarfDetails } from './-components/DwarfDetails'

const GROUP_EYEBROW = {
  citizen: 'Citizen',
  resident: 'Resident',
  visitor: 'Visitor',
  animal: 'Animal',
  hostile: 'Hostile',
  other: 'Creature',
} as const

function DwarfPage() {
  const { id } = Route.useParams()
  const numericId = Number.parseInt(id, 10)
  const overview = useFortOverview()
  const { data, isFetching, refetch } = useFortUnit(numericId)

  const unit = data?.unit ?? null
  const title = unit ? unitDisplayName(unit) : `Unit #${id}`

  const legends = useQuery({
    queryKey: ['legends', 'overview'],
    queryFn: () => getLegendsOverview(),
    staleTime: 60_000,
  })
  const liveWorld = overview.data?.state?.world_name ?? null
  const matchingWorld =
    legends.data?.worlds.find((w) => w.name && liveWorld && w.name === liveWorld) ?? null
  const hfId = unit?.hist_figure_id ?? -1
  const matchingWorldId = matchingWorld?.id ?? null
  const known = useQuery({
    queryKey: ['legends', 'known-figures', matchingWorldId, hfId],
    queryFn: () => getKnownFigures({ data: { worldId: matchingWorldId ?? -1, ids: [hfId] } }),
    enabled: matchingWorldId !== null && hfId >= 0,
    staleTime: 5 * 60_000,
  })
  const legendsWorldId = matchingWorld && known.data?.includes(hfId) ? matchingWorld.id : null

  const living = unit ? isLiving(unit) : false
  const group = unit ? unitGroup(unit) : 'other'
  const subtitle = unit
    ? [
        unit.name_english && unit.name_english !== unit.name ? unit.name_english : null,
        unit.caste,
        sexLabel(unit.sex),
        unit.profession,
        `${Math.floor(unit.age)} years`,
        !living ? 'dead' : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <FortBreadcrumbs
        items={[
          { label: 'Fortress', to: '/fortress' },
          { label: 'Dwarves', to: '/fortress/dwarves' },
          { label: title },
        ]}
      />

      <PageHeader
        eyebrow={GROUP_EYEBROW[group]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {unit ? (
              <UnitPortrait
                unit={unit}
                size={96}
                fallbackToSprite
                className="rounded-md border bg-muted/40"
                title={`${unit.race} as drawn in the game`}
              />
            ) : null}
            {title}
            {unit && (group === 'citizen' || group === 'resident') ? (
              <MoodBadge category={unit.stress_category} className="text-sm font-normal" />
            ) : null}
            {unit?.mood ? (
              <Badge variant="outline" className="text-sm font-normal">
                {humanize(unit.mood)} mood
              </Badge>
            ) : null}
          </span>
        }
        description={subtitle}
        updatedAt={data?.capturedAt}
        isFetching={isFetching}
        onRefresh={() => refetch()}
        actions={
          legendsWorldId ? (
            <Button asChild size="sm" variant="outline" className="gap-2">
              <Link
                to="/legends/$kind/$id"
                params={{ kind: 'historical_figure', id: String(hfId) }}
                search={{ world: legendsWorldId }}
              >
                <BookOpenIcon className="size-3.5" />
                Legends
              </Link>
            </Button>
          ) : null
        }
      />
      <StatusBanner state={overview.data?.state} />
      <DwarfDetails unitId={numericId} />
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/_app/fortress/dwarves/$id')({
  component: DwarfPage,
})
