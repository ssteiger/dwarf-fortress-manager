import type { FortBuilding, FortItem, FortJob, FortOrder, FortUnit } from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'

import { type FixPlan, planFixes } from '../advice/fixes'
import { dumpTable, readDump } from './dump'
import { currentSummary } from './fortState'

/*
 * Server functions for the work page: workshops, jobs and work orders, and
 * the work orders that would fix the suspended and failing jobs.
 */

export interface FortWorkResult {
  capturedAt: string | null
  buildings: FortBuilding[]
  jobs: FortJob[]
  /** Manager work orders; empty in dumps older than version 9. */
  orders: FortOrder[]
  units: Pick<FortUnit, 'id' | 'name' | 'profession'>[]
}

export const getFortWork = createServerFn({ method: 'GET' }).handler(
  async (): Promise<FortWorkResult> => {
    const dump = await readDump()
    const row = dump?.row
    return {
      capturedAt: row?.captured_at ?? null,
      buildings: dumpTable<FortBuilding>(dump, 'buildings'),
      jobs: dumpTable<FortJob>(dump, 'jobs'),
      orders: dumpTable<FortOrder>(dump, 'orders'),
      units: dumpTable<FortUnit>(dump, 'units').map((u) => ({
        id: u.id,
        name: u.name,
        profession: u.profession,
      })),
    }
  },
)

export interface FortFixes extends FixPlan {
  capturedAt: string | null
}

/** Work orders, in order, for what the suspended and failing jobs lack. */
export const getFortFixes = createServerFn({ method: 'GET' }).handler(
  async (): Promise<FortFixes> => {
    const [dump, summary] = await Promise.all([readDump(), currentSummary()])
    const row = dump?.row
    return {
      capturedAt: row?.captured_at ?? null,
      ...planFixes({
        jobs: dumpTable<FortJob>(dump, 'jobs'),
        items: dumpTable<FortItem>(dump, 'items'),
        orders: dumpTable<FortOrder>(dump, 'orders'),
        alerts: summary?.alerts ?? [],
      }),
    }
  },
)
