import {
  type FortUnit,
  MAX_UNIT_TITLE,
  type UnitAction,
  decodeTable,
  isUnitAction,
  postgres_db,
  schema,
} from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, inArray } from 'drizzle-orm'

import { getSupabaseServerClient } from '~/lib/utils/supabase/server'

/*
 * Actions on one unit, queued for the worker: a nickname (its own command
 * kind, shared with the nickname page) or one of UNIT_ACTIONS. The game side
 * checks everything again before it changes anything.
 */

const C = schema.fort_commands
const SINGLETON_ID = 1

export type UnitCommandAction = UnitAction | 'nickname'

export interface UnitCommandRun {
  id: number
  action: UnitCommandAction
  /** The nickname or title it set; empty clears it. */
  text: string | null
  status: 'pending' | 'processing' | 'done' | 'failed'
  error: string | null
  createdAt: string
  completedAt: string | null
}

async function requireUser() {
  const {
    data: { user },
  } = await getSupabaseServerClient().auth.getUser()
  if (!user) throw new Error('You must be signed in to change anything in the game')
  return user
}

function cleanText(value: string | undefined, what: string): string {
  const text = (value ?? '').trim()
  const chars = Array.from(text)
  if (chars.length > MAX_UNIT_TITLE)
    throw new Error(`${what} can be at most ${MAX_UNIT_TITLE} characters`)
  if (chars.some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127))
    throw new Error(`${what} cannot contain control characters`)
  return text
}

function isLiving(unit: FortUnit): boolean {
  return !unit.flags.includes('dead') && !unit.flags.includes('ghost')
}

export const queueUnitAction = createServerFn({ method: 'POST' })
  .inputValidator((input: { unitId: number; action: UnitCommandAction; text?: string }) => input)
  .handler(async ({ data }): Promise<{ id: number; reused: boolean }> => {
    await requireUser()
    const { unitId, action } = data
    if (!Number.isSafeInteger(unitId) || unitId < 0) throw new Error('Invalid unit id')
    if (action !== 'nickname' && !isUnitAction(action))
      throw new Error('That action is not on the list')

    const [stateRows, dumpRows] = await Promise.all([
      postgres_db
        .select({ status: schema.fort_state.status })
        .from(schema.fort_state)
        .where(eq(schema.fort_state.id, SINGLETON_ID))
        .limit(1),
      postgres_db
        .select({ units: schema.fort_dump.units })
        .from(schema.fort_dump)
        .where(eq(schema.fort_dump.id, SINGLETON_ID))
        .limit(1),
    ])
    if (stateRows[0]?.status !== 'live') throw new Error('A live fortress is required')
    const unit = decodeTable<FortUnit>(dumpRows[0]?.units).find((u) => u.id === unitId)
    if (!unit) throw new Error('They are not in the current fortress')

    if (action === 'nickname') {
      if (!isLiving(unit) || !unit.flags.includes('citizen'))
        throw new Error('Only living citizens can be nicknamed')
    } else if (action === 'reveal') {
      if (unit.x === null) throw new Error('They are not on the map')
    } else if (!isLiving(unit) || !unit.flags.includes('fort_controlled')) {
      throw new Error('Only living members of the fortress can be changed')
    }

    if (action === 'nickname') {
      const [row] = await postgres_db
        .insert(C)
        .values({
          kind: 'set_nickname',
          unit_id: unitId,
          nickname: cleanText(data.text, 'Nicknames'),
        })
        .returning({ id: C.id })
      return { id: row.id, reused: false }
    }

    const arg = action === 'title' ? cleanText(data.text, 'Titles') : null
    if (action !== 'title') {
      // A second click while the first is still waiting should not run it twice.
      const waiting = await postgres_db
        .select({ id: C.id })
        .from(C)
        .where(
          and(
            eq(C.kind, 'unit_action'),
            eq(C.unit_id, unitId),
            eq(C.action, action),
            inArray(C.status, ['pending', 'processing']),
          ),
        )
        .limit(1)
      if (waiting[0]) return { id: waiting[0].id, reused: true }
    }
    const [row] = await postgres_db
      .insert(C)
      .values({ kind: 'unit_action', unit_id: unitId, action, arg })
      .returning({ id: C.id })
    return { id: row.id, reused: false }
  })

/** What was asked of the game for this unit lately, newest first. */
export const listUnitCommands = createServerFn({ method: 'GET' })
  .inputValidator((input: { unitId: number }) => input)
  .handler(async ({ data }): Promise<UnitCommandRun[]> => {
    await requireUser()
    const rows = await postgres_db
      .select()
      .from(C)
      .where(and(eq(C.unit_id, data.unitId), inArray(C.kind, ['set_nickname', 'unit_action'])))
      .orderBy(desc(C.created_at), desc(C.id))
      .limit(20)
    return rows.flatMap((row): UnitCommandRun[] => {
      const action: UnitCommandAction | null =
        row.kind === 'set_nickname' ? 'nickname' : isUnitAction(row.action) ? row.action : null
      if (!action) return []
      return [
        {
          id: row.id,
          action,
          text: row.kind === 'set_nickname' ? row.nickname : row.arg,
          status: row.status,
          error: row.error,
          createdAt: row.created_at,
          completedAt: row.completed_at,
        },
      ]
    })
  })
