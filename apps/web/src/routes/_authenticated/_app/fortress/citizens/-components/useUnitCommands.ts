import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import { toast } from 'sonner'

import {
  type UnitCommandAction,
  type UnitCommandRun,
  listUnitCommands,
  queueUnitAction,
} from '~/lib/fortress/server/unitActions'

/** A run older than this no longer shows as the result of its button. */
export const RECENT_MS = 30 * 60_000

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
        void client.invalidateQueries({ queryKey: ['fort', 'people'] })
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
