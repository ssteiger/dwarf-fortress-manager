import type { FortBuilding, FortJob } from '@fortress/db-drizzle'
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import {
  LeafIcon,
  LifeBuoyIcon,
  ListChecksIcon,
  SnowflakeIcon,
  SproutIcon,
  SunIcon,
} from 'lucide-react'
import * as React from 'react'

import {
  fortAdvice,
  jobQueue,
  seasonNotes,
  situations,
  workshopBoard,
} from '~/lib/fortress/advisor'
import { formatNumber, splitPascal } from '~/lib/fortress/format'
import { gameTimeOf, isGrownCitizen } from '~/lib/fortress/insights'
import {
  FORT_REFRESH_MS,
  useFortConcerns,
  useFortOverview,
  useFortSupplies,
  useFortUnits,
} from '~/lib/fortress/queries'
import { getFortWork } from '~/lib/fortress/server'
import {
  AreaStrip,
  Checklist,
  JobQueueList,
  NextSteps,
  SituationList,
  WorkshopList,
} from '../-components/Advice'
import { EmptyState, PageHeader, StatusBanner } from '../-components/FortChrome'
import { GuideProvider } from '../-components/Guide'

const WORKSHOP_TYPES = new Set(['Workshop', 'Furnace', 'TradeDepot'])

interface BuildingGroup {
  label: string
  buildings: FortBuilding[]
}

function jobLabel(job: FortJob): string {
  return job.name || splitPascal(job.type)
}

function jobFlagScore(job: FortJob): number {
  return (job.suspended ? 4 : 0) + (job.repeat ? 2 : 0) + (job.order_id >= 0 ? 1 : 0)
}

function buildingLabel(b: FortBuilding): string {
  if (b.custom) return b.custom
  if (b.type === 'Civzone') return `${splitPascal(b.subtype)} zone`
  if (b.subtype)
    return `${splitPascal(b.subtype)}${b.type === 'Workshop' || b.type === 'Furnace' ? ` ${b.type.toLowerCase()}` : ''}`
  return splitPascal(b.type)
}

