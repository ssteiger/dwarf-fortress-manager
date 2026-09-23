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
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import type { ColumnDef } from '@tanstack/react-table'
import { MapIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { CreatureSprite, ItemSprite } from '~/lib/df-assets/components'
import {
  formatGameTick,
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
import { type CarriedItem, getFortEvents } from '~/lib/fortress/server'
import { EmptyState, StatCard, UnitConditionBadges } from '../../-components/FortChrome'
import type { UnitLegendsRef } from './UnitLinks'

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
    meta: { cellClassName: 'max-w-[320px] font-medium' },
    cell: ({ row }) => (
      <span className="flex items-center gap-2">
        {row.original.item ? (
          <ItemSprite item={row.original.item} size={24} className="-my-1" />
        ) : null}
        <span className="truncate">
          {row.original.item?.description ?? `#${row.original.itemId}`}
        </span>
      </span>
    ),
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

export function DwarfDetails({
  unitId,
  compact,
  legends = null,
}: {
  unitId: number
  compact?: boolean
  legends?: UnitLegendsRef | null
}) {
  const { data, isLoading } = useFortUnit(unitId)
  const unit = data?.unit ?? null
  const mentionedName = unit?.name.trim() ?? ''
  const mentions = useQuery({
    queryKey: ['fort', 'events', 'unit', mentionedName],
    queryFn: () => getFortEvents({ data: { q: mentionedName, limit: 8 } }),
    enabled: mentionedName.length > 0,
    staleTime: 30_000,
  })

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
            <CardTitle className="flex items-center justify-between gap-3 text-base">
              Who they are
              <CreatureSprite unit={unit} size={64} title={`${unit.race} as drawn in the game`} />
            </CardTitle>
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

      {unit.traits == null && unit.values == null && unit.thoughts == null ? (
        <p className="text-sm text-muted-foreground">
          Personality and thoughts arrive with the next fortress dump.
        </p>
      ) : unit.traits?.length || unit.values?.length || unit.thoughts?.length ? (
        <div className={cn('grid gap-4', compact ? 'grid-cols-1' : 'lg:grid-cols-2')}>
          {unit.traits?.length || unit.values?.length ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Personality</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {unit.traits?.length ? (
                  <ul className="flex flex-col gap-1.5">
                    {unit.traits.map(([facet, value]) => (
                      <FacetRow key={facet} name={facet} value={value} />
                    ))}
                  </ul>
                ) : null}
                {unit.values?.length ? (
                  <div>
                    <div className="mb-1.5 text-sm font-medium text-muted-foreground">Beliefs</div>
                    <ul className="flex flex-col gap-1 text-sm">
                      {unit.values.map(([value, strength]) => (
                        <li key={value} className="flex items-baseline justify-between gap-3">
                          <span>{tokenLabel(value)}</span>
                          <span className="text-muted-foreground">
                            {strength < 0 ? 'rejects it' : 'holds it'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {unit.thoughts?.length ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  Thoughts
                  <Badge variant="secondary" className="tabular-nums">
                    {unit.thoughts.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2">
                  {unit.thoughts.slice(0, compact ? 8 : unit.thoughts.length).map((thought) => (
                    <ThoughtRow
                      key={`${thought[0]}-${thought[1]}-${thought[3]}-${thought[4]}`}
                      thought={thought}
                    />
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

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

      {mentionedName || legends ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-base">
              Records
              <span className="flex items-center gap-3 text-sm font-normal">
                {legends ? (
                  <Link
                    to="/legends/$kind/$id"
                    params={{ kind: 'historical_figure', id: String(legends.figureId) }}
                    search={{ world: legends.worldId }}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    Their legends
                  </Link>
                ) : null}
                {mentionedName ? (
                  <Link
                    to="/fortress/chronicle"
                    search={{ q: mentionedName, filter: 'all' }}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    All events
                  </Link>
                ) : null}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {mentionedName ? (
              mentions.data?.length ? (
                <ul className="flex flex-col gap-2 text-sm">
                  {mentions.data.slice(0, compact ? 4 : 8).map((event) => (
                    <li key={event.id} className="flex gap-3">
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {formatGameTick(event.game_year, event.game_tick) || '—'}
                      </span>
                      <span>{event.text}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {mentions.isLoading
                    ? 'Looking through the chronicle…'
                    : 'The chronicle has not mentioned them yet.'}
                </p>
              )
            ) : (
              <p className="text-sm text-muted-foreground">
                No name for the chronicle to quote. Their legends are linked above.
              </p>
            )}
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

function tokenLabel(token: string): string {
  if (token.includes('_')) return humanize(token)
  return splitPascal(token)
}

function facetLevel(value: number): string {
  if (value <= 24) return 'very low'
  if (value <= 40) return 'low'
  if (value >= 76) return 'very high'
  return 'high'
}

function emotionTone(emotion: string): 'bad' | 'good' | 'neutral' {
  const name = emotion.toLowerCase()
  if (/anything|interest|empathy|sympathy/.test(name)) return 'neutral'
  if (
    /anger|anguish|anxi|apath|bitter|contempt|despair|disgust|fear|fright|frustrat|grief|grouch|hate|horror|irritat|loath|lonely|loneli|miser|mortif|nervous|panic|pessim|restless|sad|shame|shock|terror|uneas|worry|agitat|empti|outrage/.test(
      name,
    )
  )
    return 'bad'
  return 'good'
}

function FacetRow({ name, value }: { name: string; value: number }) {
  const towardHigh = value >= 61
  const pct = Math.min(100, Math.round((Math.abs(value - 50) / 50) * 100))
  return (
    <li className="flex items-center gap-3 text-sm">
      <span className="min-w-0 flex-1 truncate">{tokenLabel(name)}</span>
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
        <span
          className={cn('block h-full', towardHigh ? 'bg-primary' : 'bg-amber-500')}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="w-16 text-right text-muted-foreground">{facetLevel(value)}</span>
    </li>
  )
}

function ThoughtRow({
  thought,
}: {
  thought: [string, string, number, number, number]
}) {
  const [name, emotion, , year, tick] = thought
  const tone = emotionTone(emotion)
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 text-sm">
      <span className="min-w-0 flex-1">{tokenLabel(name)}</span>
      {emotion ? (
        <span
          className={cn(
            tone === 'bad' && 'text-red-600 dark:text-red-400',
            tone === 'good' && 'text-emerald-700 dark:text-emerald-400',
            tone === 'neutral' && 'text-muted-foreground',
          )}
        >
          {tokenLabel(emotion)}
        </span>
      ) : null}
      <span className="tabular-nums text-muted-foreground">{formatGameTick(year, tick)}</span>
    </li>
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
