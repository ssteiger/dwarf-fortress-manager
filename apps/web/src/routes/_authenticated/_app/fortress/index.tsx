import type { FortEvent, FortSummary, FortUnit } from '@fortress/db-drizzle'
import { STRESS_LABELS } from '@fortress/db-drizzle/fortress-types'
import { Button, Card, CardContent, CardHeader, CardTitle, cn } from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { formatDistanceToNow } from 'date-fns'
import {
  ArrowRightIcon,
  BeerIcon,
  CoinsIcon,
  EyeIcon,
  HeartIcon,
  HistoryIcon,
  PanelRightIcon,
  ScrollTextIcon,
  ShieldAlertIcon,
  SwordsIcon,
  TriangleAlertIcon,
  UsersIcon,
} from 'lucide-react'
import * as React from 'react'

import { fortAdvice, situations } from '~/lib/fortress/advisor'
import {
  STRESS_BAR_COLORS,
  formatGameTick,
  formatNumber,
  formatValue,
  isLiving,
  unitGroup,
} from '~/lib/fortress/format'
import { noticeGuide } from '~/lib/fortress/guides'
import {
  type Feeling,
  type Notice,
  STORY_KINDS,
  absTicks,
  activityBoard,
  concernScore,
  firstName,
  fortFeelings,
  fortNotices,
  gameSpan,
  gameTimeOf,
  makeNameLinker,
  storyKind,
  unitConcerns,
} from '~/lib/fortress/insights'
import { useLastSeen } from '~/lib/fortress/lastSeen'
import { LIFE_TONE_DOT } from '~/lib/fortress/lifeEvents'
import {
  useFortConcerns,
  useFortOverview,
  useFortRecap,
  useFortSupplies,
  useFortUnits,
} from '~/lib/fortress/queries'
import { buildRecap, lead, ownGroupsOf, seasonAt, seasonIndex } from '~/lib/fortress/recap'
import { getFortWork } from '~/lib/fortress/server'
import { useWatchList } from '~/lib/fortress/watch'
import { watchNews } from '~/lib/fortress/watchChanges'
import { EmptyState, PageHeader, SectionBoundary, StatusBanner } from './-components/FortChrome'
import { GuideProvider, useOpenGuide } from './-components/Guide'
import {
  ActivityBoard,
  AlertsMenu,
  AnnouncementText,
  FeelingsPanel,
  NoticeList,
  StoryFeed,
} from './-components/Insights'
import { TrendsCard } from './-components/Trends'
import { HelpStrip } from './dwarves/-components/PeoplePanels'

const KEY_STOCKS = [
  'drink',
  'meals',
  'plants',
  'meat',
  'fish',
  'seeds',
  'logs',
  'stone',
  'blocks',
  'bars',
  'cloth',
  'thread',
]

const FOOD_STOCKS = ['meals', 'meat', 'fish', 'plants', 'cheese', 'eggs']

type FeedFilter = 'story' | 'all'

function OverviewPage() {
  return (
    <GuideProvider>
      <OverviewBody />
    </GuideProvider>
  )
}

