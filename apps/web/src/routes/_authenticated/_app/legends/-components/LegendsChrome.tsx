import type { LegendsRecord, LegendsWorld } from '@fortress/db-drizzle'
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  cn,
} from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { formatDistanceToNow } from 'date-fns'
import { ChevronRightIcon, GlobeIcon, HourglassIcon, LibraryIcon } from 'lucide-react'
import type * as React from 'react'

import { LegendsSprite } from '~/lib/df-assets/legends'
import { formatNumber } from '~/lib/fortress/format'
import { useFortOverview } from '~/lib/fortress/queries'
import {
  type Fragment,
  describeEvent,
  eventCategory,
  legendsDate,
  plusOf,
} from '~/lib/legends/events'
import { cleanName, kindLabel, kindPlural, titleCase, words } from '~/lib/legends/model'
import {
  type LegendsHit,
  type LegendsWorldSummary,
  type NameIndex,
  getLegendsOverview,
  getLegendsWorldSummary,
} from '~/lib/legends/server'
import { EmptyState, PageHeader } from '../../fortress/-components/FortChrome'

/** Every legends page shares the list of imported worlds. */
export function useLegendsWorlds() {
  return useQuery({
    queryKey: ['legends', 'overview'],
    queryFn: () => getLegendsOverview(),
    staleTime: 60_000,
  })
}

export function parseWorldParam(raw: unknown): number | undefined {
  const world =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(world) ? world : undefined
}

export function parseWorldSearch(raw: Record<string, unknown>): { world?: number } {
  const world = parseWorldParam(raw.world)
  return world !== undefined ? { world } : {}
}

export type LegendsSection = 'world' | 'history' | 'archive'

const SECTION_LINKS = [
  { key: 'world' as const, label: 'The world', to: '/legends/world', icon: GlobeIcon },
  { key: 'history' as const, label: 'History', to: '/legends/history', icon: HourglassIcon },
  { key: 'archive' as const, label: 'Archive', to: '/legends/archive', icon: LibraryIcon },
]

export function useSelectedWorld(requestedId?: number) {
  const overview = useFortOverview()
  const legends = useLegendsWorlds()
  const worlds = legends.data?.worlds ?? []
  const liveWorldName = legends.data?.liveWorldName ?? overview.data?.state?.world_name ?? null
  const selectedWorld =
    worlds.find((w) => w.id === requestedId) ??
    worlds.find((w) => w.name && w.name === liveWorldName) ??
    worlds[0] ??
    null
  return {
    legends,
    worlds,
    selectedWorld,
    worldId: selectedWorld?.id ?? null,
    liveWorldName,
    matchesLive: !!selectedWorld?.name && selectedWorld.name === liveWorldName,
  }
}

