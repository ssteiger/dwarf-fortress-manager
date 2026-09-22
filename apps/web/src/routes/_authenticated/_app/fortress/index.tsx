import { STRESS_LABELS } from '@fortress/db-drizzle/fortress-types'
import { Badge, Card, CardContent, CardHeader, CardTitle, cn } from '@fortress/ui'
import { Link, createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangleIcon,
  BeerIcon,
  CoinsIcon,
  HeartPulseIcon,
  PawPrintIcon,
  ShieldAlertIcon,
  SwordsIcon,
  UsersIcon,
} from 'lucide-react'

import { STRESS_BAR_COLORS, formatGameTick, formatNumber, formatValue } from '~/lib/fortress/format'
import { useFortOverview } from '~/lib/fortress/queries'
import { EmptyState, PageHeader, StatCard, StatusBanner } from './-components/fort-chrome'

const SEVERITY_CLASSES = {
  danger: 'border-red-500/40 bg-red-500/10',
  warning: 'border-amber-500/40 bg-amber-500/10',
  info: 'border-sky-500/30 bg-sky-500/5',
} as const

const SEVERITY_ICON = {
  danger: ShieldAlertIcon,
  warning: AlertTriangleIcon,
  info: HeartPulseIcon,
} as const

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

function OverviewPage() {
  const { data, isFetching, refetch, dataUpdatedAt } = useFortOverview()
  const state = data?.state ?? null
  const world = state?.world ?? null
  const summary = state?.summary ?? null
  const population = summary ? summary.adults + summary.children + summary.babies : 0

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
                <span className="text-muted-foreground/70"> ({world.name_native})</span>
              ) : null}
            </>
          ) : (
            'Waiting for the worker to take its first dump of the game.'
          )
        }
        updatedAt={state?.captured_at ?? dataUpdatedAt}
        isFetching={isFetching}
        onRefresh={() => refetch()}
      />

      <StatusBanner state={state} />

      {summary ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Citizens"
              value={population}
              Icon={UsersIcon}
              hint={`${summary.adults} adults · ${summary.children} children · ${summary.babies} babies`}
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
              title="On the map"
              value={summary.hostiles}
              Icon={ShieldAlertIcon}
              accentClassName={summary.hostiles > 0 ? 'text-red-500' : 'text-muted-foreground'}
              hint={`dangerous creatures · ${summary.visitors} visitors · ${summary.merchants} merchants`}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Mood of the fortress</CardTitle>
              </CardHeader>
              <CardContent>
                <MoodBar counts={summary.mood} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <PawPrintIcon className="size-4" /> Animals
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {summary.tame_animals} tame animals, {summary.war_animals} trained for war.
              </CardContent>
            </Card>
          </div>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Needs attention</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {summary.alerts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing is on fire. The fortress runs itself for now.
                  </p>
                ) : (
                  summary.alerts.map((alert, i) => {
                    const Icon = SEVERITY_ICON[alert.severity]
                    return (
                      <div
                        key={`${alert.kind}-${alert.title}-${i}`}
                        className={cn(
                          'flex items-start gap-3 rounded-lg border p-3',
                          SEVERITY_CLASSES[alert.severity],
                        )}
                      >
                        <Icon className="mt-0.5 size-4 shrink-0" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 font-medium">
                            {alert.title}
                            {alert.count > 1 ? (
                              <Badge variant="outline">{alert.count}</Badge>
                            ) : null}
                          </div>
                          <div className="text-sm text-muted-foreground">{alert.detail}</div>
                        </div>
                      </div>
                    )
                  })
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <BeerIcon className="size-4" /> Stores
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
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
                            (stock.key === 'drink' || stock.key === 'meals') &&
                              population > 0 &&
                              stock.count < population * 3
                              ? 'text-amber-600 dark:text-amber-400'
                              : undefined,
                          )}
                        >
                          {formatNumber(stock.count)}
                        </dd>
                      </div>
                    ))}
                </dl>
                <div className="mt-3 text-xs text-muted-foreground">
                  <Link to="/fortress/items" className="underline-offset-4 hover:underline">
                    Browse all {formatNumber(summary.items_total)} items
                  </Link>
                </div>
              </CardContent>
            </Card>
          </section>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">Latest from the fortress</CardTitle>
              <Link
                to="/fortress/chronicle"
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                Full chronicle
              </Link>
            </CardHeader>
            <CardContent>
              {data?.events.length ? (
                <ul className="divide-y text-sm">
                  {data.events.slice(0, 12).map((event) => (
                    <li key={event.id} className="flex gap-3 py-1.5">
                      <span className="w-32 shrink-0 text-xs text-muted-foreground tabular-nums">
                        {formatGameTick(event.game_year, event.game_tick)}
                      </span>
                      <span className={cn(event.type === 'CANCEL_JOB' && 'text-muted-foreground')}>
                        {event.text}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No announcements recorded yet.</p>
              )}
            </CardContent>
          </Card>
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

function MoodBar({ counts }: { counts: number[] }) {
  const total = counts.reduce((a, b) => a + b, 0)
  if (total === 0)
    return <p className="text-sm text-muted-foreground">No citizens to be happy or sad.</p>
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted">
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
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
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
