import type { FortUnit } from '@fortress/db-drizzle'
import {
  Badge,
  Card,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  cn,
} from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { BookOpenIcon } from 'lucide-react'
import * as React from 'react'

import { humanize, isLiving, skillRank, unitGroup, unitNeeds } from '~/lib/fortress/format'
import { FORT_REFRESH_MS, useFortOverview } from '~/lib/fortress/queries'
import { getFortUnits } from '~/lib/fortress/server'
import { getKnownFigures, getLegendsOverview } from '~/lib/legends/server'
import { EmptyState, MoodBadge, PageHeader, StatusBanner } from '../-components/fort-chrome'

type Group = ReturnType<typeof unitGroup> | 'all'

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
  const [search, setSearch] = React.useState('')
  const [showDead, setShowDead] = React.useState(false)

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

  const rows = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return units
      .filter((u) => (showDead ? true : isLiving(u)))
      .filter((u) => group === 'all' || unitGroup(u) === group)
      .filter(
        (u) =>
          !q ||
          u.readable.toLowerCase().includes(q) ||
          u.profession.toLowerCase().includes(q) ||
          (u.job ?? '').toLowerCase().includes(q) ||
          u.race.toLowerCase().includes(q),
      )
      .sort(
        (a, b) =>
          a.stress_category - b.stress_category ||
          b.stress - a.stress ||
          a.name.localeCompare(b.name),
      )
  }, [units, group, search, showDead])

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

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
        <PageHeader
          eyebrow="Fortress"
          title="Dwarves and creatures"
          description="Every unit on the map, worst mood first. Hover a name for skills, hunger, and wounds."
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
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {counts[key]}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showDead}
                  onChange={(e) => setShowDead(e.target.checked)}
                />
                include the dead
              </label>
              <Input
                placeholder="Search name, job, profession…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-64"
              />
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="p-6">
              <EmptyState title="Nobody here">
                {units.length === 0
                  ? 'No dump has been taken yet.'
                  : 'No unit matches this filter.'}
              </EmptyState>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Profession</TableHead>
                  <TableHead>Mood</TableHead>
                  <TableHead>Doing</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead className="text-right">Age</TableHead>
                  <TableHead className="text-right">Where</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((unit) => (
                  <UnitRow
                    key={unit.id}
                    unit={unit}
                    legendsWorldId={
                      matchingWorld && knownSet.has(unit.hist_figure_id) ? matchingWorld.id : null
                    }
                  />
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </TooltipProvider>
  )
}

function UnitRow({ unit, legendsWorldId }: { unit: FortUnit; legendsWorldId: number | null }) {
  const needs = unitNeeds(unit)
  const living = isLiving(unit)
  const groupKind = unitGroup(unit)
  return (
    <TableRow className={cn(!living && 'opacity-50')}>
      <TableCell className="max-w-[280px]">
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="cursor-default">
              <div className="flex items-center gap-2 font-medium">
                <span className="truncate">{unit.name || unit.readable}</span>
                {legendsWorldId ? (
                  <Link
                    to="/legends/$kind/$id"
                    params={{ kind: 'historical_figure', id: String(unit.hist_figure_id) }}
                    search={{ world: legendsWorldId }}
                    className="text-muted-foreground hover:text-foreground"
                    title="Open in legends"
                  >
                    <BookOpenIcon className="size-3.5" />
                  </Link>
                ) : null}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {unit.name_english && unit.name_english !== unit.name
                  ? `${unit.name_english} · `
                  : ''}
                {unit.race}
                {unit.squad ? ` · ${unit.squad}` : ''}
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-sm">
            <UnitDetails unit={unit} />
          </TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell>
        <div>{unit.profession}</div>
        {unit.positions.length ? (
          <div className="text-xs text-muted-foreground">{unit.positions.join(', ')}</div>
        ) : null}
      </TableCell>
      <TableCell>
        {groupKind === 'citizen' || groupKind === 'resident' ? (
          <MoodBadge category={unit.stress_category} />
        ) : null}
        {unit.mood ? (
          <Badge variant="outline" className="ml-1">
            {humanize(unit.mood)} mood
          </Badge>
        ) : null}
      </TableCell>
      <TableCell className="max-w-[260px] truncate text-sm">
        {!living ? (
          <span className="text-muted-foreground">Dead</span>
        ) : (
          (unit.job ?? <span className="text-muted-foreground">Idle</span>)
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {unit.wounds > 0 ? (
            <Badge variant="destructive">
              {unit.wounds} wound{unit.wounds === 1 ? '' : 's'}
            </Badge>
          ) : null}
          {needs.map((n) => (
            <Badge
              key={n.label}
              variant={n.severity === 'danger' ? 'destructive' : 'secondary'}
              className={cn(
                n.severity === 'warning' &&
                  'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
              )}
            >
              {n.label}
            </Badge>
          ))}
          {unit.flags.includes('caged') ? <Badge variant="outline">Caged</Badge> : null}
          {unit.flags.includes('chained') ? <Badge variant="outline">Chained</Badge> : null}
          {unit.flags.includes('insane') && living ? (
            <Badge variant="destructive">Insane</Badge>
          ) : null}
          {unit.flags.includes('ghost') ? <Badge variant="outline">Ghost</Badge> : null}
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">{Math.floor(unit.age)}</TableCell>
      <TableCell className="text-right font-mono text-xs text-muted-foreground">
        {unit.x !== null ? `${unit.x},${unit.y} z${unit.z}` : '—'}
      </TableCell>
    </TableRow>
  )
}

function UnitDetails({ unit }: { unit: FortUnit }) {
  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="font-medium">{unit.readable}</div>
      <div className="text-muted-foreground">
        {unit.caste} · {unit.sex === 1 ? 'male' : unit.sex === 0 ? 'female' : 'no sex'} · stress{' '}
        {unit.stress.toLocaleString()}
      </div>
      {unit.skills.length ? (
        <ul className="grid grid-cols-2 gap-x-3">
          {unit.skills.slice(0, 8).map(([skill, rating]) => (
            <li key={skill} className="flex justify-between gap-2">
              <span>{humanize(skill)}</span>
              <span className="text-muted-foreground">{skillRank(rating)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {unit.blood !== null && unit.blood_max ? (
        <div className="text-muted-foreground">
          Blood {Math.round((unit.blood / unit.blood_max) * 100)}% · {unit.inventory.length} items
          carried
        </div>
      ) : null}
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/_app/fortress/dwarves/')({
  component: DwarvesPage,
})
