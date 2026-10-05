/**
 * The file a player keeps their own writing in: notes on creatures, the
 * nicknames they gave and why, their name list and their legends journal.
 * Nothing here touches the database, so a file can be checked before import.
 */

export const BACKUP_KIND = 'dwarf-fortress-manager-backup'
export const BACKUP_VERSION = 1

export type NicknameSource = 'facts' | 'model' | 'list' | 'typed'

export interface BackupUnitNote {
  /** "save_dir:site_id", as the chronicle keys the fortress. */
  fortKey: string
  unitId: number
  note: string
  updatedAt: string
}

export interface BackupNickname {
  fortKey: string
  unitId: number
  nickname: string
  why: string | null
  source: NicknameSource
  createdAt: string
}

export interface BackupListName {
  name: string
  createdAt: string
}

export interface BackupJournalEntry {
  /** The legends file prefix; world ids differ between databases. */
  worldKey: string
  worldName: string | null
  targetKind: string
  targetId: string
  title: string
  note: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface Backup {
  kind: typeof BACKUP_KIND
  version: number
  exportedAt: string
  unitNotes: BackupUnitNote[]
  nicknames: BackupNickname[]
  nameList: BackupListName[]
  journal: BackupJournalEntry[]
}

export interface BackupCounts {
  unitNotes: number
  nicknames: number
  nameList: number
  journal: number
}

export interface ImportResult {
  added: BackupCounts
  /** Notes and journal entries the file held a newer version of. */
  updated: number
  /** Rows this app already had, as new as the file's or newer. */
  unchanged: number
  /** Rows in the file that could not be read. */
  dropped: number
  /** Names left out because the list was full. */
  listFull: number
  /** Journal entries for worlds whose legends are not imported here, by world name. */
  missingWorlds: { name: string; entries: number }[]
}

export const BACKUP_LIMITS = {
  note: 20_000,
  nickname: 40,
  why: 300,
  title: 400,
  tags: 12,
  tag: 40,
  list: 500,
  key: 400,
  rows: 50_000,
} as const

export class BackupError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  return Array.from(value).slice(0, max).join('')
}

