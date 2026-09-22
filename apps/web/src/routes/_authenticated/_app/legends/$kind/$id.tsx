import type { JsonObject, LegendsPayload, LegendsRecord } from '@fortress/db-drizzle'
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton, cn } from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'
import * as React from 'react'

import { humanize } from '~/lib/fortress/format'
import { type Fragment, describeEvent, legendsDate, titleCase } from '~/lib/legends/events'
import { type NameIndex, getLegendsOverview, getLegendsRecord } from '~/lib/legends/server'
import { EmptyState, PageHeader } from '../../fortress/-components/fort-chrome'

/** Payload keys that are shown in the header or are noise in the fact list. */
const HIDDEN_KEYS = new Set(['id', 'name', 'plus', 'type', 'event'])

/** Fields that are ids of other records: key pattern -> kind. */
const ID_KINDS: [RegExp, string][] = [
  [/civ|entity|enid|(^|_)en$/i, 'entity'],
  [/site/i, 'site'],
  [/artifact/i, 'artifact'],
  [/wc_id|written_content/i, 'written_content'],
  [/subregion|region/i, 'region'],
  [
    /hfid|hist_?fig|histfig|(^|_)hf$|^hf_|^(target|doer|victim|slayer|woundee|wounder|eater|group|creator|builder|appointer|leader|ruler)$/i,
    'historical_figure',
  ],
]

function kindForKey(key: string): string | null {
  for (const [re, kind] of ID_KINDS) if (re.test(key)) return kind
  return null
}

