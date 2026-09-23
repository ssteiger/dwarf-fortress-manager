import type { FortUnit } from '@fortress/db-drizzle'
import {
  Badge,
  Button,
  Card,
  DataTable,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { Maximize2Icon, XIcon } from 'lucide-react'
import * as React from 'react'

import { CreatureSprite, UnitPortrait } from '~/lib/df-assets/components'
import {
  humanize,
  isLiving,
  sexLabel,
  stressLabel,
  unitDisplayName,
  unitGroup,
  unitNeeds,
} from '~/lib/fortress/format'
import { FORT_REFRESH_MS, useFortOverview } from '~/lib/fortress/queries'
import { getFortUnits } from '~/lib/fortress/server'
import {
  EmptyState,
  MoodBadge,
  PageHeader,
  StatusBanner,
  UnitConditionBadges,
} from '../-components/FortChrome'
import { DwarfDetails } from './-components/DwarfDetails'
import {
  UnitLinks,
  legendsRefFor,
  useChronicleMentionCounts,
  useFigureEventCounts,
  useFortLegendsWorldId,
  useKnownHistFigures,
} from './-components/UnitLinks'

type Group = ReturnType<typeof unitGroup> | 'all'

function conditionScore(unit: FortUnit): number {
  const needs = unitNeeds(unit)
  let score = unit.wounds * 100
  for (const need of needs) score += need.severity === 'danger' ? 10 : 1
  if (unit.flags.includes('insane')) score += 50
  if (unit.flags.includes('caged') || unit.flags.includes('chained')) score += 5
  return score
}

const GROUP_LABELS: Record<Group, string> = {
  citizen: 'Citizens',
  resident: 'Residents',
  visitor: 'Visitors',
  animal: 'Animals',
  hostile: 'Hostiles',
  other: 'Others',
  all: 'Everyone',
}

function DwarvesPage() {
  const overview = useFortOverview()
  const { data, isFetching, refetch } = useQuery({
    queryKey: ['fort', 'units'],
    queryFn: () => getFortUnits(),
    refetchInterval: FORT_REFRESH_MS * 2,
  })
  const [group, setGroup] = React.useState<Group>('citizen')
  const [showDead, setShowDead] = React.useState(false)
  const [selected, setSelected] = React.useState<FortUnit | null>(null)

  const units = data?.units ?? []
  const counts = React.useMemo(() => {
    const c: Record<Group, number> = {
      citizen: 0,
      resident: 0,
      visitor: 0,
      animal: 0,
      hostile: 0,
      other: 0,
      all: 0,
    }
    for (const u of units) {
      if (!showDead && !isLiving(u)) continue
      c[unitGroup(u)]++
      c.all++
    }
    return c
  }, [units, showDead])

  const rows = React.useMemo(
    () =>
      units
        .filter((u) => (showDead ? true : isLiving(u)))
        .filter((u) => group === 'all' || unitGroup(u) === group),
    [units, group, showDead],
  )

  const legendsWorldId = useFortLegendsWorldId()
  const figureIds = rows.map((unit) => unit.hist_figure_id)
  const knownFigures = useKnownHistFigures(legendsWorldId, figureIds)
  const legendCounts = useFigureEventCounts(legendsWorldId, figureIds)
  const chronicleCounts = useChronicleMentionCounts(rows.map((unit) => unit.name))

  const columns = React.useMemo<ColumnDef<FortUnit>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        accessorFn: (unit) => unitDisplayName(unit),
        meta: { cellClassName: 'max-w-[280px]' },
        cell: ({ row }) => {
          const unit = row.original
          return (
            <div className="flex items-center gap-3">
              <CreatureSprite unit={unit} size={32} className="-my-1" />
              <div className="min-w-0">
                <div className="truncate font-medium">{unitDisplayName(unit)}</div>
                <div className="truncate text-sm text-muted-foreground">
                  {unit.name_english && unit.name_english !== unit.name
                    ? `${unit.name_english} · `
                    : ''}
                  {unit.race}
                  {unit.squad ? ` · ${unit.squad}` : ''}
                </div>
              </div>
            </div>
          )
        },
      },
      {
        id: 'legends',
        header: 'Legends',
        accessorFn: (unit) => {
          const legends = legendsRefFor(unit, legendsWorldId, knownFigures)
          return legends ? (legendCounts.get(legends.figureId) ?? 0) : null
        },
        sortUndefined: 'last',
        meta: { align: 'right', cellClassName: 'tabular-nums' },
        cell: ({ row }) => {
          const legends = legendsRefFor(row.original, legendsWorldId, knownFigures)
          if (!legends) return '—'
          const count = legendCounts.get(legends.figureId) ?? 0
          return (
            <Link
              to="/legends/$kind/$id"
              params={{ kind: 'historical_figure', id: String(legends.figureId) }}
              search={{ world: legends.worldId }}
              className="hover:underline"
              title="Their legends"
              onClick={(event) => event.stopPropagation()}
            >
              {count.toLocaleString()}
            </Link>
          )
        },
      },
      {
        id: 'chronicle',
        header: 'Chronicle',
        accessorFn: (unit) => {
          const name = unit.name.trim()
          return name ? (chronicleCounts.get(name) ?? 0) : null
        },
        sortUndefined: 'last',
        meta: { align: 'right', cellClassName: 'tabular-nums' },
        cell: ({ row }) => {
          const name = row.original.name.trim()
          if (!name) return '—'
          const count = chronicleCounts.get(name) ?? 0
          return (
            <Link
              to="/fortress/chronicle"
              search={{ q: name, filter: 'all' }}
              className="hover:underline"
              title="Announcements that name them"
              onClick={(event) => event.stopPropagation()}
            >
              {count.toLocaleString()}
            </Link>
          )
        },
      },
      {
        id: 'profession',
        header: 'Profession',
        accessorFn: (unit) => unit.profession,
        cell: ({ row }) => (
          <>
            <div>{row.original.profession}</div>
            {row.original.positions.length ? (
              <div className="text-sm text-muted-foreground">
                {row.original.positions.join(', ')}
              </div>
            ) : null}
          </>
        ),
      },
      {
        id: 'mood',
        header: 'Mood',
        accessorFn: (unit) => unit.stress_category,
        meta: {
          searchText: (unit) =>
            [stressLabel(unit.stress_category), unit.mood ? `${humanize(unit.mood)} mood` : '']
              .filter(Boolean)
              .join(' '),
        },
        sortingFn: (a, b) => {
          const category = a.original.stress_category - b.original.stress_category
          if (category !== 0) return category
          return b.original.stress - a.original.stress
        },
        cell: ({ row }) => {
          const unit = row.original
          const kind = unitGroup(unit)
          return (
            <>
              {kind === 'citizen' || kind === 'resident' ? (
                <MoodBadge category={unit.stress_category} />
              ) : null}
              {unit.mood ? (
                <Badge variant="outline" className="ml-1">
                  {humanize(unit.mood)} mood
                </Badge>
              ) : null}
            </>
          )
        },
      },
      {
        id: 'doing',
        header: 'Doing',
        accessorFn: (unit) => (isLiving(unit) ? (unit.job ?? 'Idle') : 'Dead'),
        meta: { cellClassName: 'max-w-[260px] text-sm' },
        cell: ({ row }) =>
          isLiving(row.original) ? (
            (row.original.job ?? <span className="text-muted-foreground">Idle</span>)
          ) : (
            <span className="text-muted-foreground">Dead</span>
          ),
      },
      {
        id: 'condition',
        header: 'Condition',
        accessorFn: (unit) => conditionScore(unit),
        meta: {
          searchText: (unit) =>
            [
              unit.wounds > 0 ? `${unit.wounds} wound${unit.wounds === 1 ? '' : 's'}` : '',
              ...unitNeeds(unit).map((need) => need.label),
              unit.flags.includes('insane') ? 'insane' : '',
              unit.flags.includes('ghost') ? 'ghost' : '',
            ]
              .filter(Boolean)
              .join(' '),
        },
        cell: ({ row }) => <UnitConditionBadges unit={row.original} />,
      },
      {
        id: 'age',
        header: 'Age',
        accessorFn: (unit) => unit.age,
        meta: { align: 'right' },
        cell: ({ row }) => <span className="tabular-nums">{Math.floor(row.original.age)}</span>,
      },
      {
        id: 'where',
        header: 'Where',
        accessorFn: (unit) => (unit.x === null ? null : `${unit.z} ${unit.y} ${unit.x}`),
        sortUndefined: 'last',
        meta: { align: 'right', cellClassName: 'font-mono text-sm text-muted-foreground' },
        cell: ({ row }) => {
          const unit = row.original
          return unit.x !== null ? `${unit.x},${unit.y} z${unit.z}` : '—'
        },
      },
    ],
    [legendsWorldId, knownFigures, legendCounts, chronicleCounts],
  )

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        eyebrow="Fortress"
        title="Dwarves and creatures"
        description="Every unit on the map, worst mood first. Click a row for skills, hunger, and what they carry."
        updatedAt={data?.capturedAt}
        isFetching={isFetching}
        onRefresh={() => refetch()}
      />
      <StatusBanner state={overview.data?.state} />

      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center lg:justify-between">
          <Tabs value={group} onValueChange={(v) => setGroup(v as Group)}>
            <TabsList className="flex-wrap">
              {(Object.keys(GROUP_LABELS) as Group[]).map((key) => (
                <TabsTrigger key={key} value={key} className="gap-1.5">
                  {GROUP_LABELS[key]}
                  <span className="text-xs text-muted-foreground tabular-nums">{counts[key]}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={showDead}
              onChange={(e) => setShowDead(e.target.checked)}
            />
            include the dead
          </label>
        </div>

        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState title="Nobody here">
              {units.length === 0 ? 'No dump has been taken yet.' : 'No unit matches this filter.'}
            </EmptyState>
          </div>
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            showSelectColumn={false}
            showActionsColumn={false}
            showToolbar={false}
            enableSortingRemoval={false}
            defaultSort={[{ id: 'mood', desc: false }]}
            getRowId={(unit) => String(unit.id)}
            rowClassName={(unit) => (isLiving(unit) ? undefined : 'opacity-50')}
            onRowClick={setSelected}
          />
        )}
      </Card>

      <Drawer
        direction="right"
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null)
        }}
      >
        <DrawerContent className="data-[vaul-drawer-direction=right]:h-full data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:sm:max-w-xl">
          {selected ? (
            <>
              <DrawerHeader className="border-b">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <UnitPortrait
                      unit={selected}
                      size={72}
                      fallbackToSprite
                      className="shrink-0 rounded-md border bg-muted/40"
                      title={`${selected.race} as drawn in the game`}
                    />
                    <div className="min-w-0">
                      <DrawerTitle className="flex flex-wrap items-center gap-2">
                        {unitDisplayName(selected)}
                        <UnitLinks
                          unit={selected}
                          legends={legendsRefFor(selected, legendsWorldId, knownFigures)}
                        />
                        {unitGroup(selected) === 'citizen' || unitGroup(selected) === 'resident' ? (
                          <MoodBadge
                            category={selected.stress_category}
                            className="text-sm font-normal"
                          />
                        ) : null}
                        {selected.mood ? (
                          <Badge variant="outline" className="text-sm font-normal">
                            {humanize(selected.mood)} mood
                          </Badge>
                        ) : null}
                      </DrawerTitle>
                      <DrawerDescription className="mt-1">
                        {[
                          selected.name_english && selected.name_english !== selected.name
                            ? selected.name_english
                            : null,
                          selected.caste,
                          sexLabel(selected.sex),
                          selected.profession,
                          `${Math.floor(selected.age)} years`,
                          isLiving(selected) ? null : 'dead',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </DrawerDescription>
                    </div>
                  </div>
                  <DrawerClose asChild>
                    <Button size="icon" variant="ghost" aria-label="Close">
                      <XIcon className="size-4" />
                    </Button>
                  </DrawerClose>
                </div>
              </DrawerHeader>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <DwarfDetails
                  unitId={selected.id}
                  compact
                  legends={legendsRefFor(selected, legendsWorldId, knownFigures)}
                />
              </div>
              <DrawerFooter className="border-t">
                <Button asChild>
                  <Link to="/fortress/dwarves/$id" params={{ id: String(selected.id) }}>
                    <Maximize2Icon className="size-4" />
                    Show full page
                  </Link>
                </Button>
              </DrawerFooter>
            </>
          ) : null}
        </DrawerContent>
      </Drawer>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/_app/fortress/dwarves/')({
  component: DwarvesPage,
})
