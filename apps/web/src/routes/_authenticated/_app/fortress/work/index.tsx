import type { FortBuilding, FortJob, FortOrder } from '@fortress/db-drizzle'
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
  cn,
} from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import {
  CircleCheckIcon,
  CirclePauseIcon,
  ClipboardListIcon,
  HammerIcon,
  LeafIcon,
  LifeBuoyIcon,
  ListChecksIcon,
  ListTodoIcon,
  SnowflakeIcon,
  SproutIcon,
  SunIcon,
  WarehouseIcon,
} from 'lucide-react'
import * as React from 'react'

import {
  fortAdvice,
  jobQueue,
  seasonNotes,
  situations,
  workshopBoard,
} from '~/lib/fortress/advisor'
import { formatNumber, jobNeedsText, splitPascal } from '~/lib/fortress/format'
import { gameTimeOf, isGrownCitizen } from '~/lib/fortress/insights'
import {
  useFortConcerns,
  useFortOverview,
  useFortSupplies,
  useFortUnits,
} from '~/lib/fortress/queries'
import { getFortWork } from '~/lib/fortress/server'
import {
  FineChecks,
  JobQueueList,
  NextSteps,
  SituationList,
  WorkshopList,
} from '../-components/Advice'
import { EmptyState, PageHeader, SectionBoundary, StatusBanner } from '../-components/FortChrome'
import { GuideProvider } from '../-components/Guide'
import {
  FailingJobs,
  IdleHands,
  StuckFixes,
  SuspendedJobs,
  UnworkableWork,
} from './-components/Stuck'

const WORKSHOP_TYPES = new Set(['Workshop', 'Furnace', 'TradeDepot'])

const TABS = [
  { key: 'checklist', label: 'Checklist', icon: ListChecksIcon },
  { key: 'stuck', label: 'Stuck', icon: CirclePauseIcon },
  { key: 'queue', label: 'Queue', icon: ListTodoIcon },
  { key: 'orders', label: 'Orders', icon: ClipboardListIcon },
  { key: 'workshops', label: 'Workshops', icon: HammerIcon },
  { key: 'buildings', label: 'Buildings', icon: WarehouseIcon },
] as const

type WorkTab = (typeof TABS)[number]['key']

function isWorkTab(value: unknown): value is WorkTab {
  return TABS.some((tab) => tab.key === value)
}

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

const JOB_STATE_LABEL: Record<string, string> = {
  working: 'Working',
  bringing: 'Bringing',
  fetching: 'Fetching',
  item_lost: 'Item lost',
}

const FREQUENCY_LABEL: Record<string, string> = {
  OneTime: 'Once',
  Daily: 'Daily',
  Monthly: 'Monthly',
  Seasonally: 'Each season',
  Yearly: 'Yearly',
}

function orderStatus(order: FortOrder): { label: string; rank: number } {
  if (!order.validated) return { label: 'Not checked', rank: 2 }
  if (order.active) return { label: 'Active', rank: 0 }
  return { label: 'Waiting', rank: 1 }
}

function capitalizeFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function buildingLabel(b: FortBuilding): string {
  if (b.custom) return b.custom
  if (b.type === 'Civzone') return `${splitPascal(b.subtype)} zone`
  if (b.subtype)
    return `${splitPascal(b.subtype)}${b.type === 'Workshop' || b.type === 'Furnace' ? ` ${b.type.toLowerCase()}` : ''}`
  return splitPascal(b.type)
}

