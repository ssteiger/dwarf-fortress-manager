import {
  type DfhackAction,
  type FortStatus,
  type UnitAction,
  postgres_db,
  schema,
} from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { count, desc, eq, max } from 'drizzle-orm'

import { getSupabaseServerClient } from '~/lib/utils/supabase/server'

async function requireUser() {
  const {
    data: { user },
  } = await getSupabaseServerClient().auth.getUser()
  if (!user) throw new Error('You must be signed in')
  return user
}

// ---------------------------------------------------------------------------
// Game connection

export interface WorkerCommand {
  id: number
  kind: 'set_nickname' | 'dfhack' | 'unit_action' | 'console'
  action: DfhackAction | UnitAction | null
  unitId: number | null
  nickname: string | null
  /** unit_action: the text it took, such as a title. */
  arg: string | null
  /** console: the command as confirmed in the assistant. */
  command: string | null
  status: 'pending' | 'processing' | 'done' | 'failed'
  error: string | null
  output: string | null
  createdAt: string
  completedAt: string | null
}

export interface ConnectionStatus {
  /** Null until the worker has reported at least once. */
  status: FortStatus | null
  fortName: string | null
  worldName: string | null
  siteName: string | null
  gameDate: string | null
  saveDir: string | null
  dfVersion: string | null
  dfhackVersion: string | null
  /** When the worker last talked to the game. */
  reportedAt: string | null
  /** How long that last dump took. */
  elapsedMs: number | null
  error: string | null
  dumpAt: string | null
  mapAt: string | null
  mapSize: { x: number; y: number; z: number } | null
  eventCount: number
  lastEventAt: string | null
  commands: WorkerCommand[]
}

export const getConnectionStatus = createServerFn({ method: 'GET' }).handler(
  async (): Promise<ConnectionStatus> => {
    await requireUser()
    const C = schema.fort_commands
    const [state, dump, map, events, commands] = await Promise.all([
      postgres_db.select().from(schema.fort_state).where(eq(schema.fort_state.id, 1)).limit(1),
      postgres_db
        .select({ captured_at: schema.fort_dump.captured_at })
        .from(schema.fort_dump)
        .where(eq(schema.fort_dump.id, 1))
        .limit(1),
      postgres_db
        .select({
          captured_at: schema.fort_map.captured_at,
          x: schema.fort_map.x_count,
          y: schema.fort_map.y_count,
          z: schema.fort_map.z_count,
        })
        .from(schema.fort_map)
        .where(eq(schema.fort_map.id, 1))
        .limit(1),
      postgres_db
        .select({ total: count(), latest: max(schema.fort_events.captured_at) })
        .from(schema.fort_events),
      postgres_db.select().from(C).orderBy(desc(C.created_at)).limit(25),
    ])
    const s = state[0]
    const m = map[0]
    return {
      status: s?.status ?? null,
      fortName: s?.fort_name ?? null,
      worldName: s?.world_name ?? null,
      siteName: s?.world?.site_name ?? null,
      gameDate: s?.game_date ?? null,
      saveDir: s?.world?.save_dir ?? null,
      dfVersion: s?.world?.df_version ?? null,
      dfhackVersion: s?.world?.dfhack_version ?? null,
      reportedAt: s?.captured_at ?? null,
      elapsedMs: s?.elapsed_ms ?? null,
      error: s?.error ?? null,
      dumpAt: dump[0]?.captured_at ?? null,
      mapAt: m?.captured_at ?? null,
      mapSize: m ? { x: m.x, y: m.y, z: m.z } : null,
      eventCount: events[0]?.total ?? 0,
      lastEventAt: events[0]?.latest ?? null,
      commands: commands.map((c) => ({
        id: c.id,
        kind: c.kind,
        action: c.action,
        unitId: c.unit_id,
        nickname: c.nickname,
        arg: c.arg,
        command: c.command,
        status: c.status,
        error: c.error,
        output: c.output,
        createdAt: c.created_at,
        completedAt: c.completed_at,
      })),
    }
  },
)

/**
 * Commands still waiting for the worker. Worth cancelling when the worker has
 * been off: otherwise they all run the moment it comes back.
 */
export const cancelWaitingCommands = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ cancelled: number }> => {
    await requireUser()
    const C = schema.fort_commands
    const rows = await postgres_db
      .update(C)
      .set({
        status: 'failed',
        error: 'Cancelled in Settings before the worker picked it up',
        completed_at: new Date().toISOString(),
      })
      .where(eq(C.status, 'pending'))
      .returning({ id: C.id })
    return { cancelled: rows.length }
  },
)

// ---------------------------------------------------------------------------
// Legends

export interface LegendsLibraryWorld {
  id: number
  name: string | null
  altName: string | null
  importedAt: string
  records: number
  files: number
  /** The signed-in reader's journal notes in this world. */
  notes: number
}

export interface LegendsLibrary {
  worlds: LegendsLibraryWorld[]
  liveWorldName: string | null
}

export const getLegendsLibrary = createServerFn({ method: 'GET' }).handler(
  async (): Promise<LegendsLibrary> => {
    const user = await requireUser()
    const N = schema.legends_notes
    const I = schema.legends_imports
    const [worlds, files, notes, state] = await Promise.all([
      postgres_db
        .select()
        .from(schema.legends_worlds)
        .orderBy(desc(schema.legends_worlds.imported_at)),
      postgres_db.select({ worldId: I.world_id, total: count() }).from(I).groupBy(I.world_id),
      postgres_db
        .select({ worldId: N.world_id, total: count() })
        .from(N)
        .where(eq(N.user_id, user.id))
        .groupBy(N.world_id),
      postgres_db
        .select({ world_name: schema.fort_state.world_name })
        .from(schema.fort_state)
        .where(eq(schema.fort_state.id, 1))
        .limit(1),
    ])
    const fileCount = new Map(files.map((f) => [f.worldId, f.total]))
    const noteCount = new Map(notes.map((n) => [n.worldId, n.total]))
    return {
      worlds: worlds.map((w) => ({
        id: w.id,
        name: w.name,
        altName: w.alt_name,
        importedAt: w.imported_at,
        records: Object.values(w.record_counts ?? {}).reduce((sum, n) => sum + n, 0),
        files: fileCount.get(w.id) ?? 0,
        notes: noteCount.get(w.id) ?? 0,
      })),
      liveWorldName: state[0]?.world_name ?? null,
    }
  },
)
