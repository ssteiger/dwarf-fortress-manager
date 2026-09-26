import {
  Button,
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
  Popover,
  PopoverContent,
  PopoverTrigger,
  cn,
} from '@fortress/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ChevronsUpDownIcon, SearchIcon, XIcon } from 'lucide-react'
import * as React from 'react'

import { LegendsSprite } from '~/lib/df-assets/legends'
import { quickSearch } from '~/lib/legends/chronicle'
import { kindLabel, kindPlural } from '~/lib/legends/model'
import type { LegendsHit } from '~/lib/legends/server'
import { recordName } from './LegendsChrome'

function useDebounced<T>(value: T, ms: number): T {
  const [state, setState] = React.useState(value)
  React.useEffect(() => {
    const t = setTimeout(() => setState(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return state
}

function useQuickResults(worldId: number, q: string, kinds?: string[]) {
  const debounced = useDebounced(q.trim(), 180)
  return useQuery({
    queryKey: ['legends', 'quick', worldId, debounced, kinds ?? null],
    queryFn: () => quickSearch({ data: { worldId, q: debounced, kinds, limit: 14 } }),
    enabled: debounced.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  })
}

/** Results grouped by kind, in the order the server ranked them. */
function groupHits(hits: LegendsHit[]) {
  const groups = new Map<string, LegendsHit[]>()
  for (const hit of hits) {
    const list = groups.get(hit.kind) ?? []
    list.push(hit)
    groups.set(hit.kind, list)
  }
  return [...groups.entries()]
}

function HitRow({ hit }: { hit: LegendsHit }) {
  return (
    <>
      <LegendsSprite subject={hit} size={24} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        {recordName(hit)}
        {hit.detail ? (
          <span className="ml-2 text-xs text-muted-foreground">{hit.detail}</span>
        ) : null}
      </span>
      {hit.year !== null ? (
        <span className="text-xs tabular-nums text-muted-foreground">{hit.year}</span>
      ) : null}
    </>
  )
}

/**
 * Jump to any named record from anywhere in the legends pages. Opens with
 * ⌘K / Ctrl+K; typing two letters searches names across every kind.
 */
export function QuickSearch({ worldId }: { worldId: number }) {
  const navigate = useNavigate()
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState('')
  const results = useQuickResults(worldId, q)

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const go = (hit: LegendsHit) => {
    setOpen(false)
    navigate({
      to: '/legends/$kind/$id',
      params: { kind: hit.kind, id: String(hit.id) },
      search: { world: worldId },
    })
  }
  const browse = () => {
    setOpen(false)
    navigate({ to: '/legends/archive', search: { world: worldId, archive: 'all', q: q.trim() } })
  }

  const hits = results.data ?? []
  const typed = q.trim().length >= 2
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-10 gap-2 text-muted-foreground sm:w-64 sm:justify-start"
        onClick={() => setOpen(true)}
        aria-label="Search records"
      >
        <SearchIcon className="size-4" />
        <span className="hidden flex-1 text-left sm:inline">Find anyone or anywhere…</span>
        <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[10px] sm:inline">
          ⌘K
        </kbd>
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setQ('')
        }}
      >
        <DialogContent className="overflow-hidden p-0 sm:max-w-xl">
          <DialogHeader className="sr-only">
            <DialogTitle>Find a record</DialogTitle>
            <DialogDescription>
              Search figures, sites, civilizations, artifacts and more by name.
            </DialogDescription>
          </DialogHeader>
          <Command
            shouldFilter={false}
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2.5"
          >
            <CommandInput
              placeholder="A name, or part of one…"
              value={q}
              onValueChange={setQ}
              aria-label="Search records"
            />
            <CommandList>
              {!typed ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Type at least two letters. Figures, sites, civilizations, artifacts, wars, regions
                  and writings all answer.
                </p>
              ) : results.isLoading ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">Searching…</p>
              ) : (
                <>
                  <CommandEmpty>Nothing by that name.</CommandEmpty>
                  {groupHits(hits).map(([kind, list]) => (
                    <CommandGroup key={kind} heading={kindPlural(kind)}>
                      {list.map((hit) => (
                        <CommandItem
                          key={`${hit.kind}-${hit.id}`}
                          value={`${hit.kind}-${hit.id}`}
                          onSelect={() => go(hit)}
                          className="gap-2"
                        >
                          <HitRow hit={hit} />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
                  <CommandGroup heading="More">
                    <CommandItem value="__browse" onSelect={browse} className="gap-2">
                      <SearchIcon className="size-4 text-muted-foreground" />
                      Browse the whole archive for “{q.trim()}”
                    </CommandItem>
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** A named record chosen in a filter. */
export interface PickedRecord {
  kind: string
  id: number
  name: string | null
  type?: string | null
}

/**
 * Pick one record of the given kinds by name, for "involving…" filters.
 * Shows the current pick with a clear button.
 */
export function RecordPicker({
  worldId,
  kinds,
  value,
  onChange,
  placeholder,
  className,
}: {
  worldId: number
  kinds: string[]
  value: PickedRecord | null
  onChange: (next: PickedRecord | null) => void
  placeholder: string
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState('')
  const results = useQuickResults(worldId, q, kinds)
  const hits = results.data ?? []
  const label = value
    ? recordName({ kind: value.kind, id: value.id, name: value.name, type: value.type ?? null })
    : null
  return (
    <div className={cn('flex items-center', className)}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setQ('')
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-expanded={open}
            aria-haspopup="listbox"
            className={cn(
              'h-9 max-w-64 justify-between gap-2 font-normal',
              value ? 'rounded-r-none border-r-0 text-foreground' : 'text-muted-foreground',
            )}
          >
            <span className="truncate">{label ?? placeholder}</span>
            <ChevronsUpDownIcon className="size-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={placeholder}
              value={q}
              onValueChange={setQ}
              aria-label={placeholder}
            />
            <CommandList>
              {q.trim().length < 2 ? (
                <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                  Type at least two letters.
                </p>
              ) : results.isLoading ? (
                <p className="px-3 py-4 text-center text-sm text-muted-foreground">Searching…</p>
              ) : (
                <>
                  <CommandEmpty>Nothing by that name.</CommandEmpty>
                  <CommandGroup>
                    {hits.map((hit) => (
                      <CommandItem
                        key={`${hit.kind}-${hit.id}`}
                        value={`${hit.kind}-${hit.id}`}
                        onSelect={() => {
                          onChange({ kind: hit.kind, id: hit.id, name: hit.name, type: hit.type })
                          setOpen(false)
                          setQ('')
                        }}
                        className="gap-2"
                      >
                        <HitRow hit={hit} />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value ? (
        <Button
          variant="outline"
          size="icon"
          className="size-9 rounded-l-none"
          onClick={() => onChange(null)}
          aria-label={`Clear ${kindLabel(value.kind).toLowerCase()} filter`}
        >
          <XIcon className="size-3.5" />
        </Button>
      ) : null}
    </div>
  )
}
