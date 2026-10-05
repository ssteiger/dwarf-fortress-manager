import { type RowTable, decodeTable, postgres_db, schema } from '@fortress/db-drizzle'
import { eq } from 'drizzle-orm'

const SINGLETON_ID = 1
const D = schema.fort_dump

export type DumpRow = typeof D.$inferSelect

type TableColumn = {
  [K in keyof DumpRow]: NonNullable<DumpRow[K]> extends RowTable ? K : never
}[keyof DumpRow]

/**
 * The last dump, read and decoded once for every request until the worker
 * writes the next one. Only the worker writes `fort_dump`, and always with a
 * new `captured_at`, so that is all a request has to look up first.
 */
export interface CachedDump {
  row: DumpRow
  /** A table of the dump, decoded once; each call gets its own array of the shared rows. */
  table<T extends object>(column: TableColumn): T[]
  /** Something worked out from the dump, once per dump. Callers must not change what it returns. */
  memo<T>(key: string, compute: () => T): T
}

let entry: { capturedAt: string; dump: Promise<CachedDump | null> } | null = null

async function loadDump(): Promise<CachedDump | null> {
  const rows = await postgres_db.select().from(D).where(eq(D.id, SINGLETON_ID)).limit(1)
  const row = rows[0]
  if (!row) return null
  const tables = new Map<TableColumn, object[]>()
  const memos = new Map<string, unknown>()
  return {
    row,
    table<T extends object>(column: TableColumn): T[] {
      let decoded = tables.get(column)
      if (!decoded) {
        decoded = decodeTable<T>(row[column])
        tables.set(column, decoded)
      }
      return [...decoded] as T[]
    },
    memo<T>(key: string, compute: () => T): T {
      if (!memos.has(key)) memos.set(key, compute())
      return memos.get(key) as T
    },
  }
}

/** A table of the dump, empty without one. */
export function dumpTable<T extends object>(
  dump: CachedDump | null | undefined,
  column: TableColumn,
): T[] {
  return dump ? dump.table<T>(column) : []
}

/** When the last dump was taken and in which format, without reading it. */
export async function dumpHead(): Promise<{ capturedAt: string; version: number | null } | null> {
  const head = await postgres_db
    .select({ capturedAt: D.captured_at, version: D.dump_version })
    .from(D)
    .where(eq(D.id, SINGLETON_ID))
    .limit(1)
  return head[0] ?? null
}

export async function dumpCapturedAt(): Promise<string | null> {
  return (await dumpHead())?.capturedAt ?? null
}

/** The last dump, or null before the worker has written one. */
export async function readDump(): Promise<CachedDump | null> {
  const capturedAt = await dumpCapturedAt()
  if (!capturedAt) return null
  if (entry?.capturedAt !== capturedAt) {
    const next = { capturedAt, dump: loadDump() }
    next.dump.catch(() => {
      if (entry === next) entry = null
    })
    entry = next
  }
  return entry.dump
}
