import { type LegendsWorld, postgres_db, schema } from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { desc, eq } from 'drizzle-orm'

/*
 * Server function: the imported legends worlds, and which of them the
 * running fortress stands in.
 */

export interface LegendsOverview {
  worlds: LegendsWorld[]
  /** World name of the running fortress, so the UI can say whether they match. */
  liveWorldName: string | null
}

export const getLegendsOverview = createServerFn({ method: 'GET' }).handler(
  async (): Promise<LegendsOverview> => {
    const [worlds, state] = await Promise.all([
      postgres_db
        .select()
        .from(schema.legends_worlds)
        .orderBy(desc(schema.legends_worlds.imported_at)),
      postgres_db
        .select({ world_name: schema.fort_state.world_name })
        .from(schema.fort_state)
        .where(eq(schema.fort_state.id, 1))
        .limit(1),
    ])
    return { worlds, liveWorldName: state[0]?.world_name ?? null }
  },
)
