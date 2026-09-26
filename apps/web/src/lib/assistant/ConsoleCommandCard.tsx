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
} from '@fortress/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CircleCheckIcon,
  CopyIcon,
  Loader2Icon,
  PlayIcon,
  RotateCcwIcon,
  TerminalIcon,
} from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { usePreferences } from '~/lib/preferences'
import { getConsoleRun, queueConsoleCommand } from './server'

/** Waiting this long without being picked up: the worker is probably not running. */
const STALE_MS = 20_000

/**
 * A DFHack command the assistant suggested. It runs only after the player
 * has read it in full and confirmed; with one-click commands off in
 * Settings, it can only be copied.
 */
export function ConsoleCommandCard({
  command,
  problem,
}: {
  command: string
  problem: string | null
}) {
  const { oneClickActions } = usePreferences()
  const client = useQueryClient()
  const [runId, setRunId] = React.useState<number | null>(null)
  const [confirming, setConfirming] = React.useState(false)

  const run = useQuery({
    queryKey: ['assistant', 'console-run', runId],
    queryFn: () => (runId === null ? null : getConsoleRun({ data: { id: runId } })),
    enabled: runId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'pending' || status === 'processing' ? 1500 : false
    },
  })
  const queue = useMutation({
    mutationFn: () => queueConsoleCommand({ data: { command } }),
    onSuccess: ({ id, reused }) => {
      if (reused) toast.message('That command is already on its way.')
      setRunId(id)
    },
    onError: (error) => toast.error(error.message),
  })

  // Once it has run, the worker dumps the fortress (when reads are on); refresh what the pages show.
  const status = run.data?.status
  const finished = status === 'done' || status === 'failed'
  React.useEffect(() => {
    if (!finished) return
    const timer = setTimeout(() => {
      void client.invalidateQueries({ queryKey: ['fort'] })
      void client.invalidateQueries({ queryKey: ['settings', 'connection'] })
    }, 3000)
    return () => clearTimeout(timer)
  }, [finished, client])

  const busy = queue.isPending || status === 'pending' || status === 'processing'
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      toast.success('Copied. Paste it into the DFHack console.')
    } catch {
      toast.error('The clipboard would not take it.')
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-background p-2.5">
      <div className="flex items-start gap-2">
        <TerminalIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <code className="min-w-0 flex-1 font-mono text-xs break-all whitespace-pre-wrap">
          {command}
        </code>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {problem ? (
          <span className="text-xs text-destructive">{problem}</span>
        ) : oneClickActions ? (
          <Button
            size="sm"
            className="h-7 gap-1.5"
            onClick={() => setConfirming(true)}
            disabled={busy}
          >
            {busy ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : finished ? (
              <RotateCcwIcon className="size-3.5" />
            ) : (
              <PlayIcon className="size-3.5" />
            )}
            {finished ? 'Run again' : 'Run in DFHack'}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" className="h-7 gap-1.5" onClick={copy}>
          <CopyIcon className="size-3.5" />
          Copy
        </Button>
        {!problem && !oneClickActions ? (
          <span className="text-xs text-muted-foreground">
            One-click commands are off in Settings.
          </span>
        ) : null}
        <RunStatus run={run.data ?? null} />
      </div>
      {run.data?.error ? <p className="text-xs text-destructive">{run.data.error}</p> : null}
      {run.data?.output?.trim() ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            What DFHack said
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-muted p-2 whitespace-pre-wrap">
            {run.data.output.trim()}
          </pre>
        </details>
      ) : null}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run this in DFHack?</AlertDialogTitle>
            <AlertDialogDescription>
              The app runs exactly this line in DFHack's console. It cannot check what the command
              does to your game, so read it first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 font-mono text-sm break-all whitespace-pre-wrap">
            {command}
          </pre>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction onClick={() => queue.mutate()}>Run it</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function RunStatus({ run }: { run: Awaited<ReturnType<typeof getConsoleRun>> }) {
  if (!run) return null
  if (run.status === 'pending') {
    const stale = Date.now() - new Date(run.createdAt).getTime() > STALE_MS
    return (
      <span className="text-xs text-muted-foreground">
        {stale ? 'Not picked up yet. Is the worker running?' : 'Waiting for the worker…'}
      </span>
    )
  }
  if (run.status === 'processing')
    return <span className="text-xs text-muted-foreground">Running in the game…</span>
  if (run.status === 'done')
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
        <CircleCheckIcon className="size-3.5" />
        Done
      </span>
    )
  return <span className="text-xs text-destructive">Failed</span>
}
