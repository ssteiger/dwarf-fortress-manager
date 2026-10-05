import { postgres_db, schema } from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { type AnyColumn, count, eq, inArray, sql } from 'drizzle-orm'

import { requireSignedInUser } from '~/lib/utils/supabase/server'
import {
  BACKUP_KIND,
  BACKUP_LIMITS,
  BACKUP_VERSION,
  type Backup,
  type BackupCounts,
  type ImportResult,
  readBackup,
} from './backupFormat'

const requireUser = async () => (await requireSignedInUser('Sign in to back up your writing')).id

/** A timestamp as JavaScript writes it, to the millisecond, so it reads back the same. */
function iso(column: AnyColumn) {
  return sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
}

const CHUNK = 1000

function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK))
  return out
}

export const getBackupCounts = createServerFn({ method: 'GET' }).handler(
  async (): Promise<BackupCounts> => {
    const userId = await requireUser()
    const tables = [
      schema.fort_unit_notes,
      schema.fort_nicknames,
      schema.nickname_list,
      schema.legends_notes,
    ] as const
    const [unitNotes, nicknames, nameList, journal] = await Promise.all(
      tables.map((t) =>
        postgres_db
          .select({ total: count() })
          .from(t)
          .where(eq(t.user_id, userId))
          .then((rows) => rows[0]?.total ?? 0),
      ),
    )
    return { unitNotes, nicknames, nameList, journal }
  },
)

export const exportBackup = createServerFn({ method: 'GET' }).handler(async (): Promise<Backup> => {
  const userId = await requireUser()
  const U = schema.fort_unit_notes
  const K = schema.fort_nicknames
  const L = schema.nickname_list
  const J = schema.legends_notes
  const W = schema.legends_worlds
  const [unitNotes, nicknames, nameList, journal] = await Promise.all([
    postgres_db
      .select({
        fortKey: U.fort_key,
        unitId: U.unit_id,
        note: U.note,
        updatedAt: iso(U.updated_at),
      })
      .from(U)
      .where(eq(U.user_id, userId))
      .orderBy(U.fort_key, U.unit_id),
    postgres_db
      .select({
        fortKey: K.fort_key,
        unitId: K.unit_id,
        nickname: K.nickname,
        why: K.why,
        source: K.source,
        createdAt: iso(K.created_at),
      })
      .from(K)
      .where(eq(K.user_id, userId))
      .orderBy(K.created_at, K.id),
    postgres_db
      .select({ name: L.name, createdAt: iso(L.created_at) })
      .from(L)
      .where(eq(L.user_id, userId))
      .orderBy(L.created_at, L.id),
    postgres_db
      .select({
        worldKey: W.key,
        worldName: W.name,
        targetKind: J.target_kind,
        targetId: J.target_id,
        title: J.title,
        note: J.note,
        tags: J.tags,
        createdAt: iso(J.created_at),
        updatedAt: iso(J.updated_at),
      })
      .from(J)
      .innerJoin(W, eq(W.id, J.world_id))
      .where(eq(J.user_id, userId))
      .orderBy(W.key, J.created_at),
  ])
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    unitNotes,
    nicknames,
    nameList,
    journal,
  }
})

/**
 * Adds what the file has and this database does not. A note or journal entry
 * already here is replaced only by a newer one; nothing is deleted, and no one
 * is renamed in the game.
 */
