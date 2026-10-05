import { Button } from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import {
  ArrowRightIcon,
  GlobeIcon,
  HourglassIcon,
  LibraryIcon,
  NotebookPenIcon,
  SparklesIcon,
} from 'lucide-react'
import * as React from 'react'

import { LegendsSprite } from '~/lib/df-assets/legends'
import { formatNumber } from '~/lib/fortress/format'
import { BROWSE_TABS, racePlural, raceToken, titleCase } from '~/lib/legends/model'
import { getLegendsNames } from '~/lib/legends/server/fortressLinks'
import type { LegendsWorldSummary } from '~/lib/legends/server/summary'
import { useFortressInLegends } from './-components/FortressTie'
import { HistoryChart } from './-components/HistoryChart'
import { useJournal } from './-components/Journal'
import {
  Fragments,
  LegendsShell,
  type LiveFortress,
  RecordLink,
  Section,
  parseWorldParam,
} from './-components/LegendsChrome'
import { FeaturedStory, featuredStories, useStories } from './-components/Stories'
import { TrailList } from './-components/Trail'

interface LegacySearch {
  world?: number
  tab?: 'world' | 'history' | 'archive'
  archive?: string
  q?: string
}

function OverviewPage() {
  const { world } = Route.useSearch()
  return (
    <LegendsShell section="overview" world={world}>
      {({ worldId, selectedWorld, counts, summary, live, matchesLive }) => (
        <OverviewBody
          worldId={worldId}
          worldName={titleCase(selectedWorld.name ?? selectedWorld.key)}
          counts={counts}
          summary={summary}
          live={live}
          matchesLive={matchesLive}
        />
      )}
    </LegendsShell>
  )
}

function OverviewBody({
  worldId,
  worldName,
  counts,
  summary,
  live,
  matchesLive,
}: {
  worldId: number
  worldName: string
  counts: Record<string, number>
  summary: LegendsWorldSummary | undefined
  live: LiveFortress | null
  matchesLive: boolean
}) {
  const navigate = useNavigate()
  const years = summary?.years ?? null
  const stories = useStories(worldId)
  const ourCiv = matchesLive ? (live?.civId ?? null) : null
  const featured = React.useMemo(
    () => featuredStories(stories.data, ourCiv),
    [stories.data, ourCiv],
  )

  return (
    <div className="flex flex-col gap-4">
      <Section title="Other ways in">
        <WaysIn worldId={worldId} />
      </Section>

      <Section
        title="The size of the world"
        description={`What the export holds for ${worldName}. Each count opens that part of the archive.`}
      >
        <AtAGlance worldId={worldId} counts={counts} summary={summary} />
      </Section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="xl:col-start-1 xl:row-start-1">
          {featured.length ? (
            <FeaturedStory
              worldId={worldId}
              candidates={featured}
              title="A story to start with"
              start={ourCiv !== null ? 'first' : 'random'}
              action={
                <Button asChild variant="ghost" size="sm">
                  <Link to="/legends/stories" search={{ world: worldId }}>
                    All stories
                  </Link>
                </Button>
              }
            />
          ) : (
            <Section title="A story to start with">
              <p className="text-sm text-muted-foreground">
                {stories.isLoading ? 'Sifting the chronicles for a story…' : 'No stories yet.'}
              </p>
            </Section>
          )}
        </div>

        {live ? (
          <div className="xl:col-start-2 xl:row-span-2 xl:row-start-1">
            <YourFortress
              worldId={worldId}
              worldName={worldName}
              live={live}
              matchesLive={matchesLive}
              summary={summary}
            />
          </div>
        ) : null}
        <div className={live ? 'xl:col-start-1 xl:row-start-2' : 'xl:col-start-2 xl:row-start-1'}>
          <PickUp worldId={worldId} />
        </div>
      </div>

      {summary?.timeline.length && years ? (
        <Section
          title="The ages of the world"
          description="Events recorded across the whole history. Click a stretch of years, or drag across several, to read its chronicle."
        >
          <HistoryChart
            bins={summary.timeline}
            binYears={summary.binYears}
            eras={summary.eras}
            onSelect={(span) =>
              navigate({
                to: '/legends/history',
                search: {
                  world: worldId,
                  from: Math.max(span.from, years.min),
                  to: Math.min(span.to, years.max),
                },
              })
            }
          />
        </Section>
      ) : null}
    </div>
  )
}

