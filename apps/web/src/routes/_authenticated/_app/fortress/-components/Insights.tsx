import type { FortEvent, FortUnit } from '@fortress/db-drizzle'
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from '@fortress/ui'
import { Link } from '@tanstack/react-router'
import {
  ArrowRightIcon,
  BabyIcon,
  BellIcon,
  BellOffIcon,
  BellRingIcon,
  CloudSunIcon,
  CrownIcon,
  GemIcon,
  HammerIcon,
  InfoIcon,
  LightbulbIcon,
  PickaxeIcon,
  ScrollTextIcon,
  ShieldAlertIcon,
  SkullIcon,
  SparklesIcon,
  SwordsIcon,
  TentIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { CreatureSprite } from '~/lib/df-assets/components'
import {
  type AlertMode,
  enableDesktopAlerts,
  setAlertMode,
  useAlertMode,
} from '~/lib/fortress/alerts'
import { formatGameTick } from '~/lib/fortress/format'
import {
  type ActivityGroup,
  type Concern,
  type Feeling,
  type Notice,
  STORY_KINDS,
  type Severity,
  type StoryKind,
  type TextPart,
  firstName,
  seasonOf,
  storyKind,
} from '~/lib/fortress/insights'

export type OpenUnit = (unit: FortUnit) => void

// ---------------------------------------------------------------------------
// Dwarves as links

/** A dwarf's sprite and first name: opens them in place when `onOpen` is given, else links. */
export function UnitChip({
  unit,
  onOpen,
  className,
}: {
  unit: FortUnit
  onOpen?: OpenUnit
  className?: string
}) {
  const body = (
    <>
      <CreatureSprite unit={unit} size={20} className="-my-1 shrink-0" />
      <span className="max-w-[10rem] truncate">{firstName(unit)}</span>
    </>
  )
  const classes = cn(
    'inline-flex items-center gap-1.5 rounded-full border bg-background px-2 py-0.5 text-sm transition-colors hover:bg-accent',
    className,
  )
  if (onOpen)
    return (
      <button type="button" className={classes} title={unit.readable} onClick={() => onOpen(unit)}>
        {body}
      </button>
    )
  return (
    <Link
      to="/fortress/dwarves/$id"
      params={{ id: String(unit.id) }}
      className={classes}
      title={unit.readable}
    >
      {body}
    </Link>
  )
}

export function UnitChips({
  units,
  onOpen,
  max = 10,
}: {
  units: FortUnit[]
  onOpen?: OpenUnit
  max?: number
}) {
  const [all, setAll] = React.useState(false)
  const shown = all ? units : units.slice(0, max)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((unit) => (
        <UnitChip key={unit.id} unit={unit} onOpen={onOpen} />
      ))}
      {units.length > shown.length ? (
        <button
          type="button"
          className="text-sm text-muted-foreground hover:text-foreground hover:underline"
          onClick={() => setAll(true)}
        >
          +{units.length - shown.length} more
        </button>
      ) : null}
    </div>
  )
}

