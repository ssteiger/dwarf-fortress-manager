import {
  Badge,
  Button,
  Card,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@fortress/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import * as React from 'react'

import { formatNumber, formatValue, humanize } from '~/lib/fortress/format'
import { FORT_SLOW_REFRESH_MS, useFortOverview } from '~/lib/fortress/queries'
import { getFortItems } from '~/lib/fortress/server'
import { EmptyState, PageHeader, StatusBanner } from '../-components/fort-chrome'

const PAGE_SIZE = 100
const ALL_TYPES = '__all__'

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
  const q = useDebounced(search, 250)

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['fort', 'items', q, type, onlyForbidden, page],
    queryFn: () =>
      getFortItems({
        data: {
          q,
          type: type === ALL_TYPES ? undefined : type,
          onlyForbidden,
          page,
          pageSize: PAGE_SIZE,
        },
      }),
    refetchInterval: FORT_SLOW_REFRESH_MS,
    placeholderData: keepPreviousData,
  })

  const typeOptions = React.useMemo(
    () => Object.entries(data?.types ?? {}).sort((a, b) => b[1] - a[1]),
    [data?.types],
  )
  const pageCount = data ? Math.max(1, Math.ceil(data.filtered / data.pageSize)) : 1

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
            ? `${formatNumber(data.total)} items on the map and in the stores, most valuable first.`
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
                'rounded-full border px-3 py-1 text-xs transition-colors hover:bg-accent',
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
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              placeholder="Search description or material…"
              value={search}
              onChange={(e) => changeFilter(() => setSearch(e.target.value))}
              className="h-9 w-72"
            />
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
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={onlyForbidden}
                onChange={(e) => changeFilter(() => setOnlyForbidden(e.target.checked))}
              />
              forbidden only
            </label>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {data ? (
              <span>
                {formatNumber(data.filtered)} match{data.filtered === 1 ? '' : 'es'} · page{' '}
                {page + 1} of {pageCount}
              </span>
            ) : null}
            <Button
              size="icon"
              variant="outline"
              className="size-8"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="size-8"
              disabled={page + 1 >= pageCount}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        </div>

        {!data || data.items.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No items">
              {data?.total ? 'Nothing matches this filter.' : 'No dump has been taken yet.'}
            </EmptyState>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Material</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Quality</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">Where</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="max-w-[320px] truncate font-medium">
                    {item.description}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {humanize(item.type)}
                    {item.subtype ? <span className="block text-xs">{item.subtype}</span> : null}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-sm">{item.material}</TableCell>
                  <TableCell className="text-right tabular-nums">{item.stack}</TableCell>
                  <TableCell className="text-sm">
                    {item.quality !== 'Ordinary' ? (
                      item.quality
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                    {item.wear > 0 ? (
                      <span className="ml-1 text-xs text-amber-600">worn {item.wear}</span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {item.flags.includes('artifact') ? <Badge>Artifact</Badge> : null}
                      {item.flags.includes('forbid') ? (
                        <Badge variant="destructive">Forbidden</Badge>
                      ) : null}
                      {item.flags.includes('dump') ? <Badge variant="secondary">Dump</Badge> : null}
                      {item.flags.includes('melt') ? <Badge variant="secondary">Melt</Badge> : null}
                      {item.flags.includes('rotten') ? (
                        <Badge variant="destructive">Rotten</Badge>
                      ) : null}
                      {item.flags.includes('owned') ? <Badge variant="outline">Owned</Badge> : null}
                      {item.flags.includes('trader') ? (
                        <Badge variant="outline">Merchant's</Badge>
                      ) : null}
                      {item.flags.includes('foreign') ? (
                        <Badge variant="outline">Foreign</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatValue(item.value)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-muted-foreground">
                    {item.holder_unit_id !== null
                      ? 'carried'
                      : item.holder_building_id !== null
                        ? 'in building'
                        : item.container_id !== null
                          ? 'in container'
                          : item.x !== null
                            ? `${item.x},${item.y} z${item.z}`
                            : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/_app/fortress/items/')({
  component: ItemsPage,
})
