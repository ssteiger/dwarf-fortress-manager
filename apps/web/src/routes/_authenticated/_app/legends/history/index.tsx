import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { yearSpan } from '~/lib/legends/events'
import { RACE_COLORS, titleCase, words } from '~/lib/legends/model'
import type { LegendsWorldSummary } from '~/lib/legends/server'
import { HistoryChart } from '../-components/HistoryChart'
import { LegendsShell, RecordLink, Section, parseWorldSearch } from '../-components/LegendsChrome'

function HistoryPage() {
  const { world } = Route.useSearch()
  return (
    <LegendsShell section="history" world={world}>
      {({ worldId, summary, summaryLoading }) => (
        <HistoryBody worldId={worldId} summary={summary} loading={summaryLoading} />
      )}
    </LegendsShell>
  )
}

function HistoryBody({
  worldId,
  summary,
  loading,
}: {
  worldId: number
  summary: LegendsWorldSummary | undefined
  loading: boolean
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
  return (
    <div className="flex flex-col gap-4">
      <Section
        title={
          years ? `${(years.max - years.min + 1).toLocaleString()} years of history` : 'History'
        }
        description={
          summary.eras.length
            ? `Eras: ${summary.eras.map((e) => `${e.name} (from ${e.startYear < 0 ? 'the beginning' : `year ${e.startYear}`})`).join(', ')}.`
            : undefined
        }
      >
        <HistoryChart bins={summary.timeline} binYears={summary.binYears} eras={summary.eras} />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
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
              <li key={deity.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
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
          description="Declared wars between civilizations, with their battles and conquered sites."
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
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {yearSpan(war.startYear, war.endYear)}
                    </span>
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
          title="Names that fill the chronicles"
          description="The figures mentioned in the most recorded events."
        >
          <ul className="divide-y">
            {summary.notable.map((figure, i) => (
              <li key={figure.id} className="flex items-baseline gap-3 py-2">
                <span className="w-5 text-right text-sm text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
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
      </div>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/_app/legends/history/')({
  validateSearch: parseWorldSearch,
  component: HistoryPage,
})