function OverviewBody() {
  const { data, isFetching, refetch, dataUpdatedAt } = useFortOverview()
  const unitsQuery = useFortUnits()
  const concerns = useFortConcerns()
  const supplies = useFortSupplies()
  const work = useQuery({
    queryKey: ['fort', 'work'],
    queryFn: () => getFortWork(),
  })
  const openGuide = useOpenGuide()
  const state = data?.state ?? null
  const world = state?.world ?? null
  const summary = state?.summary ?? null
  const now = gameTimeOf(state)
  const units = unitsQuery.data?.units ?? []
  const population = summary ? summary.adults + summary.children + summary.babies : 0

  const notices = React.useMemo(
    () => fortNotices({ summary, units, concerns: concerns.data ?? null, now }),
    [summary, units, concerns.data, now],
  )
  // The same advice and playbook the work page shows, so every notice has its step-by-step guide.
  const advisorInput = React.useMemo(
    () => ({
      summary,
      units,
      buildings: work.data?.buildings ?? [],
      jobs: work.data?.jobs ?? [],
      concerns: concerns.data ?? null,
      supplies: supplies.data ?? null,
      events: data?.events ?? [],
      now,
    }),
    [summary, units, work.data, concerns.data, supplies.data, data?.events, now],
  )
  const advice = React.useMemo(() => fortAdvice(advisorInput), [advisorInput])
  const playbook = React.useMemo(() => situations(advisorInput), [advisorInput])
  const guideNotice = (notice: Notice) => openGuide(noticeGuide(notice, advice, playbook))
  const guideFeeling = (feeling: Feeling) =>
    openGuide(
      noticeGuide(
        {
          key: `comfort-${feeling.thought}`,
          severity: 'info',
          kind: 'comfort',
          title: `${feeling.units.length === 1 ? firstName(feeling.units[0]) : `${feeling.units.length} dwarves`} ${feeling.phrase}`,
          hint: feeling.hint,
          units: feeling.units,
        },
        advice,
        playbook,
      ),
    )
  const board = React.useMemo(() => activityBoard(units), [units])
  const feelings = React.useMemo(() => fortFeelings(units, now), [units, now])
  const link = React.useMemo(() => makeNameLinker(units), [units])

  const events = data?.events ?? []
  const newestId = events.reduce((max, e) => Math.max(max, e.id), 0)
  const lastSeen = useLastSeen(data ? { eventId: newestId, game: now } : null)

  const hostiles = units.filter((u) => isLiving(u) && unitGroup(u) === 'hostile')
  const unseen = hostiles.filter((u) => u.flags.includes('hidden')).length
  const dangers = notices.filter((n) => n.severity === 'danger')
  const ownGroups = React.useMemo(() => ownGroupsOf(world), [world])
  const struggling = React.useMemo(
    () =>
      units
        .filter((u) => isLiving(u) && unitGroup(u) === 'citizen')
        .map((unit) => ({ unit, concerns: unitConcerns(unit, now) }))
        .filter((entry) => entry.concerns.length > 0)
        .sort((a, b) => concernScore(b.concerns) - concernScore(a.concerns)),
    [units, now],
  )

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        title={state?.fort_name ?? 'No fortress yet'}
        description={
          world ? (
            <>
              {world.day} {world.month_name}, {world.year} · {world.season} · {world.name}
              {world.name_native ? (
                <span className="text-muted-foreground"> ({world.name_native})</span>
              ) : null}
            </>
          ) : (
            'Waiting for the worker to take its first dump of the game.'
          )
        }
        updatedAt={state?.captured_at ?? dataUpdatedAt}
        isFetching={isFetching}
        onRefresh={() => refetch()}
        actions={
          <>
            <GlanceButton />
            <AlertsMenu />
          </>
        }
      />

      <StatusBanner state={state} />

      {summary ? (
        <>
          {dangers.length ? (
            <SectionBoundary name="What is dangerous right now">
              <DangerStrip notices={dangers} onGuide={guideNotice} />
            </SectionBoundary>
          ) : null}

          {lastSeen ? (
            <SectionBoundary name="What changed since your last look">
              <SinceLastLook
                lastSeen={lastSeen}
                events={events}
                now={now}
                fortName={state?.fort_name ?? 'the fortress'}
                units={units}
                ownGroups={ownGroups}
              />
            </SectionBoundary>
          ) : null}

          {struggling.length ? (
            <SectionBoundary name="Who is struggling">
              <HelpStrip entries={struggling} />
            </SectionBoundary>
          ) : null}

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
            <Reading
              title="Citizens"
              value={population}
              Icon={UsersIcon}
              hint={`${summary.adults} adults · ${summary.children} children · ${summary.babies} babies · ${summary.tame_animals} tame animals`}
            />
            <Reading
              title="At work"
              value={`${summary.working} / ${summary.working + summary.idle}`}
              Icon={SwordsIcon}
              hint={`${summary.idle} idle · ${summary.military} in squads · ${formatNumber(summary.jobs_total)} jobs queued (${summary.jobs_suspended} suspended)`}
            />
            <Reading
              title="Created wealth"
              value={summary.wealth ? formatValue(summary.wealth.total) : '—'}
              Icon={CoinsIcon}
              accentClassName="text-amber-500"
              hint={
                summary.wealth
                  ? `${formatValue(summary.wealth.imported)} imported · ${formatValue(summary.wealth.exported)} exported`
                  : undefined
              }
            />
            <Reading
              title="Dangers on the map"
              value={hostiles.length || summary.hostiles}
              Icon={ShieldAlertIcon}
              accentClassName={
                hostiles.length - unseen > 0
                  ? 'text-red-500'
                  : hostiles.length
                    ? 'text-amber-500'
                    : 'text-muted-foreground'
              }
              hint={
                hostiles.length
                  ? `${hostiles.length - unseen} in sight · ${unseen} unseen · ${summary.visitors} visitors · ${summary.merchants} merchants`
                  : `${summary.visitors} visitors · ${summary.merchants} merchants`
              }
            />
          </div>

          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="flex min-w-0 flex-col gap-4">
              <Card className="gap-4">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <TriangleAlertIcon className="size-4 text-primary" />
                    Needs your attention
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    What the dump says could go wrong, and what you can do about it.{' '}
                    <Link
                      to="/fortress/work"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      Step-by-step advice for the whole fortress
                    </Link>
                  </p>
                </CardHeader>
                <CardContent>
                  <SectionBoundary name="The list of problems">
                    {dangers.length && dangers.length === notices.length ? (
                      <p className="text-sm text-muted-foreground">
                        Nothing else needs you right now.
                      </p>
                    ) : (
                      <NoticeList
                        notices={notices.filter((n) => n.severity !== 'danger')}
                        onGuide={guideNotice}
                      />
                    )}
                  </SectionBoundary>
                </CardContent>
              </Card>

              <Card className="gap-4">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <HeartIcon className="size-4 text-primary" />
                    How the fortress feels
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    What went through your citizens’ heads this past month. Click a line to see who.
                  </p>
                </CardHeader>
                <CardContent>
                  <SectionBoundary name="The fortress’s feelings">
                    <FeelingsPanel feelings={feelings} onGuide={guideFeeling} />
                  </SectionBoundary>
                </CardContent>
              </Card>

              <SectionBoundary name="The story so far">
                <StoryCard
                  events={events}
                  link={link}
                  newAfter={lastSeen?.eventId ?? null}
                  undone={data?.undone ?? 0}
                  present={world ? `${world.day} ${world.month_name} ${world.year}` : null}
                />
              </SectionBoundary>
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              <Card className="gap-4">
                <CardHeader>
                  <CardTitle className="text-base">Right now</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    What every citizen is up to. Hover for names, click to open.
                  </p>
                </CardHeader>
                <CardContent className="flex flex-col gap-5">
                  <SectionBoundary name="What everyone is doing">
                    <MoodBar counts={summary.mood} />
                    <ActivityBoard groups={board} />
                  </SectionBoundary>
                </CardContent>
              </Card>

              <Card className="gap-4">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <BeerIcon className="size-4" /> Stores
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <SectionBoundary name="The stores">
                    <Stores summary={summary} population={population} />
                  </SectionBoundary>
                </CardContent>
              </Card>

              <SectionBoundary name="The trends">
                <TrendsCard />
              </SectionBoundary>
            </div>
          </div>
        </>
      ) : (
        <EmptyState title="Nothing to show yet">
          Once the worker has talked to the game, the population, mood, stores, and alerts appear
          here.
        </EmptyState>
      )}
    </div>
  )
}

