import { Button } from '@fortress/ui'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import * as React from 'react'

import { LegendsSprite } from '~/lib/df-assets/legends'
import type { Story } from '~/lib/legends/chronicle'
import { yearSpan } from '~/lib/legends/events'
import { RACE_COLORS, titleCase, words } from '~/lib/legends/model'
import type { LegendsWorldSummary } from '~/lib/legends/server'
import { ChroniclePanel } from '../-components/Chronicle'
import { HistoryChart, type YearSpan } from '../-components/HistoryChart'
import { LegendsShell, RecordLink, Section, parseWorldParam } from '../-components/LegendsChrome'
import { StoryCard, useStories } from '../-components/Stories'

interface HistorySearch {
  world?: number
  from?: number
  to?: number
}

function HistoryPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const setSpan = (span: YearSpan | null) =>
    navigate({
      search: (prev) => ({ ...prev, from: span?.from, to: span?.to }),
      replace: true,
    })
  return (
    <LegendsShell section="history" world={search.world}>
      {({ worldId, summary, summaryLoading }) => (
        <HistoryBody
          worldId={worldId}
          summary={summary}
          loading={summaryLoading}
          span={
            search.from !== undefined && search.to !== undefined
              ? { from: search.from, to: search.to }
              : null
          }
          onSpan={setSpan}
        />
      )}
    </LegendsShell>
  )
}

