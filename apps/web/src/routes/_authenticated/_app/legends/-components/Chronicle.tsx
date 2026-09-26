import { Button, cn } from '@fortress/ui'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronLeftIcon, ChevronRightIcon, MinusIcon, PlusIcon } from 'lucide-react'
import * as React from 'react'

import { LegendsSprite } from '~/lib/df-assets/legends'
import { type SpanDigest, getSpanDigest } from '~/lib/legends/chronicle'
import { yearSpan } from '~/lib/legends/events'
import { titleCase, words } from '~/lib/legends/model'
import { spanLabel, summarizeSpan } from '~/lib/legends/prose'
import type { YearSpan } from './HistoryChart'
import { PinButton } from './Journal'
import { EventLine, RecordLink, Section } from './LegendsChrome'
import { NarrateButton } from './Narrator'

export function useSpanDigest(worldId: number, span: YearSpan | null) {
  return useQuery({
    queryKey: ['legends', 'digest', worldId, span?.from, span?.to],
    queryFn: () => getSpanDigest({ data: { worldId, from: span?.from ?? 0, to: span?.to ?? 0 } }),
    enabled: span !== null,
    placeholderData: keepPreviousData,
    staleTime: 10 * 60_000,
  })
}

/**
 * What happened in a span of years, told as a chronicle: a summary, the
 * moments worth reading, the battles, the wars under way and the people
 * whose names fill the records.
 */
export function ChroniclePanel({
  worldId,
  span,
  years,
  onSpan,
  actions,
  compact = false,
}: {
  worldId: number
  span: YearSpan
  /** The whole recorded history, for clamping and the "everything" button. */
  years: { min: number; max: number }
  onSpan: (span: YearSpan) => void
  /** Extra controls in the header (narration, pinning). */
  actions?: React.ReactNode
  compact?: boolean
}) {
  const digest = useSpanDigest(worldId, span)
  const length = span.to - span.from + 1
  const shift = (direction: -1 | 1) => {
    const from = Math.min(
      Math.max(span.from + direction * length, years.min),
      years.max - length + 1,
    )
    onSpan({ from, to: from + length - 1 })
  }
  const resize = (factor: number) => {
    const next = Math.max(1, Math.round(length * factor))
    const centre = (span.from + span.to) / 2
    const from = Math.min(Math.max(Math.round(centre - next / 2), years.min), years.max - next + 1)
    onSpan({ from: Math.max(from, years.min), to: Math.min(from + next - 1, years.max) })
  }

  return (
    <Section
      title={`Chronicle of ${spanLabel(span.from, span.to)}`}
      description={
        digest.data
          ? `${digest.data.counts.total.toLocaleString()} events recorded. ${length === 1 ? 'A single year.' : `${length.toLocaleString()} years.`}`
          : 'Reading the records…'
      }
      action={
        <div className="flex flex-wrap items-center gap-1">
          {actions}
          <NarrateButton
            worldId={worldId}
            subject={{ kind: 'span', from: span.from, to: span.to }}
            title={`Chronicle of ${spanLabel(span.from, span.to)}`}
            size="icon"
          />
          <PinButton
            worldId={worldId}
            target={{
              kind: 'span',
              id: `${span.from}-${span.to}`,
              title: `Chronicle of ${spanLabel(span.from, span.to)}`,
            }}
            className="size-8"
          />
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="Wider span"
            title="Twice as many years"
            onClick={() => resize(2)}
          >
            <PlusIcon className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="Narrower span"
            title="Half as many years"
            onClick={() => resize(0.5)}
            disabled={length <= 1}
          >
            <MinusIcon className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="Earlier"
            title={`${length} years earlier`}
            onClick={() => shift(-1)}
            disabled={span.from <= years.min}
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="Later"
            title={`${length} years later`}
            onClick={() => shift(1)}
            disabled={span.to >= years.max}
          >
            <ChevronRightIcon className="size-4" />
          </Button>
        </div>
      }
    >
      {digest.data ? (
        <ChronicleBody
          worldId={worldId}
          digest={digest.data}
          compact={compact}
          onSpan={onSpan}
          stale={digest.isPlaceholderData}
        />
      ) : digest.isError ? (
        <p className="text-sm text-destructive">The records could not be read.</p>
      ) : (
        <p className="text-sm text-muted-foreground">Reading the chronicles…</p>
      )}
    </Section>
  )
}

