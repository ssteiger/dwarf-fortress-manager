import type { LegendsPayload } from '@fortress/db-drizzle'
import { Badge, Skeleton } from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { LegendsSprite } from '~/lib/df-assets/legends'
import { plusOf, str } from '~/lib/legends/events'
import {
  browseTabForKind,
  kindLabel,
  kindPlural,
  raceToken,
  titleCase,
  words,
} from '~/lib/legends/model'
import { getLegendsMap, getLegendsRecord } from '~/lib/legends/server'
import {
  Breadcrumbs,
  parseWorldSearch,
  recordName,
  useLegendsWorlds,
} from '../-components/LegendsChrome'
import { RawFacts } from '../-components/RawFacts'
import {
  ArtifactSections,
  CollectionSections,
  EntitySections,
  FigureSections,
  PlaceSections,
  ProseSections,
  RegionSections,
  type SectionProps,
  SiteSections,
  WrittenSections,
  describeRecord,
} from '../-components/RecordSections'
import { Timeline } from '../-components/Timeline'
import { EmptyState, PageHeader } from '../../fortress/-components/FortChrome'

/** Kinds whose page shows the world map. */
const MAP_KINDS = new Set([
  'site',
  'entity',
  'region',
  'underground_region',
  'mountain_peak',
  'river',
  'landmass',
  'historical_event_collection',
])

/** Kinds with a history of their own. */
const TIMELINE_KINDS = new Set([
  'historical_figure',
  'site',
  'entity',
  'artifact',
  'region',
  'written_content',
  'historical_event_collection',
  'poetic_form',
  'musical_form',
  'dance_form',
])

function RecordPage() {
  const { kind, id } = Route.useParams()
  const { world } = Route.useSearch()
  const legends = useLegendsWorlds()
  const worlds = legends.data?.worlds ?? []
  const selectedWorld = worlds.find((w) => w.id === world) ?? worlds[0] ?? null
  const worldId = world ?? selectedWorld?.id ?? null
  const numericId = Number.parseInt(id, 10)

  const detail = useQuery({
    queryKey: ['legends', 'record', worldId, kind, numericId],
    queryFn: () => getLegendsRecord({ data: { worldId: worldId ?? -1, kind, id: numericId } }),
    enabled: worldId !== null && Number.isFinite(numericId),
    staleTime: 5 * 60_000,
  })
  const map = useQuery({
    queryKey: ['legends', 'map', worldId],
    queryFn: () => getLegendsMap({ data: { worldId: worldId ?? -1 } }),
    enabled: worldId !== null && MAP_KINDS.has(kind),
    staleTime: 10 * 60_000,
  })

  const record = detail.data?.record ?? null
  const names = detail.data?.names ?? {}
  const payload = (record?.payload ?? {}) as LegendsPayload
  const plus = plusOf(payload)
  const title = record ? recordName(record) : `${kindLabel(kind)} #${id}`
  const subtitle = record ? describeRecord(kind, payload, names) : ''
  const tab = browseTabForKind(kind)

  // What the game draws for this record, beside the title.
  const spriteSubject = record
    ? {
        kind,
        id: numericId,
        race:
          kind === 'historical_figure'
            ? (record.type ?? str(payload.race))
            : kind === 'creature'
              ? str(plus.creature_id)
              : raceToken(str(plus.race) ?? str(payload.race)),
        caste: str(payload.caste),
        type: record.type,
        item: { type: str(plus.item_type), subtype: str(plus.item_subtype) },
      }
    : null

  const chips: string[] = []
  if (record?.type && kind !== 'historical_figure') chips.push(words(record.type))
  if (kind === 'historical_figure' && payload.deity === true) chips.push('deity')
  if (kind === 'historical_figure' && payload.force === true) chips.push('force of nature')
  if (kind === 'region' && typeof plus.evilness === 'string' && plus.evilness !== 'neutral')
    chips.push(plus.evilness)

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <Breadcrumbs
        items={[
          { label: 'Legends', to: '/legends/world', search: { world: worldId ?? undefined } },
          ...(selectedWorld
            ? [
                {
                  label: titleCase(selectedWorld.name ?? selectedWorld.key),
                  to: '/legends/world',
                  search: { world: worldId ?? undefined },
                },
              ]
            : []),
          {
            label: kindPlural(kind),
            to: '/legends/archive',
            search: { world: worldId ?? undefined, archive: tab.key },
          },
          { label: title },
        ]}
      />

      <PageHeader
        eyebrow={kindLabel(kind)}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {spriteSubject ? (
              <LegendsSprite
                subject={spriteSubject}
                size={48}
                title={`${title} as drawn in the game`}
              />
            ) : null}
            {title}
            {chips.map((chip) => (
              <Badge key={chip} variant="outline" className="text-sm font-normal">
                {chip}
              </Badge>
            ))}
          </span>
        }
        description={subtitle}
      />

      {detail.isLoading || (worldId === null && legends.isLoading) ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-64" />
          <Skeleton className="h-64 lg:col-span-2" />
        </div>
      ) : !record || worldId === null ? (
        <EmptyState title="Not in the archive">
          There is no {kindLabel(kind).toLowerCase()} with id {id} in this legends export.
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <KindSections
              record={record}
              payload={payload}
              plus={plus}
              names={names}
              related={detail.data?.related ?? {}}
              positions={detail.data?.positions ?? []}
              worldId={worldId}
              map={map.data}
            />
          </div>

          {TIMELINE_KINDS.has(kind) ? (
            <Timeline
              worldId={worldId}
              kind={kind}
              id={numericId}
              title={kind === 'historical_event_collection' ? 'What happened' : 'History'}
              description={
                kind === 'historical_figure'
                  ? 'Everything the chronicles record about this figure, in order.'
                  : kind === 'historical_event_collection'
                    ? 'The events of this chapter, in order.'
                    : 'Everything that happened here or involved this, in order.'
              }
            />
          ) : null}

          <details className="rounded-xl border bg-card text-card-foreground shadow-sm">
            <summary className="cursor-pointer select-none px-5 py-4 text-base font-medium">
              Every recorded field
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                The raw export, with ids turned into links.
              </span>
            </summary>
            <div className="border-t px-5 py-4">
              <RawFacts payload={payload} names={names} worldId={worldId} />
              {Object.keys(plus).length ? (
                <>
                  <div className="mb-3 mt-6 text-sm font-medium text-muted-foreground">
                    From legends_plus
                  </div>
                  <RawFacts payload={plus} names={names} worldId={worldId} />
                </>
              ) : null}
            </div>
          </details>
        </>
      )}
    </div>
  )
}

function KindSections(props: SectionProps) {
  switch (props.record.kind) {
    case 'historical_figure':
      return <FigureSections {...props} />
    case 'site':
      return <SiteSections {...props} />
    case 'entity':
      return <EntitySections {...props} />
    case 'artifact':
      return <ArtifactSections {...props} />
    case 'written_content':
      return <WrittenSections {...props} />
    case 'historical_event_collection':
      return <CollectionSections {...props} />
    case 'region':
    case 'underground_region':
      return <RegionSections {...props} />
    case 'mountain_peak':
    case 'river':
    case 'landmass':
    case 'world_construction':
      return <PlaceSections {...props} />
    default:
      return <ProseSections {...props} />
  }
}

export const Route = createFileRoute('/_authenticated/_app/legends/$kind/$id')({
  validateSearch: parseWorldSearch,
  component: RecordPage,
})
