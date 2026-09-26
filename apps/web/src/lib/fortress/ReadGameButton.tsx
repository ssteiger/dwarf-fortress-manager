import { Button, Tooltip, TooltipContent, TooltipTrigger, cn } from '@fortress/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { RefreshCwIcon } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { requestDump } from './dump'
import { DUMP_STATE_KEY, useDumpState } from './queries'

/** Reads the game now, whatever the schedule in Settings says. */
export function ReadGameButton() {
  const client = useQueryClient()
  const { data } = useDumpState()
  const asked = React.useRef(false)
  const wasPending = React.useRef(false)

  const request = useMutation({
    mutationFn: () => requestDump(),
    onSuccess: ({ workerRunning }) => {
      asked.current = true
      wasPending.current = true
      if (!workerRunning)
        toast.error('The worker is not running', {
          description: 'Start it with bun run dev:worker and it reads the game straight away.',
        })
      void client.invalidateQueries({ queryKey: DUMP_STATE_KEY })
    },
    onError: (error) => toast.error(error.message),
  })

  // Once the read has landed, every page refetches what it shows.
  React.useEffect(() => {
    if (!data) return
    if (wasPending.current && !data.pending) {
      void client.invalidateQueries({ queryKey: ['fort'] })
      void client.invalidateQueries({ queryKey: ['settings', 'connection'] })
      if (asked.current) {
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
  }, [data, client])

  const waitingForWorker = Boolean(data?.pending && !data.workerRunning)
  const busy = request.isPending || Boolean(data?.pending && data.workerRunning)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          type="button"
          aria-label="Read the game now"
          aria-busy={busy}
          onClick={() => {
            if (!busy) request.mutate()
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
  )
}
