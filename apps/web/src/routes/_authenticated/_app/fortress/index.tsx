import type { FortEvent, FortSummary } from '@fortress/db-drizzle'
import { STRESS_LABELS } from '@fortress/db-drizzle/fortress-types'
import { Card, CardContent, CardHeader, CardTitle, cn } from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { formatDistanceToNow } from 'date-fns'
import {
  BeerIcon,
  CoinsIcon,
  HistoryIcon,
  ShieldAlertIcon,
  SwordsIcon,
  UsersIcon,
} from 'lucide-react'
import * as React from 'react'

import { fortAdvice, situations } from '~/lib/fortress/advisor'
import {
  STRESS_BAR_COLORS,
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
  type StoryKind,
  absTicks,
  activityBoard,
  firstName,
  fortFeelings,
  fortNotices,
  gameSpan,
  gameTimeOf,
  makeNameLinker,
  storyKind,
} from '~/lib/fortress/insights'
import { useLastSeen } from '~/lib/fortress/lastSeen'
import {
  FORT_SLOW_REFRESH_MS,
  useFortConcerns,
  useFortOverview,
  useFortSupplies,
  useFortUnits,
} from '~/lib/fortress/queries'
import { getFortWork } from '~/lib/fortress/server'
import { EmptyState, PageHeader, StatCard, StatusBanner } from './-components/FortChrome'
import { GuideProvider, useOpenGuide } from './-components/Guide'
import {
  ActivityBoard,
  AlertsMenu,
  FeelingsPanel,
  NoticeList,
  StoryFeed,
  StoryIcon,
} from './-components/Insights'

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
    refetchInterval: FORT_SLOW_REFRESH_MS,
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

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        eyebrow="Fortress"
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
        actions={<AlertsMenu />}
      />

      <StatusBanner state={state} />

      {summary ? (
        <>
          {lastSeen ? (
            <SinceLastLook
              lastSeen={lastSeen}
              events={events}
              now={now}
              fortName={state?.fort_name ?? 'the fortress'}
            />
          ) : null}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
            <StatCard
              title="Citizens"
              value={population}
              Icon={UsersIcon}
              hint={`${summary.adults} adults · ${summary.children} children · ${summary.babies} babies · ${summary.tame_animals} tame animals`}
            />
            <StatCard
              title="At work"
              value={`${summary.working} / ${summary.working + summary.idle}`}
              Icon={SwordsIcon}
              hint={`${summary.idle} idle · ${summary.military} in squads · ${formatNumber(summary.jobs_total)} jobs queued (${summary.jobs_suspended} suspended)`}
            />
            <StatCard
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
            <StatCard
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
                  <CardTitle className="text-base">Needs your attention</CardTitle>
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
                  <NoticeList notices={notices} onGuide={guideNotice} />
                </CardContent>
              </Card>

              <Card className="gap-4">
                <CardHeader>
                  <CardTitle className="text-base">How the fortress feels</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    What went through your citizens’ heads this past month. Click a line to see who.
                  </p>
                </CardHeader>
                <CardContent>
                  <FeelingsPanel feelings={feelings} onGuide={guideFeeling} />
                </CardContent>
              </Card>

              <StoryCard
                events={events}
                link={link}
                newAfter={lastSeen?.eventId ?? null}
                undone={data?.undone ?? 0}
                present={world ? `${world.day} ${world.month_name} ${world.year}` : null}
              />
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
                  <MoodBar counts={summary.mood} />
                  <ActivityBoard groups={board} />
                </CardContent>
              </Card>

              <Card className="gap-4">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <BeerIcon className="size-4" /> Stores
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Stores summary={summary} population={population} />
                </CardContent>
              </Card>
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

/** What changed since the overview was last open, in wall-clock and in game time. */
function SinceLastLook({
  lastSeen,
  events,
  now,
  fortName,
}: {
  lastSeen: NonNullable<ReturnType<typeof useLastSeen>>
  events: FortEvent[]
  now: ReturnType<typeof gameTimeOf>
  fortName: string
}) {
  const fresh = events.filter((e) => e.id > lastSeen.eventId)
  const counts = new Map<StoryKind, number>()
  for (const e of fresh) {
    const kind = storyKind(e)
    if (STORY_KINDS[kind].story) counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  const passed = now && lastSeen.game ? absTicks(now) - absTicks(lastSeen.game) : null
  const wentBack = passed !== null && passed < 0
  if (!fresh.length && !wentBack && (passed === null || passed < 1200)) return null
  const when = formatDistanceToNow(lastSeen.at, { addSuffix: true })
  const span =
    passed !== null && passed >= 1200 ? `${gameSpan(passed)} passed in ${fortName}` : null
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-muted/30 px-4 py-3 text-sm">
      <HistoryIcon className="size-4 shrink-0 text-primary" />
      <span>
        {wentBack ? (
          <>
            You last looked {when}. Since then {fortName} has gone back {gameSpan(-(passed ?? 0))}:
            an earlier save was loaded.
          </>
        ) : (
          <>
            You last looked {when}. Since then{' '}
            {span
              ? `${span}${counts.size ? ':' : ', with nothing of note.'}`
              : counts.size
                ? ':'
                : 'nothing of note happened.'}
          </>
        )}
      </span>
      {[...counts.entries()].map(([kind, n]) => (
        <span key={kind} className="inline-flex items-center gap-1.5">
          <StoryIcon kind={kind} />
          {n} {STORY_KINDS[kind].noun[n === 1 ? 0 : 1]}
        </span>
      ))}
      {fresh.length ? (
        <span className="text-muted-foreground">New entries are marked below.</span>
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
          <CardTitle className="text-base">The story so far</CardTitle>
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
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {counts.map((count, i) =>
          count > 0 ? (
            <div
              key={STRESS_LABELS[i]}
              title={`${count} ${STRESS_LABELS[i]}`}
              style={{ width: `${(count / total) * 100}%`, backgroundColor: STRESS_BAR_COLORS[i] }}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {counts.map((count, i) =>
          count > 0 ? (
            <span key={STRESS_LABELS[i]} className="flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-full"
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
