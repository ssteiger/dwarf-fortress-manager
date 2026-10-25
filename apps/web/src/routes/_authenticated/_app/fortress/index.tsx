import type { FortEvent, FortSummary, FortUnit } from '@fortress/db-drizzle'
import { STRESS_LABELS } from '@fortress/db-drizzle/fortress-types'
import { Button, Stats, cn } from '@fortress/ui'
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

import { fortAdvice } from '~/lib/fortress/advice/checks'
import { noticeGuide } from '~/lib/fortress/advice/guides'
import { type Notice, fortNotices } from '~/lib/fortress/advice/notices'
import { situations } from '~/lib/fortress/advice/situations'
import { STORY_KINDS, makeNameLinker, storyKind } from '~/lib/fortress/chronicle/announcements'
import { buildRecap, lead, ownGroupsOf } from '~/lib/fortress/chronicle/recap'
import { useLastSeen } from '~/lib/fortress/client/lastSeen'
import {
  useFortConcerns,
  useFortOverview,
  useFortRecap,
  useFortSupplies,
  useFortUnits,
} from '~/lib/fortress/client/queries'
import { useWatchList } from '~/lib/fortress/client/watch'
import {
  STRESS_BAR_COLORS,
  formatGameTick,
  formatNumber,
  formatValue,
  isLiving,
  unitGroup,
} from '~/lib/fortress/format'
import { activityBoard } from '~/lib/fortress/people/activity'
import { LIFE_TONE_DOT } from '~/lib/fortress/people/lifeEvents'
import { type Feeling, fortFeelings } from '~/lib/fortress/people/thoughts'
import { concernScore, unitConcerns } from '~/lib/fortress/people/troubles'
import { firstName } from '~/lib/fortress/people/units'
import { watchNews } from '~/lib/fortress/people/watchChanges'
import { getFortWork } from '~/lib/fortress/server/work'
import { absTicks, gameSpan, gameTimeOf } from '~/lib/fortress/time'
import { seasonAt, seasonIndex } from '~/lib/fortress/time'
import {
  EmptyState,
  PageHeader,
  Reading,
  Section,
  SectionBoundary,
  StatusBand,
} from './-components/FortChrome'
import { GuideProvider, useOpenGuide } from './-components/Guide'
import {
  ActivityBoard,
  AlertsMenu,
  AnnouncementText,
  FeelingsPanel,
  NoticeList,
  StoryFeed,
} from './-components/Insights'
import { Trends } from './-components/Trends'
import { HelpStrip } from './citizens/-components/PeoplePanels'
import { useLegendsCurses } from './citizens/-components/UnitLinks'

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

const OverviewPage = () => {
  return (
    <GuideProvider>
      <OverviewBody />
    </GuideProvider>
  )
}

const OverviewBody = () => {
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
  const legendsCurses = useLegendsCurses(units)
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
      legendsCurses,
    }),
    [summary, units, work.data, concerns.data, supplies.data, data?.events, now, legendsCurses],
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
    <div className="flex flex-1 flex-col">
      <PageHeader
        className="border-b p-4"
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

      <StatusBand state={state} />

      {summary ? (
        <>
          {dangers.length ? (
            <SectionBoundary name="What is dangerous right now" className="border-b p-4">
              <DangerStrip notices={dangers} onGuide={guideNotice} />
            </SectionBoundary>
          ) : null}

          {lastSeen ? (
            <SectionBoundary name="What changed since your last look" className="border-b p-4">
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
            <SectionBoundary name="Who is struggling" className="border-b p-4">
              <HelpStrip entries={struggling} className="border-b" />
            </SectionBoundary>
          ) : null}

          <Stats className="grid-cols-2">
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
              value={summary.wealth ? formatValue(summary.wealth.total) : '-'}
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
          </Stats>

          <div className="grid flex-1 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="flex min-w-0 flex-col divide-y">
              <Section
                title="Needs your attention"
                icon={<TriangleAlertIcon className="size-4 text-primary" />}
                description={
                  <>
                    What the dump says could go wrong, and what you can do about it.{' '}
                    <Link
                      to="/fortress/work"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      Step-by-step advice for the whole fortress
                    </Link>
                  </>
                }
              >
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
              </Section>

              <Section
                title="How the fortress feels"
                icon={<HeartIcon className="size-4 text-primary" />}
                description="What went through your citizens’ heads this past month. Click a line to see who."
              >
                <SectionBoundary name="The fortress’s feelings">
                  <FeelingsPanel feelings={feelings} onGuide={guideFeeling} />
                </SectionBoundary>
              </Section>

              <StorySection
                events={events}
                link={link}
                newAfter={lastSeen?.eventId ?? null}
                undone={data?.undone ?? 0}
                present={world ? `${world.day} ${world.month_name} ${world.year}` : null}
              />
            </div>

            <div className="flex min-w-0 flex-col divide-y border-t xl:border-t-0 xl:border-l">
              <Section
                title="Right now"
                description="What every citizen is up to. Hover for names, click to open."
                className="gap-5"
              >
                <SectionBoundary name="What everyone is doing">
                  <MoodBar counts={summary.mood} />
                  <ActivityBoard groups={board} />
                </SectionBoundary>
              </Section>

              <Section title="Stores" icon={<BeerIcon className="size-4" />}>
                <SectionBoundary name="The stores">
                  <Stores summary={summary} population={population} />
                </SectionBoundary>
              </Section>

              <Trends />
            </div>
          </div>
        </>
      ) : (
        <EmptyState title="Nothing to show yet" className="m-4">
          Once the worker has talked to the game, the population, mood, stores, and alerts appear
          here.
        </EmptyState>
      )}
    </div>
  )
}

