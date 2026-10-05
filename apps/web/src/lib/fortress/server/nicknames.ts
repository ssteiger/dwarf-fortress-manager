import { postgres_db, schema } from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq } from 'drizzle-orm'

import { getSupabaseServerClient } from '~/lib/utils/supabase/server'

const SINGLETON_ID = 1

export interface NicknameReason {
  nickname: string
  /** The fact behind the name; null when the player typed their own. */
  why: string | null
  source: 'facts' | 'model' | 'list' | 'typed'
  at: string
}

/**
 * The newest nickname given to a unit from the nickname page, and why. The
 * page compares it with the unit's nickname now, since the game may have
 * been renamed by hand since.
 */
export const getNicknameReason = createServerFn({ method: 'GET' })
  .inputValidator((input: { unitId: number }) => input)
  .handler(async ({ data }): Promise<NicknameReason | null> => {
    const {
      data: { user },
    } = await getSupabaseServerClient().auth.getUser()
    if (!user) return null
    if (!Number.isSafeInteger(data.unitId) || data.unitId < 0) return null
    const [state] = await postgres_db
      .select({ world: schema.fort_state.world })
      .from(schema.fort_state)
      .where(eq(schema.fort_state.id, SINGLETON_ID))
      .limit(1)
    const world = state?.world
    if (!world) return null
    const N = schema.fort_nicknames
    const [row] = await postgres_db
      .select({ nickname: N.nickname, why: N.why, source: N.source, at: N.created_at })
      .from(N)
      .where(
        and(
          eq(N.user_id, user.id),
          eq(N.fort_key, `${world.save_dir}:${world.site_id}`),
          eq(N.unit_id, data.unitId),
        ),
      )
      .orderBy(desc(N.created_at), desc(N.id))
      .limit(1)
    return row ?? null
  })
