import { postgres_db, schema } from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { desc, eq, max } from 'drizzle-orm'

import { requireSignedInUser } from '~/lib/utils/supabase/server'
import type { RawLog } from './model'

const MAX_LIMIT = 10_000

/** The newest `limit` lines the worker wrote, and whether there are older ones. */
export const getWorkerLogs = createServerFn({ method: 'GET' })
  .inputValidator((input: { limit: number }) => ({
    limit: Math.min(Math.max(Math.floor(input.limit) || 1, 1), MAX_LIMIT),
  }))
  .handler(
    async ({
      data,
    }): Promise<{
      rows: RawLog[]
      hasMore: boolean
      /** When a command from the app last ran through; proves earlier command failures over. */
      commandDoneAt: string | null
    }> => {
      await requireSignedInUser()
      const C = schema.fort_commands
      const [rows, [done]] = await Promise.all([
        postgres_db
          .select()
          .from(schema.logs)
          .orderBy(desc(schema.logs.created_at), desc(schema.logs.id))
          .limit(data.limit + 1),
        postgres_db
          .select({ at: max(C.completed_at) })
          .from(C)
          .where(eq(C.status, 'done')),
      ])
      return {
        rows: rows.slice(0, data.limit),
        hasMore: rows.length > data.limit,
        commandDoneAt: done?.at ?? null,
      }
    },
  )