function RecordPage() {
  const { kind, id } = Route.useParams()
  const { world } = Route.useSearch()
  const legends = useQuery({
    queryKey: ['legends', 'overview'],
    queryFn: () => getLegendsOverview(),
    staleTime: 60_000,
  })
  const worldId = world ?? legends.data?.worlds[0]?.id ?? null
  const numericId = Number.parseInt(id, 10)

  const detail = useQuery({
    queryKey: ['legends', 'record', worldId, kind, numericId],
    queryFn: () => getLegendsRecord({ data: { worldId: worldId ?? -1, kind, id: numericId } }),
    enabled: worldId !== null && Number.isFinite(numericId),
  })

  const record = detail.data?.record ?? null
  const names = detail.data?.names ?? {}
  const payload = (record?.payload ?? {}) as LegendsPayload
  const plus = (
    payload.plus && typeof payload.plus === 'object' && !Array.isArray(payload.plus)
      ? payload.plus
      : {}
  ) as JsonObject

  const title = record?.name ? titleCase(record.name) : `${humanize(kind)} #${id}`
  const subtitle = describeRecord(kind, payload, plus)

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <div>
        <Link
          to="/legends"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          <ArrowLeftIcon className="size-3" /> Back to legends
        </Link>
      </div>
      <PageHeader eyebrow={humanize(kind)} title={title} description={subtitle} />

      {detail.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40 lg:col-span-2" />
        </div>
      ) : !record ? (
        <EmptyState title="Not in the archive">
          There is no {humanize(kind).toLowerCase()} with id {id} in this legends export.
        </EmptyState>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Facts</CardTitle>
              </CardHeader>
              <CardContent>
                <FactList payload={payload} names={names} worldId={worldId} />
              </CardContent>
            </Card>
            {Object.keys(plus).length ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">More detail</CardTitle>
                </CardHeader>
                <CardContent>
                  <FactList payload={plus} names={names} worldId={worldId} compact />
                </CardContent>
              </Card>
            ) : null}
          </div>

          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                History
                {detail.data ? (
                  <Badge variant="outline">
                    {detail.data.eventsTotal.toLocaleString()} event
                    {detail.data.eventsTotal === 1 ? '' : 's'}
                    {detail.data.events.length < detail.data.eventsTotal
                      ? `, first ${detail.data.events.length} shown`
                      : ''}
                  </Badge>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {detail.data?.events.length ? (
                <Timeline events={detail.data.events} names={names} worldId={worldId} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  No recorded events mention this {humanize(kind).toLowerCase()}.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

function describeRecord(kind: string, p: LegendsPayload, plus: JsonObject): string {
  const parts: string[] = []
  if (kind === 'historical_figure') {
    const race = typeof p.race === 'string' ? p.race.toLowerCase().replace(/_/g, ' ') : null
    const caste = typeof p.caste === 'string' ? p.caste.toLowerCase() : null
    if (race) parts.push(`${caste && caste !== 'default' ? `${caste} ` : ''}${race}`)
    const birth = typeof p.birth_year === 'number' ? p.birth_year : null
    const death = typeof p.death_year === 'number' ? p.death_year : null
    if (birth !== null && birth >= 0) parts.push(`born ${birth}`)
    if (death !== null && death >= 0) parts.push(`died ${death}`)
    else if (birth !== null) parts.push('still alive at export')
    if (p.deity === true) parts.push('deity')
    if (p.force === true) parts.push('force of nature')
    if (typeof p.associated_type === 'string' && p.associated_type !== 'STANDARD')
      parts.push(p.associated_type.toLowerCase().replace(/_/g, ' '))
    return parts.join(' · ')
  }
  if (typeof p.type === 'string') parts.push(p.type.replace(/_/g, ' '))
  if (typeof plus.race === 'string') parts.push(String(plus.race))
  if (typeof p.coords === 'string') parts.push(`at ${p.coords}`)
  if (typeof p.start_year === 'number' && p.start_year >= 0)
    parts.push(
      `${p.start_year}${typeof p.end_year === 'number' && p.end_year !== p.start_year ? `–${p.end_year}` : ''}`,
    )
  if (typeof p.year === 'number')
    parts.push(legendsDate(p.year, typeof p.seconds72 === 'number' ? p.seconds72 : null))
  return parts.join(' · ')
}

function RefLink({
  kind,
  id,
  names,
  worldId,
}: { kind: string; id: number; names: NameIndex; worldId: number | null }) {
  const name = names[kind]?.[id]
  return (
    <Link
      to="/legends/$kind/$id"
      params={{ kind, id: String(id) }}
      search={{ world: worldId ?? undefined }}
      className="text-primary underline-offset-4 hover:underline"
    >
      {name ? titleCase(name) : `${humanize(kind)} #${id}`}
    </Link>
  )
}

function FactValue({
  keyName,
  value,
  names,
  worldId,
}: { keyName: string; value: unknown; names: NameIndex; worldId: number | null }) {
  if (value === true) return <span>yes</span>
  if (value === null || value === undefined || value === '')
    return <span className="text-muted-foreground">—</span>
  if (typeof value === 'number') {
    const kind = kindForKey(keyName)
    if (kind && value >= 0)
      return <RefLink kind={kind} id={value} names={names} worldId={worldId} />
    if (value < 0 && kind) return <span className="text-muted-foreground">none</span>
    return <span className="tabular-nums">{value.toLocaleString()}</span>
  }
  if (typeof value === 'string') return <span>{value.replace(/_/g, ' ')}</span>
  if (Array.isArray(value)) {
    return (
      <ul className="flex flex-col gap-1">
        {value.slice(0, 60).map((entry, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: entries have no stable identity
          <li key={i}>
            {typeof entry === 'object' && entry !== null ? (
              <span className="text-sm">
                {Object.entries(entry as Record<string, unknown>).map(([k, v], j) => (
                  <span key={k}>
                    {j > 0 ? ' · ' : ''}
                    <span className="text-muted-foreground">{k.replace(/_/g, ' ')} </span>
                    <FactValue keyName={k} value={v} names={names} worldId={worldId} />
                  </span>
                ))}
              </span>
            ) : (
              <FactValue
                keyName={keyName.replace(/s$/, '')}
                value={entry}
                names={names}
                worldId={worldId}
              />
            )}
          </li>
        ))}
        {value.length > 60 ? (
          <li className="text-xs text-muted-foreground">+{value.length - 60} more</li>
        ) : null}
      </ul>
    )
  }
  if (typeof value === 'object') {
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className="text-muted-foreground">{k.replace(/_/g, ' ')}</dt>
            <dd>
              <FactValue keyName={k} value={v} names={names} worldId={worldId} />
            </dd>
          </React.Fragment>
        ))}
      </dl>
    )
  }
  return <span>{String(value)}</span>
}

function FactList({
  payload,
  names,
  worldId,
  compact,
}: {
  payload: JsonObject
  names: NameIndex
  worldId: number | null
  compact?: boolean
}) {
  const entries = Object.entries(payload).filter(([k]) => !HIDDEN_KEYS.has(k))
  if (entries.length === 0)
    return <p className="text-sm text-muted-foreground">Nothing more is recorded.</p>
  return (
    <dl className={cn('grid gap-x-4 gap-y-2 text-sm', compact ? 'grid-cols-1' : 'grid-cols-1')}>
      {entries.map(([key, value]) => (
        <div key={key} className="grid grid-cols-[120px_1fr] gap-2 border-b pb-2 last:border-0">
          <dt className="text-muted-foreground">{key.replace(/_/g, ' ')}</dt>
          <dd className="min-w-0 break-words">
            <FactValue keyName={key} value={value} names={names} worldId={worldId} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

function Fragments({ fragments, worldId }: { fragments: Fragment[]; worldId: number | null }) {
  return (
    <>
      {fragments.map((f, i) =>
        'link' in f ? (
          <Link
            // biome-ignore lint/suspicious/noArrayIndexKey: fragments are positional
            key={i}
            to="/legends/$kind/$id"
            params={{ kind: f.link.kind, id: String(f.link.id) }}
            search={{ world: worldId ?? undefined }}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {f.text}
          </Link>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: fragments are positional
          <span key={i}>{f.text}</span>
        ),
      )}
    </>
  )
}

function Timeline({
  events,
  names,
  worldId,
}: { events: LegendsRecord[]; names: NameIndex; worldId: number | null }) {
  let lastYear: number | null = null
  return (
    <ol className="flex flex-col gap-1.5 text-sm">
      {events.map((event) => {
        const p = event.payload as LegendsPayload
        const year = typeof p.year === 'number' ? p.year : null
        const showYear = year !== lastYear
        lastYear = year
        const described = describeEvent(event, names)
        return (
          <li key={event.id} className="grid grid-cols-[110px_1fr] gap-3">
            <span className="text-xs text-muted-foreground tabular-nums">
              {showYear
                ? legendsDate(year, typeof p.seconds72 === 'number' ? p.seconds72 : null)
                : ''}
            </span>
            <span className={cn(!described.known && 'text-muted-foreground')}>
              <Fragments fragments={described.fragments} worldId={worldId} />
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export const Route = createFileRoute('/_authenticated/_app/legends/$kind/$id')({
  validateSearch: (search: Record<string, unknown>): { world?: number } => {
    const raw = search.world
    const world =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
          ? Number.parseInt(raw, 10)
          : Number.NaN
    return Number.isFinite(world) ? { world } : {}
  },
  component: RecordPage,
})