/** The size of the world, each figure a way into the archive. */
function AtAGlance({
  worldId,
  counts,
  summary,
}: {
  worldId: number
  counts: Record<string, number>
  summary: LegendsWorldSummary | undefined
}) {
  const tabCount = (key: string) => {
    const tab = BROWSE_TABS.find((t) => t.key === key)
    return tab ? tab.kinds.reduce((sum, kind) => sum + (counts[kind] ?? 0), 0) : 0
  }
  const items: {
    label: string
    value: number | null | undefined
    archive?: string
    type?: string
  }[] = [
    {
      label: 'years of history',
      value: summary?.years ? summary.years.max - summary.years.min + 1 : null,
    },
    {
      label: 'civilizations',
      value: summary?.civilizations.length,
      archive: 'groups',
      type: 'civilization',
    },
    { label: 'figures', value: counts.historical_figure, archive: 'figures' },
    { label: 'sites', value: counts.site, archive: 'sites' },
    { label: 'wars', value: summary?.wars.length, archive: 'wars', type: 'war' },
    { label: 'artifacts', value: counts.artifact, archive: 'artifacts' },
    { label: 'writings & arts', value: tabCount('culture'), archive: 'culture' },
  ]
  return (
    <ul className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 xl:grid-cols-7">
      {items.map((item) => {
        const figure = (
          <>
            <span className="block text-lg font-medium tabular-nums">
              {item.value === null || item.value === undefined ? '—' : formatNumber(item.value)}
            </span>
            <span className="block text-sm text-muted-foreground group-hover:text-foreground group-hover:underline">
              {item.label}
            </span>
          </>
        )
        return (
          <li key={item.label}>
            {item.archive ? (
              <Link
                to="/legends/archive"
                search={{ world: worldId, archive: item.archive, type: item.type }}
                className="group block underline-offset-4"
              >
                {figure}
              </Link>
            ) : (
              figure
            )}
          </li>
        )
      })}
    </ul>
  )
}

const WAYS_IN = [
  {
    to: '/legends/world' as const,
    icon: GlobeIcon,
    title: 'Watch the world unfold',
    body: 'Scrub the map through the years.',
  },
  {
    to: '/legends/history' as const,
    icon: HourglassIcon,
    title: 'Read an age',
    body: 'Any stretch of years, told as a chronicle.',
  },
  {
    to: '/legends/stories' as const,
    icon: SparklesIcon,
    title: 'Follow a story',
    body: 'Battles, beasts, the cursed and the strange ends.',
  },
  {
    to: '/legends/archive' as const,
    icon: LibraryIcon,
    title: 'Look someone up',
    body: 'Figures and events by name. ⌘K works on any legends page.',
  },
  {
    to: '/legends/journal' as const,
    icon: NotebookPenIcon,
    title: 'Keep a journal',
    body: 'Pin what you read and leave notes.',
  },
]

