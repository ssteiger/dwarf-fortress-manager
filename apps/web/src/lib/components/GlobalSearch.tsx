import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  cn,
} from '@fortress/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { HammerIcon, ScrollTextIcon, SearchIcon } from 'lucide-react'
import * as React from 'react'

import { CreatureSprite, ItemSprite } from '~/lib/df-assets/components'
import { LegendsSprite } from '~/lib/df-assets/legends'
import { formatValue } from '~/lib/fortress/format'
import { kindLabel } from '~/lib/legends/model'
import type { LegendsHit } from '~/lib/legends/server'
import {
  type AppPath,
  type DwarfHit,
  EMPTY_RESULTS,
  type EventHit,
  type ItemHit,
  MIN_QUERY,
  PAGES,
  type PlaceHit,
  rankMatch,
} from '~/lib/search/model'
import { globalSearch } from '~/lib/search/server'

function useDebounced<T>(value: T, ms: number): T {
  const [state, setState] = React.useState(value)
  React.useEffect(() => {
    const id = setTimeout(() => setState(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return state
}

const unitName = (unit: DwarfHit['unit']) => unit.nickname || unit.name || unit.readable

/** Pages whose title, purpose or keywords answer the query; all of them when it is empty. */
function matchingPages(q: string) {
  if (!q) return PAGES.slice(0, 8)
  return PAGES.map((page) => ({
    page,
    rank: rankMatch(page.title, `${page.detail} ${page.keywords}`, q),
  }))
    .filter((entry): entry is { page: (typeof PAGES)[number]; rank: number } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 5)
    .map((entry) => entry.page)
}

/** One line of a result: a sprite or icon, a name, and what it is. */
function Row({
  icon,
  title,
  detail,
  trailing,
}: {
  icon: React.ReactNode
  title: string
  detail?: string | null
  trailing?: React.ReactNode
}) {
  return (
    <>
      <span className="flex size-6 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">
        {title}
        {detail ? <span className="ml-2 text-xs text-muted-foreground">{detail}</span> : null}
      </span>
      {trailing}
    </>
  )
}

function MoreNote({ count, what }: { count: number; what: string }) {
  if (!count) return null
  return (
    <span className="px-2 pb-1.5 text-xs text-muted-foreground">
      and {count.toLocaleString()} more {what}
    </span>
  )
}

/**
 * Search the whole app from the header: the pages, the dwarves, items and
 * buildings of the last dump, the chronicle, and the legends export. Opens
 * with ⌘K / Ctrl+K.
 */
export function GlobalSearch() {
  const navigate = useNavigate()
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState('')
  const typed = q.trim()
  const debounced = useDebounced(typed, 180)

  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => globalSearch({ data: { q: debounced } }),
    enabled: open && debounced.length >= MIN_QUERY,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const results = debounced.length >= MIN_QUERY ? (data ?? EMPTY_RESULTS) : EMPTY_RESULTS
  const pages = matchingPages(typed)
  const close = () => {
    setOpen(false)
    setQ('')
  }
  const goPage = (to: AppPath) => {
    close()
    navigate({ to })
  }
  const goDwarf = (hit: DwarfHit) => {
    close()
    navigate({ to: '/fortress/dwarves/$id', params: { id: String(hit.unit.id) } })
  }
  const goItem = (hit: ItemHit) => {
    close()
    navigate({ to: '/fortress/items/$id', params: { id: String(hit.item.id) } })
  }
  const goChronicle = () => {
    close()
    navigate({ to: '/fortress/chronicle', search: { q: typed, filter: 'all' } })
  }
  const goLegends = (hit: LegendsHit) => {
    close()
    navigate({
      to: '/legends/$kind/$id',
      params: { kind: hit.kind, id: String(hit.id) },
      search: results.worldId === null ? {} : { world: results.worldId },
    })
  }

  const searching = isFetching && debounced.length >= MIN_QUERY
  const nothing =
    !searching &&
    !pages.length &&
    !results.dwarves.length &&
    !results.items.length &&
    !results.places.length &&
    !results.events.length &&
    !results.legends.length

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-full items-center gap-2 rounded-md border bg-background/60 px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent/60"
      >
        <SearchIcon className="size-4 shrink-0" />
        <span className="flex-1 truncate text-left">Search the fortress…</span>
        <kbd className="rounded border bg-muted px-1.5 font-mono text-[10px] leading-4">⌘K</kbd>
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setQ('')
        }}
      >
        <DialogContent className="overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="sr-only">
            <DialogTitle>Search</DialogTitle>
            <DialogDescription>
              Find a page, a dwarf, an item, a building, an announcement or a legends record.
            </DialogDescription>
          </DialogHeader>
          <Command
            shouldFilter={false}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2"
          >
            <CommandInput
              placeholder="A dwarf, an item, a place, a page…"
              value={q}
              onValueChange={setQ}
              aria-label="Search the app"
            />
            <CommandList className="max-h-[70vh]">
              {nothing ? <CommandEmpty>Nothing by that name.</CommandEmpty> : null}

              {pages.length ? (
                <CommandGroup heading="Pages">
                  {pages.map((page) => (
                    <CommandItem
                      key={page.to}
                      value={`page-${page.to}`}
                      onSelect={() => goPage(page.to)}
                      className="gap-2"
                    >
                      <Row
                        icon={<SearchIcon className="size-4 text-muted-foreground" />}
                        title={page.title}
                        detail={page.detail}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}

              {results.dwarves.length ? (
                <CommandGroup heading="Dwarves">
                  {results.dwarves.map((hit) => (
                    <CommandItem
                      key={`dwarf-${hit.unit.id}`}
                      value={`dwarf-${hit.unit.id}`}
                      onSelect={() => goDwarf(hit)}
                      className="gap-2"
                    >
                      <Row
                        icon={<CreatureSprite unit={hit.unit} size={24} />}
                        title={unitName(hit.unit)}
                        detail={hit.detail}
                      />
                    </CommandItem>
                  ))}
                  <MoreNote count={results.more.dwarves} what="dwarves" />
                </CommandGroup>
              ) : null}

              {results.items.length ? (
                <CommandGroup heading="Items">
                  {results.items.map((hit) => (
                    <CommandItem
                      key={`item-${hit.item.id}`}
                      value={`item-${hit.item.id}`}
                      onSelect={() => goItem(hit)}
                      className="gap-2"
                    >
                      <Row
                        icon={<ItemSprite item={hit.item} size={24} />}
                        title={hit.item.description}
                        detail={hit.detail}
                        trailing={
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {formatValue(hit.item.value)}
                          </span>
                        }
                      />
                    </CommandItem>
                  ))}
                  <MoreNote count={results.more.items} what="items" />
                </CommandGroup>
              ) : null}

              {results.places.length ? (
                <CommandGroup heading="Buildings and zones">
                  {results.places.map((hit: PlaceHit) => (
                    <CommandItem
                      key={`place-${hit.id}`}
                      value={`place-${hit.id}`}
                      onSelect={() => goPage('/fortress/work')}
                      className="gap-2"
                    >
                      <Row
                        icon={<HammerIcon className="size-4 text-muted-foreground" />}
                        title={hit.label}
                        detail={hit.detail}
                      />
                    </CommandItem>
                  ))}
                  <MoreNote count={results.more.places} what="buildings and zones" />
                </CommandGroup>
              ) : null}

              {results.events.length ? (
                <CommandGroup heading="Chronicle">
                  {results.events.map((hit: EventHit) => (
                    <CommandItem
                      key={`event-${hit.id}`}
                      value={`event-${hit.id}`}
                      onSelect={goChronicle}
                      className="gap-2"
                    >
                      <Row
                        icon={<ScrollTextIcon className="size-4 text-muted-foreground" />}
                        title={hit.text}
                        trailing={
                          hit.when ? (
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {hit.when}
                            </span>
                          ) : null
                        }
                      />
                    </CommandItem>
                  ))}
                  {results.more.events ? (
                    <CommandItem value="all-events" onSelect={goChronicle} className="gap-2">
                      <Row
                        icon={<SearchIcon className="size-4 text-muted-foreground" />}
                        title={`All ${results.more.events.toLocaleString()} further announcements`}
                      />
                    </CommandItem>
                  ) : null}
                </CommandGroup>
              ) : null}

              {results.legends.length ? (
                <CommandGroup heading="Legends">
                  {results.legends.map((hit) => (
                    <CommandItem
                      key={`legends-${hit.kind}-${hit.id}`}
                      value={`legends-${hit.kind}-${hit.id}`}
                      onSelect={() => goLegends(hit)}
                      className="gap-2"
                    >
                      <Row
                        icon={<LegendsSprite subject={hit} size={24} />}
                        title={hit.name ?? kindLabel(hit.kind)}
                        detail={hit.detail}
                        trailing={
                          hit.year !== null && hit.year >= 0 ? (
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {hit.year}
                            </span>
                          ) : null
                        }
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}

              {typed.length < MIN_QUERY && !pages.length ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Type at least {MIN_QUERY} letters. Dwarves, items, buildings, announcements and
                  the legends of the world all answer.
                </p>
              ) : null}
              {searching && !results.dwarves.length && !results.legends.length ? (
                <p className="px-3 py-4 text-center text-sm text-muted-foreground">Searching…</p>
              ) : null}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  )
}