export function LegendsShell({
  section,
  world: requestedWorld,
  children,
}: {
  section: LegendsSection
  world?: number
  children: (ctx: {
    worldId: number
    selectedWorld: LegendsWorld
    counts: Record<string, number>
    summary: LegendsWorldSummary | undefined
    summaryLoading: boolean
  }) => React.ReactNode
}) {
  const navigate = useNavigate()
  const { legends, worlds, selectedWorld, worldId, liveWorldName, matchesLive } =
    useSelectedWorld(requestedWorld)
  const counts = selectedWorld?.record_counts ?? {}
  const totalRecords = Object.values(counts).reduce((a, b) => a + b, 0)

  const summary = useQuery({
    queryKey: ['legends', 'summary', worldId],
    queryFn: () => getLegendsWorldSummary({ data: { worldId: worldId ?? -1 } }),
    enabled: worldId !== null,
    staleTime: 5 * 60_000,
  })
  const years = summary.data?.years ?? null

  const setWorld = (id: number) => navigate({ to: '.', search: (prev) => ({ ...prev, world: id }) })

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        eyebrow="Legends"
        title={selectedWorld ? titleCase(selectedWorld.name ?? selectedWorld.key) : 'Legends'}
        description={
          selectedWorld ? (
            <>
              {selectedWorld.alt_name ? (
                <span className="text-foreground">{selectedWorld.alt_name}</span>
              ) : null}
              {selectedWorld.alt_name ? ' · ' : ''}
              {years
                ? `${(years.max - years.min + 1).toLocaleString()} years of history`
                : 'history'}{' '}
              in {formatNumber(totalRecords)} records, imported{' '}
              {formatDistanceToNow(new Date(selectedWorld.imported_at), { addSuffix: true })}
              {matchesLive ? (
                <Badge className="ml-2" variant="secondary">
                  the world you are playing
                </Badge>
              ) : liveWorldName ? (
                <span className="ml-2 text-muted-foreground">
                  (your fortress is in {liveWorldName})
                </span>
              ) : null}
            </>
          ) : (
            'The history of a generated world, imported from a legends export.'
          )
        }
        actions={
          worlds.length > 1 ? (
            <Select value={String(worldId ?? '')} onValueChange={(v) => setWorld(Number(v))}>
              <SelectTrigger className="h-9 w-[220px]">
                <SelectValue placeholder="World" />
              </SelectTrigger>
              <SelectContent>
                {worlds.map((w) => (
                  <SelectItem key={w.id} value={String(w.id)}>
                    {titleCase(w.name ?? w.key)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null
        }
      />

      {!selectedWorld || worldId === null ? (
        legends.isLoading ? null : (
          <EmptyState title="No legends imported yet">
            Export legends from the game (Legends mode, or DFHack's <code>exportlegends</code>) into
            the Dwarf Fortress folder. The worker picks up <code>*-legends.xml</code> and{' '}
            <code>*-legends_plus.xml</code> on its next start.
          </EmptyState>
        )
      ) : (
        <>
          <nav
            aria-label="Legends sections"
            className="bg-muted text-muted-foreground inline-flex h-10 w-fit items-center justify-center rounded-lg p-[3px]"
          >
            {SECTION_LINKS.map((item) => {
              const Icon = item.icon
              const active = item.key === section
              return (
                <Link
                  key={item.key}
                  to={item.to}
                  search={{ world: worldId }}
                  className={cn(
                    "inline-flex h-[calc(100%-1px)] items-center justify-center gap-2 rounded-md border border-transparent px-4 text-sm font-medium whitespace-nowrap text-foreground transition-[color,box-shadow] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
                    active && 'bg-background shadow-sm dark:border-input dark:bg-input/30',
                  )}
                >
                  <Icon /> {item.label}
                </Link>
              )
            })}
          </nav>
          {children({
            worldId,
            selectedWorld,
            counts,
            summary: summary.data,
            summaryLoading: summary.isLoading,
          })}
        </>
      )}
    </div>
  )
}

/** Display name for any record, falling back to "an unnamed dragon". */
export function recordName(hit: Pick<LegendsHit, 'kind' | 'id' | 'name' | 'type'>): string {
  const clean = cleanName(hit.name)
  if (clean) return titleCase(clean)
  if (hit.kind === 'historical_figure' && hit.type) return `An unnamed ${words(hit.type)}`
  return `${kindLabel(hit.kind)} #${hit.id}`
}

export function RecordLink({
  kind,
  id,
  name,
  type,
  worldId,
  className,
  children,
}: {
  kind: string
  id: number
  name?: string | null
  type?: string | null
  worldId: number | null
  className?: string
  children?: React.ReactNode
}) {
  return (
    <Link
      to="/legends/$kind/$id"
      params={{ kind, id: String(id) }}
      search={{ world: worldId ?? undefined }}
      className={cn('font-medium text-primary underline-offset-4 hover:underline', className)}
    >
      {children ?? recordName({ kind, id, name: name ?? null, type: type ?? null })}
    </Link>
  )
}

/** Link to a record by id when its name is in the index, plain text otherwise. */
export function NamedRef({
  kind,
  id,
  names,
  worldId,
  fallback,
}: {
  kind: string
  id: number | null | undefined
  names: NameIndex
  worldId: number | null
  fallback?: string
}) {
  if (id === null || id === undefined || id < 0)
    return <span className="text-muted-foreground">{fallback ?? 'none'}</span>
  const name = names[kind]?.[id]
  return <RecordLink kind={kind} id={id} name={name ?? null} worldId={worldId} />
}

export function Breadcrumbs({
  items,
}: {
  items: { label: string; to?: string; search?: Record<string, unknown> }[]
}) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground"
    >
      {items.map((item, i) => (
        <span key={`${item.label}-${i}`} className="flex items-center gap-1">
          {i > 0 ? <ChevronRightIcon className="size-3.5" /> : null}
          {item.to ? (
            <Link
              to={item.to}
              search={item.search}
              className="hover:text-foreground hover:underline"
            >
              {item.label}
            </Link>
          ) : (
            <span className="text-foreground">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

export function Section({
  title,
  count,
  description,
  action,
  children,
  className,
  collapsed = false,
}: {
  title: React.ReactNode
  count?: number | null
  description?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  /** Start closed. The title is the disclosure control; the body uses the same card. */
  collapsed?: boolean
}) {
  const heading = (
    <div>
      <CardTitle className="flex items-center gap-2 text-base">
        {collapsed ? (
          <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
        ) : null}
        {title}
        {typeof count === 'number' ? (
          <Badge variant="secondary" className="tabular-nums">
            {count.toLocaleString()}
          </Badge>
        ) : null}
      </CardTitle>
      {description ? (
        <p className="mt-1 text-sm font-normal text-muted-foreground">{description}</p>
      ) : null}
    </div>
  )
  if (collapsed) {
    return (
      <Card className={cn('gap-0 py-0', className)}>
        <details className="group">
          <summary className="cursor-pointer select-none list-none px-5 py-4 font-normal [&::-webkit-details-marker]:hidden">
            <div className="flex items-start justify-between gap-3">
              {heading}
              {action}
            </div>
          </summary>
          <CardContent className="border-t px-5 py-4">{children}</CardContent>
        </details>
      </Card>
    )
  }
  return (
    <Card className={cn('gap-4 py-5', className)}>
      <CardHeader className="px-5">
        <div className="flex items-start justify-between gap-3">
          {heading}
          {action}
        </div>
      </CardHeader>
      <CardContent className="px-5">{children}</CardContent>
    </Card>
  )
}

/** A key/value grid for a handful of facts. */
export function Facts({
  items,
  className,
}: {
  items: { label: string; value: React.ReactNode }[]
  className?: string
}) {
  const shown = items.filter(
    (item) => item.value !== null && item.value !== undefined && item.value !== '',
  )
  if (!shown.length) return null
  return (
    <dl
      className={cn('grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-base', className)}
    >
      {shown.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** A list of records with their one-line context. */
export function HitRows({
  hits,
  worldId,
  total,
  emptyText = 'Nothing recorded.',
  showKind = false,
  years = false,
}: {
  hits: LegendsHit[]
  worldId: number | null
  total?: number
  emptyText?: string
  showKind?: boolean
  years?: boolean
}) {
  if (!hits.length) return <p className="text-sm text-muted-foreground">{emptyText}</p>
  return (
    <ul className="divide-y">
      {hits.map((hit) => (
        <li
          key={`${hit.kind}-${hit.id}`}
          className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2"
        >
          <LegendsSprite subject={hit} size={24} className="-my-1" />
          <RecordLink
            kind={hit.kind}
            id={hit.id}
            name={hit.name}
            type={hit.type}
            worldId={worldId}
          />
          {showKind ? <Badge variant="outline">{kindLabel(hit.kind)}</Badge> : null}
          {hit.type && hit.kind !== 'historical_figure' ? (
            <span className="text-sm text-muted-foreground">{words(hit.type)}</span>
          ) : null}
          {years && hit.year !== null && hit.year >= 0 ? (
            <span className="text-sm text-muted-foreground tabular-nums">
              {hit.endYear !== null && hit.endYear !== undefined && hit.endYear !== hit.year
                ? `${hit.year}–${hit.endYear}`
                : hit.year}
            </span>
          ) : null}
          {hit.detail ? <span className="text-sm text-muted-foreground">{hit.detail}</span> : null}
        </li>
      ))}
      {typeof total === 'number' && total > hits.length ? (
        <li className="py-2 text-sm text-muted-foreground">
          and {(total - hits.length).toLocaleString()} more
        </li>
      ) : null}
    </ul>
  )
}

export function Fragments({
  fragments,
  worldId,
}: { fragments: Fragment[]; worldId: number | null }) {
  return (
    <>
      {fragments.map((f, i) =>
        'link' in f ? (
          <RecordLink
            // biome-ignore lint/suspicious/noArrayIndexKey: fragments are positional
            key={i}
            kind={f.link.kind}
            id={f.link.id}
            worldId={worldId}
          >
            {f.text}
          </RecordLink>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: fragments are positional
          <span key={i}>{f.text}</span>
        ),
      )}
    </>
  )
}

const CATEGORY_DOT: Record<string, string> = {
  war: 'bg-red-500',
  death: 'bg-stone-500',
  life: 'bg-emerald-500',
  power: 'bg-amber-500',
  culture: 'bg-sky-500',
  intrigue: 'bg-purple-500',
}

/** One event as a sentence, with its date and category mark. */
export function EventLine({
  event,
  names,
  worldId,
  showDate = true,
}: {
  event: LegendsRecord
  names: NameIndex
  worldId: number | null
  showDate?: boolean
}) {
  const p = event.payload
  const plus = plusOf(p)
  const type =
    typeof p.type === 'string' ? p.type : typeof plus.type === 'string' ? plus.type : null
  const category = eventCategory(type)
  const described = describeEvent(event, names)
  const year = typeof p.year === 'number' ? p.year : null
  const seconds = typeof p.seconds72 === 'number' ? p.seconds72 : null
  return (
    <li className="grid grid-cols-[minmax(6.5rem,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 py-1.5">
      <span className="pt-0.5 text-sm text-muted-foreground tabular-nums">
        {showDate ? legendsDate(year, seconds) : ''}
      </span>
      <span className="flex items-baseline gap-2">
        <span
          className={cn(
            'mt-2 inline-block size-2 shrink-0 rounded-full',
            CATEGORY_DOT[category?.key ?? ''] ?? 'bg-border',
          )}
          title={category?.label ?? (type ? words(type) : 'event')}
        />
        <span className={cn('leading-relaxed', !described.known && 'text-muted-foreground')}>
          <Fragments fragments={described.fragments} worldId={worldId} />
        </span>
      </span>
    </li>
  )
}

export function KindBadge({ kind }: { kind: string }) {
  return <Badge variant="outline">{kindLabel(kind)}</Badge>
}

export { kindLabel, kindPlural }