/** An announcement with the dwarves it names turned into links. */
export function AnnouncementText({ parts, onOpen }: { parts: TextPart[]; onOpen?: OpenUnit }) {
  return (
    <>
      {parts.map((part, i) =>
        part.unit ? (
          onOpen ? (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional
              key={i}
              type="button"
              className="font-medium text-primary underline-offset-4 hover:underline"
              onClick={() => part.unit && onOpen(part.unit)}
            >
              {part.text}
            </button>
          ) : (
            <Link
              // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional
              key={i}
              to="/fortress/dwarves/$id"
              params={{ id: String(part.unit.id) }}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {part.text}
            </Link>
          )
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Notices

const SEVERITY_STYLE: Record<Severity, { box: string; icon: string; Icon: typeof InfoIcon }> = {
  danger: {
    box: 'border-red-500/40 bg-red-500/10',
    icon: 'text-red-600 dark:text-red-400',
    Icon: ShieldAlertIcon,
  },
  warning: {
    box: 'border-amber-500/40 bg-amber-500/5',
    icon: 'text-amber-600 dark:text-amber-400',
    Icon: TriangleAlertIcon,
  },
  info: { box: 'border-border', icon: 'text-sky-600 dark:text-sky-400', Icon: InfoIcon },
}

const NOTICE_LINES = 4

export function NoticeCard({
  notice,
  onOpen,
  onGuide,
}: {
  notice: Notice
  onOpen?: OpenUnit
  /** Opens the step-by-step guide for this notice. */
  onGuide?: (notice: Notice) => void
}) {
  const style = SEVERITY_STYLE[notice.severity]
  const Icon = style.Icon
  const [allLines, setAllLines] = React.useState(false)
  const lines = notice.lines ?? []
  const shownLines = allLines ? lines : lines.slice(0, NOTICE_LINES)
  return (
    <li className={cn('flex gap-3 rounded-lg border p-3', style.box)}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', style.icon)} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <div className="font-medium leading-snug">{notice.title}</div>
          {notice.detail ? (
            <p className="mt-0.5 text-sm text-muted-foreground">{notice.detail}</p>
          ) : null}
        </div>
        {shownLines.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {shownLines.map((line) => (
              <li key={`${line.label}-${line.detail ?? ''}`} className="leading-snug">
                <span className="font-medium">{line.label}</span>
                {line.detail ? (
                  <span className="text-muted-foreground"> · {line.detail}</span>
                ) : null}
                {line.count && line.count > 1 ? (
                  <span className="text-muted-foreground tabular-nums"> · ×{line.count}</span>
                ) : null}
                {line.hint ? (
                  <div className="text-xs text-muted-foreground">{line.hint}</div>
                ) : null}
              </li>
            ))}
            {lines.length > shownLines.length ? (
              <li>
                <button
                  type="button"
                  className="text-sm text-primary underline-offset-4 hover:underline"
                  onClick={() => setAllLines(true)}
                >
                  and {lines.length - shownLines.length} more
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
        {notice.units?.length ? <UnitChips units={notice.units} onOpen={onOpen} max={8} /> : null}
        {notice.hint ? (
          <p className="flex gap-1.5 text-sm text-muted-foreground">
            <LightbulbIcon className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
            <span>{notice.hint}</span>
          </p>
        ) : null}
        {onGuide || notice.link ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {onGuide ? (
              <button
                type="button"
                onClick={() => onGuide(notice)}
                className="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                How to fix it, step by step
                <ArrowRightIcon className="size-3.5" />
              </button>
            ) : null}
            {notice.link ? (
              <Link
                to={notice.link.to}
                className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {notice.link.label}
                <ArrowRightIcon className="size-3.5" />
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  )
}

/** Urgent notices open; the smaller ones fold under a line so they do not bury the rest. */
export function NoticeList({
  notices,
  onOpen,
  onGuide,
  foldInfo = true,
}: {
  notices: Notice[]
  onOpen?: OpenUnit
  onGuide?: (notice: Notice) => void
  foldInfo?: boolean
}) {
  const [showMinor, setShowMinor] = React.useState(false)
  const major = foldInfo ? notices.filter((n) => n.severity !== 'info') : notices
  const minor = foldInfo ? notices.filter((n) => n.severity === 'info') : []
  if (!notices.length)
    return (
      <p className="text-sm text-muted-foreground">
        Nothing needs you right now. The fortress runs itself for a while.
      </p>
    )
  return (
    <div className="flex flex-col gap-2">
      {major.length ? (
        <ul className="flex flex-col gap-2">
          {major.map((notice) => (
            <NoticeCard key={notice.key} notice={notice} onOpen={onOpen} onGuide={onGuide} />
          ))}
        </ul>
      ) : null}
      {minor.length ? (
        showMinor || !major.length ? (
          <ul className="flex flex-col gap-2">
            {minor.map((notice) => (
              <NoticeCard key={notice.key} notice={notice} onOpen={onOpen} onGuide={onGuide} />
            ))}
          </ul>
        ) : (
          <button
            type="button"
            onClick={() => setShowMinor(true)}
            className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <InfoIcon className="size-4 shrink-0 text-sky-600 dark:text-sky-400" />
            <span className="min-w-0 flex-1 truncate">
              {minor.length} smaller thing{minor.length === 1 ? '' : 's'}:{' '}
              {minor.map((n) => n.title).join(' · ')}
            </span>
          </button>
        )
      ) : null}
    </div>
  )
}

export function ConcernBadges({
  concerns,
  className,
}: { concerns: Concern[]; className?: string }) {
  if (!concerns.length) return null
  return (
    <div className={cn('flex flex-wrap gap-1', className)}>
      {concerns.map((c) => (
        <Badge
          key={c.key}
          variant={c.severity === 'danger' ? 'destructive' : 'secondary'}
          className={cn(
            'font-normal',
            c.severity === 'warning' &&
              'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200',
          )}
          title={c.hint}
        >
          {c.label}
        </Badge>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// What everyone is doing

export function ActivityBoard({ groups, onOpen }: { groups: ActivityGroup[]; onOpen?: OpenUnit }) {
  if (!groups.length) return <p className="text-sm text-muted-foreground">Nobody is about.</p>
  return (
    <ul className="flex flex-col gap-2.5">
      {groups.map((group) => (
        <li key={group.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span
              className={cn(
                'font-medium',
                group.key === 'idle' && 'text-amber-700 dark:text-amber-300',
                group.key === 'mood' && 'text-purple-700 dark:text-purple-300',
              )}
            >
              {group.label}
            </span>
            <span className="text-muted-foreground tabular-nums">{group.units.length}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {group.units.map((unit) =>
              onOpen ? (
                <button
                  key={unit.id}
                  type="button"
                  onClick={() => onOpen(unit)}
                  title={`${unit.readable}${unit.job ? ` · ${unit.job}` : ''}`}
                  className="rounded-md border bg-muted/40 p-0.5 transition-colors hover:border-primary/60"
                >
                  <CreatureSprite unit={unit} size={24} />
                </button>
              ) : (
                <Link
                  key={unit.id}
                  to="/fortress/dwarves/$id"
                  params={{ id: String(unit.id) }}
                  title={`${unit.readable}${unit.job ? ` · ${unit.job}` : ''}`}
                  className="rounded-md border bg-muted/40 p-0.5 transition-colors hover:border-primary/60"
                >
                  <CreatureSprite unit={unit} size={24} />
                </Link>
              ),
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// What they are feeling

function FeelingRow({
  feeling,
  onOpen,
  onGuide,
}: {
  feeling: Feeling
  onOpen?: OpenUnit
  onGuide?: (feeling: Feeling) => void
}) {
  const [open, setOpen] = React.useState(false)
  return (
    <li className="flex flex-col gap-1.5 py-2">
      <button
        type="button"
        className="flex items-baseline gap-2 text-left text-sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span
          className={cn(
            'w-7 shrink-0 text-right font-semibold tabular-nums',
            feeling.tone === 'bad' && 'text-red-600 dark:text-red-400',
            feeling.tone === 'good' && 'text-emerald-700 dark:text-emerald-400',
            feeling.tone === 'neutral' && 'text-muted-foreground',
          )}
        >
          {feeling.units.length}
        </span>
        <span className="min-w-0 flex-1">
          {feeling.units.length === 1 ? firstName(feeling.units[0]) : 'dwarves'} {feeling.phrase}
          {feeling.emotions.length ? (
            <span className="text-muted-foreground">
              {' '}
              ·{' '}
              {feeling.emotions
                .slice(0, 3)
                .map((e) => e.toLowerCase().replace(/_/g, ' '))
                .join(', ')}
            </span>
          ) : null}
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-1.5 pl-9">
          <UnitChips units={feeling.units} onOpen={onOpen} max={12} />
          {feeling.hint ? (
            <p className="flex gap-1.5 text-sm text-muted-foreground">
              <LightbulbIcon className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
              {feeling.hint}
            </p>
          ) : null}
          {onGuide && feeling.tone === 'bad' ? (
            <button
              type="button"
              onClick={() => onGuide(feeling)}
              className="inline-flex w-fit items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              What to do about it
              <ArrowRightIcon className="size-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

/** The month's thoughts across the fortress: what weighs on them, what lifts them. */
export function FeelingsPanel({
  feelings,
  onOpen,
  onGuide,
}: {
  feelings: Feeling[]
  onOpen?: OpenUnit
  /** Opens the step-by-step guide for a troubling feeling. */
  onGuide?: (feeling: Feeling) => void
}) {
  const bad = feelings.filter((f) => f.tone === 'bad').slice(0, 6)
  const good = feelings.filter((f) => f.tone !== 'bad').slice(0, 6)
  if (!feelings.length)
    return <p className="text-sm text-muted-foreground">No thoughts recorded this month.</p>
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <div className="mb-1 text-sm font-medium text-muted-foreground">Weighing on them</div>
        {bad.length ? (
          <ul className="divide-y">
            {bad.map((f) => (
              <FeelingRow key={f.key} feeling={f} onOpen={onOpen} onGuide={onGuide} />
            ))}
          </ul>
        ) : (
          <p className="py-2 text-sm text-muted-foreground">Nothing much. A good month.</p>
        )}
      </div>
      <div>
        <div className="mb-1 text-sm font-medium text-muted-foreground">Lifting their spirits</div>
        <ul className="divide-y">
          {good.map((f) => (
            <FeelingRow key={f.key} feeling={f} onOpen={onOpen} />
          ))}
        </ul>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The story so far

const KIND_ICON: Record<StoryKind, typeof InfoIcon> = {
  death: SkullIcon,
  threat: SwordsIcon,
  mood: SparklesIcon,
  birth: BabyIcon,
  arrival: TentIcon,
  craft: GemIcon,
  discovery: PickaxeIcon,
  society: CrownIcon,
  work: HammerIcon,
  season: CloudSunIcon,
  other: ScrollTextIcon,
}

const TONE_CLASS = {
  danger: 'text-red-600 dark:text-red-400',
  warning: 'text-amber-600 dark:text-amber-400',
  good: 'text-emerald-700 dark:text-emerald-400',
  info: 'text-sky-700 dark:text-sky-400',
  muted: 'text-muted-foreground',
} as const

export function StoryIcon({ kind, className }: { kind: StoryKind; className?: string }) {
  const Icon = KIND_ICON[kind]
  return <Icon className={cn('size-4 shrink-0', TONE_CLASS[STORY_KINDS[kind].tone], className)} />
}

function seasonTitle(year: number | null, tick: number | null): string {
  if (year === null || tick === null) return 'Undated'
  const season = seasonOf(tick)
  return `${season.charAt(0).toUpperCase()}${season.slice(1)} of ${year}`
}

const STRUCK_RE = /^You have struck (.+?)!$/

type FeedRow = { event: FortEvent } | { strikes: string[]; events: FortEvent[] }

/** Back-to-back ore and gem strikes read as one line: "You struck ruby, schorl and morion." */
function foldStrikes(events: FortEvent[]): FeedRow[] {
  const rows: FeedRow[] = []
  for (const event of events) {
    const mineral = STRUCK_RE.exec(event.text.trim())?.[1]
    const last = rows[rows.length - 1]
    if (mineral && last && 'strikes' in last) {
      last.strikes.push(mineral)
      last.events.push(event)
    } else if (mineral) rows.push({ strikes: [mineral], events: [event] })
    else rows.push({ event })
  }
  return rows.map((row) =>
    'strikes' in row && row.events.length === 1 ? { event: row.events[0] } : row,
  )
}

function listWords(words: string[], max = 6): string {
  const unique = [...new Set(words)]
  const shown = unique.slice(0, max)
  const rest = unique.length - shown.length
  if (rest > 0) return `${shown.join(', ')} and ${rest} more`
  return shown.length > 1
    ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
    : shown.join('')
}

const dayMonth = (event: FortEvent) =>
  formatGameTick(event.game_year, event.game_tick).replace(/ \d+$/, '')

/**
 * Announcements grouped by season, newest first, with the dwarves they name
 * linked. Entries after `newAfter` are marked as new since the last visit.
 */
export function StoryFeed({
  events,
  link,
  newAfter = null,
  onOpen,
  limit = 60,
}: {
  events: FortEvent[]
  link: (text: string) => TextPart[]
  newAfter?: number | null
  onOpen?: OpenUnit
  limit?: number
}) {
  const seasons = React.useMemo(() => {
    const out: { title: string; events: FortEvent[] }[] = []
    for (const event of events.slice(0, limit)) {
      const title = seasonTitle(event.game_year, event.game_tick)
      const last = out[out.length - 1]
      if (last && last.title === title) last.events.push(event)
      else out.push({ title, events: [event] })
    }
    return out
  }, [events, limit])
  if (!events.length)
    return <p className="text-sm text-muted-foreground">Nothing has been recorded yet.</p>
  return (
    <div className="flex flex-col gap-5">
      {seasons.map((season) => (
        <section key={season.title}>
          <h3 className="mb-1 text-sm font-medium text-muted-foreground">{season.title}</h3>
          <ol className="divide-y">
            {foldStrikes(season.events).map((row) => {
              const events = 'strikes' in row ? row.events : [row.event]
              const first = events[0]
              const last = events[events.length - 1]
              const fresh = newAfter !== null && events.some((e) => e.id > newAfter)
              return (
                <li key={first.id} className="flex gap-3 py-2">
                  <StoryIcon kind={storyKind(first)} className="mt-1" />
                  <div className="min-w-0 flex-1 leading-relaxed">
                    {'strikes' in row ? (
                      <>You struck {listWords([...row.strikes].reverse())}.</>
                    ) : (
                      <AnnouncementText parts={link(first.text)} onOpen={onOpen} />
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {events.length > 1 && dayMonth(last) !== dayMonth(first)
                        ? `${dayMonth(last)} – ${dayMonth(first)}`
                        : dayMonth(first)}
                    </span>
                    {fresh ? (
                      <Badge className="h-4 px-1.5 text-[10px] uppercase tracking-wide">new</Badge>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Alerts

const ALERT_LABELS: Record<AlertMode, string> = {
  app: 'Alerts in the app',
  desktop: 'Desktop alerts',
  off: 'Alerts off',
}

/** Choose how new happenings are announced: toasts, desktop notifications, or not at all. */
export function AlertsMenu() {
  const mode = useAlertMode()
  const Icon = mode === 'off' ? BellOffIcon : mode === 'desktop' ? BellRingIcon : BellIcon
  const choose = async (next: string) => {
    if (next === 'desktop') {
      const ok = await enableDesktopAlerts()
      if (!ok) toast.error('The browser would not allow notifications. Alerts stay in the app.')
      else toast.success('You will be told on the desktop while the app is in the background.')
      return
    }
    setAlertMode(next as AlertMode)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" className="gap-2" title="How to tell you what happens">
          <Icon className="size-3.5" />
          <span className="hidden sm:inline">{ALERT_LABELS[mode]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>
          Tell me about deaths, danger, moods, births and arrivals
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={mode} onValueChange={choose}>
          <DropdownMenuRadioItem value="app">In the app, on any page</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="desktop">
            Also on the desktop, while the tab is hidden
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="off">Not at all</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
