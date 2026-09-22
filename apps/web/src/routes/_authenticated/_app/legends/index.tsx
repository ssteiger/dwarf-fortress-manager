import { LEGENDS_KINDS } from '@fortress/db-drizzle/fortress-types'
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@fortress/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { formatDistanceToNow } from 'date-fns'
import { BookOpenIcon } from 'lucide-react'
import * as React from 'react'

import { formatNumber, humanize } from '~/lib/fortress/format'
import { useFortOverview } from '~/lib/fortress/queries'
import { titleCase } from '~/lib/legends/events'
import { getLegendsOverview, searchLegends } from '~/lib/legends/server'
import { EmptyState, PageHeader } from '../fortress/-components/fort-chrome'

const ALL_KINDS = '__all__'
const SEARCH_KINDS = [
  'historical_figure',
  'site',
  'entity',
  'artifact',
  'region',
  'written_content',
  'historical_event_collection',
]

function LegendsPage() {
  const overview = useFortOverview()
  const legends = useQuery({
    queryKey: ['legends', 'overview'],
    queryFn: () => getLegendsOverview(),
    refetchInterval: 30_000,
  })
  const worlds = legends.data?.worlds ?? []
  const liveWorldName = legends.data?.liveWorldName ?? overview.data?.state?.world_name ?? null

  const [worldId, setWorldId] = React.useState<number | null>(null)
  const selectedWorld =
    worlds.find((w) => w.id === worldId) ??
    worlds.find((w) => w.name && w.name === liveWorldName) ??
    worlds[0] ??
    null

  const [search, setSearch] = React.useState('')
  const [kind, setKind] = React.useState<string>('historical_figure')
  const [q, setQ] = React.useState('')
  React.useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 250)
    return () => clearTimeout(id)
  }, [search])

  const results = useQuery({
    queryKey: ['legends', 'search', selectedWorld?.id, q, kind],
    queryFn: () =>
      searchLegends({
        data: {
          worldId: selectedWorld?.id ?? -1,
          q,
          kind: kind === ALL_KINDS ? undefined : kind,
          limit: 200,
        },
      }),
    enabled: !!selectedWorld,
    placeholderData: keepPreviousData,
  })

  const counts = selectedWorld?.record_counts ?? {}
  const matchesLive = !!selectedWorld?.name && selectedWorld.name === liveWorldName

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        eyebrow="Legends"
        title={selectedWorld ? (selectedWorld.name ?? selectedWorld.key) : 'Legends'}
        description={
          selectedWorld ? (
            <>
              {selectedWorld.alt_name ? `${selectedWorld.alt_name} · ` : ''}
              imported{' '}
              {formatDistanceToNow(new Date(selectedWorld.imported_at), { addSuffix: true })}
              {matchesLive ? (
                <Badge className="ml-2" variant="secondary">
                  this is the world you are playing
                </Badge>
              ) : liveWorldName ? (
                <span className="ml-2 text-muted-foreground/80">
                  (your running fort is in {liveWorldName})
                </span>
              ) : null}
            </>
          ) : (
            'The history of a generated world, imported from a legends export.'
          )
        }
        actions={
          worlds.length > 1 ? (
            <Select
              value={String(selectedWorld?.id ?? '')}
              onValueChange={(v) => setWorldId(Number(v))}
            >
              <SelectTrigger className="h-9 w-[220px]">
                <SelectValue placeholder="World" />
              </SelectTrigger>
              <SelectContent>
                {worlds.map((w) => (
                  <SelectItem key={w.id} value={String(w.id)}>
                    {w.name ?? w.key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null
        }
      />

      {!selectedWorld ? (
        <EmptyState title="No legends imported yet">
          Export legends from the game (Legends mode, or DFHack's <code>exportlegends</code>) into
          the Dwarf Fortress folder. The worker picks up <code>*-legends.xml</code> and{' '}
          <code>*-legends_plus.xml</code> on its next start.
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              'historical_figure',
              'historical_event',
              'site',
              'entity',
              'artifact',
              'written_content',
            ].map((k) => (
              <button
                type="button"
                key={k}
                onClick={() => (k === 'historical_event' ? undefined : setKind(k))}
                className={cn(
                  'rounded-xl border bg-card p-3 text-left shadow-sm transition-colors',
                  k !== 'historical_event' && 'hover:bg-accent',
                  kind === k && 'border-primary',
                )}
              >
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {humanize(k)}s
                </div>
                <div className="text-xl font-semibold tabular-nums">{formatNumber(counts[k])}</div>
              </button>
            ))}
          </div>

          <Card className="overflow-hidden p-0">
            <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center">
              <Input
                placeholder="Search names…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 w-full sm:w-80"
                autoFocus
              />
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger className="h-9 w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_KINDS}>Everything with a name</SelectItem>
                  {[...SEARCH_KINDS, ...LEGENDS_KINDS.filter((k) => !SEARCH_KINDS.includes(k))].map(
                    (k) => (
                      <SelectItem key={k} value={k}>
                        {humanize(k)}s {counts[k] ? `(${formatNumber(counts[k])})` : ''}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">
                {results.data ? `${results.data.length} shown` : ''}
              </span>
            </div>
            {results.data && results.data.length === 0 ? (
              <div className="p-6">
                <EmptyState title="Nothing found">
                  Try a different spelling, or another kind of record.
                </EmptyState>
              </div>
            ) : (
              <ul className="divide-y">
                {(results.data ?? []).map((hit) => (
                  <li key={`${hit.kind}-${hit.id}`}>
                    <Link
                      to="/legends/$kind/$id"
                      params={{ kind: hit.kind, id: String(hit.id) }}
                      search={{ world: selectedWorld.id }}
                      className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-accent"
                    >
                      <BookOpenIcon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="font-medium">{titleCase(hit.name ?? `#${hit.id}`)}</span>
                      <span className="text-muted-foreground">
                        {humanize(hit.kind)}
                        {hit.type ? ` · ${hit.type.replace(/_/g, ' ')}` : ''}
                        {hit.year !== null && hit.year >= 0 ? ` · ${hit.year}` : ''}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">What was imported</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {Object.entries(counts)
                .sort((a, b) => b[1] - a[1])
                .map(([k, n]) => (
                  <Badge key={k} variant="outline" className="gap-1.5">
                    {humanize(k)}{' '}
                    <span className="tabular-nums text-muted-foreground">{formatNumber(n)}</span>
                  </Badge>
                ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/_app/legends/')({
  component: LegendsPage,
})
