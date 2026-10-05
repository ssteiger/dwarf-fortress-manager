import type { FortCaravan, FortDiplomacy } from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'

import { readDump } from './dump'
import { currentSummary } from './fortState'

/*
 * Server function for the diplomacy page: neighbours, wars and petitions
 * from the dump, with the wealth and population that draw caravans and
 * invaders.
 */

export interface FortDiplomacyResult {
  capturedAt: string | null
  /** Null in dumps older than version 11. */
  diplomacy: FortDiplomacy | null
  caravans: FortCaravan[]
  /** What the fortress's progress levels measure: citizens, created and exported wealth. */
  citizens: number
  createdWealth: number | null
  exportedWealth: number | null
}

/** Neighbours, wars and petitions, with what draws caravans and invaders. */
export const getFortDiplomacy = createServerFn({ method: 'GET' }).handler(
  async (): Promise<FortDiplomacyResult> => {
    const [dump, summary] = await Promise.all([readDump(), currentSummary()])
    return {
      capturedAt: dump?.row.captured_at ?? null,
      diplomacy: dump?.row.diplomacy ?? null,
      caravans: summary?.caravans ?? [],
      citizens: summary ? summary.adults + summary.children + summary.babies : 0,
      createdWealth: summary?.wealth?.total ?? null,
      exportedWealth: summary?.wealth?.exported ?? null,
    }
  },
)
