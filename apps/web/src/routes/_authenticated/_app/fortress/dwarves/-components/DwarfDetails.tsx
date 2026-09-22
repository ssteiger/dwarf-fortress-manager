import type { FortBuilding } from '@fortress/db-drizzle'
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  Skeleton,
  cn,
} from '@fortress/ui'
import { Link } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { MapIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import {
  formatValue,
  humanize,
  hungerState,
  isLiving,
  sexLabel,
  skillRank,
  sleepState,
  splitPascal,
  thirstState,
} from '~/lib/fortress/format'
import { useFortUnit } from '~/lib/fortress/queries'
import type { CarriedItem } from '~/lib/fortress/server'
import { EmptyState, StatCard, UnitConditionBadges } from '../../-components/FortChrome'

const HUNGER_DANGER = 75_000
const THIRST_DANGER = 50_000
const SLEEP_DANGER = 150_000

function buildingLabel(building: FortBuilding): string {
  if (building.custom) return building.custom
  if (building.name) return building.name
  if (building.type === 'Civzone') return `${splitPascal(building.subtype)} zone`
  if (building.subtype) {
    return `${splitPascal(building.subtype)}${building.type === 'Workshop' || building.type === 'Furnace' ? ` ${building.type.toLowerCase()}` : ''}`
  }
  return splitPascal(building.type)
}

const INVENTORY_COLUMNS: ColumnDef<CarriedItem>[] = [
  {
    id: 'item',
    header: 'Item',
    accessorFn: (row) => row.item?.description ?? `#${row.itemId}`,
    meta: { cellClassName: 'max-w-[320px] truncate font-medium' },
  },
  {
    id: 'mode',
    header: 'How held',
    accessorFn: (row) => splitPascal(row.mode) || row.mode,
    meta: { cellClassName: 'text-sm' },
  },
  {
    id: 'material',
    header: 'Material',
    accessorFn: (row) => row.item?.material ?? '',
    meta: { cellClassName: 'max-w-[200px] truncate text-sm' },
    cell: ({ row }) => row.original.item?.material || '—',
  },
  {
    id: 'quality',
    header: 'Quality',
    accessorFn: (row) => row.item?.quality ?? '',
    meta: { cellClassName: 'text-sm' },
    cell: ({ row }) => {
      const item = row.original.item
      if (!item) return '—'
      return (
        <>
          {item.quality !== 'Ordinary' ? (
            item.quality
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
          {item.wear > 0 ? (
            <span className="ml-1 text-xs text-amber-600">worn {item.wear}</span>
          ) : null}
        </>
      )
    },
  },
  {
    id: 'value',
    header: 'Value',
    accessorFn: (row) => row.item?.value ?? 0,
    meta: { align: 'right', cellClassName: 'tabular-nums' },
    cell: ({ row }) => (row.original.item ? formatValue(row.original.item.value) : '—'),
  },
]

export function DwarfDetails({ unitId, compact }: { unitId: number; compact?: boolean }) {
  const { data, isLoading } = useFortUnit(unitId)
  const unit = data?.unit ?? null

  if (isLoading) {
    return (
      <div className={cn('grid gap-4', compact ? 'grid-cols-1' : 'lg:grid-cols-3')}>
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    )
  }

  if (!unit) {
    return (
      <EmptyState title="Not in the last dump">
        There is no unit with id {unitId} in the fortress dump. They may have left the map, or no
        dump has been taken yet.
      </EmptyState>
    )
  }

  const living = isLiving(unit)
  const bloodPct =
    unit.blood !== null && unit.blood_max ? Math.round((unit.blood / unit.blood_max) * 100) : null
  const carriedValue = (data?.inventory ?? []).reduce((sum, row) => sum + (row.item?.value ?? 0), 0)

  return (
    <div className="flex flex-col gap-4">
      <div className={cn('grid gap-4', compact ? 'grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-4')}>
        <StatCard
          title="Doing"
          value={living ? (unit.job ? 'Working' : 'Idle') : 'Dead'}
          hint={
            living && unit.job
              ? data?.job
                ? `${unit.job} · ${data.job.x},${data.job.y} z${data.job.z}`
                : unit.job
              : (unit.squad ?? undefined)
          }
        />
        <StatCard
          title="Condition"
          value={unit.wounds > 0 ? `${unit.wounds} wound${unit.wounds === 1 ? '' : 's'}` : 'Unhurt'}
          hint={bloodPct !== null ? `blood ${bloodPct}%` : undefined}
        >
          <div className="mt-3">
            <UnitConditionBadges unit={unit} />
          </div>
        </StatCard>
        <StatCard
          title="Stress"
          value={unit.stress.toLocaleString()}
          hint={unit.positions.length ? unit.positions.join(', ') : undefined}
        />
        <StatCard
          title="Where"
          value={
            unit.x !== null ? (
              <span className={cn('font-mono', compact ? 'text-lg' : 'text-xl')}>
                {unit.x},{unit.y} z{unit.z}
              </span>
            ) : (
              '—'
            )
          }
          hint={
            unit.x !== null ? (
              <Link
                to="/fortress/map"
                className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
              >
                <MapIcon className="size-3.5" />
                Open map
              </Link>
            ) : undefined
          }
        />
      </div>

      <div className={cn('grid gap-4', compact ? 'grid-cols-1' : 'lg:grid-cols-3')}>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Who they are</CardTitle>
          </CardHeader>
          <CardContent>
            <Facts
              items={[
                { label: 'Name', value: unit.readable },
                {
                  label: 'Race',
                  value: `${unit.race}${unit.caste ? ` · ${unit.caste}` : ''}`,
                },
                { label: 'Sex', value: sexLabel(unit.sex) },
                { label: 'Age', value: `${Math.floor(unit.age)} years` },
                { label: 'Profession', value: unit.profession },
                { label: 'Squad', value: unit.squad },
                {
                  label: 'Office',
                  value: unit.positions.length ? unit.positions.join(', ') : null,
                },
              ]}
            />
            <div className="mt-4 flex flex-wrap gap-1.5">
              {unit.flags.map((flag) => (
                <Badge key={flag} variant="outline">
                  {humanize(flag)}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Needs</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <NeedMeter
              label="Hunger"
              timer={unit.hunger}
              dangerAt={HUNGER_DANGER}
              invert
              state={hungerState(unit.hunger)}
            />
            <NeedMeter
              label="Thirst"
              timer={unit.thirst}
              dangerAt={THIRST_DANGER}
              invert
              state={thirstState(unit.thirst)}
            />
            <NeedMeter
              label="Sleep"
              timer={unit.sleepiness}
              dangerAt={SLEEP_DANGER}
              invert
              state={sleepState(unit.sleepiness)}
            />
            {bloodPct !== null ? (
              <NeedMeter
                label="Blood"
                filled={bloodPct}
                state={
                  bloodPct < 50
                    ? { label: `${bloodPct}%`, severity: 'danger' }
                    : bloodPct < 80
                      ? { label: `${bloodPct}%`, severity: 'warning' }
                      : { label: `${bloodPct}%`, severity: 'ok' }
                }
              />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              Skills
              {unit.skills.length ? (
                <Badge variant="secondary" className="tabular-nums">
                  {unit.skills.length}
                </Badge>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {unit.skills.length ? (
              <ul className="flex flex-col gap-1.5 text-sm">
                {unit.skills.map(([skill, rating]) => (
                  <li key={skill} className="flex items-baseline justify-between gap-3">
                    <span>{humanize(skill)}</span>
                    <span className="text-muted-foreground tabular-nums">{skillRank(rating)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No skills recorded.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {data?.buildings.length ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Assigned work</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {data.buildings.map((building) => (
              <Badge key={building.id} variant="secondary" className="gap-1.5 font-normal">
                {buildingLabel(building)}
                <span className="font-mono text-xs opacity-70">
                  {building.cx},{building.cy} z{building.z}
                </span>
              </Badge>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="border-b px-5 py-4">
          <div className="text-base font-semibold">Carried</div>
          <p className="mt-1 text-sm text-muted-foreground">
            {data?.inventory.length
              ? `${data.inventory.length} item${data.inventory.length === 1 ? '' : 's'} · ${formatValue(carriedValue)}`
              : 'Nothing in their hands or on their person.'}
          </p>
        </div>
        {data?.inventory.length ? (
          <DataTable
            data={data.inventory}
            columns={INVENTORY_COLUMNS}
            showSelectColumn={false}
            showActionsColumn={false}
            showToolbar={false}
            enableSortingRemoval={false}
            defaultSort={[{ id: 'value', desc: true }]}
            getRowId={(row) => String(row.itemId)}
            pageSize={compact ? 25 : 50}
          />
        ) : null}
      </Card>
    </div>
  )
}

function Facts({ items }: { items: { label: string; value: ReactNode }[] }) {
  const shown = items.filter(
    (item) => item.value !== null && item.value !== undefined && item.value !== '',
  )
  if (!shown.length) return null
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
      {shown.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 wrap-break-word">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function NeedMeter({
  label,
  timer,
  dangerAt,
  filled,
  invert,
  state,
}: {
  label: string
  timer?: number
  dangerAt?: number
  filled?: number
  invert?: boolean
  state: { label: string; severity: 'ok' | 'warning' | 'danger' } | null
}) {
  const raw = Math.min(
    100,
    Math.max(
      0,
      filled ?? (dangerAt && dangerAt > 0 ? Math.round(((timer ?? 0) / dangerAt) * 100) : 0),
    ),
  )
  const pct = invert ? 100 - raw : raw
  const severity = state?.severity ?? 'ok'
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>{label}</span>
        <span
          className={cn(
            'tabular-nums',
            severity === 'danger' && 'text-red-600 dark:text-red-400',
            severity === 'warning' && 'text-amber-700 dark:text-amber-300',
            severity === 'ok' && 'text-muted-foreground',
          )}
        >
          {state?.label ?? 'Fine'}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full',
            severity === 'danger' && 'bg-red-500',
            severity === 'warning' && 'bg-amber-400',
            severity === 'ok' && 'bg-emerald-500',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
