import {
  type ColumnDef,
  type ColumnFiltersState,
  type PaginationState,
  type Row,
  type RowData,
  type SortingState,
  type Updater,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  MoreHorizontal,
  Search,
} from 'lucide-react'
import * as React from 'react'

import { cn } from '../../../utils/cn'
import { Button } from '../Button'
import { Checkbox } from '../Checkbox'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../DropdownMenu'
import { Input } from '../Input'
import { Label } from '../Label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../Select'
import { Sheet, SheetContent } from '../Sheet'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../Table'

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: 'left' | 'right'
    cellClassName?: string
    /** Visible words that are not already stored on the row, such as "Hungry". */
    searchText?: (row: TData) => string
  }
}

function collectSearchText(value: unknown, parts: string[]) {
  if (value == null || typeof value === 'boolean') return
  if (typeof value === 'string' || typeof value === 'number') {
    parts.push(String(value))
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSearchText(item, parts)
    return
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>))
      collectSearchText(item, parts)
  }
}

/** Match a query against every field on the row and any extra column labels. */
function rowMatchesQuery<TData>(row: Row<TData>, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const parts: string[] = []
  collectSearchText(row.original, parts)
  for (const cell of row.getAllCells()) {
    collectSearchText(cell.getValue(), parts)
    const extra = cell.column.columnDef.meta?.searchText?.(row.original)
    if (extra) parts.push(extra)
  }
  return parts.join('\n').toLowerCase().includes(needle)
}

export interface DataTableProps<TData> {
  data: TData[]
  isLoading?: boolean
  refetch?: () => void
  columns: ColumnDef<TData>[]
  showSelectColumn?: boolean
  /** Placeholder row menu. Off for tables that only display data. */
  showActionsColumn?: boolean
  /** Refresh and column visibility, beside the search box. */
  showToolbar?: boolean
  /** Page controls under the table. */
  paginate?: boolean
  enableSortingRemoval?: boolean
  getRowId?: (row: TData) => string
  rowClassName?: (row: TData) => string | undefined
  /** Called when a row is clicked, except on links, buttons, and form controls. */
  onRowClick?: (row: TData) => void
  rowViewerContent?: React.ComponentType<{ item: TData }>
  pageSize?: number
  resetOnDataChange?: boolean
  pagination?: { pageIndex: number; pageSize: number }
  onPaginationChange?: (pagination: { pageIndex: number; pageSize: number }) => void
  search?: string
  onSearch?: (search: string) => void
  /** Extra controls beside the search box (filters, etc.). */
  toolbar?: React.ReactNode
  sorting?: SortingState
  onSortingChange?: (sorting: SortingState) => void
  defaultSort?: SortingState
  rowCount?: number
  emptyState?: {
    title: string
    subtitle: string
  }
}