function ChronicleBody({
  worldId,
  digest,
  compact,
  onSpan,
  stale,
}: {
  worldId: number
  digest: SpanDigest
  compact: boolean
  onSpan: (span: YearSpan) => void
  stale: boolean
}) {
  const [showAll, setShowAll] = React.useState(false)
  const moments = showAll ? digest.moments : digest.moments.slice(0, compact ? 12 : 25)
  return (
    <div className={cn('flex flex-col gap-6', stale && 'opacity-60 transition-opacity')}>
      <p className="max-w-[70ch] text-base leading-relaxed">{summarizeSpan(digest)}</p>

      <div
        className={cn('grid gap-6', compact ? 'grid-cols-1' : 'lg:grid-cols-[minmax(0,1fr)_280px]')}
      >
        <div className="flex flex-col gap-6">
          <div>
            <h3 className="mb-2 text-sm font-medium text-muted-foreground">Defining moments</h3>
            {moments.length ? (
              <ol className="divide-y">
                {moments.map((event) => (
                  <EventLine key={event.id} event={event} names={digest.names} worldId={worldId} />
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing the chroniclers dwelt on.</p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-x-4">
              {digest.moments.length > moments.length ? (
                <Button variant="link" size="sm" className="px-0" onClick={() => setShowAll(true)}>
                  Show all {digest.moments.length}
                </Button>
              ) : null}
              <Button asChild variant="link" size="sm" className="px-0">
                <Link
                  to="/legends/archive"
                  search={{ world: worldId, archive: 'events', from: digest.from, to: digest.to }}
                >
                  Every event of these years
                </Link>
              </Button>
            </div>
          </div>

          {digest.battles.length ? (
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">Battles</h3>
              <ul className="divide-y">
                {digest.battles.slice(0, compact ? 5 : 10).map((battle) => (
                  <li
                    key={battle.id}
                    className="flex flex-wrap items-baseline gap-x-3 py-1.5 text-sm"
                  >
                    <RecordLink
                      kind="historical_event_collection"
                      id={battle.id}
                      name={battle.name}
                      worldId={worldId}
                    />
                    <span className="text-muted-foreground tabular-nums">{battle.year ?? ''}</span>
                    <span className="text-muted-foreground">
                      {battle.attacker?.name ? titleCase(battle.attacker.name) : 'Unknown'} against{' '}
                      {battle.defender?.name ? titleCase(battle.defender.name) : 'unknown'}
                      {battle.site ? (
                        <>
                          {' at '}
                          <RecordLink
                            kind="site"
                            id={battle.site.id}
                            name={battle.site.name}
                            worldId={worldId}
                            className="font-normal"
                          />
                        </>
                      ) : null}
                      {battle.casualties ? ` · ${battle.casualties.toLocaleString()} fell` : ''}
                      {battle.outcome ? ` · ${battle.outcome}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-6">
          {digest.people.length ? (
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">People of the age</h3>
              <ul className="flex flex-col gap-1.5">
                {digest.people.slice(0, compact ? 6 : 12).map((person) => (
                  <li key={person.id} className="flex items-center gap-2 text-sm">
                    <LegendsSprite
                      subject={{ kind: 'historical_figure', id: person.id, race: person.raceToken }}
                      size={24}
                      className="-my-1"
                    />
                    <div className="min-w-0 flex-1">
                      <RecordLink
                        kind="historical_figure"
                        id={person.id}
                        name={person.name}
                        type={person.raceToken}
                        worldId={worldId}
                        className="block truncate"
                      />
                      <div className="truncate text-xs text-muted-foreground">
                        {person.race ? words(person.race) : 'unknown'}
                        {yearSpan(person.birthYear, person.deathYear)
                          ? ` · ${yearSpan(person.birthYear, person.deathYear)}`
                          : ''}
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {person.events}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {digest.wars.length ? (
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">Wars under way</h3>
              <ul className="flex flex-col gap-1.5">
                {digest.wars.slice(0, 8).map((war) => (
                  <li key={war.id} className="text-sm">
                    <RecordLink
                      kind="historical_event_collection"
                      id={war.id}
                      name={war.name}
                      worldId={worldId}
                    />
                    <div className="text-xs text-muted-foreground">
                      {war.aggressor?.name ? titleCase(war.aggressor.name) : 'Unknown'} against{' '}
                      {war.defender?.name ? titleCase(war.defender.name) : 'unknown'}
                      {yearSpan(war.startYear, war.endYear)
                        ? ` · ${yearSpan(war.startYear, war.endYear)}`
                        : ''}
                      {war.startYear !== null ? (
                        <>
                          {' · '}
                          <button
                            type="button"
                            className="underline-offset-2 hover:underline"
                            onClick={() =>
                              onSpan({
                                from: war.startYear ?? 0,
                                to:
                                  war.endYear !== null && war.endYear >= 0
                                    ? war.endYear
                                    : digest.to,
                              })
                            }
                          >
                            read those years
                          </button>
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
