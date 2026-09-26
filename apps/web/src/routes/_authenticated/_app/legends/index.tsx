import { Button, cn } from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import {
  ArrowRightIcon,
  DicesIcon,
  GlobeIcon,
  HourglassIcon,
  LibraryIcon,
  NotebookPenIcon,
  SparklesIcon,
} from 'lucide-react'
import * as React from 'react'

import { LegendsSprite } from '~/lib/df-assets/legends'
import { formatNumber } from '~/lib/fortress/format'
import type { Story } from '~/lib/legends/chronicle'
import { yearSpan } from '~/lib/legends/events'
import { BROWSE_TABS, racePlural, raceToken, titleCase } from '~/lib/legends/model'
import { type LegendsWorldSummary, getLegendsNames } from '~/lib/legends/server'
import { HistoryChart } from './-components/HistoryChart'
import { useJournal } from './-components/Journal'
import {
  LegendsShell,
  type LiveFortress,
  RecordLink,
  Section,
  parseWorldParam,
} from './-components/LegendsChrome'
import { StoryCard, leadRef, useStories } from './-components/Stories'
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
  const yearsOfHistory = years ? years.max - years.min + 1 : null

  return (
    <div className="flex flex-col gap-4">
      <AtAGlance worldId={worldId} counts={counts} summary={summary} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Section
          title="Where to begin"
          description={`${worldName} is ${yearsOfHistory ? `${yearsOfHistory.toLocaleString()} years` : 'a long history'} of wars, lives and strange ends. Here are five ways into it.`}
        >
          <WaysIn worldId={worldId} counts={counts} yearsOfHistory={yearsOfHistory} />
        </Section>

        <div className="flex flex-col gap-4">
          {live ? (
            <YourFortress
              worldId={worldId}
              worldName={worldName}
              live={live}
              matchesLive={matchesLive}
              summary={summary}
            />
          ) : null}
          <PickUp worldId={worldId} />
        </div>
      </div>

      <StoryToStart worldId={worldId} />

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
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
      {items.map((item) =>
        item.archive ? (
          <Link
            key={item.label}
            to="/legends/archive"
            search={{ world: worldId, archive: item.archive, type: item.type }}
            className="rounded-xl border bg-card px-4 py-3 transition-colors hover:border-primary/50 hover:bg-accent/40"
          >
            <GlanceFigure value={item.value} label={item.label} />
          </Link>
        ) : (
          <div key={item.label} className="rounded-xl border bg-card px-4 py-3">
            <GlanceFigure value={item.value} label={item.label} />
          </div>
        ),
      )}
    </div>
  )
}

function GlanceFigure({ value, label }: { value: number | null | undefined; label: string }) {
  return (
    <>
      <div className="text-2xl font-semibold tabular-nums tracking-tight">
        {value === null || value === undefined ? '—' : formatNumber(value)}
      </div>
      <div className="text-sm text-muted-foreground">{label}</div>
    </>
  )
}

