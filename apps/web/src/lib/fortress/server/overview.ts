import {
  type FortAutomation,
  type FortBuilding,
  type FortEvent,
  type FortItem,
  type FortState,
  type FortUnit,
  postgres_db,
  schema,
} from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { desc, eq, sql } from 'drizzle-orm'

import { isLiving } from '../format'
import type { FortConcerns, UnburiedBody } from '../types'
import { type CachedDump, dumpCapturedAt, readDump } from './dump'
import { ofFortress, timelineOf, undoneIn } from './fortState'

/*
 * Server functions for the overview: the fortress state with its
 * announcements, and what the overview checks beyond units and stocks
 * (rooms, burials, cups, health, automation).
 */

const SINGLETON_ID = 1
const E = schema.fort_events

export interface FortOverview {
  state: FortState | null
  dumpCapturedAt: string | null
  /** This fortress's announcements up to its present, newest first, without job cancellations. */
  events: FortEvent[]
  /** Announcements hidden because loading an earlier save undid them. */
  undone: number
}

export const getFortOverview = createServerFn({ method: 'GET' }).handler(
  async (): Promise<FortOverview> => {
    const [stateRows, capturedAt] = await Promise.all([
      postgres_db
        .select()
        .from(schema.fort_state)
        .where(eq(schema.fort_state.id, SINGLETON_ID))
        .limit(1),
      dumpCapturedAt(),
    ])
    const state = stateRows[0] ?? null
    const timeline = timelineOf(state)
    const notCancel = sql`coalesce(${E.type}, '') <> 'CANCEL_JOB'`
    const [events, undoneRows] = await Promise.all([
      postgres_db
        .select()
        .from(E)
        .where(
          timeline
            ? sql`${ofFortress(timeline)} and not ${undoneIn(timeline)} and ${notCancel}`
            : notCancel,
        )
        .orderBy(desc(E.game_year), desc(E.game_tick), desc(E.id))
        .limit(160),
      timeline
        ? postgres_db.select({ n: sql<number>`count(*)::int` }).from(E).where(undoneIn(timeline))
        : Promise.resolve([{ n: 0 }]),
    ])
    return {
      state,
      dumpCapturedAt: capturedAt,
      events,
      undone: Number(undoneRows[0]?.n ?? 0),
    }
  },
)

async function readFortConcerns(): Promise<FortConcerns> {
  const dump = await readDump()
  if (!dump) return { capturedAt: null, zones: {}, coffins: 0, cups: 0, unburied: [], health: null }
  return dump.memo('concerns', () => fortConcerns(dump))
}

function fortConcerns(dump: CachedDump): FortConcerns {
  const row = dump.row
  const zones: Record<string, number> = {}
  let coffins = 0
  for (const b of dump.table<FortBuilding>('buildings')) {
    if (b.type === 'Civzone' && b.subtype) zones[b.subtype] = (zones[b.subtype] ?? 0) + 1
    if (b.type === 'Coffin') coffins++
  }

  // Our dead, by the name the game gives their corpse: "Urist McDwarf's skeleton".
  const ownDead = new Map<string, FortUnit>()
  for (const u of dump.table<FortUnit>('units')) {
    if (isLiving(u) || !u.name) continue
    if (u.flags.includes('citizen') || u.flags.includes('own_civ') || u.flags.includes('resident'))
      ownDead.set(u.name.toLowerCase(), u)
  }
  let cups = 0
  const unburied: UnburiedBody[] = []
  const seen = new Set<number>()
  for (const item of dump.table<FortItem>('items')) {
    if (item.type === 'GOBLET' && item.x !== null && !item.flags.includes('trader'))
      cups += item.stack || 1
    if (item.type !== 'CORPSE' && item.type !== 'CORPSEPIECE') continue
    if (item.holder_building_id !== null) continue
    const owner = /^(.+?)'s /.exec(item.description)?.[1]?.toLowerCase()
    const unit = owner ? ownDead.get(owner) : undefined
    if (!unit || seen.has(unit.id)) continue
    seen.add(unit.id)
    unburied.push({
      unitId: unit.id,
      name: unit.name,
      description: item.description,
      x: item.x,
      y: item.y,
      z: item.z,
    })
  }
  return {
    capturedAt: row.captured_at,
    zones,
    coffins,
    cups,
    unburied,
    health: row.health ?? null,
  }
}

export const getFortConcerns = createServerFn({ method: 'GET' }).handler(() => readFortConcerns())

export interface FortAutomationState {
  capturedAt: string | null
  /** Null until a dump from version 12 on. */
  automation: FortAutomation | null
}

/** Which DFHack plugins the last dump found running. */
export const getFortAutomation = createServerFn({ method: 'GET' }).handler(
  async (): Promise<FortAutomationState> => {
    const dump = await readDump()
    return { capturedAt: dump?.row.captured_at ?? null, automation: dump?.row.automation ?? null }
  },
)
