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
import * as React from 'react'

import { formatNumber, splitPascal } from '~/lib/fortress/format'
import { FORT_REFRESH_MS, useFortOverview } from '~/lib/fortress/queries'
import { getFortWork } from '~/lib/fortress/server'
import { EmptyState, PageHeader, StatCard, StatusBanner } from '../-components/FortChrome'

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
  const buildings = data?.buildings ?? []
  const jobs = data?.jobs ?? []
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

  const activeJobs = jobs.filter((j) => j.worker_id !== null).length
  const suspended = jobs.filter((j) => j.suspended).length
  const jobsByType = React.useMemo(() => {
    const m = new Map<string, number>()
    for (const j of jobs) m.set(j.name, (m.get(j.name) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  }, [jobs])

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        eyebrow="Fortress"
        title="Work and buildings"
        description="What is being built, what is queued, and who is doing it."
        updatedAt={data?.capturedAt}
        isFetching={isFetching}
        onRefresh={() => refetch()}
      />
      <StatusBanner state={overview.data?.state} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Jobs queued"
          value={formatNumber(jobs.length)}
          hint={`${activeJobs} being worked · ${suspended} suspended`}
        />
        <StatCard
          title="Workshops"
          value={groups.workshops.length}
          hint="including furnaces and the depot"
        />
        <StatCard
          title="Stockpiles"
          value={groups.stockpiles.length}
          hint={`${formatNumber(groups.stockpiles.reduce((a, b) => a + (b.stockpile_items ?? 0), 0))} items stored`}
        />
        <StatCard
          title="Under construction"
          value={groups.unfinished.length}
          hint="buildings not yet finished"
          accentClassName="text-amber-500"
        />
      </div>

      {jobsByType.length ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Most common jobs</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {jobsByType.map(([name, count]) => (
              <Badge key={name} variant="secondary" className="gap-1.5">
                {name} <span className="tabular-nums opacity-70">{count}</span>
              </Badge>
            ))}
          </CardContent>
        </Card>
      ) : null}

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
  )
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