/** One line of plain text, the way the nickname page cleans names. */
function line(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const printable = Array.from(value)
    .map((c) => {
      const code = c.charCodeAt(0)
      return code < 32 || code === 127 ? ' ' : c
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  const cut = Array.from(printable).slice(0, max).join('').trim()
  return cut || null
}

function key(value: unknown): string | null {
  return typeof value === 'string' && value.trim() && value.length <= BACKUP_LIMITS.key
    ? value
    : null
}

function unitId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function date(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? fallback : new Date(ms).toISOString()
}

function tags(value: unknown): string[] {
  const seen = new Set<string>()
  for (const raw of Array.isArray(value) ? value : []) {
    if (typeof raw !== 'string') continue
    const tag = raw.trim().replace(/^#/, '').toLowerCase().slice(0, BACKUP_LIMITS.tag)
    if (tag) seen.add(tag)
    if (seen.size >= BACKUP_LIMITS.tags) break
  }
  return [...seen]
}

const SOURCES = new Set<string>(['facts', 'model', 'list', 'typed'])

/**
 * Checks a parsed file and trims it to what the app keeps. Throws a
 * `BackupError` with a sentence for the player when the file is not a backup;
 * rows that do not fit are left out and counted.
 */
export function readBackup(input: unknown): { backup: Backup; dropped: number } {
  if (!isRecord(input) || input.kind !== BACKUP_KIND)
    throw new BackupError('This file is not a backup from Dwarf Fortress Manager.')
  const version = input.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    throw new BackupError('This backup does not say which version wrote it, so it was not read.')
  if (version > BACKUP_VERSION)
    throw new BackupError(
      `This backup was written by a newer version of the app (format ${version}, this app reads ${BACKUP_VERSION}). Update the app, then import it again.`,
    )
  const now = new Date().toISOString()
  const exportedAt = date(input.exportedAt, now)
  let dropped = 0
  function rows<T>(value: unknown, read: (row: Record<string, unknown>) => T | null): T[] {
    if (value === undefined) return []
    if (!Array.isArray(value)) {
      dropped++
      return []
    }
    if (value.length > BACKUP_LIMITS.rows)
      throw new BackupError(
        `This backup holds ${value.length} rows in one list, more than the ${BACKUP_LIMITS.rows} the app imports at once.`,
      )
    const out: T[] = []
    for (const row of value) {
      const read_ = isRecord(row) ? read(row) : null
      if (read_ === null) dropped++
      else out.push(read_)
    }
    return out
  }

  const unitNotes = rows(input.unitNotes, (r): BackupUnitNote | null => {
    const fortKey = key(r.fortKey)
    const id = unitId(r.unitId)
    const note = text(r.note, BACKUP_LIMITS.note)
    if (fortKey === null || id === null || !note?.trim()) return null
    return { fortKey, unitId: id, note, updatedAt: date(r.updatedAt, exportedAt) }
  })
  const nicknames = rows(input.nicknames, (r): BackupNickname | null => {
    const fortKey = key(r.fortKey)
    const id = unitId(r.unitId)
    const nickname = line(r.nickname, BACKUP_LIMITS.nickname)
    if (fortKey === null || id === null || nickname === null) return null
    return {
      fortKey,
      unitId: id,
      nickname,
      why: line(r.why, BACKUP_LIMITS.why),
      source:
        typeof r.source === 'string' && SOURCES.has(r.source)
          ? (r.source as NicknameSource)
          : 'typed',
      createdAt: date(r.createdAt, exportedAt),
    }
  })
  const nameList = rows(input.nameList, (r): BackupListName | null => {
    const name = line(r.name, BACKUP_LIMITS.nickname)
    return name === null ? null : { name, createdAt: date(r.createdAt, exportedAt) }
  })
  const journal = rows(input.journal, (r): BackupJournalEntry | null => {
    const worldKey = key(r.worldKey)
    const targetKind = key(r.targetKind)
    const targetId = key(r.targetId)
    if (worldKey === null || targetKind === null || targetId === null) return null
    const createdAt = date(r.createdAt, exportedAt)
    return {
      worldKey,
      worldName: line(r.worldName, BACKUP_LIMITS.title),
      targetKind,
      targetId,
      title: text(r.title, BACKUP_LIMITS.title) ?? '',
      note: text(r.note, BACKUP_LIMITS.note) ?? '',
      tags: tags(r.tags),
      createdAt,
      updatedAt: date(r.updatedAt, createdAt),
    }
  })

  return {
    backup: {
      kind: BACKUP_KIND,
      version,
      exportedAt,
      unitNotes: newest(unitNotes, (n) => `${n.fortKey}\u0000${n.unitId}`),
      nicknames,
      nameList,
      journal: newest(journal, (j) => `${j.worldKey}\u0000${j.targetKind}\u0000${j.targetId}`),
    },
    dropped,
  }
}

/** One row per key, the most recently updated, so an upsert never meets the same key twice. */
function newest<T extends { updatedAt: string }>(rows: T[], keyOf: (row: T) => string): T[] {
  const kept = new Map<string, T>()
  for (const row of rows) {
    const k = keyOf(row)
    const had = kept.get(k)
    if (!had || had.updatedAt < row.updatedAt) kept.set(k, row)
  }
  return [...kept.values()]
}

export function countBackup(backup: Backup): BackupCounts {
  return {
    unitNotes: backup.unitNotes.length,
    nicknames: backup.nicknames.length,
    nameList: backup.nameList.length,
    journal: backup.journal.length,
  }
}

export function backupFileName(at: Date): string {
  return `dwarf-fortress-manager-backup-${at.toISOString().slice(0, 10)}.json`
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function list(words: string[]): string {
  return words.length <= 1
    ? words.join('')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

/** "3 notes on creatures, 22 nicknames and 116 names on your list", or null when empty. */
export function describeCounts(counts: BackupCounts): string | null {
  const parts = [
    counts.unitNotes ? plural(counts.unitNotes, 'note on a creature', 'notes on creatures') : '',
    counts.nicknames ? plural(counts.nicknames, 'nickname', 'nicknames') : '',
    counts.nameList ? plural(counts.nameList, 'name on your list', 'names on your list') : '',
    counts.journal ? plural(counts.journal, 'journal entry', 'journal entries') : '',
  ].filter(Boolean)
  return parts.length ? list(parts) : null
}

/** What an import did, in sentences. */
export function describeImport(result: ImportResult): string {
  const sentences: string[] = []
  const added = describeCounts(result.added)
  sentences.push(added ? `Added ${added}.` : 'Nothing new to add.')
  if (result.updated)
    sentences.push(
      `${result.updated === 1 ? 'One was' : `${result.updated} were`} replaced by a newer version from the file.`,
    )
  if (result.unchanged)
    sentences.push(
      `${result.unchanged === 1 ? 'One was' : `${result.unchanged} were`} already here.`,
    )
  for (const world of result.missingWorlds)
    sentences.push(
      `${plural(world.entries, 'journal entry is', 'journal entries are')} for ${world.name}, whose legends are not imported here: import its legends export in Settings, then this file again.`,
    )
  if (result.listFull)
    sentences.push(
      `${plural(result.listFull, 'name', 'names')} did not fit, since the list holds ${BACKUP_LIMITS.list}.`,
    )
  if (result.dropped)
    sentences.push(
      `${plural(result.dropped, 'row', 'rows')} in the file could not be read and ${result.dropped === 1 ? 'was' : 'were'} left out.`,
    )
  return sentences.join(' ')
}
