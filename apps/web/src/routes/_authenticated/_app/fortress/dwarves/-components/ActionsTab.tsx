import type { FortUnit } from '@fortress/db-drizzle'
import { MAX_UNIT_TITLE, UNIT_ACTIONS, type UnitAction } from '@fortress/db-drizzle/fortress-types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Input,
  cn,
} from '@fortress/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { formatDistanceToNow } from 'date-fns'
import {
  ChevronDownIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CrosshairIcon,
  FlaskConicalIcon,
  HeartPulseIcon,
  LightbulbIcon,
  Loader2Icon,
  SparklesIcon,
  SunIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { careTips, preferenceGroups } from '~/lib/fortress/character'
import { isLiving } from '~/lib/fortress/format'
import { concernGuide } from '~/lib/fortress/guides'
import type { Concern } from '~/lib/fortress/insights'
import {
  type UnitCommandAction,
  type UnitCommandRun,
  listUnitCommands,
  queueUnitAction,
} from '~/lib/fortress/unitActions'
import { usePreferences } from '~/lib/preferences'
import { CopyCommand, GuideBody } from '../../-components/Guide'
import { Muted, STANDING_TEXT, Section } from './SheetParts'

/** A run older than this no longer shows as the result of its button. */
const RECENT_MS = 30 * 60_000
/** Pending this long without being picked up: the worker is probably not running. */
const STALE_MS = 20_000

const NICKNAME_COMMAND = 'lua dfhack.units.setNickname(df.unit.find({id}), dfhack.utf2df("{text}"))'

function commandFor(action: UnitCommandAction, unitId: number, text = ''): string {
  const template = action === 'nickname' ? NICKNAME_COMMAND : UNIT_ACTIONS[action].command
  return template
    .replace('{id}', String(unitId))
    .replace('{text}', text.replace(/\\/g, '\\\\').replace(/"/g, '\\"'))
}

/** Recent actions on this unit, polled quickly while one is on its way. */
export function useUnitCommands(unitId: number) {
  const client = useQueryClient()
  const key = ['fort', 'unit-commands', unitId]
  const runs = useQuery({
    queryKey: key,
    queryFn: () => listUnitCommands({ data: { unitId } }),
    refetchInterval: (query) =>
      query.state.data?.some((r) => r.status === 'pending' || r.status === 'processing')
        ? 1500
        : 30_000,
  })
  // The worker dumps right after running a command; refresh what the page shows then.
  const open = React.useRef(new Set<number>())
  React.useEffect(() => {
    let finished = false
    for (const run of runs.data ?? []) {
      if (run.status === 'pending' || run.status === 'processing') open.current.add(run.id)
      else if (open.current.delete(run.id)) finished = true
    }
    if (finished) {
      const timer = setTimeout(() => {
        void client.invalidateQueries({ queryKey: ['fort', 'unit', unitId] })
        void client.invalidateQueries({ queryKey: ['fort', 'units'] })
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [runs.data, client, unitId])
  const queue = useMutation({
    mutationFn: (input: { action: UnitCommandAction; text?: string }) =>
      queueUnitAction({ data: { unitId, ...input } }),
    onSuccess: ({ reused }) => {
      if (reused) toast.message('That is already on its way to the game.')
      void client.invalidateQueries({ queryKey: key })
    },
    onError: (error) => toast.error(error.message),
  })
  const latest = (action: UnitCommandAction): UnitCommandRun | undefined =>
    runs.data?.find(
      (r) =>
        r.action === action &&
        (r.status === 'pending' ||
          r.status === 'processing' ||
          Date.now() - new Date(r.completedAt ?? r.createdAt).getTime() < RECENT_MS),
    )
  return { runs, queue, latest }
}

function RunLine({ run }: { run: UnitCommandRun }) {
  const age = Date.now() - new Date(run.createdAt).getTime()
  if (run.status === 'pending' || run.status === 'processing')
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <Loader2Icon className="size-3.5 animate-spin" />
        {run.status === 'pending' ? 'Waiting for the worker…' : 'Happening in the game…'}
        {run.status === 'pending' && age > STALE_MS ? (
          <span className="text-amber-700 dark:text-amber-300">Is the worker running?</span>
        ) : null}
      </span>
    )
  const when = formatDistanceToNow(new Date(run.completedAt ?? run.createdAt), { addSuffix: true })
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-sm',
        run.status === 'done'
          ? 'text-emerald-700 dark:text-emerald-400'
          : 'text-red-600 dark:text-red-400',
      )}
    >
      {run.status === 'done' ? (
        <CircleCheckIcon className="size-3.5" />
      ) : (
        <CircleAlertIcon className="size-3.5" />
      )}
      {run.status === 'done' ? `Done ${when}` : `Failed ${when}: ${run.error ?? 'no reason given'}`}
    </span>
  )
}

/** Centres the game on them. Renders nothing for units off the map. */
export function ShowInGameButton({
  unit,
  size = 'sm',
}: {
  unit: FortUnit
  size?: 'sm' | 'icon'
}) {
  const { oneClickActions } = usePreferences()
  const { queue, latest } = useUnitCommands(unit.id)
  if (unit.x === null) return null
  const run = latest('reveal')
  const busy = queue.isPending || run?.status === 'pending' || run?.status === 'processing'
  const onClick = async () => {
    if (oneClickActions) {
      queue.mutate({ action: 'reveal' })
      return
    }
    const command = commandFor('reveal', unit.id)
    try {
      await navigator.clipboard.writeText(command)
      toast.success('Copied. Paste it into the DFHack console to jump to them.')
    } catch {
      toast.error('The clipboard would not take it.')
    }
  }
  return (
    <Button
      type="button"
      size={size}
      variant="outline"
      className={size === 'icon' ? 'size-8' : 'gap-2'}
      onClick={onClick}
      disabled={busy}
      title={
        oneClickActions
          ? 'Centre the game on them'
          : 'Copy the DFHack command that centres the game on them'
      }
      aria-label="Show in game"
    >
      {busy ? (
        <Loader2Icon className="size-3.5 animate-spin" />
      ) : (
        <CrosshairIcon className="size-3.5" />
      )}
      {size === 'sm' ? 'Show in game' : null}
    </Button>
  )
}

function NameEditor({
  unit,
  action,
  label,
  current,
  placeholder,
  hint,
}: {
  unit: FortUnit
  action: 'nickname' | 'title'
  label: string
  current: string | null
  placeholder: string
  hint: React.ReactNode
}) {
  const { oneClickActions } = usePreferences()
  const { queue, latest } = useUnitCommands(unit.id)
  const [draft, setDraft] = React.useState(current ?? '')
  React.useEffect(() => setDraft(current ?? ''), [current])
  const run = latest(action)
  const busy = queue.isPending || run?.status === 'pending' || run?.status === 'processing'
  const changed = draft.trim() !== (current ?? '')
  const id = `unit-${action}-${unit.id}`
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        if (changed) queue.mutate({ action, text: draft.trim() })
      }}
    >
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          maxLength={MAX_UNIT_TITLE}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          disabled={busy}
        />
        {oneClickActions ? (
          <Button type="submit" variant="outline" disabled={!changed || busy}>
            {busy ? <Loader2Icon className="size-4 animate-spin" /> : null}
            {draft.trim() ? 'Set' : 'Clear'}
          </Button>
        ) : null}
      </div>
      {!oneClickActions && changed ? (
        <CopyCommand
          shortcut={{
            command: commandFor(action, unit.id, draft.trim()),
            what: 'Paste into the DFHack console.',
          }}
        />
      ) : null}
      {run ? <RunLine run={run} /> : <p className="text-sm text-muted-foreground">{hint}</p>}
    </form>
  )
}

