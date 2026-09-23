import type { FortItem } from '@fortress/db-drizzle'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@fortress/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Maximize2Icon, XIcon } from 'lucide-react'
import * as React from 'react'

import { ItemSprite } from '~/lib/df-assets/components'
import { formatNumber, formatValue, humanize } from '~/lib/fortress/format'
import { FORT_SLOW_REFRESH_MS, useFortOverview } from '~/lib/fortress/queries'
import { type ItemSortKey, getFortItems } from '~/lib/fortress/server'
import { EmptyState, PageHeader, StatusBanner } from '../-components/FortChrome'
import { ItemDetails, ItemStatusBadges, itemSubtitle } from './-components/ItemDetails'

const ALL_TYPES = '__all__'

const STATUS_FLAGS = [
  'artifact',
  'forbid',
  'dump',
  'melt',
  'rotten',
  'owned',
  'trader',
  'foreign',
] as const

const ITEM_COLUMNS: ColumnDef<FortItem>[] = [
  {
    id: 'item',
    header: 'Item',
    accessorFn: (item) => item.description,
    meta: { cellClassName: 'max-w-[320px] font-medium' },
    cell: ({ row }) => (
      <span className="flex items-center gap-2">
        <ItemSprite item={row.original} size={24} className="-my-1" />
        <span className="truncate">{row.original.description}</span>
      </span>
    ),
  },
  {
    id: 'type',
    header: 'Type',
    accessorFn: (item) => `${item.type}\u0000${item.subtype ?? ''}`,
    meta: { cellClassName: 'text-sm text-muted-foreground' },
    cell: ({ row }) => (
      <>
        {humanize(row.original.type)}
        {row.original.subtype ? (
          <span className="block text-sm">{row.original.subtype}</span>
        ) : null}
      </>
    ),
  },
  {
    id: 'material',
    header: 'Material',
    accessorKey: 'material',
    meta: { cellClassName: 'max-w-[200px] truncate text-sm' },
  },
  {
    id: 'qty',
    header: 'Qty',
    accessorKey: 'stack',
    meta: { align: 'right', cellClassName: 'tabular-nums' },
  },
  {
    id: 'quality',
    header: 'Quality',
    accessorFn: (item) => item.wear * 100 + (item.quality === 'Ordinary' ? 0 : 1),
    meta: { cellClassName: 'text-sm' },
    cell: ({ row }) => (
      <>
        {row.original.quality !== 'Ordinary' ? (
          row.original.quality
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
        {row.original.wear > 0 ? (
          <span className="ml-1 text-xs text-amber-600">worn {row.original.wear}</span>
        ) : null}
      </>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    accessorFn: (item) => STATUS_FLAGS.filter((flag) => item.flags.includes(flag)).join(' '),
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {row.original.flags.includes('artifact') ? <Badge>Artifact</Badge> : null}
        {row.original.flags.includes('forbid') ? (
          <Badge variant="destructive">Forbidden</Badge>
        ) : null}
        {row.original.flags.includes('dump') ? <Badge variant="secondary">Dump</Badge> : null}
        {row.original.flags.includes('melt') ? <Badge variant="secondary">Melt</Badge> : null}
        {row.original.flags.includes('rotten') ? <Badge variant="destructive">Rotten</Badge> : null}
        {row.original.flags.includes('owned') ? <Badge variant="outline">Owned</Badge> : null}
        {row.original.flags.includes('trader') ? <Badge variant="outline">Merchant's</Badge> : null}
        {row.original.flags.includes('foreign') ? <Badge variant="outline">Foreign</Badge> : null}
      </div>
    ),
  },
  {
    id: 'value',
    header: 'Value',
    accessorKey: 'value',
    meta: { align: 'right', cellClassName: 'tabular-nums' },
    cell: ({ row }) => formatValue(row.original.value),
  },
  {
    id: 'where',
    header: 'Where',
    accessorFn: (item) =>
      item.holder_unit_id !== null
        ? 'carried'
        : item.holder_building_id !== null
          ? 'in building'
          : item.container_id !== null
            ? 'in container'
            : item.x !== null
              ? `map ${item.z} ${item.y} ${item.x}`
              : null,
    sortUndefined: 'last',
    meta: { align: 'right', cellClassName: 'font-mono text-sm text-muted-foreground' },
    cell: ({ row }) => {
      const item = row.original
      if (item.holder_unit_id !== null) return 'carried'
      if (item.holder_building_id !== null) return 'in building'
      if (item.container_id !== null) return 'in container'
      if (item.x !== null) return `${item.x},${item.y} z${item.z}`
      return '—'
    },
  },
]

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

function ItemsPage() {
  const overview = useFortOverview()
  const [search, setSearch] = React.useState('')
  const [type, setType] = React.useState<string>(ALL_TYPES)
  const [onlyForbidden, setOnlyForbidden] = React.useState(false)
  const [page, setPage] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(100)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'value', desc: true }])
  const sortColumn = sorting[0]
  const sortKey = (sortColumn?.id ?? 'value') as ItemSortKey
  const sortDir = sortColumn?.desc === false ? 'asc' : 'desc'
  const q = useDebounced(search, 250)
  const [selected, setSelected] = React.useState<FortItem | null>(null)

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['fort', 'items', q, type, onlyForbidden, page, pageSize, sortKey, sortDir],
    queryFn: () =>
      getFortItems({
        data: {
          q,
          type: type === ALL_TYPES ? undefined : type,
          onlyForbidden,
          page,
          pageSize,
          sortKey,
          sortDir,
        },
      }),
    refetchInterval: FORT_SLOW_REFRESH_MS,
    placeholderData: keepPreviousData,
  })

  const typeOptions = React.useMemo(
    () => Object.entries(data?.types ?? {}).sort((a, b) => b[1] - a[1]),
    [data?.types],
  )
  const changeFilter = (fn: () => void) => {
    fn()
    setPage(0)
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        eyebrow="Fortress"
        title="Items"
        description={
          data
            ? `${formatNumber(data.total)} items on the map and in the stores, most valuable first. Click a row to inspect one.`
            : 'Everything the fortress owns, once a dump has been taken.'
        }
        updatedAt={data?.capturedAt}
        isFetching={isFetching}
        onRefresh={() => refetch()}
      />
      <StatusBanner state={overview.data?.state} />

      {data && typeOptions.length ? (
        <div className="flex flex-wrap gap-2">
          {typeOptions.slice(0, 14).map(([name, count]) => (
            <button
              type="button"
              key={name}
              onClick={() => changeFilter(() => setType(type === name ? ALL_TYPES : name))}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-accent',
                type === name &&
                  'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
              )}
            >
              {humanize(name)} <span className="opacity-70">{formatNumber(count)}</span>
              {data.valueByType[name] ? (
                <span className="ml-1 opacity-70">· {formatValue(data.valueByType[name])}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      <Card className="overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <Select value={type} onValueChange={(v) => changeFilter(() => setType(v))}>
            <SelectTrigger className="h-9 w-[200px]">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TYPES}>All types</SelectItem>
              {typeOptions.map(([name, count]) => (
                <SelectItem key={name} value={name}>
                  {humanize(name)} ({count})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={onlyForbidden}
              onChange={(e) => changeFilter(() => setOnlyForbidden(e.target.checked))}
            />
            forbidden only
          </label>
        </div>

        {!data || data.total === 0 ? (
          <div className="p-6">
            <EmptyState title="No items">
              {data?.total ? 'Nothing matches this filter.' : 'No dump has been taken yet.'}
            </EmptyState>
          </div>
        ) : (
          <DataTable
            data={data.items}
            columns={ITEM_COLUMNS}
            showSelectColumn={false}
            showActionsColumn={false}
            showToolbar={false}
            enableSortingRemoval={false}
            sorting={sorting}
            onSortingChange={(next) => {
              setSorting(next)
              setPage(0)
            }}
            search={search}
            onSearch={(value) => {
              setSearch(value)
              setPage(0)
            }}
            pagination={{ pageIndex: page, pageSize }}
            onPaginationChange={(next) => {
              setPage(next.pageIndex)
              setPageSize(next.pageSize)
            }}
            rowCount={data.filtered}
            getRowId={(item) => String(item.id)}
            onRowClick={setSelected}
            emptyState={{
              title: 'No items',
              subtitle: 'Nothing matches this search.',
            }}
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
                    <ItemSprite
                      item={selected}
                      size={72}
                      className="shrink-0 rounded-md border bg-muted/40"
                      title={`${selected.description} as drawn in the game`}
                    />
                    <div className="min-w-0">
                      <DrawerTitle className="flex flex-wrap items-center gap-2">
                        {selected.description}
                        <ItemStatusBadges flags={selected.flags} className="text-sm font-normal" />
                      </DrawerTitle>
                      <DrawerDescription className="mt-1">
                        {itemSubtitle(selected)}
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
                <ItemDetails itemId={selected.id} compact />
              </div>
              <DrawerFooter className="border-t">
                <Button asChild>
                  <Link to="/fortress/items/$id" params={{ id: String(selected.id) }}>
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

export const Route = createFileRoute('/_authenticated/_app/fortress/items/')({
  component: ItemsPage,
})
