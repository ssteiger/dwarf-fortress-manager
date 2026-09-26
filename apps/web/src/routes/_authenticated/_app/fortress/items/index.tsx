import type { FortItem } from '@fortress/db-drizzle'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@fortress/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import {
  HammerIcon,
  LifeBuoyIcon,
  ListChecksIcon,
  Maximize2Icon,
  PiggyBankIcon,
  XIcon,
} from 'lucide-react'
import * as React from 'react'

import { ItemSprite } from '~/lib/df-assets/components'
import { formatNumber, formatValue, humanize } from '~/lib/fortress/format'
import { gameTimeOf } from '~/lib/fortress/insights'
import {
  FORT_SLOW_REFRESH_MS,
  useFortConcerns,
  useFortOverview,
  useFortSupplies,
  useFortUnits,
} from '~/lib/fortress/queries'
import { type ItemSortKey, getFortItems, getFortWork } from '~/lib/fortress/server'
import {
  type ItemView,
  isItemView,
  productionPlan,
  storeSituations,
  storeTiles,
  storesAdvice,
} from '~/lib/fortress/stores'
import { NextSteps, SituationList } from '../-components/Advice'
import { EmptyState, PageHeader, StatusBanner } from '../-components/FortChrome'
import { GuideProvider } from '../-components/Guide'
import { ItemDetails, ItemStatusBadges, itemSubtitle } from './-components/ItemDetails'
import {
  ProductionPlan,
  StoreTiles,
  TypeChips,
  ViewChips,
  ViewHint,
  WealthBreakdown,
} from './-components/Stores'

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
        <ItemStatusBadges flags={row.original.flags} />
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
      return 'elsewhere'
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
  return (
    <GuideProvider>
      <ItemsBody />
    </GuideProvider>
  )
}

function ItemsBody() {
  const overview = useFortOverview()
  const units = useFortUnits()
  const concerns = useFortConcerns()
  const supplies = useFortSupplies()
  const work = useQuery({
    queryKey: ['fort', 'work'],
    queryFn: () => getFortWork(),
    refetchInterval: FORT_SLOW_REFRESH_MS,
  })
  const state = overview.data?.state ?? null
  const summary = state?.summary ?? null
  const now = gameTimeOf(state)

  const advisorInput = React.useMemo(
    () => ({
      summary,
      units: units.data?.units ?? [],
      buildings: work.data?.buildings ?? [],
      jobs: work.data?.jobs ?? [],
      concerns: concerns.data ?? null,
      supplies: supplies.data ?? null,
      events: overview.data?.events ?? [],
      now,
    }),
    [summary, units.data, work.data, concerns.data, supplies.data, overview.data?.events, now],
  )
  const advice = React.useMemo(() => storesAdvice(advisorInput), [advisorInput])
  const tiles = React.useMemo(() => storeTiles(advisorInput), [advisorInput])
  const plan = React.useMemo(() => productionPlan(advisorInput), [advisorInput])
  const playbook = React.useMemo(() => storeSituations(advisorInput), [advisorInput])
  const ready = Boolean(summary && supplies.data && units.data && work.data)
  const problems = advice.filter((a) => a.status === 'problem').length
  const attention = advice.filter((a) => a.status === 'attention').length

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        eyebrow="Fortress"
        title="Stores and items"
        description="What the fortress keeps, what it is running short of, and what to do about it in the game. Every item on the map is listed below."
        updatedAt={supplies.data?.capturedAt}
        isFetching={supplies.isFetching}
        onRefresh={() => {
          void supplies.refetch()
          void work.refetch()
        }}
      />
      <StatusBanner state={state} />

      {ready ? (
        <>
          <StoreTiles tiles={tiles} advice={advice} />

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="flex min-w-0 flex-col gap-4">
              <Card className="gap-4">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ListChecksIcon className="size-4 text-primary" />
                    What the stores need
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {problems ? `${problems} problem${problems === 1 ? '' : 's'} and ` : ''}
                    {attention} thing{attention === 1 ? '' : 's'} to see to in what the fortress
                    keeps. Open one for the steps in the game.
                  </p>
                </CardHeader>
                <CardContent>
                  <NextSteps advice={advice} max={6} />
                </CardContent>
              </Card>

              <Card className="gap-4">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <HammerIcon className="size-4 text-primary" />
                    Worth making next
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    What a fortress this size should keep in store, against what it has. Open one to
                    see where to make it and who can.
                  </p>
                </CardHeader>
                <CardContent>
                  <ProductionPlan rows={plan} />
                </CardContent>
              </Card>
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              <Card className="gap-3">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <PiggyBankIcon className="size-4 text-primary" />
                    Where the wealth is
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <WealthBreakdown wealth={summary?.wealth ?? null} />
                </CardContent>
              </Card>

              <Card className="gap-4">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <LifeBuoyIcon className="size-4 text-primary" />
                    When things go wrong
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Trouble with the stores, and how to get through it. What seems to be happening
                    now is on top.
                  </p>
                </CardHeader>
                <CardContent>
                  <SituationList situations={playbook} />
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Reading the stores…</p>
      )}

      <ItemList />
    </div>
  )
}