/** What is dangerous right now, a line each, above the story; the guide holds who and how. */
function DangerStrip({
  notices,
  onGuide,
}: {
  notices: Notice[]
  onGuide: (notice: Notice) => void
}) {
  return (
    <section
      aria-label="Dangerous right now"
      className="rounded-xl border border-red-500/40 bg-red-500/5 dark:bg-red-500/10"
    >
      <ul className="divide-y divide-red-500/20">
        {notices.map((notice) => (
          <li key={notice.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5">
            <ShieldAlertIcon className="size-4 shrink-0 text-red-600 dark:text-red-400" />
            <span className="min-w-0 flex-1">
              <span className="font-semibold">{notice.title}</span>
              {notice.detail ? (
                <span className="text-sm text-muted-foreground"> · {notice.detail}</span>
              ) : null}
            </span>
            <button
              type="button"
              onClick={() => onGuide(notice)}
              className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              How to fix it
              <ArrowRightIcon className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Opens the compact view in a narrow window of its own, to keep beside the game. */
function GlanceButton() {
  return (
    <Button
      size="sm"
      variant="outline"
      className="gap-1.5"
      title="A narrow view for beside the game: what needs you, who is struggling, the dwarves you watch and the chronicle’s last lines."
      onClick={() => {
        const opened = window.open('/glance', 'dfm-glance', 'popup,width=440,height=900')
        if (!opened) window.location.assign('/glance')
      }}
    >
      <PanelRightIcon className="size-3.5" />
      While playing
    </Button>
  )
}

/** One cell of the overview's reading strip: label, big number, the detail beneath it. */
function Reading({
  title,
  value,
  hint,
  Icon,
  accentClassName,
}: {
  title: string
  value: React.ReactNode
  hint?: React.ReactNode
  Icon: React.ComponentType<{ className?: string }>
  accentClassName?: string
}) {
  return (
    <div className="bg-card p-4 text-card-foreground">
      <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
        <Icon className={cn('size-3.5 shrink-0', accentClassName)} />
        {title}
      </div>
      <div className="mt-1 text-2xl leading-tight font-medium tracking-tight tabular-nums">
        {value}
      </div>
      {hint ? (
        <div className="mt-1.5 text-sm leading-snug text-muted-foreground">{hint}</div>
      ) : null}
    </div>
  )
}

const LEAD_SENTENCES = 4
const WATCHED_LINES = 6

/** What happened since the overview was last open, told as a story, in wall-clock and in game time. */
function SinceLastLook({
  lastSeen,
  events,
  now,
  fortName,
  units,
  ownGroups,
}: {
  lastSeen: NonNullable<ReturnType<typeof useLastSeen>>
  events: FortEvent[]
  now: ReturnType<typeof gameTimeOf>
  fortName: string
  units: FortUnit[]
  ownGroups: ReadonlySet<number> | undefined
}) {
  const source = useFortRecap(
    lastSeen.game ? { year: lastSeen.game.year, tick: lastSeen.game.tick + 1 } : null,
  )
  const { ids: watched } = useWatchList()
  const recap = React.useMemo(
    () => (source.data ? buildRecap(source.data, { units, watched, ownGroups }) : null),
    [source.data, units, watched, ownGroups],
  )
  const fresh = events.filter((e) => e.id > lastSeen.eventId)
  const story = recap ? lead(recap, LEAD_SENTENCES) : []
  // Without anything for the headline, the other lines speak for themselves.
  const told = recap?.told.length ? story : story.slice(1)
  const shifts = recap?.sections.find((s) => s.key === 'fortress')?.lines ?? []
  const news = watchNews(units, watched, lastSeen.game)
  const passed = now && lastSeen.game ? absTicks(now) - absTicks(lastSeen.game) : null
  const wentBack = passed !== null && passed < 0
  if (
    !fresh.length &&
    !told.length &&
    !news.length &&
    !wentBack &&
    (passed === null || passed < 1200)
  )
    return null
  const when = formatDistanceToNow(lastSeen.at, { addSuffix: true })
  const span =
    passed !== null && passed >= 1200 ? `${gameSpan(passed)} passed in ${fortName}` : null
  const noteworthy = told.length > 0 || news.length > 0
  const seasons =
    now && lastSeen.game ? seasonIndex(seasonAt(now)) - seasonIndex(seasonAt(lastSeen.game)) + 1 : 1
  const headline = told[0]?.key === 'headline' ? told[0] : null
  const lines = headline ? told.slice(1) : told
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 px-4 py-3 text-sm">
      <p className="flex items-start gap-2">
        <HistoryIcon className="mt-0.5 size-4 shrink-0 text-primary" />
        <span>
          {wentBack ? (
            <>
              You last looked {when}. Since then {fortName} has gone back {gameSpan(-(passed ?? 0))}
              : an earlier save was loaded.
            </>
          ) : (
            <>
              You last looked {when}. Since then{' '}
              {span
                ? `${span}${noteworthy ? ':' : ', with nothing of note.'}`
                : noteworthy
                  ? 'this happened:'
                  : 'nothing of note happened.'}
            </>
          )}
        </span>
      </p>
      {!wentBack && (told.length || news.length || shifts.length) ? (
        <div className="flex flex-col gap-2 pl-6">
          {headline ? (
            <p className="text-base leading-snug font-medium text-pretty">
              <AnnouncementText parts={headline.parts} />
            </p>
          ) : null}
          {lines.length ? (
            <ul className="flex flex-col gap-1">
              {lines.map((line) => (
                <li key={line.key} className="flex gap-2">
                  {line.watched ? (
                    <EyeIcon
                      className="mt-0.5 size-3.5 shrink-0 text-primary"
                      aria-label="Watched"
                    />
                  ) : (
                    <span
                      className={cn(
                        'mt-1.5 size-1.5 shrink-0 rounded-full',
                        LIFE_TONE_DOT[line.tone ?? 'neutral'],
                      )}
                      aria-hidden
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <AnnouncementText parts={line.parts} />
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {news.length ? (
            <ul className="flex flex-col gap-1" aria-label="The dwarves you watch">
              {news.slice(0, WATCHED_LINES).map((item) => (
                <li
                  key={`${item.unit.id}-${item.year}-${item.tick}-${item.phrase}`}
                  className="flex gap-2"
                >
                  <EyeIcon className="mt-0.5 size-3.5 shrink-0 text-primary" aria-label="Watched" />
                  <span className="min-w-0 flex-1">
                    <AnnouncementText
                      parts={[
                        { text: firstName(item.unit), unit: item.unit },
                        { text: ` ${item.phrase}` },
                      ]}
                    />
                  </span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {formatGameTick(item.year, item.tick)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {shifts.length ? (
            <p className="text-muted-foreground">
              {shifts.map((line) => line.parts.map((p) => p.text).join('')).join(' ')}
            </p>
          ) : null}
        </div>
      ) : null}
      {!wentBack && (told.length || fresh.length) ? (
        <p className="flex flex-wrap gap-x-4 gap-y-1 pl-6">
          {told.length ? (
            <Link
              to="/fortress/chronicle"
              search={{ view: 'seasons' }}
              className="text-primary underline-offset-4 hover:underline"
            >
              {seasons > 1 ? 'Read it season by season' : 'Read the whole season'}
            </Link>
          ) : null}
          {fresh.length ? (
            <span className="text-muted-foreground">New entries are marked below.</span>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}

function StoryCard({
  events,
  link,
  newAfter,
  undone,
  present,
}: {
  events: FortEvent[]
  link: ReturnType<typeof makeNameLinker>
  newAfter: number | null
  undone: number
  present: string | null
}) {
  const [filter, setFilter] = React.useState<FeedFilter>('story')
  const shown = React.useMemo(
    () => (filter === 'all' ? events : events.filter((e) => STORY_KINDS[storyKind(e)].story)),
    [events, filter],
  )
  return (
    <Card className="gap-4">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollTextIcon className="size-4 text-primary" />
            The story so far
          </CardTitle>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Deaths, births, moods, arrivals and finds, by season. Names open the dwarf.
          </p>
        </div>
        <div className="flex items-center gap-1">
          {(
            [
              ['story', 'The story'],
              ['all', 'Everything but cancellations'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                'rounded-full border px-3 py-1 text-sm transition-colors hover:bg-accent',
                filter === key &&
                  'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <StoryFeed events={shown} link={link} newAfter={newAfter} limit={50} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            {undone
              ? `${undone.toLocaleString()} announcement${undone === 1 ? '' : 's'} dated after ${present ?? 'today'} ${undone === 1 ? 'is' : 'are'} hidden: an earlier save was loaded since, so ${undone === 1 ? 'it' : 'they'} never happened.`
              : null}
          </span>
          <Link
            to="/fortress/chronicle"
            className="text-primary underline-offset-4 hover:underline"
          >
            Full chronicle
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

function Stores({ summary, population }: { summary: FortSummary; population: number }) {
  const count = (key: string) => summary.stocks.find((s) => s.key === key)?.count ?? 0
  const drink = count('drink')
  const food = FOOD_STOCKS.reduce((sum, key) => sum + count(key), 0)
  const per = (n: number) => (population ? Math.floor(n / population) : 0)
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <PerDwarf label="Drink" total={drink} each={per(drink)} low={per(drink) < 5} />
        <PerDwarf label="Food" total={food} each={per(food)} low={per(food) < 3} />
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        {summary.stocks
          .filter((s) => KEY_STOCKS.includes(s.key))
          .sort((a, b) => KEY_STOCKS.indexOf(a.key) - KEY_STOCKS.indexOf(b.key))
          .map((stock) => (
            <div
              key={stock.key}
              className="flex items-baseline justify-between gap-2 border-b py-1"
            >
              <dt className="text-muted-foreground">{stock.label}</dt>
              <dd
                className={cn(
                  'font-medium tabular-nums',
                  stock.count === 0 && 'text-muted-foreground',
                )}
              >
                {formatNumber(stock.count)}
              </dd>
            </div>
          ))}
      </dl>
      <Link
        to="/fortress/items"
        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        Browse all {formatNumber(summary.items_total)} items
      </Link>
    </div>
  )
}

function PerDwarf({
  label,
  total,
  each,
  low,
}: {
  label: string
  total: number
  each: number
  low: boolean
}) {
  return (
    <div
      className={cn('rounded-lg border px-3 py-2', low && 'border-amber-500/50 bg-amber-500/10')}
    >
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums">
        {each}
        <span className="ml-1 text-sm font-normal text-muted-foreground">per dwarf</span>
      </div>
      <div className="text-xs text-muted-foreground tabular-nums">
        {formatNumber(total)} in stock
      </div>
    </div>
  )
}

function MoodBar({ counts }: { counts: number[] }) {
  const total = counts.reduce((a, b) => a + b, 0)
  if (total === 0)
    return <p className="text-sm text-muted-foreground">No citizens to be happy or sad.</p>
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-2 w-full gap-0.5">
        {counts.map((count, i) =>
          count > 0 ? (
            <div
              key={STRESS_LABELS[i]}
              title={`${count} ${STRESS_LABELS[i]}`}
              className="h-full min-w-1 rounded-full"
              style={{ flex: `${count} 1 0%`, backgroundColor: STRESS_BAR_COLORS[i] }}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {counts.map((count, i) =>
          count > 0 ? (
            <span key={STRESS_LABELS[i]} className="flex items-center gap-1.5 tabular-nums">
              <span
                className="inline-block size-2 rounded-full"
                style={{ backgroundColor: STRESS_BAR_COLORS[i] }}
              />
              {count} {STRESS_LABELS[i]}
            </span>
          ) : null,
        )}
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/_app/fortress/')({
  component: OverviewPage,
})