function WaysIn({ worldId }: { worldId: number }) {
  return (
    <ul className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-5">
      {WAYS_IN.map((way) => {
        const Icon = way.icon
        return (
          <li key={way.to}>
            <Link to={way.to} search={{ world: worldId }} className="group flex gap-2.5">
              <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="flex items-center gap-1 font-medium group-hover:underline">
                  {way.title}
                  <ArrowRightIcon className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </span>
                <span className="block text-sm text-muted-foreground">{way.body}</span>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/** Where the running fortress stands in these legends, or why it does not. */
function YourFortress({
  worldId,
  worldName,
  live,
  matchesLive,
  summary,
}: {
  worldId: number
  worldName: string
  live: LiveFortress
  matchesLive: boolean
  summary: LegendsWorldSummary | undefined
}) {
  const refs = {
    entity: [live.civId, live.groupId].filter((id): id is number => id !== null),
    site: live.siteId !== null ? [live.siteId] : [],
  }
  const names = useQuery({
    queryKey: ['legends', 'names', worldId, refs],
    queryFn: () => getLegendsNames({ data: { worldId, refs } }),
    enabled: matchesLive && (refs.entity.length > 0 || refs.site.length > 0),
    staleTime: 10 * 60_000,
  })
  const tie = useFortressInLegends(worldId, matchesLive)
  const fortName = live.fortName ? titleCase(live.fortName) : 'Your fortress'

  if (!matchesLive) {
    return (
      <Section title="Your fortress">
        <p className="text-sm text-muted-foreground">
          <span className="text-foreground">{fortName}</span> stands in{' '}
          <span className="text-foreground">
            {live.worldName ? titleCase(live.worldName) : 'another world'}
          </span>
          , but these legends are from {worldName}. To read the history your dwarves were born into,
          export legends from that save (Legends mode, or <code>exportlegends</code> in DFHack). The
          worker imports it on its next start, and this panel will show your civilization, its wars
          and your site.
        </p>
      </Section>
    )
  }

  const civ = summary?.civilizations.find((c) => c.id === live.civId) ?? null
  const civName = live.civId !== null ? names.data?.entity?.[live.civId] : undefined
  const groupName = live.groupId !== null ? names.data?.entity?.[live.groupId] : undefined
  const siteName = live.siteId !== null ? names.data?.site?.[live.siteId] : undefined
  const told = tie.data

  return (
    <Section
      title="Your people in this world"
      description={`Where ${fortName} and its people stand in the legends.`}
    >
      <div className="flex flex-col gap-4 text-sm">
        {live.civId !== null ? (
          <div className="flex items-center gap-3">
            <LegendsSprite
              subject={{ kind: 'entity', id: live.civId, race: raceToken(civ?.race ?? null) }}
              size={32}
              className="shrink-0"
            />
            <div className="min-w-0">
              <div className="text-muted-foreground">Your civilization</div>
              {civName ? (
                <RecordLink kind="entity" id={live.civId} name={civName} worldId={worldId} />
              ) : (
                <span className="text-muted-foreground">not in this export</span>
              )}
              {civ ? (
                <div className="text-muted-foreground">
                  {civ.race ? `${racePlural(civ.race)} · ` : ''}
                  {civ.sites} site{civ.sites === 1 ? '' : 's'}
                  {civ.wars ? ` · ${civ.wars} war${civ.wars === 1 ? '' : 's'}` : ''}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
          <dt className="text-muted-foreground">Site</dt>
          <dd className="min-w-0">
            {live.siteId !== null && siteName ? (
              <RecordLink kind="site" id={live.siteId} name={siteName} worldId={worldId} />
            ) : (
              <span>
                {fortName}{' '}
                <span className="text-muted-foreground">(founded after this export)</span>
              </span>
            )}
          </dd>
          {live.groupId !== null && groupName ? (
            <>
              <dt className="text-muted-foreground">Government</dt>
              <dd className="min-w-0">
                <RecordLink kind="entity" id={live.groupId} name={groupName} worldId={worldId} />
              </dd>
            </>
          ) : null}
        </dl>
        {told?.civ.length ? (
          <p className="leading-relaxed">
            <Fragments fragments={told.civ} worldId={worldId} />
          </p>
        ) : null}
        {told?.storied.length ? (
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground">Your dwarves in history</span>
              <span className="text-muted-foreground tabular-nums">
                {told.living.length} of {told.dwellers} in the record
              </span>
            </div>
            <ul className="flex flex-col gap-2.5">
              {told.storied.map((dweller) => (
                <li key={dweller.figureId} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <RecordLink
                      kind="historical_figure"
                      id={dweller.figureId}
                      name={told.names.historical_figure?.[dweller.figureId]}
                      worldId={worldId}
                    />
                    <Link
                      to="/fortress/dwarves/$id"
                      params={{ id: String(dweller.unitId) }}
                      className="shrink-0 text-primary underline-offset-4 hover:underline"
                    >
                      In your fortress
                    </Link>
                  </div>
                  <div className="text-muted-foreground">
                    <Fragments fragments={dweller.line} worldId={worldId} />
                    {dweller.kin ? (
                      <>
                        {' '}
                        <Fragments fragments={dweller.kin} worldId={worldId} />
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {live.civId !== null && civName ? (
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/legends/world" search={{ world: worldId, civ: live.civId }}>
                Light their sites on the map
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link
                to="/legends/archive"
                search={{ world: worldId, archive: 'figures', civ: live.civId }}
              >
                Their people
              </Link>
            </Button>
          </div>
        ) : null}
      </div>
    </Section>
  )
}

/** The trail and the latest journal pins, for a returning reader. */
function PickUp({ worldId }: { worldId: number }) {
  const journal = useJournal(worldId)
  const notes = (journal.data ?? []).slice(0, 3)
  return (
    <Section title="Pick up where you left off">
      <div className="flex flex-col gap-4">
        <TrailList worldId={worldId} limit={6} />
        {notes.length ? (
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Latest in your journal</span>
              <Link
                to="/legends/journal"
                search={{ world: worldId }}
                className="text-primary underline-offset-4 hover:underline"
              >
                All {(journal.data?.length ?? 0).toLocaleString()}
              </Link>
            </div>
            <ul className="flex flex-col gap-1.5 text-sm">
              {notes.map((note) => (
                <li key={note.id} className="min-w-0">
                  <div className="truncate font-medium">{note.title}</div>
                  {note.note.trim() ? (
                    <div className="line-clamp-2 text-muted-foreground">{note.note}</div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Section>
  )
}

export const Route = createFileRoute('/_authenticated/_app/legends/')({
  validateSearch: (raw: Record<string, unknown>): LegacySearch => {
    const out: LegacySearch = {}
    const world = parseWorldParam(raw.world)
    if (world !== undefined) out.world = world
    if (raw.tab === 'world' || raw.tab === 'history' || raw.tab === 'archive') out.tab = raw.tab
    if (typeof raw.archive === 'string' && BROWSE_TABS.some((t) => t.key === raw.archive))
      out.archive = raw.archive
    if (typeof raw.q === 'string' && raw.q) out.q = raw.q
    return out
  },
  // Old links used ?tab= on this page; send them where the tab lives now.
  beforeLoad: ({ search }) => {
    if (search.tab === 'history') {
      throw redirect({ to: '/legends/history', search: { world: search.world } })
    }
    if (search.tab === 'archive') {
      throw redirect({
        to: '/legends/archive',
        search: { world: search.world, archive: search.archive, q: search.q },
      })
    }
    if (search.tab === 'world') {
      throw redirect({ to: '/legends/world', search: { world: search.world } })
    }
  },
  component: OverviewPage,
})
