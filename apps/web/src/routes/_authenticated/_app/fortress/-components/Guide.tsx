import {
  DFHACK_ACTIONS,
  type DfhackAction,
  type DfhackActionSpec,
} from '@fortress/db-drizzle/fortress-types'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Checkbox,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  cn,
} from '@fortress/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { formatDistanceToNow } from 'date-fns'
import {
  ArrowRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CopyIcon,
  Loader2Icon,
  PlayIcon,
  RotateCcwIcon,
  TerminalIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { type ActionRun, listDfhackActionRuns, queueDfhackAction } from '~/lib/fortress/actions'
import type { AdviceStatus, Shortcut } from '~/lib/fortress/advisor'
import type { Guide } from '~/lib/fortress/guides'
import { useStepProgress } from '~/lib/fortress/progress'
import { usePreferences } from '~/lib/preferences'
import { UnitChips } from './Insights'

// ---------------------------------------------------------------------------
// Running whitelisted DFHack actions

const RUNS_KEY = ['fort', 'dfhack-runs'] as const
/** A run older than this no longer shows as the button's result. */
const RECENT_MS = 30 * 60_000
/** Pending this long without being picked up: the worker is probably not running. */
const STALE_MS = 20_000

/** Recent runs of every action, polled quickly while one is on its way. */
function useActionRuns() {
  const client = useQueryClient()
  const runs = useQuery({
    queryKey: RUNS_KEY,
    queryFn: () => listDfhackActionRuns(),
    refetchInterval: (query) =>
      query.state.data?.some((r) => r.status === 'pending' || r.status === 'processing')
        ? 1500
        : 30_000,
  })
  // When a run finishes, the worker dumps the fortress right after; refresh what the pages show.
  const open = React.useRef(new Set<number>())
  React.useEffect(() => {
    const data = runs.data
    if (!data) return
    let finished = false
    for (const run of data) {
      const waiting = run.status === 'pending' || run.status === 'processing'
      if (waiting) open.current.add(run.id)
      else if (open.current.delete(run.id)) finished = true
    }
    if (finished) {
      setTimeout(() => {
        void client.invalidateQueries({ queryKey: ['fort'] })
      }, 3000)
    }
  }, [runs.data, client])
  return runs
}

function RunStatus({ run }: { run: ActionRun }) {
  const [showOutput, setShowOutput] = React.useState(false)
  const age = Date.now() - new Date(run.createdAt).getTime()
  if (run.status === 'pending' || run.status === 'processing')
    return (
      <div className="flex flex-col gap-0.5 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Loader2Icon className="size-3.5 animate-spin" />
          {run.status === 'pending' ? 'Waiting for the worker…' : 'Running in the game…'}
        </span>
        {run.status === 'pending' && age > STALE_MS ? (
          <span className="text-amber-700 dark:text-amber-300">
            Not picked up yet. Is the worker running (bun run dev)?
          </span>
        ) : null}
      </div>
    )
  const when = formatDistanceToNow(new Date(run.completedAt ?? run.createdAt), { addSuffix: true })
  return (
    <div className="flex flex-col gap-1 text-sm">
      <span
        className={cn(
          'inline-flex items-center gap-1.5',
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
        {run.status === 'done'
          ? `Done ${when}`
          : `Failed ${when}: ${run.error ?? 'no reason given'}`}
        {run.output ? (
          <button
            type="button"
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            onClick={() => setShowOutput((v) => !v)}
          >
            {showOutput ? 'hide output' : 'show output'}
          </button>
        ) : null}
      </span>
      {showOutput && run.output ? (
        <pre className="max-h-48 overflow-auto rounded-md border bg-muted/50 p-2 font-mono text-xs whitespace-pre-wrap">
          {run.output}
        </pre>
      ) : null}
    </div>
  )
}

/**
 * Run a whitelisted DFHack action in the game through the worker, and show how
 * it went. With one-click commands turned off in Settings, offers it to copy.
 */
export function RunActionButton({ action }: { action: DfhackAction }) {
  const { oneClickActions } = usePreferences()
  if (!oneClickActions) {
    const spec: DfhackActionSpec = DFHACK_ACTIONS[action]
    return (
      <CopyCommand
        shortcut={{ command: [spec.command, ...spec.args].join(' '), what: spec.what }}
      />
    )
  }
  return <RunAction action={action} />
}

function RunAction({ action }: { action: DfhackAction }) {
  const spec: DfhackActionSpec = DFHACK_ACTIONS[action]
  const client = useQueryClient()
  const runs = useActionRuns()
  const [confirming, setConfirming] = React.useState(false)
  const latest = runs.data?.find(
    (r) =>
      r.action === action &&
      (r.status === 'pending' ||
        r.status === 'processing' ||
        Date.now() - new Date(r.completedAt ?? r.createdAt).getTime() < RECENT_MS),
  )
  const busy = latest?.status === 'pending' || latest?.status === 'processing'
  const queue = useMutation({
    mutationFn: () => queueDfhackAction({ data: { action } }),
    onSuccess: ({ reused }) => {
      if (reused) toast.message(`"${spec.label}" is already on its way.`)
      void client.invalidateQueries({ queryKey: RUNS_KEY })
    },
    onError: (error) => toast.error(error.message),
  })
  const start = () => (spec.confirm ? setConfirming(true) : queue.mutate())
  const command = [spec.command, ...spec.args].join(' ')
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={start}
          disabled={busy || queue.isPending}
          className="gap-1.5"
          title={`Runs "${command}" in DFHack`}
        >
          {busy || queue.isPending ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : latest?.status === 'done' ? (
            <RotateCcwIcon className="size-3.5" />
          ) : (
            <PlayIcon className="size-3.5" />
          )}
          {spec.label}
        </Button>
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
          {command}
        </code>
      </div>
      <p className="text-sm text-muted-foreground">{spec.what}</p>
      {latest ? <RunStatus run={latest} /> : null}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{spec.label}?</AlertDialogTitle>
            <AlertDialogDescription>{spec.confirm}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction onClick={() => queue.mutate()}>Run it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export function CopyCommand({ shortcut }: { shortcut: Shortcut }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shortcut.command)
      toast.success(`Copied "${shortcut.command}". Paste it into the DFHack console.`)
    } catch {
      toast.error('The clipboard would not take it.')
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <button
        type="button"
        onClick={copy}
        title="Copy the command"
        className="inline-flex items-center gap-1.5 rounded-md border bg-muted/60 px-2 py-0.5 font-mono text-xs transition-colors hover:bg-accent"
      >
        <TerminalIcon className="size-3" />
        {shortcut.command}
        <CopyIcon className="size-3 text-muted-foreground" />
      </button>
      <span className="text-muted-foreground">{shortcut.what}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The guide itself

const STATUS_ICON: Record<AdviceStatus, { Icon: typeof CircleAlertIcon; className: string }> = {
  problem: { Icon: CircleAlertIcon, className: 'text-red-600 dark:text-red-400' },
  attention: { Icon: TriangleAlertIcon, className: 'text-amber-600 dark:text-amber-400' },
  good: { Icon: CircleCheckIcon, className: 'text-emerald-600 dark:text-emerald-400' },
}

export function GuideStatusIcon({
  status,
  className,
}: { status?: AdviceStatus; className?: string }) {
  if (!status) return null
  const { Icon, className: tone } = STATUS_ICON[status]
  return <Icon className={cn('size-4 shrink-0', tone, className)} />
}

/** The steps as a checklist the player can tick off while doing them in the game. */
function StepChecklist({ guideKey, steps }: { guideKey: string; steps: string[] }) {
  const { done, toggle, reset } = useStepProgress(guideKey)
  const count = steps.filter((_, i) => done.includes(i)).length
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">Step by step</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {count}/{steps.length} done
          {count ? (
            <button
              type="button"
              onClick={reset}
              className="ml-2 underline-offset-4 hover:text-foreground hover:underline"
            >
              start over
            </button>
          ) : null}
        </span>
      </div>
      <ol className="flex flex-col gap-1">
        {steps.map((step, i) => {
          const checked = done.includes(i)
          const id = `${guideKey}-step-${i}`
          return (
            <li key={step}>
              <label
                htmlFor={id}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50',
                  checked && 'text-muted-foreground',
                )}
              >
                <Checkbox
                  id={id}
                  checked={checked}
                  onCheckedChange={() => toggle(i)}
                  className="mt-0.5"
                />
                <span className="flex gap-2 text-sm leading-relaxed">
                  <span className="shrink-0 tabular-nums text-muted-foreground">{i + 1}.</span>
                  <span className={cn(checked && 'line-through decoration-muted-foreground/60')}>
                    {step}
                  </span>
                </span>
              </label>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** Everything a guide says: why, how to tell, the steps, and what DFHack can do for you. */
export function GuideBody({
  guide,
  compact = false,
  onNavigate,
}: {
  guide: Guide
  compact?: boolean
  /** Called when the guide's link is followed, e.g. to close the drawer it sits in. */
  onNavigate?: () => void
}) {
  const { oneClickActions } = usePreferences()
  return (
    <div className={cn('flex flex-col', compact ? 'gap-3' : 'gap-5')}>
      {guide.why ? <p className="text-sm leading-relaxed">{guide.why}</p> : null}
      {guide.signs ? (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">How you can tell: </span>
          {guide.signs}
        </p>
      ) : null}
      {guide.units?.length ? <UnitChips units={guide.units} max={compact ? 6 : 12} /> : null}
      {guide.steps.length ? <StepChecklist guideKey={guide.key} steps={guide.steps} /> : null}
      {guide.actions?.length ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Let DFHack do it</h3>
          {oneClickActions ? (
            <p className="text-xs text-muted-foreground">
              The worker runs the command in your game within a few seconds. Only these commands can
              be run from here.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              One-click commands are off, so copy them into the DFHack console.{' '}
              <Link
                to="/settings/connection"
                className="underline underline-offset-4 hover:text-foreground"
              >
                Turn them on
              </Link>
            </p>
          )}
          {guide.actions.map((action) => (
            <RunActionButton key={action} action={action} />
          ))}
        </div>
      ) : null}
      {guide.dfhack?.length ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-sm font-medium">Or type it yourself</h3>
          {guide.dfhack.map((s) => (
            <CopyCommand key={s.command} shortcut={s} />
          ))}
        </div>
      ) : null}
      {guide.link ? (
        guide.link.to === '/fortress/items' ? (
          <Link
            to="/fortress/items"
            search={{ view: guide.link.view }}
            hash="items-list"
            onClick={onNavigate}
            className="inline-flex w-fit items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
          >
            {guide.link.label}
            <ArrowRightIcon className="size-3.5" />
          </Link>
        ) : (
          <Link
            to={guide.link.to}
            onClick={onNavigate}
            className="inline-flex w-fit items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
          >
            {guide.link.label}
            <ArrowRightIcon className="size-3.5" />
          </Link>
        )
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// The drawer

const GuideContext = React.createContext<((guide: Guide) => void) | null>(null)

/** Opens a guide in the side drawer. Must be inside a GuideProvider. */
export function useOpenGuide() {
  const open = React.useContext(GuideContext)
  if (!open) throw new Error('useOpenGuide needs a GuideProvider')
  return open
}

export function GuideProvider({ children }: { children: React.ReactNode }) {
  const [guide, setGuide] = React.useState<Guide | null>(null)
  return (
    <GuideContext.Provider value={setGuide}>
      {children}
      <Drawer
        direction="right"
        open={guide !== null}
        onOpenChange={(open) => {
          if (!open) setGuide(null)
        }}
      >
        <DrawerContent className="data-[vaul-drawer-direction=right]:h-full data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:sm:max-w-lg">
          {guide ? (
            <>
              <DrawerHeader className="border-b">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {guide.eyebrow ? (
                      <Badge variant="outline" className="mb-2 font-normal text-muted-foreground">
                        {guide.eyebrow}
                      </Badge>
                    ) : null}
                    <DrawerTitle className="flex items-start gap-2 text-lg leading-snug">
                      <GuideStatusIcon status={guide.status} className="mt-1" />
                      {guide.title}
                    </DrawerTitle>
                    <DrawerDescription className="sr-only">
                      How to deal with it in the game, step by step.
                    </DrawerDescription>
                  </div>
                  <DrawerClose asChild>
                    <Button size="icon" variant="ghost" aria-label="Close">
                      <XIcon className="size-4" />
                    </Button>
                  </DrawerClose>
                </div>
              </DrawerHeader>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <GuideBody guide={guide} onNavigate={() => setGuide(null)} />
              </div>
            </>
          ) : null}
        </DrawerContent>
      </Drawer>
    </GuideContext.Provider>
  )
}

/** A small "How to fix" link that opens the guide. */
export function GuideButton({
  guide,
  label = 'How to fix it',
  className,
}: {
  guide: Guide
  label?: string
  className?: string
}) {
  const open = useOpenGuide()
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        open(guide)
      }}
      className={cn(
        'inline-flex w-fit items-center gap-1 text-sm text-primary underline-offset-4 hover:underline',
        className,
      )}
    >
      {label}
      <ArrowRightIcon className="size-3.5" />
    </button>
  )
}
