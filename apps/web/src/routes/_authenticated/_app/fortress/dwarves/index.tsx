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
import { BookOpenIcon, Maximize2Icon, XIcon } from 'lucide-react'
import * as React from 'react'

import { CreatureSprite } from '~/lib/df-assets/components'
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
import { getKnownFigures, getLegendsOverview } from '~/lib/legends/server'
import {
  EmptyState,
  MoodBadge,
  PageHeader,
  StatusBanner,
  UnitConditionBadges,
} from '../-components/FortChrome'
import { DwarfDetails } from './-components/DwarfDetails'

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

  // Legends cross-link: only when the imported world is the one being played.
  const legends = useQuery({
    queryKey: ['legends', 'overview'],
    queryFn: () => getLegendsOverview(),
    staleTime: 60_000,
  })
  const liveWorld = overview.data?.state?.world_name ?? null
  const matchingWorld =
    legends.data?.worlds.find((w) => w.name && liveWorld && w.name === liveWorld) ?? null
  const hfIds = React.useMemo(
    () => rows.map((u) => u.hist_figure_id).filter((id) => id >= 0),
    [rows],
  )
  const matchingWorldId = matchingWorld?.id ?? null
  const known = useQuery({
    queryKey: ['legends', 'known-figures', matchingWorldId, hfIds.join(',')],
    queryFn: () => getKnownFigures({ data: { worldId: matchingWorldId ?? -1, ids: hfIds } }),
    enabled: matchingWorldId !== null && hfIds.length > 0,
    staleTime: 5 * 60_000,
  })
  const knownSet = React.useMemo(() => new Set(known.data ?? []), [known.data])

  const columns = React.useMemo<ColumnDef<FortUnit>[]>(
    () => [
      {
        id: 'name',
        header: 'Name',
        accessorFn: (unit) => unitDisplayName(unit),
        meta: { cellClassName: 'max-w-[280px]' },
        cell: ({ row }) => {
          const unit = row.original
          const legendsWorldId =
            matchingWorld && knownSet.has(unit.hist_figure_id) ? matchingWorld.id : null
          return (
            <div className="flex items-center gap-3">
              <CreatureSprite unit={unit} size={32} className="-my-1" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium">
                  <span className="truncate">{unitDisplayName(unit)}</span>
                  {legendsWorldId ? (
                    <Link
                      to="/legends/$kind/$id"
                      params={{ kind: 'historical_figure', id: String(unit.hist_figure_id) }}
                      search={{ world: legendsWorldId }}
                      className="text-muted-foreground hover:text-foreground"
                      title="Open in legends"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <BookOpenIcon className="size-3.5" />
                    </Link>
                  ) : null}
                </div>
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
    [knownSet, matchingWorld],
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
                    <CreatureSprite unit={selected} size={48} className="shrink-0" />
                    <div className="min-w-0">
                      <DrawerTitle className="flex flex-wrap items-center gap-2">
                        {unitDisplayName(selected)}
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
                <DwarfDetails unitId={selected.id} compact />
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
