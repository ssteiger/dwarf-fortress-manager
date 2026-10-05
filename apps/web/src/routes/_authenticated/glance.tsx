import type { FortEvent, FortState, FortUnit } from '@fortress/db-drizzle'
import { Toaster, cn } from '@fortress/ui'
import { createFileRoute } from '@tanstack/react-router'
import { formatDistanceToNow } from 'date-fns'
import {
  CircleAlertIcon,
  ExternalLinkIcon,
  EyeIcon,
  MoonIcon,
  PlugZapIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import * as React from 'react'

import { type Notice, fortNotices } from '~/lib/fortress/advice/notices'
import { STORY_KINDS, cleanAnnouncement, storyKind } from '~/lib/fortress/chronicle/announcements'
import { FortWatcher } from '~/lib/fortress/client/FortWatcher'
import {
  useFailingFortReads,
  useFortConcerns,
  useFortOverview,
  useFortUnits,
  useTick,
} from '~/lib/fortress/client/queries'
import { useWatchList } from '~/lib/fortress/client/watch'
import { formatGameTick, isLiving, stressLabel, unitGroup } from '~/lib/fortress/format'
import { emotionTone, thoughtPhrase } from '~/lib/fortress/people/thoughts'
import { moodText } from '~/lib/fortress/people/troubles'
import { firstName } from '~/lib/fortress/people/units'
import { latestThought } from '~/lib/fortress/people/watchChanges'
import { gameTimeOf } from '~/lib/fortress/time'
import { usePreferencesSync } from '~/lib/preferences'
import { MoodBadge, SectionBoundary } from './_app/fortress/-components/FortChrome'
import { StoryIcon } from './_app/fortress/-components/Insights'

/*
 * The fortress at a glance, for a second screen or a small window beside the
 * game: what needs you most, who is struggling, the dwarves you watch, what
 * the work and stores warn of, and the chronicle's last lines. No scrolling.
 */

const MAX_WATCHED = 6
const MAX_STRUGGLING = 5
const MAX_WARNINGS = 4
const MAX_CHRONICLE = 8

function GlancePage() {
  usePreferencesSync()
  const overview = useFortOverview()
  const unitsQuery = useFortUnits()
  const concerns = useFortConcerns()
  const state = overview.data?.state ?? null
  const summary = state?.summary ?? null
  const now = gameTimeOf(state)
  const units = unitsQuery.data?.units ?? []
  const { ids: watched } = useWatchList()

  const notices = React.useMemo(
    () => fortNotices({ summary, units, concerns: concerns.data ?? null, now }),
    [summary, units, concerns.data, now],
  )
  const urgent = notices.filter((n) => n.severity === 'danger' || n.severity === 'warning')
  const warnings = notices.filter(
    (n) => (n.kind === 'work' || n.kind === 'supply') && n.key !== urgent[0]?.key,
  )
  const events = overview.data?.events ?? []

  return (
    <div className="flex h-dvh flex-col gap-3 overflow-hidden p-3 text-sm">
      <Toaster position="bottom-center" />
      <FortWatcher />
      <Header state={state} />
      {state ? (
        <>
          <SectionBoundary name="The most urgent">
            <Urgent notices={urgent} />
          </SectionBoundary>
          <SectionBoundary name="The dwarves you watch">
            <Watched units={units} watched={watched} />
          </SectionBoundary>
          <SectionBoundary name="Who is struggling">
            <Struggling units={units} watched={watched} />
          </SectionBoundary>
          <SectionBoundary name="The warnings">
            <Warnings notices={warnings} />
          </SectionBoundary>
          <SectionBoundary name="The chronicle">
            <Chronicle events={events} />
          </SectionBoundary>
        </>
      ) : (
        <p className="text-muted-foreground">
          {overview.isPending
            ? 'Reading the fortress…'
            : 'No fortress yet. Once the worker has read the game, it shows here.'}
        </p>
      )}
    </div>
  )
}

function Header({ state }: { state: FortState | null }) {
  useTick(5000)
  const failing = useFailingFortReads()
  const world = state?.world ?? null
  const read = state?.captured_at
    ? formatDistanceToNow(new Date(state.captured_at), { addSuffix: true })
    : null
  return (
    <header className="flex shrink-0 flex-col gap-1 border-b pb-2">
      <div className="flex items-center justify-between gap-2">
        <h1 className="truncate text-base font-medium">{state?.fort_name ?? 'No fortress yet'}</h1>
        <a
          href="/fortress"
          target="dfm-app"
          className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Open the app
          <ExternalLinkIcon className="size-3" />
        </a>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        {world ? (
          <span>
            {world.day} {world.month_name} {world.year}, {world.season}
          </span>
        ) : null}
        {state ? <GameStatus state={state} /> : null}
        {read ? <span>read {read}</span> : null}
      </div>
      {failing.length ? (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <CircleAlertIcon className="size-3.5 shrink-0" />
          The last read failed: {failing[0].message}. This is the read before it.
        </p>
      ) : null}
    </header>
  )
}

function GameStatus({ state }: { state: FortState }) {
  if (state.status === 'live')
    return (
      <span className="inline-flex items-center gap-1">
        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
        Live
      </span>
    )
  if (state.status === 'menu')
    return (
      <span className="inline-flex items-center gap-1">
        <MoonIcon className="size-3" />
        The game is on a menu
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-destructive">
      <PlugZapIcon className="size-3" />
      The game is not reachable
    </span>
  )
}

function Heading({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <h2 className="mb-1 flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
      {children}
      {count ? <span className="tabular-nums">{count}</span> : null}
    </h2>
  )
}

function Urgent({ notices }: { notices: Notice[] }) {
  const top = notices[0]
  if (!top)
    return (
      <section className="shrink-0 rounded-lg border px-3 py-2 text-muted-foreground">
        Nothing needs you right now.
      </section>
    )
  const danger = top.severity === 'danger'
  return (
    <section
      className={cn(
        'shrink-0 rounded-lg border px-3 py-2',
        danger ? 'border-red-500/40 bg-red-500/10' : 'border-amber-500/40 bg-amber-500/10',
      )}
    >
      <p className="flex items-start gap-2 font-medium">
        <TriangleAlertIcon
          className={cn('mt-0.5 size-4 shrink-0', danger ? 'text-red-500' : 'text-amber-500')}
        />
        {top.title}
      </p>
      {top.detail || top.hint ? (
        <p className="mt-0.5 line-clamp-2 pl-6 text-muted-foreground">{top.detail ?? top.hint}</p>
      ) : null}
      {notices.length > 1 ? (
        <p className="mt-1 pl-6 text-xs text-muted-foreground">
          And {notices.length - 1} more {notices.length === 2 ? 'thing' : 'things'} to see to.
        </p>
      ) : null}
    </section>
  )
}

/** "2 wounds, fey mood": what is wrong with them besides their mood. */
function troubles(unit: FortUnit): string[] {
  const out: string[] = []
  if (unit.wounds > 0) out.push(`${unit.wounds} ${unit.wounds === 1 ? 'wound' : 'wounds'}`)
  if (unit.mood) out.push((moodText(unit.mood)?.label ?? 'in a mood').toLowerCase())
  return out
}

function Watched({ units, watched }: { units: FortUnit[]; watched: ReadonlySet<number> }) {
  const shown = units.filter((u) => watched.has(u.id) && isLiving(u))
  if (!shown.length)
    return watched.size ? null : (
      <p className="shrink-0 text-xs text-muted-foreground">
        Watch a dwarf from their page and they show here.
      </p>
    )
  return (
    <section className="shrink-0">
      <Heading>
        <EyeIcon className="size-3" />
        Watching
      </Heading>
      <ul className="flex flex-col gap-1">
        {shown.slice(0, MAX_WATCHED).map((unit) => {
          const thought = latestThought(unit)
          return (
            <li key={unit.id} className="flex flex-col">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium">{firstName(unit)}</span>
                <MoodBadge category={unit.stress_category} className="px-1.5 py-0 text-xs" />
                <span className="truncate text-xs text-muted-foreground">
                  {[...troubles(unit), unit.job ?? (unit.squad ? unit.squad : 'idle')].join(', ')}
                </span>
              </span>
              {thought ? (
                <span
                  className={cn(
                    'truncate text-xs',
                    emotionTone(thought[1]) === 'bad'
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-muted-foreground',
                  )}
                >
                  {formatGameTick(thought[3], thought[4])}:{' '}
                  {thoughtPhrase(thought[0], thought[1], unit)}
                </span>
              ) : null}
            </li>
          )
        })}
      </ul>
      {shown.length > MAX_WATCHED ? (
        <p className="text-xs text-muted-foreground">And {shown.length - MAX_WATCHED} more.</p>
      ) : null}
    </section>
  )
}

function Struggling({ units, watched }: { units: FortUnit[]; watched: ReadonlySet<number> }) {
  const struggling = units
    .filter(
      (u) =>
        isLiving(u) &&
        unitGroup(u) === 'citizen' &&
        !watched.has(u.id) &&
        (u.stress_category <= 1 || u.wounds > 0 || u.mood),
    )
    .sort((a, b) => a.stress_category - b.stress_category || b.wounds - a.wounds)
  if (!struggling.length) return null
  return (
    <section className="shrink-0">
      <Heading count={struggling.length}>Struggling</Heading>
      <ul className="flex flex-col gap-0.5">
        {struggling.slice(0, MAX_STRUGGLING).map((unit) => (
          <li key={unit.id} className="flex items-center gap-2">
            <span className="truncate">{firstName(unit)}</span>
            <span className="truncate text-xs text-muted-foreground">
              {[
                unit.stress_category <= 1 ? stressLabel(unit.stress_category) : null,
                ...troubles(unit),
              ]
                .filter(Boolean)
                .join(', ')}
            </span>
          </li>
        ))}
      </ul>
      {struggling.length > MAX_STRUGGLING ? (
        <p className="text-xs text-muted-foreground">
          And {struggling.length - MAX_STRUGGLING} more.
        </p>
      ) : null}
    </section>
  )
}

function Warnings({ notices }: { notices: Notice[] }) {
  if (!notices.length) return null
  return (
    <section className="shrink-0">
      <Heading>Jobs and stores</Heading>
      <ul className="flex flex-col gap-0.5">
        {notices.slice(0, MAX_WARNINGS).map((n) => (
          <li key={n.key} className="flex items-start gap-2">
            <span
              className={cn(
                'mt-1.5 size-1.5 shrink-0 rounded-full',
                n.severity === 'danger'
                  ? 'bg-red-500'
                  : n.severity === 'warning'
                    ? 'bg-amber-500'
                    : 'bg-muted-foreground/50',
              )}
              aria-hidden
            />
            <span className="line-clamp-2 min-w-0">
              {n.title}
              {n.lines?.length ? (
                <span className="text-muted-foreground">
                  : {n.lines.map((l) => l.label).join(', ')}
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Chronicle({ events }: { events: FortEvent[] }) {
  const story = events
    .filter((e) => STORY_KINDS[storyKind(e)].story)
    .sort((a, b) => b.id - a.id)
    .slice(0, MAX_CHRONICLE)
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <Heading>The chronicle</Heading>
      {story.length ? (
        <ul className="flex min-h-0 flex-col gap-1.5 overflow-hidden [mask-image:linear-gradient(to_bottom,black_85%,transparent)]">
          {story.map((event) => (
            <li key={event.id} className="flex gap-2">
              <StoryIcon kind={storyKind(event)} />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2">{cleanAnnouncement(event.text)}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatGameTick(event.game_year, event.game_tick)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">Nothing in the chronicle yet.</p>
      )}
    </section>
  )
}

export const Route = createFileRoute('/_authenticated/glance')({
  head: () => ({ meta: [{ title: 'While playing · Dwarf Fortress Manager' }] }),
  component: GlancePage,
})
