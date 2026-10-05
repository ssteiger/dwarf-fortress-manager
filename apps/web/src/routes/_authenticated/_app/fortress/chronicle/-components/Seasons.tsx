import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton, cn } from '@fortress/ui'
import { EyeIcon } from 'lucide-react'
import * as React from 'react'

import {
  type Recap,
  type RecapSection,
  buildRecap,
  ownGroupsOf,
} from '~/lib/fortress/chronicle/recap'
import { useFortOverview, useFortSeasons, useFortUnits } from '~/lib/fortress/client/queries'
import { useWatchList } from '~/lib/fortress/client/watch'
import { formatGameTick } from '~/lib/fortress/format'
import { LIFE_TONE_DOT } from '~/lib/fortress/people/lifeEvents'
import { type SeasonRef, seasonAt, seasonIndex, seasonTitle } from '~/lib/fortress/time'
import { EmptyState } from '../../-components/FortChrome'
import { AnnouncementText } from '../../-components/Insights'
import { useFortLegendsWorldId, useKnownHistFigures } from '../../dwarves/-components/UnitLinks'

const SECTION_LINES = 8

type Legends = { worldId: number; known: Set<number> } | null

/** The fortress's book: every season the app knows anything of, newest first, under its year. */
export function Seasons() {
  const seasons = useFortSeasons()
  const units = useFortUnits().data?.units
  const world = useFortOverview().data?.state?.world
  const ownGroups = React.useMemo(() => ownGroupsOf(world), [world])
  const { ids: watched } = useWatchList()
  const pages = seasons.data?.pages
  const all = React.useMemo(() => (pages ?? []).flatMap((p) => p.seasons), [pages])
  const readingSince = pages?.[0]?.readingSince ?? null
  const present = pages?.[0]?.present ?? null

  const worldId = useFortLegendsWorldId()
  const known = useKnownHistFigures(
    worldId,
    React.useMemo(() => all.flatMap((s) => s.source.history.flatMap((e) => e.hfids)), [all]),
  )
  const legends = React.useMemo(
    () => (worldId !== null ? { worldId, known } : null),
    [worldId, known],
  )

  const years = React.useMemo(() => {
    const out: { year: number; seasons: { season: SeasonRef; recap: Recap }[] }[] = []
    for (const { season, source } of all) {
      const recap = buildRecap(source, { units: units ?? [], watched, ownGroups })
      const last = out[out.length - 1]
      if (last?.year === season.year) last.seasons.push({ season, recap })
      else out.push({ year: season.year, seasons: [{ season, recap }] })
    }
    return out
  }, [all, units, watched, ownGroups])

  if (seasons.isPending)
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  if (!all.length)
    return seasons.isError ? (
      <EmptyState title="The seasons could not be read">
        {seasons.error instanceof Error ? seasons.error.message : String(seasons.error)}
      </EmptyState>
    ) : (
      <EmptyState title="No seasons yet">
        Each season gets its recap once the worker has read some of it from the game.
      </EmptyState>
    )

  const startedIn = readingSince ? seasonAt(readingSince) : null
  const current = present ? seasonIndex(seasonAt(present)) : null
  return (
    <div className="flex flex-col gap-8">
      {years.map(({ year, seasons: inYear }) => (
        <section key={year} aria-label={`The year ${year}`} className="flex flex-col gap-4">
          <h2 className="text-lg font-medium tracking-tight tabular-nums">{year}</h2>
          {inYear.map(({ season, recap }) => (
            <SeasonCard
              key={seasonIndex(season)}
              season={season}
              recap={recap}
              current={seasonIndex(season) === current}
              startedIn={
                startedIn && seasonIndex(season) < seasonIndex(startedIn) ? startedIn : null
              }
              legends={legends}
            />
          ))}
        </section>
      ))}
      {seasons.hasNextPage ? (
        <Button
          variant="outline"
          className="self-start"
          disabled={seasons.isFetchingNextPage}
          onClick={() => void seasons.fetchNextPage()}
        >
          {seasons.isFetchingNextPage ? 'Reading earlier seasons…' : 'Earlier seasons'}
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing earlier is known of the fortress.</p>
      )}
    </div>
  )
}

function SeasonCard({
  season,
  recap,
  current,
  startedIn,
  legends,
}: {
  season: SeasonRef
  recap: Recap
  current: boolean
  /** When the worker began reading, for a season before it. */
  startedIn: SeasonRef | null
  legends: Legends
}) {
  return (
    <Card className="gap-4">
      <CardHeader className="gap-1.5">
        <CardTitle className="text-base">
          {seasonTitle(season)}
          {current ? <span className="font-normal text-muted-foreground">, so far</span> : null}
        </CardTitle>
        {recap.headline.length ? (
          <p className="text-base leading-snug text-pretty">
            <AnnouncementText parts={recap.headline} legends={legends} />
          </p>
        ) : null}
        {startedIn ? (
          <p className="text-sm text-muted-foreground">
            The worker began reading in {seasonTitle(startedIn)}, so this season is told from the
            world’s history alone.
          </p>
        ) : null}
      </CardHeader>
      {recap.sections.length ? (
        <CardContent className="gap-x-10 lg:columns-2">
          {recap.sections.map((section) => (
            <SectionLines key={section.key} section={section} legends={legends} />
          ))}
        </CardContent>
      ) : null}
    </Card>
  )
}

function SectionLines({ section, legends }: { section: RecapSection; legends: Legends }) {
  const [all, setAll] = React.useState(false)
  const folded = !all && section.lines.length > SECTION_LINES + 2
  const shown = folded ? section.lines.slice(0, SECTION_LINES) : section.lines
  return (
    <div className="mb-5 flex min-w-0 break-inside-avoid flex-col gap-1.5 last:mb-0">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {section.title}
      </h3>
      <ul className="flex flex-col gap-1 text-sm">
        {shown.map((line) => (
          <li key={line.key} className="flex gap-2">
            {line.watched ? (
              <EyeIcon className="mt-0.5 size-3.5 shrink-0 text-primary" aria-label="Watched" />
            ) : (
              <span
                className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', LIFE_TONE_DOT[line.tone])}
                aria-hidden
              />
            )}
            <span className="min-w-0 flex-1">
              <AnnouncementText parts={line.parts} legends={legends} />
            </span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {formatGameTick(line.year, line.tick)}
            </span>
          </li>
        ))}
      </ul>
      {folded ? (
        <button
          type="button"
          className="self-start text-sm text-muted-foreground hover:text-foreground hover:underline"
          onClick={() => setAll(true)}
        >
          Show {section.lines.length - SECTION_LINES} more
        </button>
      ) : null}
    </div>
  )
}
