import { type DumpProgress, type DumpStep, dumpSteps } from '@fortress/db-drizzle/fortress-types'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Progress,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@fortress/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleIcon,
  CircleMinusIcon,
  CirclePauseIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
} from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { type DumpState, requestDump } from './dump'
import { DUMP_STATE_KEY, useDumpState, useTick } from './queries'

const STEP_LABEL: Record<DumpStep, string> = {
  worker: 'The worker picks up the request',
  game: 'Dwarf Fortress answers',
  world: 'World and calendar',
  units: 'Dwarves and creatures',
  items: 'Items',
  buildings: 'Buildings and zones',
  jobs: 'Jobs',
  announcements: 'Announcements',
  writing: 'Writing it all down',
  map: 'The map',
  store: 'Saving it for the app',
}

type StepMark = 'done' | 'current' | 'blocked' | 'failed' | 'skipped' | 'upcoming'

/** Reads the game now, whatever the schedule in Settings says, and shows the read as it goes. */
export function ReadGameButton() {
  const client = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const asked = React.useRef(false)
  const wasPending = React.useRef(false)

  const request = useMutation({
    mutationFn: () => requestDump(),
    onMutate: async () => {
      await client.cancelQueries({ queryKey: DUMP_STATE_KEY })
      client.setQueryData<DumpState>(DUMP_STATE_KEY, (old) =>
        old
          ? {
              ...old,
              pending: true,
              progress: old.progress?.state === 'running' ? old.progress : null,
            }
          : old,
      )
    },
    onSuccess: ({ workerRunning }) => {
      asked.current = true
      wasPending.current = true
      if (!workerRunning && !open)
        toast.error('The worker is not running', {
          description: 'Start it with bun run dev:worker and it reads the game straight away.',
        })
    },
    onError: (error) => {
      if (!open) toast.error(error.message)
    },
    onSettled: () => client.invalidateQueries({ queryKey: DUMP_STATE_KEY }),
  })
  const { data } = useDumpState({ watch: open, paused: request.isPending })

  // Once the read has landed, every page refetches what it shows. With the
  // dialog closed, say so when the game could not be read.
  React.useEffect(() => {
    if (!data) return
    if (wasPending.current && !data.pending) {
      void client.invalidateQueries({ queryKey: ['fort'] })
      void client.invalidateQueries({ queryKey: ['settings', 'connection'] })
      if (asked.current && !open) {
        if (data.status === 'offline')
          toast.error('Dwarf Fortress did not answer', {
            description: 'Is the game open, with DFHack running?',
          })
        else if (data.status === 'menu')
          toast('No fortress is loaded', {
            description: 'Load a save, then read the game again.',
          })
      }
      asked.current = false
    }
    wasPending.current = data.pending
  }, [data, client, open])

  const waitingForWorker = Boolean(data?.pending && !data.workerRunning)
  const busy = request.isPending || Boolean(data?.pending && data.workerRunning)
  const read = () => {
    if (!busy) request.mutate()
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            type="button"
            aria-label="Read the game now"
            aria-busy={busy}
            onClick={() => {
              setOpen(true)
              read()
            }}
          >
            <RefreshCwIcon className={cn('size-4', busy && 'animate-spin')} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" className="flex flex-col gap-0.5">
          {busy ? (
            <span>Reading the game…</span>
          ) : waitingForWorker ? (
            <span>Waiting for the worker to start</span>
          ) : (
            <>
              <span className="font-medium">Read the game now</span>
              {data?.lastDumpAt ? (
                <span>
                  Last read {formatDistanceToNow(new Date(data.lastDumpAt), { addSuffix: true })}
                  {data.elapsedMs ? `, paused ${(data.elapsedMs / 1000).toFixed(1)} s` : ''}
                </span>
              ) : null}
              {data && !data.auto ? <span>Automatic reads are off</span> : null}
            </>
          )}
        </TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <ReadProgress
            data={data}
            sending={request.isPending}
            requestError={request.error?.message ?? null}
            waitingForWorker={waitingForWorker}
          />
          <DialogFooter>
            {!busy && !waitingForWorker ? (
              <Button variant="outline" onClick={read}>
                <RefreshCwIcon className="size-4" />
                Read again
              </Button>
            ) : null}
            <DialogClose asChild>
              <Button>Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * The read to show. While a request is on its way only a read under way
 * counts; once answered without progress (a worker from before progress was
 * reported), the fortress state says how it went.
 */
function shownRead(
  data: DumpState | undefined,
  sending: boolean,
  requestError: string | null,
): DumpProgress | null {
  const now = new Date().toISOString()
  if (requestError)
    return { step: 'worker', state: 'error', withMap: false, startedAt: now, detail: requestError }
  if (!data) return null
  const progress = data.progress
  if (progress && (progress.state === 'running' || !sending)) return progress
  if (sending || data.pending) return null
  const at = data.lastDumpAt ?? now
  if (data.status === 'live')
    return { step: 'store', state: 'done', withMap: false, startedAt: at, detail: null }
  if (data.status === 'menu' || data.status === 'offline')
    return { step: 'game', state: data.status, withMap: false, startedAt: at, detail: null }
  return null
}

function stepMarks(steps: DumpStep[], read: DumpProgress | null, blocked: boolean): StepMark[] {
  const at = read ? Math.max(steps.indexOf(read.step), 0) : 0
  const state = read?.state ?? 'running'
  return steps.map((_, i) => {
    if (i < at) return 'done'
    if (i > at) return state === 'running' ? 'upcoming' : state === 'done' ? 'done' : 'skipped'
    if (blocked) return 'blocked'
    if (state === 'running') return 'current'
    return state === 'offline' || state === 'error' ? 'failed' : 'done'
  })
}

function ReadProgress({
  data,
  sending,
  requestError,
  waitingForWorker,
}: {
  data: DumpState | undefined
  sending: boolean
  requestError: string | null
  waitingForWorker: boolean
}) {
  const read = waitingForWorker ? null : shownRead(data, sending, requestError)
  const steps = dumpSteps(read?.withMap ?? false)
  const marks = stepMarks(steps, read, waitingForWorker)
  const state = read?.state ?? 'running'
  const failed = state === 'offline' || state === 'error'
  const running = state === 'running' && !waitingForWorker
  const finished = marks.filter((mark) => mark === 'done').length
  const percent = state === 'done' ? 100 : Math.round((finished / steps.length) * 100)

  const title = requestError
    ? 'Could not ask for a read'
    : waitingForWorker
      ? 'Waiting for the worker'
      : state === 'done'
        ? 'Fortress read'
        : state === 'menu'
          ? 'No fortress is loaded'
          : state === 'offline'
            ? 'Dwarf Fortress did not answer'
            : state === 'error'
              ? 'The read failed'
              : 'Reading the game'

  let message: React.ReactNode
  if (requestError) message = requestError
  else if (waitingForWorker)
    message = (
      <>
        The worker is not running. Start it with{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-xs">bun run dev:worker</code> and it
        reads the game straight away.
      </>
    )
  else if (state === 'done')
    message =
      read?.detail ??
      (data?.elapsedMs
        ? `The fortress is up to date. The game was paused for ${(data.elapsedMs / 1000).toFixed(1)} s.`
        : 'The fortress is up to date.')
  else if (state === 'menu') message = 'The game is on a menu. Load a save, then read it again.'
  else if (state === 'offline') message = 'Is the game open, with DFHack running?'
  else if (state === 'error') message = 'The worker could not finish the read.'
  else if (read === null) message = 'The worker looks for requests every couple of seconds.'
  else
    message = read.withMap
      ? 'The game stands still until the fortress is copied out. The map comes along this time, which takes longer.'
      : 'The game stands still until the fortress is copied out.'

  return (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription aria-live="polite">{message}</DialogDescription>
      </DialogHeader>

      {failed && !requestError && read?.detail ? (
        <code className="block rounded-md bg-muted p-2 text-xs break-all whitespace-pre-wrap">
          {read.detail}
        </code>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Progress
          value={running ? Math.max(percent, 4) : percent}
          aria-label="Read progress"
          className={cn(
            failed && '[&_[data-slot=progress-indicator]]:bg-destructive',
            running && '[&_[data-slot=progress-indicator]]:animate-pulse',
          )}
        />
        <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
          <span>
            {finished} of {steps.length} steps
          </span>
          {running && read ? <Elapsed since={read.startedAt} /> : null}
        </div>
      </div>

      <ol className="flex flex-col gap-1.5">
        {steps.map((step, i) => {
          const mark = marks[i] ?? 'upcoming'
          return (
            <li
              key={step}
              aria-current={mark === 'current' ? 'step' : undefined}
              className={cn(
                'flex items-center gap-2 text-sm',
                (mark === 'upcoming' || mark === 'skipped') && 'text-muted-foreground',
                mark === 'current' && 'font-medium',
                mark === 'failed' && 'text-destructive',
              )}
            >
              <StepIcon mark={mark} />
              {STEP_LABEL[step]}
            </li>
          )
        })}
      </ol>
    </>
  )
}

function Elapsed({ since }: { since: string }) {
  useTick(100)
  const seconds = Math.max(0, (Date.now() - new Date(since).getTime()) / 1000)
  return <span>{seconds.toFixed(1)} s</span>
}

function StepIcon({ mark }: { mark: StepMark }) {
  const base = 'size-4 shrink-0'
  switch (mark) {
    case 'done':
      return <CircleCheckIcon className={cn(base, 'text-emerald-700 dark:text-emerald-400')} />
    case 'current':
      return <LoaderCircleIcon className={cn(base, 'animate-spin text-primary')} />
    case 'blocked':
      return <CirclePauseIcon className={cn(base, 'text-amber-600 dark:text-amber-400')} />
    case 'failed':
      return <CircleAlertIcon className={base} />
    case 'skipped':
      return <CircleMinusIcon className={cn(base, 'opacity-50')} />
    default:
      return <CircleIcon className={cn(base, 'opacity-40')} />
  }
}