function WorkPage() {
  const overview = useFortOverview()
  const { data, isFetching, refetch } = useQuery({
    queryKey: ['fort', 'work'],
    queryFn: () => getFortWork(),
    refetchInterval: FORT_REFRESH_MS * 2,
  })
  const everyone = useFortUnits()
  const concerns = useFortConcerns()
  const supplies = useFortSupplies()
  const buildings = data?.buildings ?? []
  const jobs = data?.jobs ?? []
  const units = everyone.data?.units ?? []
  const state = overview.data?.state ?? null
  const now = gameTimeOf(state)

  const advisorInput = React.useMemo(
    () => ({
      summary: state?.summary ?? null,
      units,
      buildings,
      jobs,
      concerns: concerns.data ?? null,
      supplies: supplies.data ?? null,
      events: overview.data?.events ?? [],
      now,
    }),
    [state, units, buildings, jobs, concerns.data, supplies.data, overview.data?.events, now],
  )
  const advice = React.useMemo(() => fortAdvice(advisorInput), [advisorInput])
  const playbook = React.useMemo(() => situations(advisorInput), [advisorInput])
  const queue = React.useMemo(() => jobQueue(jobs, units), [jobs, units])
  const shops = React.useMemo(() => workshopBoard(buildings, units), [buildings, units])
  const idle = React.useMemo(
    () => units.filter((u) => isGrownCitizen(u) && !u.job && !u.squad && !u.mood),
    [units],
  )
  const season = seasonNotes(now?.tick ?? null)
  const ready = Boolean(state?.summary && data && everyone.data)
  const counts = {
    problem: advice.filter((a) => a.status === 'problem').length,
    attention: advice.filter((a) => a.status === 'attention').length,
    good: advice.filter((a) => a.status === 'good').length,
  }
  const unitNames = React.useMemo(
    () => new Map((data?.units ?? []).map((u) => [u.id, u.name])),
    [data?.units],
  )
  const buildingNames = React.useMemo(
    () => new Map(buildings.map((b) => [b.id, b.name || buildingLabel(b)])),
    [buildings],
  )

  const groups = React.useMemo(() => {
    const workshops: FortBuilding[] = []
    const stockpiles: FortBuilding[] = []
    const zones: FortBuilding[] = []
    const furniture: FortBuilding[] = []
    const unfinished: FortBuilding[] = []
    for (const b of buildings) {
      if (b.max_stage > 0 && b.stage < b.max_stage) unfinished.push(b)
      if (WORKSHOP_TYPES.has(b.type)) workshops.push(b)
      else if (b.type === 'Stockpile') stockpiles.push(b)
      else if (b.type === 'Civzone') zones.push(b)
      else furniture.push(b)
    }
    return { workshops, stockpiles, zones, furniture, unfinished }
  }, [buildings])

  const jobColumns = React.useMemo<ColumnDef<FortJob>[]>(
    () => [
      {
        id: 'job',
        header: 'Job',
        accessorFn: (job) => jobLabel(job),
        meta: { cellClassName: 'font-medium' },
      },
      {
        id: 'worker',
        header: 'Worker',
        accessorFn: (job) =>
          job.worker_id !== null ? (unitNames.get(job.worker_id) ?? null) : null,
        sortUndefined: 'last',
        meta: {
          cellClassName: 'text-sm',
          searchText: (job) =>
            job.worker_id !== null ? (unitNames.get(job.worker_id) ?? 'unassigned') : 'unassigned',
        },
        cell: ({ getValue }) =>
          getValue<string | null>() ?? <span className="text-muted-foreground">unassigned</span>,
      },
      {
        id: 'building',
        header: 'Building',
        accessorFn: (job) =>
          job.building_id !== null ? (buildingNames.get(job.building_id) ?? null) : null,
        sortUndefined: 'last',
        meta: { cellClassName: 'text-sm text-muted-foreground' },
        cell: ({ getValue }) => getValue<string | null>() ?? '—',
      },
      {
        id: 'flags',
        header: 'Flags',
        accessorFn: (job) => jobFlagScore(job),
        meta: {
          searchText: (job) =>
            [
              job.suspended ? 'suspended' : '',
              job.repeat ? 'repeat' : '',
              job.order_id >= 0 ? 'manager order' : '',
            ]
              .filter(Boolean)
              .join(' '),
        },
        cell: ({ row }) => (
          <div className="flex gap-1">
            {row.original.suspended ? <Badge variant="destructive">Suspended</Badge> : null}
            {row.original.repeat ? <Badge variant="outline">Repeat</Badge> : null}
            {row.original.order_id >= 0 ? <Badge variant="secondary">Manager order</Badge> : null}
          </div>
        ),
      },
      {
        id: 'where',
        header: 'Where',
        accessorFn: (job) => `${job.z} ${job.y} ${job.x}`,
        meta: { align: 'right', cellClassName: 'font-mono text-sm text-muted-foreground' },
        cell: ({ row }) => `${row.original.x},${row.original.y} z${row.original.z}`,
      },
    ],
    [buildingNames, unitNames],
  )

  return (
    <GuideProvider>
      <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
        <PageHeader
          eyebrow="Fortress"
          title="Work and advice"
          description="What the fortress needs to thrive, what to do about it in the game, and who is doing what."
          updatedAt={data?.capturedAt}
          isFetching={isFetching}
          onRefresh={() => refetch()}
        />
        <StatusBanner state={overview.data?.state} />

        {ready ? (
          <>
            <AreaStrip advice={advice} />

            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
              <div className="flex min-w-0 flex-col gap-4">
                <Card className="gap-4">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ListChecksIcon className="size-4 text-primary" />
                      Do these next
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {counts.problem
                        ? `${counts.problem} problem${counts.problem === 1 ? '' : 's'}, `
                        : ''}
                      {counts.attention} thing{counts.attention === 1 ? '' : 's'} to see to, and{' '}
                      {counts.good} check{counts.good === 1 ? '' : 's'} already fine. Open one for
                      the steps in the game.
                    </p>
                  </CardHeader>
                  <CardContent>
                    <NextSteps advice={advice} />
                  </CardContent>
                </Card>

                <Card className="gap-4">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <LifeBuoyIcon className="size-4 text-primary" />
                      When things go wrong
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      What to do when trouble comes. What seems to be happening now is on top.
                    </p>
                  </CardHeader>
                  <CardContent>
                    <SituationList situations={playbook} />
                  </CardContent>
                </Card>
              </div>

              <div className="flex min-w-0 flex-col gap-4">
                {season ? (
                  <Card className="gap-3">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <SeasonIcon season={season.season} />
                        {season.season.charAt(0).toUpperCase()}
                        {season.season.slice(1)}
                        {state?.world ? ` of ${state.world.year}` : ''}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ul className="flex flex-col gap-1.5 text-sm">
                        {season.notes.map((note) => (
                          <li key={note} className="flex gap-2">
                            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                            {note}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ) : null}
                <Card className="gap-4">
                  <CardHeader>
                    <CardTitle className="text-base">What a thriving fortress has</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Every check, the good ones too. Click one for the details.
                    </p>
                  </CardHeader>
                  <CardContent>
                    <Checklist advice={advice} />
                  </CardContent>
                </Card>
                <Card className="gap-4">
                  <CardHeader>
                    <CardTitle className="text-base">The work queue</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {formatNumber(jobs.length)} jobs, by kind.
                    </p>
                  </CardHeader>
                  <CardContent>
                    <JobQueueList groups={queue} advice={advice} />
                  </CardContent>
                </Card>
                <Card className="gap-4">
                  <CardHeader>
                    <CardTitle className="text-base">Workshops and who can work them</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      The best hands at each, by skill. Enable the matching labor to put them to
                      work.
                    </p>
                  </CardHeader>
                  <CardContent>
                    <WorkshopList rows={shops} idle={idle} />
                  </CardContent>
                </Card>
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Reading the fortress…</p>
        )}

        <div>
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Every job and building</h2>
          <Tabs defaultValue="jobs">
            <TabsList>
              <TabsTrigger value="jobs">Jobs ({jobs.length})</TabsTrigger>
              <TabsTrigger value="workshops">Workshops ({groups.workshops.length})</TabsTrigger>
              <TabsTrigger value="stockpiles">Stockpiles ({groups.stockpiles.length})</TabsTrigger>
              <TabsTrigger value="zones">Zones ({groups.zones.length})</TabsTrigger>
              <TabsTrigger value="furniture">
                Furniture &amp; other ({groups.furniture.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="jobs">
              <Card className="overflow-hidden p-0">
                {jobs.length === 0 ? (
                  <div className="p-6">
                    <EmptyState title="No jobs">
                      {jobs.length
                        ? 'Nothing matches.'
                        : 'Nothing is queued, or no dump has been taken.'}
                    </EmptyState>
                  </div>
                ) : (
                  <DataTable
                    data={jobs}
                    columns={jobColumns}
                    showSelectColumn={false}
                    showActionsColumn={false}
                    showToolbar={false}
                    enableSortingRemoval={false}
                    defaultSort={[{ id: 'worker', desc: false }]}
                    getRowId={(job) => String(job.id)}
                    rowClassName={(job) => (job.suspended ? 'opacity-60' : undefined)}
                  />
                )}
              </Card>
            </TabsContent>

            {(['workshops', 'stockpiles', 'zones', 'furniture'] as const).map((key) => (
              <TabsContent key={key} value={key}>
                <BuildingTable
                  buildings={groups[key]}
                  showJobs={key === 'workshops'}
                  showItems={key === 'stockpiles'}
                  unitNames={unitNames}
                />
              </TabsContent>
            ))}
          </Tabs>
        </div>
      </div>
    </GuideProvider>
  )
}

function SeasonIcon({ season }: { season: string }) {
  const Icon =
    season === 'spring'
      ? SproutIcon
      : season === 'summer'
        ? SunIcon
        : season === 'autumn'
          ? LeafIcon
          : SnowflakeIcon
  return <Icon className="size-4 text-primary" />
}

function BuildingTable({
  buildings,
  showJobs,
  showItems,
  unitNames,
}: {
  buildings: FortBuilding[]
  showJobs: boolean
  showItems: boolean
  unitNames: Map<number, string>
}) {
  const grouped = React.useMemo<BuildingGroup[]>(() => {
    const m = new Map<string, FortBuilding[]>()
    for (const b of buildings) {
      const label = buildingLabel(b)
      const list = m.get(label) ?? []
      list.push(b)
      m.set(label, list)
    }
    return [...m.entries()].map(([label, list]) => ({ label, buildings: list }))
  }, [buildings])
  const columns = React.useMemo<ColumnDef<BuildingGroup>[]>(
    () => [
      {
        id: 'building',
        header: 'Building',
        accessorKey: 'label',
        meta: { cellClassName: 'font-medium' },
      },
      {
        id: 'count',
        header: 'Count',
        accessorFn: (group) => group.buildings.length,
        meta: { align: 'right', cellClassName: 'tabular-nums' },
      },
      {
        id: 'details',
        header: 'Details',
        accessorFn: (group) =>
          group.buildings
            .map((b) =>
              [b.name, b.room ?? '', `${b.z} ${b.cy} ${b.cx}`, String(b.jobs.length)]
                .filter(Boolean)
                .join(' '),
            )
            .join(' | '),
        meta: { cellClassName: 'text-sm text-muted-foreground' },
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {row.original.buildings.slice(0, 12).map((b) => (
              <span key={b.id} className="inline-flex items-center gap-1">
                <span className="font-mono text-sm">
                  {b.cx},{b.cy} z{b.z}
                </span>
                {b.name ? <span className="text-foreground">“{b.name}”</span> : null}
                {b.room ? <span>{b.room}</span> : null}
                {showJobs && b.jobs.length ? (
                  <Badge variant="secondary">{b.jobs.length} jobs</Badge>
                ) : null}
                {showItems && b.stockpile_items !== null ? (
                  <Badge variant="outline">{b.stockpile_items} items</Badge>
                ) : null}
                {b.assigned_units.length ? (
                  <span>
                    · {b.assigned_units.map((id) => unitNames.get(id) ?? `#${id}`).join(', ')}
                  </span>
                ) : null}
                {b.max_stage > 0 && b.stage < b.max_stage ? (
                  <Badge variant="outline">building</Badge>
                ) : null}
              </span>
            ))}
            {row.original.buildings.length > 12 ? (
              <span>+{row.original.buildings.length - 12} more</span>
            ) : null}
          </div>
        ),
      },
    ],
    [showItems, showJobs, unitNames],
  )

  if (buildings.length === 0) {
    return (
      <Card className="p-6">
        <EmptyState title="Nothing here" />
      </Card>
    )
  }
  return (
    <Card className="overflow-hidden p-0">
      <DataTable
        data={grouped}
        columns={columns}
        showSelectColumn={false}
        showActionsColumn={false}
        showToolbar={false}
        enableSortingRemoval={false}
        defaultSort={[{ id: 'count', desc: true }]}
        getRowId={(group) => group.label}
      />
    </Card>
  )
}

export const Route = createFileRoute('/_authenticated/_app/fortress/work/')({
  component: WorkPage,
})
