import type { FortBuilding, FortJob } from '@fortress/db-drizzle'
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import * as React from 'react'

import { formatNumber, humanize, splitPascal } from '~/lib/fortress/format'
import { FORT_REFRESH_MS, useFortOverview } from '~/lib/fortress/queries'
import { getFortWork } from '~/lib/fortress/server'
import { EmptyState, PageHeader, StatCard, StatusBanner } from '../-components/fort-chrome'

const WORKSHOP_TYPES = new Set(['Workshop', 'Furnace', 'TradeDepot'])

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
  const [search, setSearch] = React.useState('')
  const q = search.trim().toLowerCase()

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
      if (q && !`${b.name} ${buildingLabel(b)} ${b.room ?? ''}`.toLowerCase().includes(q)) continue
      if (b.max_stage > 0 && b.stage < b.max_stage) unfinished.push(b)
      if (WORKSHOP_TYPES.has(b.type)) workshops.push(b)
      else if (b.type === 'Stockpile') stockpiles.push(b)
      else if (b.type === 'Civzone') zones.push(b)
      else furniture.push(b)
    }
    return { workshops, stockpiles, zones, furniture, unfinished }
  }, [buildings, q])

  const jobRows = React.useMemo(() => {
    return jobs
      .filter((j) => !q || `${j.name} ${j.type}`.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          Number(b.worker_id !== null) - Number(a.worker_id !== null) ||
          a.name.localeCompare(b.name),
      )
  }, [jobs, q])

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
        actions={
          <Input
            placeholder="Filter jobs and buildings…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-56"
          />
        }
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
          <TabsTrigger value="jobs">Jobs ({jobRows.length})</TabsTrigger>
          <TabsTrigger value="workshops">Workshops ({groups.workshops.length})</TabsTrigger>
          <TabsTrigger value="stockpiles">Stockpiles ({groups.stockpiles.length})</TabsTrigger>
          <TabsTrigger value="zones">Zones ({groups.zones.length})</TabsTrigger>
          <TabsTrigger value="furniture">
            Furniture &amp; other ({groups.furniture.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="jobs">
          <Card className="overflow-hidden p-0">
            {jobRows.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No jobs">
                  {jobs.length
                    ? 'Nothing matches.'
                    : 'Nothing is queued, or no dump has been taken.'}
                </EmptyState>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Worker</TableHead>
                    <TableHead>Building</TableHead>
                    <TableHead>Flags</TableHead>
                    <TableHead className="text-right">Where</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobRows.map((job) => (
                    <JobRow
                      key={job.id}
                      job={job}
                      worker={job.worker_id !== null ? unitNames.get(job.worker_id) : undefined}
                      building={
                        job.building_id !== null ? buildingNames.get(job.building_id) : undefined
                      }
                    />
                  ))}
                </TableBody>
              </Table>
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

function JobRow({ job, worker, building }: { job: FortJob; worker?: string; building?: string }) {
  return (
    <TableRow className={cn(job.suspended && 'opacity-60')}>
      <TableCell className="font-medium">{job.name || splitPascal(job.type)}</TableCell>
      <TableCell className="text-sm">
        {worker ?? <span className="text-muted-foreground">unassigned</span>}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{building ?? '—'}</TableCell>
      <TableCell>
        <div className="flex gap-1">
          {job.suspended ? <Badge variant="destructive">Suspended</Badge> : null}
          {job.repeat ? <Badge variant="outline">Repeat</Badge> : null}
          {job.order_id >= 0 ? <Badge variant="secondary">Manager order</Badge> : null}
        </div>
      </TableCell>
      <TableCell className="text-right font-mono text-xs text-muted-foreground">
        {job.x},{job.y} z{job.z}
      </TableCell>
    </TableRow>
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
  const grouped = React.useMemo(() => {
    const m = new Map<string, FortBuilding[]>()
    for (const b of buildings) {
      const label = buildingLabel(b)
      const list = m.get(label) ?? []
      list.push(b)
      m.set(label, list)
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [buildings])

  if (buildings.length === 0) {
    return (
      <Card className="p-6">
        <EmptyState title="Nothing here" />
      </Card>
    )
  }
  return (
    <Card className="overflow-hidden p-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Building</TableHead>
            <TableHead className="text-right">Count</TableHead>
            <TableHead>Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {grouped.map(([label, list]) => (
            <TableRow key={label}>
              <TableCell className="font-medium">{label}</TableCell>
              <TableCell className="text-right tabular-nums">{list.length}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {list.slice(0, 12).map((b) => (
                    <span key={b.id} className="inline-flex items-center gap-1">
                      <span className="font-mono text-xs">
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
                  {list.length > 12 ? <span>+{list.length - 12} more</span> : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}

export const Route = createFileRoute('/_authenticated/_app/fortress/work/')({
  component: WorkPage,
})