const CHEAT_ICONS: Record<'calm' | 'fillneeds' | 'heal', typeof SunIcon> = {
  calm: SunIcon,
  fillneeds: SparklesIcon,
  heal: HeartPulseIcon,
}

function CheatButton({ unit, action }: { unit: FortUnit; action: 'calm' | 'fillneeds' | 'heal' }) {
  const spec = UNIT_ACTIONS[action]
  const { oneClickActions } = usePreferences()
  const { queue, latest } = useUnitCommands(unit.id)
  const [confirming, setConfirming] = React.useState(false)
  const run = latest(action)
  const busy = queue.isPending || run?.status === 'pending' || run?.status === 'processing'
  const Icon = CHEAT_ICONS[action]
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-3">
      {oneClickActions ? (
        <Button
          size="sm"
          variant="outline"
          className="w-fit gap-1.5"
          onClick={() => setConfirming(true)}
          disabled={busy}
        >
          {busy ? <Loader2Icon className="size-3.5 animate-spin" /> : <Icon className="size-3.5" />}
          {spec.label}
        </Button>
      ) : (
        <span className="text-sm font-medium">{spec.label}</span>
      )}
      <p className="text-sm text-muted-foreground">{spec.what}</p>
      {!oneClickActions ? (
        <CopyCommand
          shortcut={{
            command: commandFor(action, unit.id),
            what: 'Paste into the DFHack console.',
          }}
        />
      ) : null}
      {run ? <RunLine run={run} /> : null}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{spec.label}?</AlertDialogTitle>
            <AlertDialogDescription>{spec.confirm}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction onClick={() => queue.mutate({ action })}>Do it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** One trouble, with its step-by-step guide folded underneath. */
export function ConcernRow({ concern, unit }: { concern: Concern; unit: FortUnit }) {
  const [open, setOpen] = React.useState(false)
  const guide = React.useMemo(() => concernGuide(concern, unit), [concern, unit])
  return (
    <li
      className={cn(
        'rounded-lg border px-3 py-2 text-sm',
        concern.severity === 'danger' && 'border-red-500/40 bg-red-500/10',
        concern.severity === 'warning' && 'border-amber-500/40 bg-amber-500/5',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-medium">{concern.label}</span>
        {guide.steps.length ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
          >
            {open ? 'Hide the steps' : 'Step by step'}
            <ChevronDownIcon
              className={cn('size-3.5 transition-transform', open && 'rotate-180')}
            />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="mt-2 border-t pt-3">
          <GuideBody guide={{ ...guide, units: undefined }} compact />
        </div>
      ) : concern.hint ? (
        <span className="mt-0.5 flex gap-1.5 text-muted-foreground">
          <LightbulbIcon className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
          {concern.hint}
        </span>
      ) : null}
    </li>
  )
}

export function ActionsTab({ unit, compact }: { unit: FortUnit; compact?: boolean }) {
  const sheet = unit.sheet && !unit.sheet.error ? unit.sheet : null
  const living = isLiving(unit)
  const ours = living && unit.flags.includes('fort_controlled')
  const citizen = living && unit.flags.includes('citizen')
  const tips = sheet ? careTips(unit, sheet) : []
  const pleases = sheet ? preferenceGroups(sheet) : []
  const { runs } = useUnitCommands(unit.id)
  const [cheats, setCheats] = React.useState(false)
  const history = (runs.data ?? []).slice(0, 6)
  return (
    <div className={cn('grid gap-4', compact ? 'grid-cols-1' : 'lg:grid-cols-2')}>
      <Section
        title="In the game"
        description="Queued for the worker, which carries it out in the running game through DFHack."
      >
        <div className="flex flex-col gap-4">
          {unit.x !== null ? (
            <div className="flex flex-col gap-1.5">
              <ShowInGameButton unit={unit} />
              <p className="text-sm text-muted-foreground">{UNIT_ACTIONS.reveal.what}</p>
            </div>
          ) : (
            <Muted>They are not on the map.</Muted>
          )}
          {citizen ? (
            <NameEditor
              unit={unit}
              action="nickname"
              label="Nickname"
              current={unit.nickname}
              placeholder="A name that sticks"
              hint={
                <>
                  Shown in place of their first name.{' '}
                  <Link to="/nickname-dwarves" className="text-primary hover:underline">
                    Ideas for every citizen
                  </Link>
                </>
              }
            />
          ) : null}
          {ours ? (
            <NameEditor
              unit={unit}
              action="title"
              label="Title"
              current={sheet?.custom_profession ?? null}
              placeholder={unit.profession}
              hint={UNIT_ACTIONS.title.what}
            />
          ) : (
            <Muted>
              {living
                ? 'Only members of the fortress can be named or changed.'
                : 'The dead are beyond changing.'}
            </Muted>
          )}
        </div>
      </Section>

      <Section
        title="What would help"
        count={tips.length || undefined}
        description={
          sheet
            ? 'From what they long for and what their skills are wasted on.'
            : 'Their needs and skills come with the next dump from the updated worker.'
        }
      >
        {tips.length ? (
          <ul className="flex flex-col gap-2">
            {tips.map((tip) => (
              <li key={tip.key} className="rounded-lg border px-3 py-2 text-sm">
                <div className={cn('font-medium', STANDING_TEXT[tip.standing])}>{tip.title}</div>
                <div className="mt-0.5 flex gap-1.5 text-muted-foreground">
                  <LightbulbIcon className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                  {tip.text}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Muted>{sheet ? 'Nothing they long for right now.' : null}</Muted>
        )}
      </Section>

      {pleases.length ? (
        <Section
          title="What pleases them"
          description="Their likes, and how to put them in their path."
        >
          <ul className="flex flex-col gap-2 text-sm">
            {pleases.map((group) => (
              <li key={group.key}>
                <span className="font-medium">{group.label}.</span>{' '}
                <span className="text-muted-foreground">{group.tip}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {ours ? (
        <Section
          title={
            <span className="flex items-center gap-2">
              <FlaskConicalIcon className="size-4 text-amber-600 dark:text-amber-400" />
              Cheats
            </span>
          }
          action={
            <button
              type="button"
              className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
              onClick={() => setCheats((v) => !v)}
              aria-expanded={cheats}
            >
              {cheats ? 'Hide' : 'Show'}
              <ChevronDownIcon
                className={cn('size-3.5 transition-transform', cheats && 'rotate-180')}
              />
            </button>
          }
          description="DFHack can do what the game never would. Each asks before it runs."
        >
          {cheats ? (
            <div className="flex flex-col gap-2">
              <p className="flex gap-2 text-sm text-amber-700 dark:text-amber-300">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                These change your save for good. Consider saving the game first.
              </p>
              <CheatButton unit={unit} action="calm" />
              <CheatButton unit={unit} action="fillneeds" />
              <CheatButton unit={unit} action="heal" />
            </div>
          ) : null}
        </Section>
      ) : null}

      {history.length ? (
        <Section
          title="Recently asked of the game"
          className={compact ? undefined : 'lg:col-span-2'}
        >
          <ul className="flex flex-col gap-1.5 text-sm">
            {history.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center justify-between gap-x-3">
                <span>
                  {run.action === 'nickname'
                    ? run.text
                      ? `Nickname “${run.text}”`
                      : 'Clear the nickname'
                    : run.action === 'title'
                      ? run.text
                        ? `Title “${run.text}”`
                        : 'Clear the title'
                      : UNIT_ACTIONS[run.action as UnitAction].label}
                </span>
                <RunLine run={run} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  )
}