export const importBackup = createServerFn({ method: 'POST' })
  .inputValidator((input: unknown) => readBackup(input))
  .handler(async ({ data }): Promise<ImportResult> => {
    const userId = await requireUser()
    const { backup, dropped } = data
    const result: ImportResult = {
      added: { unitNotes: 0, nicknames: 0, nameList: 0, journal: 0 },
      updated: 0,
      unchanged: 0,
      dropped,
      listFull: 0,
      missingWorlds: [],
    }

    await postgres_db.transaction(async (tx) => {
      const U = schema.fort_unit_notes
      for (const part of chunks(backup.unitNotes)) {
        const written = await tx
          .insert(U)
          .values(
            part.map((n) => ({
              user_id: userId,
              fort_key: n.fortKey,
              unit_id: n.unitId,
              note: n.note,
              created_at: n.updatedAt,
              updated_at: n.updatedAt,
            })),
          )
          .onConflictDoUpdate({
            target: [U.user_id, U.fort_key, U.unit_id],
            set: { note: sql`excluded.note`, updated_at: sql`excluded.updated_at` },
            setWhere: sql`${U.updated_at} < excluded.updated_at`,
          })
          .returning({ inserted: sql<boolean>`(xmax = 0)` })
        const inserted = written.filter((w) => w.inserted).length
        result.added.unitNotes += inserted
        result.updated += written.length - inserted
        result.unchanged += part.length - written.length
      }

      const K = schema.fort_nicknames
      const nicknameKey = (n: {
        fortKey: string
        unitId: number
        nickname: string
        createdAt: string
      }) => `${n.fortKey}\u0000${n.unitId}\u0000${n.nickname}\u0000${n.createdAt}`
      const haveNicknames = new Set(
        (
          await tx
            .select({
              fortKey: K.fort_key,
              unitId: K.unit_id,
              nickname: K.nickname,
              createdAt: iso(K.created_at),
            })
            .from(K)
            .where(eq(K.user_id, userId))
        ).map(nicknameKey),
      )
      const newNicknames = backup.nicknames.filter((n) => {
        const k = nicknameKey(n)
        if (haveNicknames.has(k)) return false
        haveNicknames.add(k)
        return true
      })
      result.unchanged += backup.nicknames.length - newNicknames.length
      for (const part of chunks(newNicknames))
        await tx.insert(K).values(
          part.map((n) => ({
            user_id: userId,
            fort_key: n.fortKey,
            unit_id: n.unitId,
            nickname: n.nickname,
            why: n.why,
            source: n.source,
            created_at: n.createdAt,
          })),
        )
      result.added.nicknames = newNicknames.length

      const L = schema.nickname_list
      const haveNames = new Set(
        (await tx.select({ name: L.name }).from(L).where(eq(L.user_id, userId))).map((r) =>
          r.name.toLowerCase(),
        ),
      )
      const room = Math.max(0, BACKUP_LIMITS.list - haveNames.size)
      const newNames = backup.nameList.filter((n) => {
        const k = n.name.toLowerCase()
        if (haveNames.has(k)) return false
        haveNames.add(k)
        return true
      })
      result.unchanged += backup.nameList.length - newNames.length
      result.listFull = Math.max(0, newNames.length - room)
      const fitting = newNames.slice(0, room)
      if (fitting.length) {
        const added = await tx
          .insert(L)
          .values(fitting.map((n) => ({ user_id: userId, name: n.name, created_at: n.createdAt })))
          .onConflictDoNothing()
          .returning({ id: L.id })
        result.added.nameList = added.length
      }

      const W = schema.legends_worlds
      const J = schema.legends_notes
      const worldKeys = [...new Set(backup.journal.map((j) => j.worldKey))]
      const worlds = worldKeys.length
        ? await tx.select({ id: W.id, key: W.key }).from(W).where(inArray(W.key, worldKeys))
        : []
      const worldId = new Map(worlds.map((w) => [w.key, w.id]))
      const missing = new Map<string, number>()
      const entries = backup.journal.filter((j) => {
        if (worldId.has(j.worldKey)) return true
        const name = j.worldName ?? j.worldKey
        missing.set(name, (missing.get(name) ?? 0) + 1)
        return false
      })
      result.missingWorlds = [...missing].map(([name, n]) => ({ name, entries: n }))
      for (const part of chunks(entries)) {
        const written = await tx
          .insert(J)
          .values(
            part.map((j) => ({
              user_id: userId,
              world_id: worldId.get(j.worldKey) as number,
              target_kind: j.targetKind,
              target_id: j.targetId,
              title: j.title,
              note: j.note,
              tags: j.tags,
              created_at: j.createdAt,
              updated_at: j.updatedAt,
            })),
          )
          .onConflictDoUpdate({
            target: [J.user_id, J.world_id, J.target_kind, J.target_id],
            set: {
              title: sql`excluded.title`,
              note: sql`excluded.note`,
              tags: sql`excluded.tags`,
              updated_at: sql`excluded.updated_at`,
            },
            setWhere: sql`${J.updated_at} < excluded.updated_at`,
          })
          .returning({ inserted: sql<boolean>`(xmax = 0)` })
        const inserted = written.filter((w) => w.inserted).length
        result.added.journal += inserted
        result.updated += written.length - inserted
        result.unchanged += part.length - written.length
      }
    })

    return result
  })
