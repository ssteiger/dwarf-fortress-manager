import { Badge } from '@fortress/ui'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { UnitPortrait } from '~/lib/df-assets/components'
import { useFortOverview, useFortUnit } from '~/lib/fortress/client/queries'
import { humanize, isLiving, sexLabel, unitDisplayName, unitGroup } from '~/lib/fortress/format'
import {
  FortBreadcrumbs,
  MoodBadge,
  PageHeader,
  StatusBanner,
  WatchButton,
} from '../-components/FortChrome'
import { ShowInGameButton } from './-components/ActionsTab'
import { DwarfDetails, type DwarfTab, isDwarfTab } from './-components/DwarfDetails'
import {
  UnitLinks,
  legendsRefFor,
  useFortLegendsWorldId,
  useKnownHistFigures,
} from './-components/UnitLinks'

const GROUP_LABEL = {
  citizen: 'Citizen',
  resident: 'Resident',
  visitor: 'Visitor',
  animal: 'Animal',
  hostile: 'Hostile',
  other: 'Creature',
} as const

interface DwarfSearch {
  tab?: DwarfTab
}

function DwarfPage() {
  const { id } = Route.useParams()
  const { tab } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const numericId = Number.parseInt(id, 10)
  const overview = useFortOverview()
  const { data, isFetching, refetch } = useFortUnit(numericId)

  const unit = data?.unit ?? null
  const title = unit ? unitDisplayName(unit) : `Unit #${id}`

  const legendsWorldId = useFortLegendsWorldId()
  const knownFigures = useKnownHistFigures(legendsWorldId, [unit?.hist_figure_id ?? -1])
  const legends = unit ? legendsRefFor(unit, legendsWorldId, knownFigures) : null

  const archived = data?.archived ?? null
  const living = unit ? isLiving(unit) : false
  const onMap = living && !archived
  const group = unit ? unitGroup(unit) : 'other'
  const subtitle = unit
    ? [
        GROUP_LABEL[group],
        unit.name_english && unit.name_english !== unit.name ? unit.name_english : null,
        unit.caste,
        sexLabel(unit.sex),
        unit.profession,
        `${Math.floor(unit.age)} years`,
        !living ? 'dead' : archived ? 'left the map' : null,
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
            {unit && onMap && (group === 'citizen' || group === 'resident') ? (
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
          unit ? (
            <>
              {living && !archived ? <WatchButton unit={unit} /> : null}
              {onMap ? <ShowInGameButton unit={unit} /> : null}
              <UnitLinks unit={unit} legends={legends} variant="button" />
            </>
          ) : null
        }
      />
      <StatusBanner state={overview.data?.state} />
      <DwarfDetails
        unitId={numericId}
        legends={legends}
        tab={tab ?? 'overview'}
        onTabChange={(next) =>
          navigate({
            search: next === 'overview' ? {} : { tab: next },
            replace: true,
            resetScroll: false,
          })
        }
      />
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/_app/fortress/dwarves/$id')({
  validateSearch: (raw: Record<string, unknown>): DwarfSearch =>
    isDwarfTab(raw.tab) ? { tab: raw.tab } : {},
  component: DwarfPage,
})
