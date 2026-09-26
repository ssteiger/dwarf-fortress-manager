import { type DfhackAction, isDfhackAction, postgres_db, schema } from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, inArray } from 'drizzle-orm'

import { getSupabaseServerClient } from '~/lib/utils/supabase/server'

/*
 * Whitelisted DFHack actions, queued for the worker. The web app only ever
 * stores an action key; the worker looks up the command in DFHACK_ACTIONS.
 */

const C = schema.fort_commands

export interface ActionRun {
  id: number
  action: DfhackAction
  status: 'pending' | 'processing' | 'done' | 'failed'
  output: string | null
  error: string | null
  createdAt: string
  completedAt: string | null
}

async function requireUser() {
  const {
    data: { user },
  } = await getSupabaseServerClient().auth.getUser()
  if (!user) throw new Error('You must be signed in to run commands in the game')
  return user
}

export const queueDfhackAction = createServerFn({ method: 'POST' })
  .inputValidator((input: { action: DfhackAction }) => input)
  .handler(async ({ data }): Promise<{ id: number; reused: boolean }> => {
    await requireUser()
    if (!isDfhackAction(data.action)) throw new Error('That command is not on the list')
    const state = await postgres_db
      .select({ status: schema.fort_state.status })
      .from(schema.fort_state)
      .where(eq(schema.fort_state.id, 1))
      .limit(1)
    if (state[0]?.status !== 'live') throw new Error('A live fortress is required')

    // A second click while the first is still waiting should not run it twice.
    const waiting = await postgres_db
      .select({ id: C.id })
      .from(C)
      .where(
        and(
          eq(C.kind, 'dfhack'),
          eq(C.action, data.action),
          inArray(C.status, ['pending', 'processing']),
        ),
      )
      .limit(1)
    if (waiting[0]) return { id: waiting[0].id, reused: true }

    const [row] = await postgres_db
      .insert(C)
      .values({ kind: 'dfhack', action: data.action })
      .returning({ id: C.id })
    return { id: row.id, reused: false }
  })

/** The latest runs of each action, newest first. */
export const listDfhackActionRuns = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ActionRun[]> => {
    await requireUser()
    const rows = await postgres_db
      .select({
        id: C.id,
        action: C.action,
        status: C.status,
        output: C.output,
        error: C.error,
        created_at: C.created_at,
        completed_at: C.completed_at,
      })
      .from(C)
      .where(eq(C.kind, 'dfhack'))
      .orderBy(desc(C.created_at), desc(C.id))
      .limit(40)
    return rows
      .filter((row): row is typeof row & { action: DfhackAction } => isDfhackAction(row.action))
      .map((row) => ({
        id: row.id,
        action: row.action,
        status: row.status,
        output: row.output,
        error: row.error,
        createdAt: row.created_at,
        completedAt: row.completed_at,
      }))
  },
)