const ALL_TYPES = null

/** Every item in one view of the list, filterable by type and searchable. */
function ItemList() {
  const { view: urlView } = Route.useSearch()
  const navigate = Route.useNavigate()
  const view: ItemView = urlView ?? 'fortress'
  const [search, setSearch] = React.useState('')
  // Type and page belong to the view they were picked in and reset with it.
  const [picked, setPicked] = React.useState<{ view: ItemView; type: string | null; page: number }>(
    { view, type: ALL_TYPES, page: 0 },
  )
  const { type, page } = picked.view === view ? picked : { type: ALL_TYPES, page: 0 }
  const [pageSize, setPageSize] = React.useState(100)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'value', desc: true }])
  const sortColumn = sorting[0]
  const sortKey = (sortColumn?.id ?? 'value') as ItemSortKey
  const sortDir = sortColumn?.desc === false ? 'asc' : 'desc'
  const q = useDebounced(search, 250)
  const [selected, setSelected] = React.useState<FortItem | null>(null)

  const { data, isFetching } = useQuery({
    queryKey: ['fort', 'items', view, q, type, page, pageSize, sortKey, sortDir],
    queryFn: () =>
      getFortItems({
        data: {
          q,
          view,
          type: type ?? undefined,
          page,
          pageSize,
          sortKey,
          sortDir,
        },
      }),
    refetchInterval: FORT_SLOW_REFRESH_MS,
    placeholderData: keepPreviousData,
  })
  const setView = (next: ItemView) =>
    navigate({
      search: (prev) => ({ ...prev, view: next === 'fortress' ? undefined : next }),
      resetScroll: false,
    })
  const setType = (next: string | null) => setPicked({ view, type: next, page: 0 })
  const setPage = (next: number) => setPicked({ view, type, page: next })
  const current = data?.view === view ? data : undefined

  return (
    <section id="items-list" className="flex scroll-mt-4 flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Every item</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {data
            ? `${formatNumber(data.views.fortress)} items in the fortress${data.views.elsewhere ? `, and ${formatNumber(data.views.elsewhere)} artifacts and books the game knows of elsewhere` : ''}. Click one to see what to do with it.`
            : 'Everything the fortress owns, once a dump has been taken.'}
          {isFetching ? ' Updating…' : ''}
        </p>
      </div>

      <ViewChips view={view} counts={data?.views} onChange={setView} />
      {current ? <ViewHint view={view} count={current.inView} value={current.viewValue} /> : null}
      {current ? (
        <TypeChips
          types={current.types}
          valueByType={current.valueByType}
          samples={current.samples}
          selected={type}
          onSelect={setType}
        />
      ) : null}

      <Card className="overflow-hidden p-0">
        {!data || data.total === 0 ? (
          <div className="p-6">
            <EmptyState title="No items">No dump has been taken yet.</EmptyState>
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
              subtitle: q || type ? 'Nothing matches this search.' : 'Nothing in this view.',
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
    </section>
  )
}

interface ItemsSearch {
  view?: ItemView
}

export const Route = createFileRoute('/_authenticated/_app/fortress/items/')({
  validateSearch: (raw: Record<string, unknown>): ItemsSearch =>
    isItemView(raw.view) && raw.view !== 'fortress' ? { view: raw.view } : {},
  component: ItemsPage,
})