/** What is dangerous right now, a line each, above the story; the guide holds who and how. */
const DangerStrip = ({
  notices,
  onGuide,
}: {
  notices: Notice[]
  onGuide: (notice: Notice) => void
}) => {
  return (
    <section
      aria-label="Dangerous right now"
      className="border-b border-red-500/30 bg-red-500/5 dark:bg-red-500/10"
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
const GlanceButton = () => {
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

const LEAD_SENTENCES = 4
const WATCHED_LINES = 6

/** What happened since the overview was last open, told as a story, in wall-clock and in game time. */
const SinceLastLook = ({
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
}) => {
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
    <div className="flex flex-col gap-3 border-b bg-muted/30 p-4 text-sm">
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

const StorySection = ({
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
}) => {
  const [filter, setFilter] = React.useState<FeedFilter>('story')
  const shown = React.useMemo(
    () => (filter === 'all' ? events : events.filter((e) => STORY_KINDS[storyKind(e)].story)),
    [events, filter],
  )
  return (
    <Section
      title="The story so far"
      icon={<ScrollTextIcon className="size-4 text-primary" />}
      description="Deaths, births, moods, arrivals and finds, by season. Names open the dwarf."
      action={
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
      }
    >
      <SectionBoundary name="The story so far">
        <StoryFeed events={shown} link={link} newAfter={newAfter} limit={50} />
      </SectionBoundary>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span>
          {undone
            ? `${undone.toLocaleString()} announcement${undone === 1 ? '' : 's'} dated after ${present ?? 'today'} ${undone === 1 ? 'is' : 'are'} hidden: an earlier save was loaded since, so ${undone === 1 ? 'it' : 'they'} never happened.`
            : null}
        </span>
        <Link to="/fortress/chronicle" className="text-primary underline-offset-4 hover:underline">
          Full chronicle
        </Link>
      </div>
    </Section>
  )
}

const Stores = ({ summary, population }: { summary: FortSummary; population: number }) => {
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

const PerDwarf = ({
  label,
  total,
  each,
  low,
}: {
  label: string
  total: number
  each: number
  low: boolean
}) => {
  return (
    <div>
      <div className="text-sm text-muted-foreground">
        {label}
        {low ? <span className="text-amber-600 dark:text-amber-400"> · running low</span> : null}
      </div>
      <div
        className={cn(
          'text-xl font-semibold tabular-nums',
          low && 'text-amber-600 dark:text-amber-400',
        )}
      >
        {each}
        <span className="ml-1 text-sm font-normal text-muted-foreground">per dwarf</span>
      </div>
      <div className="text-xs text-muted-foreground tabular-nums">
        {formatNumber(total)} in stock
      </div>
    </div>
  )
}

const MoodBar = ({ counts }: { counts: number[] }) => {
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
