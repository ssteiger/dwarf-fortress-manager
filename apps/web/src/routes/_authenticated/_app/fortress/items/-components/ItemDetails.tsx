import type { FortBuilding, FortItem } from '@fortress/db-drizzle'
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
import { LightbulbIcon, MapIcon, TriangleAlertIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { ItemSprite } from '~/lib/df-assets/components'
import { formatValue, humanize, splitPascal, unitDisplayName } from '~/lib/fortress/format'
import { useFortItem } from '~/lib/fortress/queries'
import { type ItemHint, itemHints } from '~/lib/fortress/stores'
import { EmptyState, StatCard } from '../../-components/FortChrome'

const PROMINENT_FLAGS = [
  'artifact',
  'forbid',
  'dump',
  'melt',
  'rotten',
  'owned',
  'trader',
  'foreign',
]

const CONTENT_COLUMNS: ColumnDef<FortItem>[] = [
  {
    id: 'item',
    header: 'Item',
    accessorFn: (item) => item.description,
    meta: { cellClassName: 'max-w-[280px] font-medium' },
    cell: ({ row }) => (
      <Link
        to="/fortress/items/$id"
        params={{ id: String(row.original.id) }}
        className="flex items-center gap-2 hover:underline"
      >
        <ItemSprite item={row.original} size={24} className="-my-1" />
        <span className="truncate">{row.original.description}</span>
      </Link>
    ),
  },
  {
    id: 'material',
    header: 'Material',
    accessorKey: 'material',
    meta: { cellClassName: 'max-w-[160px] truncate text-sm' },
  },
  {
    id: 'qty',
    header: 'Qty',
    accessorKey: 'stack',
    meta: { align: 'right', cellClassName: 'tabular-nums' },
  },
  {
    id: 'value',
    header: 'Value',
    accessorKey: 'value',
    meta: { align: 'right', cellClassName: 'tabular-nums' },
    cell: ({ row }) => formatValue(row.original.value),
  },
]

export function itemSubtitle(item: FortItem): string {
  return [
    humanize(item.type),
    item.subtype,
    item.material,
    item.quality !== 'Ordinary' ? splitPascal(item.quality) : null,
    item.stack > 1 ? `${item.stack.toLocaleString()} stacked` : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function ItemStatusBadges({
  flags,
  className,
}: {
  flags: string[]
  className?: string
}) {
  return (
    <>
      {flags.includes('artifact') ? <Badge className={className}>Artifact</Badge> : null}
      {flags.includes('forbid') ? (
        <Badge variant="destructive" className={className}>
          Forbidden
        </Badge>
      ) : null}
      {flags.includes('dump') ? (
        <Badge variant="secondary" className={className}>
          Dump
        </Badge>
      ) : null}
      {flags.includes('melt') ? (
        <Badge variant="secondary" className={className}>
          Melt
        </Badge>
      ) : null}
      {flags.includes('rotten') ? (
        <Badge variant="destructive" className={className}>
          Rotten
        </Badge>
      ) : null}
      {flags.includes('owned') ? (
        <Badge variant="outline" className={className}>
          Owned
        </Badge>
      ) : null}
      {flags.includes('trader') ? (
        <Badge variant="outline" className={className}>
          Merchant's
        </Badge>
      ) : null}
      {flags.includes('foreign') ? (
        <Badge variant="outline" className={className}>
          Foreign
        </Badge>
      ) : null}
    </>
  )
}

function buildingLabel(building: FortBuilding): string {
  if (building.custom) return building.custom
  if (building.name) return building.name
  if (building.type === 'Civzone') return `${splitPascal(building.subtype)} zone`
  if (building.subtype) {
    return `${splitPascal(building.subtype)}${building.type === 'Workshop' || building.type === 'Furnace' ? ` ${building.type.toLowerCase()}` : ''}`
  }
  return splitPascal(building.type)
}

export function ItemDetails({ itemId, compact }: { itemId: number; compact?: boolean }) {
  const { data, isLoading } = useFortItem(itemId)

  if (isLoading) {
    return (
      <div className={cn('grid gap-4', compact ? 'grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-4')}>
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    )
  }

  const item = data?.item ?? null
  if (!item) {
    return (
      <EmptyState title="Not in the last dump">
        There is no item with id {itemId} in the fortress dump. It may have been used up, or no dump
        has been taken yet.
      </EmptyState>
    )
  }

  const otherFlags = item.flags.filter((flag) => !PROMINENT_FLAGS.includes(flag))
  const contentsValue = (data?.contents ?? []).reduce((sum, entry) => sum + entry.value, 0)
  const hints = itemHints(item)

  return (
    <div className="flex flex-col gap-4">
      {hints.length ? <ItemHints hints={hints} /> : null}
      <div className={cn('grid gap-4', compact ? 'grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-4')}>
        <StatCard title="Value" value={formatValue(item.value)} />
        <StatCard
          title="Quantity"
          value={item.stack.toLocaleString()}
          hint={item.stack === 1 ? 'a single item' : 'stacked together'}
        />
        <StatCard
          title="Quality"
          value={item.quality === 'Ordinary' ? 'Ordinary' : splitPascal(item.quality)}
          hint={item.wear > 0 ? `worn ${item.wear}` : undefined}
        />
        <StatCard
          title="Where"
          value={
            item.x !== null ? (
              <span className={cn('font-mono', compact ? 'text-lg' : 'text-xl')}>
                {item.x},{item.y} z{item.z}
              </span>
            ) : data?.holder ? (
              'Carried'
            ) : data?.building ? (
              'Stored'
            ) : data?.container ? (
              'Contained'
            ) : (
              'Elsewhere'
            )
          }
          hint={
            item.x !== null ? (
              <Link
                to="/fortress/map"
                className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
              >
                <MapIcon className="size-3.5" />
                Open map
              </Link>
            ) : data?.holder ? (
              <Link
                to="/fortress/dwarves/$id"
                params={{ id: String(data.holder.id) }}
                className="hover:text-foreground hover:underline"
              >
                {unitDisplayName(data.holder)}
              </Link>
            ) : data?.building ? (
              buildingLabel(data.building)
            ) : data?.container ? (
              <Link
                to="/fortress/items/$id"
                params={{ id: String(data.container.id) }}
                className="hover:text-foreground hover:underline"
              >
                {data.container.description}
              </Link>
            ) : undefined
          }
        />
      </div>

      <div className={cn('grid gap-4', compact ? 'grid-cols-1' : 'lg:grid-cols-2')}>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center justify-between gap-3 text-base">
              The object
              <ItemSprite
                item={item}
                size={48}
                title={`${item.description} as drawn in the game`}
              />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Facts
              items={[
                { label: 'Type', value: humanize(item.type) },
                { label: 'Subtype', value: item.subtype },
                { label: 'Material', value: item.material },
                { label: 'Class', value: item.mat_class ? humanize(item.mat_class) : null },
                { label: 'Color', value: item.color ? humanize(item.color) : null },
                { label: 'Creature', value: item.race_id ? humanize(item.race_id) : null },
                { label: 'Caste', value: item.caste_id ? humanize(item.caste_id) : null },
                { label: 'Plant', value: item.plant_id ? humanize(item.plant_id) : null },
                {
                  label: 'Remains',
                  value: item.corpse_flags?.length
                    ? item.corpse_flags.map((flag) => humanize(flag)).join(', ')
                    : null,
                },
              ]}
            />
            {otherFlags.length ? (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {otherFlags.map((flag) => (
                  <Badge key={flag} variant="outline">
                    {humanize(flag)}
                  </Badge>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {data?.holder || data?.building || data?.container ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Kept</CardTitle>
            </CardHeader>
            <CardContent>
              <Facts
                items={[
                  {
                    label: 'Held by',
                    value: data.holder ? (
                      <Link
                        to="/fortress/dwarves/$id"
                        params={{ id: String(data.holder.id) }}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {unitDisplayName(data.holder)}
                      </Link>
                    ) : null,
                  },
                  {
                    label: 'Building',
                    value: data.building ? (
                      <span>
                        {buildingLabel(data.building)}
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {data.building.cx},{data.building.cy} z{data.building.z}
                        </span>
                      </span>
                    ) : null,
                  },
                  {
                    label: 'Inside',
                    value: data.container ? (
                      <Link
                        to="/fortress/items/$id"
                        params={{ id: String(data.container.id) }}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {data.container.description}
                      </Link>
                    ) : null,
                  },
                ]}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>

      {data?.contents.length ? (
        <Card className="overflow-hidden p-0">
          <div className="border-b px-5 py-4">
            <div className="text-base font-semibold">Contents</div>
            <p className="mt-1 text-sm text-muted-foreground">
              {data.contents.length} item{data.contents.length === 1 ? '' : 's'} ·{' '}
              {formatValue(contentsValue)}
            </p>
          </div>
          <DataTable
            data={data.contents}
            columns={CONTENT_COLUMNS}
            showSelectColumn={false}
            showActionsColumn={false}
            showToolbar={false}
            enableSortingRemoval={false}
            defaultSort={[{ id: 'value', desc: true }]}
            getRowId={(row) => String(row.id)}
            pageSize={compact ? 25 : 50}
          />
        </Card>
      ) : null}
    </div>
  )
}

/** What is wrong with the item and what it is good for. */
function ItemHints({ hints }: { hints: ItemHint[] }) {
  const trouble = hints.some((h) => h.problem)
  return (
    <div
      className={cn(
        'rounded-xl border p-4',
        trouble ? 'border-amber-500/40 bg-amber-500/5' : 'bg-muted/30',
      )}
    >
      <div className="mb-2 text-sm font-medium">What to do with it</div>
      <ul className="flex flex-col gap-2">
        {hints.map((hint) => {
          const Icon = hint.problem ? TriangleAlertIcon : LightbulbIcon
          return (
            <li key={hint.title} className="flex gap-2.5 text-sm leading-relaxed">
              <Icon
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  hint.problem ? 'text-amber-600 dark:text-amber-400' : 'text-primary',
                )}
              />
              <span>
                <span className="font-medium">{hint.title}.</span> {hint.text}
              </span>
            </li>
          )
        })}
      </ul>
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