function WaysIn({
  worldId,
  counts,
  yearsOfHistory,
}: {
  worldId: number
  counts: Record<string, number>
  yearsOfHistory: number | null
}) {
  const ways = [
    {
      to: '/legends/world' as const,
      icon: GlobeIcon,
      title: 'Watch the world unfold',
      body: `Scrub through ${yearsOfHistory ? yearsOfHistory.toLocaleString() : 'the'} years and watch ${formatNumber(counts.site ?? 0)} sites rise, change hands and fall to ruin.`,
      cta: 'Open the map',
    },
    {
      to: '/legends/history' as const,
      icon: HourglassIcon,
      title: 'Read an age',
      body: 'Pick any stretch of years and read its chronicle: who died, what was won, and whose names filled the records.',
      cta: 'Open the chronicle',
    },
    {
      to: '/legends/stories' as const,
      icon: SparklesIcon,
      title: 'Follow a story',
      body: 'The bloodiest battles, the deadliest beasts, the cursed and the strange ends, picked out of the records for you.',
      cta: 'Browse stories',
    },
    {
      to: '/legends/archive' as const,
      icon: LibraryIcon,
      title: 'Look someone up',
      body: `Search ${formatNumber(counts.historical_figure ?? 0)} figures and ${formatNumber(counts.historical_event ?? 0)} events by name, race, civilization or years. Press ⌘K from any legends page.`,
      cta: 'Search the archive',
    },
    {
      to: '/legends/journal' as const,
      icon: NotebookPenIcon,
      title: 'Keep a journal',
      body: 'Pin figures, places and years as you read, and leave notes for your own saga or campaign.',
      cta: 'Open your journal',
    },
  ]
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {ways.map((way, i) => {
        const Icon = way.icon
        return (
          <li key={way.to} className={cn(i === ways.length - 1 && 'md:col-span-2')}>
            <Link
              to={way.to}
              search={{ world: worldId }}
              className="group flex h-full gap-3 rounded-lg border p-4 transition-colors hover:border-primary/50 hover:bg-accent/40"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Icon className="size-5" />
              </span>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="font-medium">{way.title}</span>
                <span className="text-sm leading-relaxed text-muted-foreground">{way.body}</span>
                <span className="mt-1 inline-flex items-center gap-1 text-sm text-primary">
                  {way.cta}
                  <ArrowRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </span>
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
  const fortName = live.fortName ? titleCase(live.fortName) : 'Your fortress'

  if (!matchesLive) {
    return (
      <Section title="Your fortress">
        <p className="text-sm leading-relaxed text-muted-foreground">
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
  const wars = (summary?.wars ?? [])
    .filter((w) => w.aggressor?.id === live.civId || w.defender?.id === live.civId)
    .slice(0, 4)

  return (
    <Section
      title="Your fortress in this world"
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
        {wars.length ? (
          <div>
            <div className="mb-1.5 text-muted-foreground">Wars your people fought</div>
            <ul className="flex flex-col gap-1.5">
              {wars.map((war) => {
                const foe = war.aggressor?.id === live.civId ? war.defender : war.aggressor
                return (
                  <li key={war.id}>
                    <RecordLink
                      kind="historical_event_collection"
                      id={war.id}
                      name={war.name}
                      worldId={worldId}
                    />
                    <span className="text-muted-foreground">
                      {' '}
                      against {foe?.name ? titleCase(foe.name) : 'unknown foes'}
                      {yearSpan(war.startYear, war.endYear)
                        ? ` · ${yearSpan(war.startYear, war.endYear)}`
                        : ''}
                    </span>
                  </li>
                )
              })}
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

/** One story from the whole record, re-rolled on demand. */
function StoryToStart({ worldId }: { worldId: number }) {
  const navigate = useNavigate()
  const stories = useStories(worldId)
  const all = React.useMemo(
    () => (stories.data?.groups ?? []).flatMap((g) => g.stories.filter((s) => leadRef(s))),
    [stories.data],
  )
  const [pick, setPick] = React.useState<Story | null>(null)
  const roll = React.useCallback(() => {
    if (!all.length) return
    setPick((prev) => {
      const pool = all.length > 1 ? all.filter((s) => s.key !== prev?.key) : all
      return pool[Math.floor(Math.random() * pool.length)]
    })
  }, [all])
  React.useEffect(() => {
    if (!pick && all.length) roll()
  }, [pick, all, roll])

  if (!stories.data || !pick) {
    return stories.isLoading ? (
      <Section title="A story to start with">
        <p className="text-sm text-muted-foreground">Sifting the chronicles for a story…</p>
      </Section>
    ) : null
  }
  return (
    <Section
      title="A story to start with"
      description="Picked at random from the stories the records keep returning to."
      action={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" onClick={roll}>
            <DicesIcon className="size-4" />
            Another
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/legends/stories" search={{ world: worldId }}>
              All stories
            </Link>
          </Button>
        </div>
      }
    >
      <StoryCard
        story={pick}
        names={stories.data.names}
        worldId={worldId}
        featured
        onOpen={() => {
          const ref = leadRef(pick)
          if (ref)
            navigate({
              to: '/legends/$kind/$id',
              params: { kind: ref.kind, id: String(ref.id) },
              search: { world: worldId },
            })
        }}
      />
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