function WorkPage() {
  const { tab = 'checklist' } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const overview = useFortOverview()
  const { data, isFetching, refetch } = useQuery({
    queryKey: ['fort', 'work'],
    queryFn: () => getFortWork(),
  })
  const everyone = useFortUnits()
  const concerns = useFortConcerns()
  const supplies = useFortSupplies()
  const buildings = data?.buildings ?? []
  const jobs = data?.jobs ?? []
  const orders = data?.orders ?? []
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
  const adviceByKey = (key: string) => advice.find((a) => a.key === key)
  const alerts = state?.summary?.alerts ?? []
  const working = jobs.filter((job) => job.worker_id !== null).length
  const suspended = jobs.filter((job) => job.suspended).length
  const failing = alerts.filter((alert) => alert.kind === 'cancellation').length
  const blocked = shops.filter(
    (row) =>
      (row.info.essential && row.count === 0) ||
      (row.count > 0 && row.info.skills.length > 0 && row.skilled.length === 0),
  ).length

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
    for (const b of buildings) {
      if (WORKSHOP_TYPES.has(b.type)) workshops.push(b)
      else if (b.type === 'Stockpile') stockpiles.push(b)
      else if (b.type === 'Civzone') zones.push(b)
      else furniture.push(b)
    }
    return { workshops, stockpiles, zones, furniture }
  }, [buildings])

  const tabCounts: Record<WorkTab, number> = {
    checklist: counts.problem + counts.attention,
    stuck: suspended + failing + blocked,
    queue: jobs.length,
    orders: orders.length,
    workshops: groups.workshops.length,
    buildings: groups.stockpiles.length + groups.zones.length + groups.furniture.length,
  }

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
        meta: { cellClassName: 'text-muted-foreground' },
        cell: ({ getValue }) => getValue<string | null>() ?? '—',
      },
      {
        id: 'needs',
        header: 'Needs',
        accessorFn: (job) => jobNeedsText(job) || null,
        sortUndefined: 'last',
        meta: { cellClassName: 'max-w-[320px] text-sm text-muted-foreground' },
        cell: ({ row }) => {
          const needs = row.original.needs ?? []
          if (!needs.length) return '—'
          return (
            <span className="flex flex-wrap gap-x-2 gap-y-0.5">
              {needs.map(([label, need, have], i) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: a job can ask for the same thing twice
                  key={i}
                  className={cn('tabular-nums', have >= need && 'text-foreground')}
                >
                  {have}/{need} {label}
                </span>
              ))}
            </span>
          )
        },
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
              job.state ? (JOB_STATE_LABEL[job.state] ?? job.state) : '',
            ]
              .filter(Boolean)
              .join(' '),
        },
        cell: ({ row }) => (
          <div className="flex gap-1">
            {row.original.state ? (
              <Badge variant={row.original.state === 'item_lost' ? 'destructive' : 'outline'}>
                {JOB_STATE_LABEL[row.original.state] ?? row.original.state}
              </Badge>
            ) : null}
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
        meta: { align: 'right', cellClassName: 'font-mono text-muted-foreground' },
        // Jobs without a place yet, like a strange mood's, sit at -30000.
        cell: ({ row }) =>
          row.original.x <= -30000 ? '—' : `${row.original.x},${row.original.y} z${row.original.z}`,
      },
    ],
    [buildingNames, unitNames],
  )

  const orderCounts = {
    active: orders.filter((o) => orderStatus(o).label === 'Active').length,
    waiting: orders.filter((o) => orderStatus(o).label === 'Waiting').length,
    unchecked: orders.filter((o) => !o.validated).length,
  }
  const orderColumns = React.useMemo<ColumnDef<FortOrder>[]>(
    () => [
      {
        id: 'order',
        header: 'Order',
        accessorFn: (order) => `${order.label} ${order.detail ?? ''}`,
        meta: { cellClassName: 'max-w-[280px]' },
        cell: ({ row }) => (
          <span className="flex flex-col">
            <span className="font-medium">{capitalizeFirst(row.original.label)}</span>
            {row.original.detail ? (
              <span className="text-sm text-muted-foreground">{row.original.detail}</span>
            ) : null}
          </span>
        ),
      },
      {
        id: 'done',
        header: 'Done',
        accessorFn: (order) =>
          order.amount_total ? (order.amount_total - order.amount_left) / order.amount_total : 0,
        meta: { align: 'right', cellClassName: 'tabular-nums' },
        cell: ({ row }) =>
          `${(row.original.amount_total - row.original.amount_left).toLocaleString()} of ${row.original.amount_total.toLocaleString()}`,
      },
      {
        id: 'repeats',
        header: 'Repeats',
        accessorFn: (order) => FREQUENCY_LABEL[order.frequency] ?? order.frequency,
        meta: { cellClassName: 'text-sm' },
      },
      {
        id: 'status',
        header: 'Status',
        accessorFn: (order) => orderStatus(order).rank,
        meta: { searchText: (order) => orderStatus(order).label },
        cell: ({ row }) => {
          const status = orderStatus(row.original)
          return (
            <Badge
              variant={status.rank === 0 ? 'secondary' : 'outline'}
              className={cn(
                status.rank === 2 && 'border-amber-500/50 text-amber-700 dark:text-amber-300',
              )}
            >
              {status.label}
            </Badge>
          )
        },
      },
      {
        id: 'conditions',
        header: 'Runs when',
        accessorFn: (order) => order.conditions.join('; ') || null,
        sortUndefined: 'last',
        meta: { cellClassName: 'max-w-[360px] text-sm text-muted-foreground' },
        cell: ({ row }) =>
          row.original.conditions.length ? (
            <span className="flex flex-col">
              {row.original.conditions.map((condition) => (
                <span key={condition}>{condition}</span>
              ))}
            </span>
          ) : (
            'always'
          ),
      },
      {
        id: 'workshop',
        header: 'Workshop',
        accessorFn: (order) =>
          order.workshop_id !== null ? (buildingNames.get(order.workshop_id) ?? null) : null,
        sortUndefined: 'last',
        meta: { cellClassName: 'text-sm text-muted-foreground' },
        cell: ({ getValue }) => getValue<string | null>() ?? 'any',
      },
    ],
    [buildingNames],
  )

  return (
    <GuideProvider>
      <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
        <PageHeader
          title="Work and advice"
          description={
            ready
              ? `${formatNumber(jobs.length)} jobs queued · ${formatNumber(working)} being worked · ${formatNumber(suspended)} suspended · ${idle.length} with nothing to do · ${counts.problem + counts.attention} things to see to`
              : 'What the fortress needs to thrive, what is stuck, and who is doing what.'
          }
          updatedAt={data?.capturedAt}
          isFetching={isFetching}
          onRefresh={() => refetch()}
        />
        <StatusBanner state={overview.data?.state} />

        {ready ? (
          <Tabs
            value={tab}
            onValueChange={(next) => {
              if (!isWorkTab(next)) return
              navigate({
                search: next === 'checklist' ? {} : { tab: next },
                replace: true,
                resetScroll: false,
              })
            }}
            className="gap-4"
          >
            <TabsList className="h-auto flex-wrap">
              {TABS.map(({ key, label, icon: Icon }) => (
                <TabsTrigger key={key} value={key} className="gap-1.5">
                  <Icon className="size-3.5" />
                  {label}
                  {tabCounts[key] ? (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatNumber(tabCounts[key])}
                    </span>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="checklist">
              <SectionBoundary name="The checklist">
                <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
                  <div className="flex min-w-0 flex-col gap-4">
                    <Card className="gap-4">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <ListChecksIcon className="size-4 text-primary" />
                          To see to
                        </CardTitle>
                        <p className="text-sm text-muted-foreground">
                          {counts.problem
                            ? `${counts.problem} problem${counts.problem === 1 ? '' : 's'} and `
                            : ''}
                          {counts.attention} thing{counts.attention === 1 ? '' : 's'} to see to, the
                          worst first. Open one for the steps in the game.
                        </p>
                      </CardHeader>
                      <CardContent>
                        <NextSteps advice={advice} max={advice.length} />
                      </CardContent>
                    </Card>
                    <Card className="gap-4">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <CircleCheckIcon className="size-4 text-primary" />
                          Already fine
                          <span className="text-sm font-normal text-muted-foreground tabular-nums">
                            {counts.good}
                          </span>
                        </CardTitle>
                        <p className="text-sm text-muted-foreground">
                          What a thriving fortress has that yours has too.
                        </p>
                      </CardHeader>
                      <CardContent>
                        <FineChecks advice={advice} />
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
                                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
                                {note}
                              </li>
                            ))}
                          </ul>
                        </CardContent>
                      </Card>
                    ) : null}
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
                </div>
              </SectionBoundary>
            </TabsContent>

            <TabsContent value="stuck" className="flex flex-col gap-4">
              <SectionBoundary name="The stuck work">
                <StuckFixes suspended={suspended} failing={failing} />
                <div className="grid items-start gap-4 xl:grid-cols-2">
                  <SuspendedJobs
                    jobs={jobs}
                    buildingNames={buildingNames}
                    advice={adviceByKey('suspended')}
                  />
                  <FailingJobs alerts={alerts} advice={adviceByKey('failing')} />
                </div>
                <UnworkableWork rows={shops} idle={idle} />
              </SectionBoundary>
            </TabsContent>

            <TabsContent value="queue" className="flex flex-col gap-4">
              <SectionBoundary name="The work queue">
                <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
                  <Card className="gap-4">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <ListTodoIcon className="size-4 text-primary" />
                        The work queue
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {formatNumber(jobs.length)} jobs in {queue.length} kinds:{' '}
                        {formatNumber(working)} being worked,{' '}
                        {formatNumber(jobs.length - working - suspended)} waiting and{' '}
                        {formatNumber(suspended)} suspended. Open a kind for what to do about it.
                      </p>
                    </CardHeader>
                    <CardContent>
                      <JobQueueList groups={queue} advice={advice} />
                    </CardContent>
                  </Card>
                  <IdleHands idle={idle} advice={adviceByKey('idle')} />
                </div>
                <Card className="gap-0 overflow-hidden p-0">
                  <CardHeader className="px-4 pt-4">
                    <CardTitle className="text-base">Every job</CardTitle>
                  </CardHeader>
                  {jobs.length === 0 ? (
                    <div className="p-6">
                      <EmptyState title="No jobs">
                        Nothing is queued, or no dump has been taken.
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
              </SectionBoundary>
            </TabsContent>

            <TabsContent value="orders" className="flex flex-col gap-4">
              <SectionBoundary name="The work orders">
                <Card className="gap-0 overflow-hidden p-0">
                  <CardHeader className="gap-1.5 px-4 pt-4 pb-4">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <ClipboardListIcon className="size-4 text-primary" />
                      Work orders
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {orders.length
                        ? `${formatNumber(orders.length)} orders at the manager: ${formatNumber(orderCounts.active)} active, ${formatNumber(orderCounts.waiting)} waiting for their conditions${orderCounts.unchecked ? `, and ${formatNumber(orderCounts.unchecked)} the manager has not checked yet` : ''}.`
                        : 'No work orders, or the dump predates them. Restart the worker so it installs the new dump script.'}
                      {orderCounts.unchecked
                        ? ' Orders run only once the manager has checked them: appoint a manager if nobody holds the post.'
                        : ''}
                    </p>
                  </CardHeader>
                  {orders.length ? (
                    <DataTable
                      data={orders}
                      columns={orderColumns}
                      showSelectColumn={false}
                      showActionsColumn={false}
                      showToolbar={false}
                      enableSortingRemoval={false}
                      defaultSort={[{ id: 'status', desc: false }]}
                      getRowId={(order) => String(order.id)}
                      rowClassName={(order) => (order.validated ? undefined : 'opacity-60')}
                    />
                  ) : null}
                </Card>
              </SectionBoundary>
            </TabsContent>

            <TabsContent value="workshops" className="flex flex-col gap-4">
              <SectionBoundary name="The workshops">
                <Card className="gap-4">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <HammerIcon className="size-4 text-primary" />
                      Workshops and who can work them
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Missing essentials first, then the ones nobody can work, then the busy ones.
                      The best hands at each, by skill.
                    </p>
                  </CardHeader>
                  <CardContent>
                    <WorkshopList rows={shops} idle={idle} max={shops.length} />
                  </CardContent>
                </Card>
                <BuildingTable
                  title="Every workshop"
                  buildings={groups.workshops}
                  showJobs
                  showItems={false}
                  unitNames={unitNames}
                />
              </SectionBoundary>
            </TabsContent>

            <TabsContent value="buildings">
              <SectionBoundary name="The buildings">
                <Tabs defaultValue="stockpiles" className="gap-3">
                  <TabsList>
                    <TabsTrigger value="stockpiles" className="gap-1.5">
                      Stockpiles
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {groups.stockpiles.length}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger value="zones" className="gap-1.5">
                      Zones
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {groups.zones.length}
                      </span>
                    </TabsTrigger>
                    <TabsTrigger value="furniture" className="gap-1.5">
                      Furniture and other
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {groups.furniture.length}
                      </span>
                    </TabsTrigger>
                  </TabsList>
                  {(['stockpiles', 'zones', 'furniture'] as const).map((key) => (
                    <TabsContent key={key} value={key}>
                      <BuildingTable
                        buildings={groups[key]}
                        showJobs={false}
                        showItems={key === 'stockpiles'}
                        unitNames={unitNames}
                        labelOf={key === 'stockpiles' ? stockpileLabel : undefined}
                      />
                    </TabsContent>
                  ))}
                </Tabs>
              </SectionBoundary>
            </TabsContent>
          </Tabs>
        ) : (
          <p className="text-sm text-muted-foreground">Reading the fortress…</p>
        )}
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

/** Stockpiles all share one type, so their own names are what tells them apart. */
function stockpileLabel(b: FortBuilding): string {
  return b.name || b.custom || 'Unnamed stockpile'
}

function BuildingTable({
  title,
  buildings,
  showJobs,
  showItems,
  unitNames,
  labelOf = buildingLabel,
}: {
  title?: string
  buildings: FortBuilding[]
  showJobs: boolean
  showItems: boolean
  unitNames: Map<number, string>
  labelOf?: (building: FortBuilding) => string
}) {
  const grouped = React.useMemo<BuildingGroup[]>(() => {
    const m = new Map<string, FortBuilding[]>()
    for (const b of buildings) {
      const label = labelOf(b)
      const list = m.get(label) ?? []
      list.push(b)
      m.set(label, list)
    }
    return [...m.entries()].map(([label, list]) => ({ label, buildings: list }))
  }, [buildings, labelOf])
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
        meta: { cellClassName: 'text-muted-foreground' },
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {row.original.buildings.slice(0, 12).map((b) => (
              <span key={b.id} className="inline-flex items-center gap-1">
                <span className="font-mono">
                  {b.cx},{b.cy} z{b.z}
                </span>
                {b.name && b.name !== row.original.label ? (
                  <span className="text-foreground">“{b.name}”</span>
                ) : null}
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
    <Card className="gap-0 overflow-hidden p-0">
      {title ? (
        <CardHeader className="px-4 pt-4">
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
      ) : null}
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

interface WorkSearch {
  tab?: Exclude<WorkTab, 'checklist'>
}

export const Route = createFileRoute('/_authenticated/_app/fortress/work/')({
  validateSearch: (raw: Record<string, unknown>): WorkSearch =>
    isWorkTab(raw.tab) && raw.tab !== 'checklist' ? { tab: raw.tab } : {},
  component: WorkPage,
})
