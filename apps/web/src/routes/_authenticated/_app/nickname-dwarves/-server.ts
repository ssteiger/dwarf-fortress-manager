import { type FortUnit, decodeTable, postgres_db, schema } from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { eq } from 'drizzle-orm'

import { getSupabaseServerClient } from '~/lib/utils/supabase/server'

const SINGLETON_ID = 1
const MAX_BATCH_SIZE = 250
export const MAX_NICKNAME_LENGTH = 40

export interface NicknameAssignment {
  unitId: number
  nickname: string
}

function validateNickname(value: string): string {
  const nickname = value.trim()
  if (Array.from(nickname).length > MAX_NICKNAME_LENGTH) {
    throw new Error(`Nicknames can be at most ${MAX_NICKNAME_LENGTH} characters`)
  }
  if (
    Array.from(nickname).some((character) => {
      const code = character.charCodeAt(0)
      return code < 32 || code === 127
    })
  ) {
    throw new Error('Nicknames cannot contain control characters')
  }
  return nickname
}

export const queueDwarfNicknames = createServerFn({ method: 'POST' })
  .inputValidator((input: { assignments: NicknameAssignment[] }) => input)
  .handler(async ({ data }) => {
    const {
      data: { user },
    } = await getSupabaseServerClient().auth.getUser()
    if (!user) throw new Error('You must be signed in to nickname citizens')

    if (!Array.isArray(data.assignments) || data.assignments.length === 0) {
      throw new Error('Choose at least one citizen')
    }
    if (data.assignments.length > MAX_BATCH_SIZE) {
      throw new Error(`At most ${MAX_BATCH_SIZE} nicknames can be queued at once`)
    }

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
    if (stateRows[0]?.status !== 'live') {
      throw new Error('A live fortress is required')
    }

    const citizens = new Map(
      decodeTable<FortUnit>(dumpRows[0]?.units)
        .filter(
          (unit) =>
            unit.flags.includes('citizen') &&
            !unit.flags.includes('dead') &&
            !unit.flags.includes('ghost'),
        )
        .map((unit) => [unit.id, unit]),
    )
    const seen = new Set<number>()
    const rows = data.assignments.map((assignment) => {
      if (!Number.isSafeInteger(assignment.unitId) || assignment.unitId < 0) {
        throw new Error('Invalid unit id')
      }
      if (seen.has(assignment.unitId)) {
        throw new Error(`Citizen ${assignment.unitId} was included more than once`)
      }
      seen.add(assignment.unitId)
      if (!citizens.has(assignment.unitId)) {
        throw new Error(`Citizen ${assignment.unitId} is not in the current fortress`)
      }
      return {
        kind: 'set_nickname' as const,
        unit_id: assignment.unitId,
        nickname: validateNickname(assignment.nickname),
      }
    })

    const queued = await postgres_db
      .insert(schema.fort_commands)
      .values(rows)
      .returning({ id: schema.fort_commands.id })
    return {
      queued: queued.length,
      commandIds: queued.map((command) => command.id),
    }
  })