function HistoryBody({
  worldId,
  summary,
  loading,
  span,
  onSpan,
}: {
  worldId: number
  summary: LegendsWorldSummary | undefined
  loading: boolean
  span: YearSpan | null
  onSpan: (span: YearSpan | null) => void
}) {
  const navigate = useNavigate()
  const onSearch = (q: string) =>
    navigate({
      to: '/legends/archive',
      search: { world: worldId, archive: 'figures', q },
    })

  if (!summary) {
    return (
      <p className="text-sm text-muted-foreground">
        {loading ? 'Reading the chronicles…' : 'No history yet.'}
      </p>
    )
  }
  const years = summary.years
  // Without a choice, read the latest stretch of history.
  const current: YearSpan | null =
    span ??
    (years ? { from: Math.max(years.max - summary.binYears + 1, years.min), to: years.max } : null)

  return (
    <div className="flex flex-col gap-4">
      <Section
        title={
          years ? `${(years.max - years.min + 1).toLocaleString()} years of history` : 'History'
        }
        description={
          summary.eras.length
            ? `Eras: ${summary.eras.map((e) => `${e.name} (from ${e.startYear < 0 ? 'the beginning' : `year ${e.startYear}`})`).join(', ')}. Click a bar, drag across several, or click an era to read those years.`
            : 'Click a bar, drag across several, or click an era to read those years.'
        }
        action={
          years && current && (current.from !== years.min || current.to !== years.max) ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSpan({ from: years.min, to: years.max })}
            >
              Read all {(years.max - years.min + 1).toLocaleString()} years
            </Button>
          ) : null
        }
      >
        <HistoryChart
          bins={summary.timeline}
          binYears={summary.binYears}
          eras={summary.eras}
          selection={current}
          onSelect={(next) =>
            onSpan(
              years
                ? { from: Math.max(next.from, years.min), to: Math.min(next.to, years.max) }
                : next,
            )
          }
        />
      </Section>

      {years && current ? (
        <ChroniclePanel worldId={worldId} span={current} years={years} onSpan={onSpan} />
      ) : null}

      <StoriesStrip worldId={worldId} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Names that fill the chronicles"
          description="The figures mentioned in the most recorded events."
        >
          <ul className="divide-y">
            {summary.notable.map((figure, i) => (
              <li key={figure.id} className="flex items-center gap-3 py-2">
                <span className="w-5 text-right text-sm text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
                <LegendsSprite
                  subject={{ kind: 'historical_figure', id: figure.id, race: figure.raceToken }}
                  size={32}
                  className="-my-1"
                />
                <div className="min-w-0 flex-1">
                  <RecordLink
                    kind="historical_figure"
                    id={figure.id}
                    name={figure.name}
                    type={figure.race}
                    worldId={worldId}
                  />
                  <div className="text-sm text-muted-foreground">
                    {figure.race ? words(figure.race) : 'unknown'}
                    {figure.birthYear !== null && figure.birthYear >= 0
                      ? ` · born ${figure.birthYear}`
                      : ''}
                    {figure.deathYear !== null && figure.deathYear >= 0
                      ? `, died ${figure.deathYear}`
                      : figure.birthYear !== null
                        ? ', still alive'
                        : ''}
                  </div>
                </div>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {figure.events.toLocaleString()} events
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Peoples and beasts"
          description="Everyone with a place in history, by race. Click a race to browse its figures."
        >
          <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            {summary.races.map((row) => (
              <li key={row.race} className="flex items-center gap-2 border-b py-1.5 text-sm">
                <span
                  className="inline-block size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: RACE_COLORS[row.race] ?? '#a8a29e' }}
                />
                <LegendsSprite
                  subject={{ kind: 'creature', id: 0, race: row.token }}
                  size={20}
                  className="-my-1"
                />
                <button
                  type="button"
                  onClick={() => onSearch(row.race)}
                  className="flex-1 text-left hover:underline"
                >
                  {titleCase(row.race)}
                </button>
                <span className="tabular-nums text-muted-foreground">
                  {row.total.toLocaleString()}
                  <span className="ml-1 text-xs">({row.alive.toLocaleString()} alive)</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Wars"
          count={summary.wars.length}
          description="Declared wars between civilizations. Click the years to read them."
        >
          {summary.wars.length ? (
            <ul className="divide-y">
              {summary.wars.map((war) => (
                <li key={war.id} className="py-2">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <RecordLink
                      kind="historical_event_collection"
                      id={war.id}
                      name={war.name}
                      worldId={worldId}
                    />
                    {war.startYear !== null && war.startYear >= 0 ? (
                      <button
                        type="button"
                        className="text-sm text-muted-foreground tabular-nums underline-offset-2 hover:underline"
                        onClick={() =>
                          onSpan({
                            from: war.startYear ?? 0,
                            to:
                              war.endYear !== null && war.endYear >= 0
                                ? war.endYear
                                : (years?.max ?? war.startYear ?? 0),
                          })
                        }
                      >
                        {yearSpan(war.startYear, war.endYear)}
                      </button>
                    ) : null}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {war.aggressor ? (
                      <RecordLink
                        kind="entity"
                        id={war.aggressor.id}
                        name={war.aggressor.name}
                        worldId={worldId}
                        className="font-normal"
                      />
                    ) : (
                      'Unknown'
                    )}{' '}
                    against{' '}
                    {war.defender ? (
                      <RecordLink
                        kind="entity"
                        id={war.defender.id}
                        name={war.defender.name}
                        worldId={worldId}
                        className="font-normal"
                      />
                    ) : (
                      'unknown'
                    )}
                    {war.battles ? ` · ${war.battles} battle${war.battles === 1 ? '' : 's'}` : ''}
                    {war.conquests
                      ? ` · ${war.conquests} site${war.conquests === 1 ? '' : 's'} conquered`
                      : ''}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No wars were declared. A peaceful world, or a quiet export.
            </p>
          )}
        </Section>

        <Section
          title="Gods and forces"
          count={summary.deitiesTotal}
          description="Deities worshipped by the civilizations, and the spheres they hold."
          action={
            <button
              type="button"
              className="text-sm text-primary underline-offset-4 hover:underline"
              onClick={() => onSearch('deity')}
            >
              Browse all
            </button>
          }
        >
          <ul className="divide-y">
            {summary.deities.map((deity) => (
              <li key={deity.id} className="flex flex-wrap items-center gap-x-3 py-2">
                <LegendsSprite
                  subject={{ kind: 'historical_figure', id: deity.id, race: deity.raceToken }}
                  size={24}
                  className="-my-1"
                />
                <RecordLink
                  kind="historical_figure"
                  id={deity.id}
                  name={deity.name}
                  worldId={worldId}
                />
                <span className="text-sm text-muted-foreground">
                  {deity.race ? `${words(deity.race)} god` : 'god'}
                  {deity.spheres.length ? ` of ${deity.spheres.join(', ')}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  )
}

/** One story from each of the liveliest groups, as a way into the Stories tab. */
function StoriesStrip({ worldId }: { worldId: number }) {
  const stories = useStories(worldId)
  const picks = React.useMemo(() => {
    const groups = stories.data?.groups ?? []
    const order = ['battles', 'slayers', 'lives', 'cursed', 'contested', 'hearts']
    return order
      .map((key) => groups.find((g) => g.key === key)?.stories[0])
      .filter((s): s is Story => Boolean(s))
      .slice(0, 4)
  }, [stories.data])
  if (!stories.data || !picks.length) return null
  return (
    <Section
      title="Stories worth reading"
      description="Threads the records keep returning to."
      action={
        <Button asChild variant="outline" size="sm">
          <Link to="/legends/stories" search={{ world: worldId }}>
            All stories
          </Link>
        </Button>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        {picks.map((story) => (
          <StoryCard key={story.key} story={story} names={stories.data.names} worldId={worldId} />
        ))}
      </div>
    </Section>
  )
}

function parseYear(raw: unknown): number | undefined {
  const n =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

export const Route = createFileRoute('/_authenticated/_app/legends/history/')({
  validateSearch: (raw: Record<string, unknown>): HistorySearch => {
    const out: HistorySearch = {}
    const world = parseWorldParam(raw.world)
    if (world !== undefined) out.world = world
    const from = parseYear(raw.from)
    const to = parseYear(raw.to)
    if (from !== undefined && to !== undefined) {
      out.from = Math.min(from, to)
      out.to = Math.max(from, to)
    }
    return out
  },
  component: HistoryPage,
})
