import { postgres_db, schema } from '@fortress/db-drizzle'
import { and, asc, eq } from 'drizzle-orm'
import type { Config } from '../config'
import { runDfhackAction } from '../dfhack/actions'
import { setUnitNickname } from '../dfhack/nickname'

const COMMAND_BATCH_SIZE = 100

/** A worker restart makes commands that were interrupted safe to retry. */
export async function recoverInterruptedCommands(): Promise<void> {
  await postgres_db
    .update(schema.fort_commands)
    .set({ status: 'pending', started_at: null })
    .where(eq(schema.fort_commands.status, 'processing'))
}

/**
 * Apply a bounded batch of queued commands: nicknames and whitelisted DFHack
 * actions. Runs before each snapshot, and on its own short cadence between.
 */
export async function processPendingCommands(config: Config): Promise<number> {
  const pending = await postgres_db
    .select()
    .from(schema.fort_commands)
    .where(eq(schema.fort_commands.status, 'pending'))
    .orderBy(asc(schema.fort_commands.created_at), asc(schema.fort_commands.id))
    .limit(COMMAND_BATCH_SIZE)

  let processed = 0
  for (const command of pending) {
    const now = new Date().toISOString()
    const claimed = await postgres_db
      .update(schema.fort_commands)
      .set({ status: 'processing', started_at: now, error: null })
      .where(
        and(eq(schema.fort_commands.id, command.id), eq(schema.fort_commands.status, 'pending')),
      )
      .returning({ id: schema.fort_commands.id })
    if (claimed.length === 0) continue

    try {
      let output: string | null = null
      if (command.kind === 'set_nickname') {
        if (command.unit_id === null || command.nickname === null)
          throw new Error('nickname command without a unit or a nickname')
        await setUnitNickname(config, command.unit_id, command.nickname)
      } else if (command.kind === 'dfhack') {
        output = await runDfhackAction(config, command.action)
      } else {
        throw new Error(`unknown command kind "${command.kind}"`)
      }
      await postgres_db
        .update(schema.fort_commands)
        .set({ status: 'done', output, completed_at: new Date().toISOString() })
        .where(eq(schema.fort_commands.id, command.id))
    } catch (error) {
      await postgres_db
        .update(schema.fort_commands)
        .set({
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          completed_at: new Date().toISOString(),
        })
        .where(eq(schema.fort_commands.id, command.id))
    }
    processed++
  }
  return processed
}