export function DataTable<TData>({
  data,
  isLoading,
  refetch,
  columns: userColumns,
  showSelectColumn = true,
  showActionsColumn = true,
  showToolbar = true,
  paginate = true,
  enableSortingRemoval = true,
  getRowId,
  rowClassName,
  onRowClick,
  rowViewerContent: CellViewerContent,
  pageSize = 100,
  pagination: externalPagination,
  onPaginationChange,
  search: externalSearch,
  onSearch,
  toolbar,
  sorting: externalSorting,
  onSortingChange,
  defaultSort,
  rowCount,
  emptyState,
}: DataTableProps<TData>) {
  // Create the select column
  const selectColumn: ColumnDef<TData> = {
    id: 'select',
    header: ({ table }) => (
      <Checkbox
        checked={
          table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')
        }
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
        aria-label="Select all"
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
        aria-label="Select row"
      />
    ),
    enableSorting: false,
    enableHiding: false,
  }

  // Create the actions column
  const actionsColumn: ColumnDef<TData> = {
    id: 'actions',
    //header: "Actions",
    enableHiding: false,
    enableSorting: false,
    cell: ({ row }) => {
      const item = row.original

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="w-8 h-8 p-0">
              <span className="sr-only">Open menu</span>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem
              // We'll need to adapt this to be more generic
              onClick={() => {
                const itemId =
                  typeof item === 'object' && item !== null && 'id' in item ? String(item.id) : ''
                navigator.clipboard.writeText(itemId)
              }}
            >
              Copy ID
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem>View details</DropdownMenuItem>
            <DropdownMenuItem>Edit</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
  }

  // Combine the columns
  const allColumns = [
    ...(showSelectColumn ? [selectColumn] : []),
    ...userColumns,
    ...(showActionsColumn ? [actionsColumn] : []),
  ]

  const [internalSorting, setInternalSorting] = React.useState<SortingState>(defaultSort ?? [])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = React.useState({})
  const [internalGlobalFilter, setInternalGlobalFilter] = React.useState('')
  const [internalPagination, setInternalPagination] = React.useState({
    pageIndex: 0,
    pageSize: pageSize,
  })

  // Use the external state if provided, otherwise use internal state
  const sorting = externalSorting !== undefined ? externalSorting : internalSorting
  const pagination = externalPagination !== undefined ? externalPagination : internalPagination
  const globalFilter = externalSearch !== undefined ? externalSearch : internalGlobalFilter

  // Handle state changes. react-table passes either the next value directly or
  // an updater function (current => next), so we need to resolve both forms
  // before forwarding to the controlled or internal setter.
  const handleSortingChange = React.useCallback(
    (updaterOrValue: Updater<SortingState>) => {
      const next = typeof updaterOrValue === 'function' ? updaterOrValue(sorting) : updaterOrValue
      if (onSortingChange) {
        onSortingChange(next)
      } else {
        setInternalSorting(next)
      }
    },
    [onSortingChange, sorting],
  )

  const handlePaginationChange = React.useCallback(
    (updaterOrValue: Updater<PaginationState>) => {
      const next =
        typeof updaterOrValue === 'function' ? updaterOrValue(pagination) : updaterOrValue
      if (onPaginationChange) {
        onPaginationChange(next)
      } else {
        setInternalPagination(next)
      }
    },
    [onPaginationChange, pagination],
  )

  const handleGlobalFilterChange = React.useCallback(
    (updater: Updater<string>) => {
      const next = typeof updater === 'function' ? updater(globalFilter) : updater
      if (onSearch) onSearch(next)
      else setInternalGlobalFilter(next)
      if (pagination.pageIndex !== 0) {
        handlePaginationChange({ ...pagination, pageIndex: 0 })
      }
    },
    [globalFilter, handlePaginationChange, onSearch, pagination],
  )

  const table = useReactTable({
    data,
    columns: allColumns,
    onSortingChange: handleSortingChange,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: paginate ? getPaginationRowModel() : undefined,
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId,
    enableSortingRemoval,
    globalFilterFn: (row, _columnId, filterValue) =>
      rowMatchesQuery(row, String(filterValue ?? '')),
    manualFiltering: !!onSearch,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: handlePaginationChange,
    onGlobalFilterChange: handleGlobalFilterChange,
    manualPagination: !!onPaginationChange,
    manualSorting: !!onSortingChange,
    pageCount:
      rowCount !== undefined ? Math.max(1, Math.ceil(rowCount / pagination.pageSize)) : undefined,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
      rowSelection,
      pagination,
      globalFilter,
    },
  })

  const [selectedRow, setSelectedRow] = React.useState<TData | null>(null)

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search…"
            value={globalFilter}
            onChange={(event) => table.setGlobalFilter(event.target.value)}
            className="pl-8"
            aria-label="Search table"
          />
        </div>
        {toolbar}
        {showToolbar ? (
          <div className="flex gap-2 ml-auto">
            {refetch && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => refetch()}
                className="flex items-center gap-1"
              >
                Refresh
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  Columns <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {table
                  .getAllColumns()
                  .filter((column) => column.getCanHide())
                  .map((column) => {
                    return (
                      <DropdownMenuCheckboxItem
                        key={column.id}
                        className="capitalize"
                        checked={column.getIsVisible()}
                        onCheckedChange={(value) => column.toggleVisibility(!!value)}
                      >
                        {column.id}
                      </DropdownMenuCheckboxItem>
                    )
                  })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>
      <div className="overflow-hidden">
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-muted">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  if (header.isPlaceholder) return <TableHead key={header.id} />

                  const rendered = flexRender(header.column.columnDef.header, header.getContext())

                  // Auto-wrap string headers of sortable columns in a clickable
                  // affordance. Anything that already renders a custom node
                  // (e.g. a checkbox) is left untouched.
                  const canSort =
                    header.column.getCanSort() && typeof header.column.columnDef.header === 'string'
                  const alignRight = header.column.columnDef.meta?.align === 'right'

                  if (!canSort) {
                    return (
                      <TableHead key={header.id} className={alignRight ? 'text-right' : undefined}>
                        {rendered}
                      </TableHead>
                    )
                  }

                  const sortState = header.column.getIsSorted()
                  const SortIcon =
                    sortState === 'asc' ? ArrowUp : sortState === 'desc' ? ArrowDown : ArrowUpDown

                  return (
                    <TableHead
                      key={header.id}
                      aria-sort={
                        sortState === 'asc'
                          ? 'ascending'
                          : sortState === 'desc'
                            ? 'descending'
                            : 'none'
                      }
                      className={alignRight ? 'text-right' : undefined}
                    >
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          'inline-flex h-8 w-full items-center gap-1.5 rounded-md px-1 text-left text-sm font-medium hover:bg-accent hover:text-accent-foreground',
                          alignRight && 'justify-end',
                        )}
                        aria-label={`Sort by ${String(header.column.columnDef.header)}`}
                      >
                        {rendered}
                        <SortIcon
                          className={cn(
                            'h-3.5 w-3.5 shrink-0',
                            sortState ? 'opacity-100' : 'opacity-40',
                          )}
                        />
                      </button>
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={allColumns.length} className="h-24 text-center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={`row-${row.id}`}
                  data-state={row.getIsSelected() && 'selected'}
                  className={cn(
                    'hover:bg-muted/40',
                    (CellViewerContent || onRowClick) && 'cursor-pointer',
                    rowClassName?.(row.original),
                  )}
                  onClick={
                    CellViewerContent || onRowClick
                      ? (event) => {
                          const target = event.target
                          if (
                            target instanceof Element &&
                            target.closest('a, button, input, textarea, select, [role="checkbox"]')
                          ) {
                            return
                          }
                          if (onRowClick) onRowClick(row.original)
                          else setSelectedRow(row.original)
                        }
                      : undefined
                  }
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={`cell-${cell.id}`}
                      className={cn(
                        cell.column.columnDef.meta?.align === 'right' && 'text-right',
                        cell.column.columnDef.meta?.cellClassName,
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={allColumns.length} className="h-24 text-center">
                  {emptyState ? (
                    <div className="flex flex-col items-center justify-center space-y-1">
                      <p className="text-lg font-medium">{emptyState.title}</p>
                      <p className="text-sm text-muted-foreground">{emptyState.subtitle}</p>
                    </div>
                  ) : (
                    'No results.'
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {paginate ? (
        <div className="flex items-center justify-between py-4 space-x-2">
          <div className="flex-1 text-sm text-muted-foreground">
            {showSelectColumn
              ? `${table.getFilteredSelectedRowModel().rows.length} of ${table.getFilteredRowModel().rows.length} row(s) selected.`
              : `${(rowCount ?? table.getFilteredRowModel().rows.length).toLocaleString()} rows`}
          </div>
          <div className="flex w-full items-center gap-8 lg:w-fit">
            <div className="hidden items-center gap-2 lg:flex">
              <Label htmlFor="rows-per-page" className="text-sm font-medium">
                Rows per page
              </Label>
              <Select
                value={`${table.getState().pagination.pageSize}`}
                onValueChange={(value) => {
                  table.setPageSize(Number(value))
                }}
              >
                <SelectTrigger className="w-20" id="rows-per-page">
                  <SelectValue placeholder={table.getState().pagination.pageSize} />
                </SelectTrigger>
                <SelectContent side="top">
                  {[50, 100, 500, 1000, 5000].map((pageSize) => (
                    <SelectItem key={pageSize} value={`${pageSize}`}>
                      {pageSize}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex w-fit items-center justify-center text-sm font-medium">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
            </div>
            <div className="ml-auto flex items-center gap-2 lg:ml-0">
              <Button
                variant="outline"
                className="hidden h-8 w-8 p-0 lg:flex"
                onClick={() => table.setPageIndex(0)}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">Go to first page</span>
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                className="h-8 w-8 p-0"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                <span className="sr-only">Go to previous page</span>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                className="h-8 w-8 p-0"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">Go to next page</span>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                className="hidden h-8 w-8 p-0 lg:flex"
                onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                disabled={!table.getCanNextPage()}
              >
                <span className="sr-only">Go to last page</span>
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Add the RowDetailSheet outside the table */}
      {CellViewerContent && selectedRow && (
        <Sheet open={!!selectedRow} onOpenChange={(open) => !open && setSelectedRow(null)}>
          <SheetContent side="right" className="flex flex-col">
            <CellViewerContent item={selectedRow} />
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}
