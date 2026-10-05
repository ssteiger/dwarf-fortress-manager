import { formatDistanceStrict, formatDistanceToNow } from 'date-fns'

/** A line from `public.logs`, as the worker's `logger` wrote it. */
export interface RawLog {
  id: number
  created_at: string | null
  message: string
}

export type LogLevel = 'error' | 'warning' | 'info'

export type LogSource = 'game' | 'commands' | 'legends' | 'other'

type LogKind =
  | 'connected'
  | 'menu'
  | 'unreachable'
  | 'read-failed'
  | 'commands-failed'
  | 'install-failed'
  | 'version'
  | 'legends'
  | 'other'

/** One thing the worker reported; a burst of the same line counts once. */
export interface LogEntry {
  /** Id of the newest line in the burst. */
  id: number
  level: LogLevel
  source: LogSource
  kind: LogKind
  /** What happened, as a sentence. */
  title: string
  /** The cause in the worker's own words, or the facts that came with it. */
  detail: string | null
  /** What to do about it. Backticks mark code. */
  hint: string | null
  /** The line as the worker wrote it. */
  raw: string
  /** When the newest line of the burst was written. */
  at: string | null
  /** When the first line of the burst was written. */
  firstAt: string | null
  count: number
  /** When something later showed the problem had passed; null if nothing has, or it cannot tell. */
  overAt: string | null
  /** What showed it: the worker connecting again, or a command from the app running through. */
  overBy: 'connected' | 'command' | null
}

/** Lines repeated closer together than this are one burst. */
const BURST_GAP_MS = 60 * 60_000

const DB_BEHIND_RE = /(column|relation) "[^"]+"( of relation "[^"]+")? does not exist/

const big = (n: string) => n.replace(/\d{4,}/g, (d) => Number(d).toLocaleString('en-US'))

function stripLevel(message: string): { level: LogLevel; text: string } {
  if (message.startsWith('ERROR:')) return { level: 'error', text: message.slice(6).trim() }
  if (message.startsWith('WARNING:')) return { level: 'warning', text: message.slice(8).trim() }
  return { level: 'info', text: message.trim() }
}

function hintFor(kind: LogKind, cause: string | null): string | null {
  if (cause && DB_BEHIND_RE.test(cause))
    return 'The database is older than the worker. Run `bun run db:migrate`, then restart the worker.'
  switch (kind) {
    case 'unreachable':
      return cause && /did not answer within/.test(cause)
        ? 'DFHack did not answer in time. The game may have been closed, or busy saving or loading. The worker keeps trying and notes here when it connects again.'
        : 'Is Dwarf Fortress open with DFHack? The worker keeps trying and notes here when it connects again.'
    case 'read-failed':
      return cause && /closed the connection/i.test(cause)
        ? 'The game was probably closed, or crashed, during the read. The next read tries again.'
        : 'The next read tries again. If it keeps failing, restart the worker (`bun run dev:worker`).'
    case 'commands-failed':
      return 'Nicknames, fixes and other commands from the app wait until this is fixed. Restart the worker (`bun run dev:worker`) once it is.'
    case 'install-failed':
      return 'Check that `DF_GAME_DIR` in `apps/worker/.env` points at the folder with Dwarf Fortress in it, then start the worker again.'
    case 'version':
      return 'Restart the worker (`bun run dev:worker`) so it installs the matching script.'
    default:
      return null
  }
}

type Described = Pick<LogEntry, 'level' | 'source' | 'kind' | 'title' | 'detail' | 'hint'>

/** Turn one line from the worker into a sentence, with its cause and what to do. */
export function describeLog(message: string): Described {
  const { level, text } = stripLevel(message)
  const make = (
    source: LogSource,
    kind: LogKind,
    title: string,
    detail: string | null = null,
    cause: string | null = detail,
  ): Described => ({
    level,
    source,
    kind,
    title,
    detail,
    hint: level === 'info' ? null : hintFor(kind, cause),
  })

  let m = /^Fortress worker connected: (.+?)(?: · (.+))?$/s.exec(text)
  if (m) return make('game', 'connected', `Connected to ${m[1]}`, m[2] ? `${big(m[2])}.` : null)
  if (/^Fortress worker: game is on a menu/.test(text))
    return make('game', 'menu', 'The game is on a menu, waiting for a fortress to load')
  m = /^Fortress worker: game unreachable \((.*)\)$/s.exec(text)
  if (m) return make('game', 'unreachable', 'Could not reach the game', m[1])
  m = /^Fortress worker: (?:dump|poll) failed \((.*)\)$/s.exec(text)
  if (m) return make('game', 'read-failed', 'A read of the game failed', m[1])
  m = /^Fortress worker: command processing failed \((.*)\)$/s.exec(text)
  if (m) return make('commands', 'commands-failed', 'Could not run commands from the app', m[1])
  m = /^Fortress worker: could not install DFHack scripts \((.*)\)$/s.exec(text)
  if (m)
    return make(
      'game',
      'install-failed',
      'Could not put the DFHack scripts in the game folder',
      m[1],
    )
  m = /dump version (\d+), and this worker reads version (\d+)/.exec(text)
  if (m)
    return make(
      'game',
      'version',
      'The game script and the worker are different versions',
      `The script wrote version ${m[1]}; the worker reads version ${m[2]}.`,
    )

  m = /^Legends: importing (.+)$/s.exec(text)
  if (m) return make('legends', 'legends', `Importing legends from ${m[1]}`)
  m = /^Legends: imported ([\d,]+) records from (.+) in ([\d.]+)s$/s.exec(text)
  if (m)
    return make(
      'legends',
      'legends',
      `Imported ${big(m[1])} legends records from ${m[2]}`,
      `Took ${m[3]} seconds.`,
    )
  m = /^Legends: world "(.+)" now has ([\d,]+) records$/s.exec(text)
  if (m) return make('legends', 'legends', `The world ${m[1]} now holds ${big(m[2])} records`)
  m = /^Legends: cannot read (.+?): (.*)$/s.exec(text)
  if (m) {
    const out = make('legends', 'legends', `Could not read the legends folder ${m[1]}`, m[2])
    return {
      ...out,
      hint: 'Check `DF_LEGENDS_DIR` in `apps/worker/.env`, or set `DF_IMPORT_LEGENDS=0` to skip legends.',
    }
  }
  m = /^Legends: import of (.+?) failed: (.*)$/s.exec(text)
  if (m) {
    const out = make('legends', 'legends', `Could not import legends from ${m[1]}`, m[2])
    return {
      ...out,
      hint:
        out.hint ??
        'The file may be cut short. Export the legends from the game again; the worker imports it the next time it starts.',
    }
  }

  m = /^Fortress worker:\s*(.+)$/s.exec(text)
  if (m) return make('game', 'other', capitalize(m[1]))
  m = /^Legends:\s*(.+)$/s.exec(text)
  if (m) return make('legends', 'legends', capitalize(m[1]))
  return make('other', 'other', text || '(empty line)')
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const time = (at: string | null) => (at ? new Date(at).getTime() : Number.NaN)

/** Problems a later connection proves over: the game answered and was read again. */
const OVER_ON_CONNECT = new Set<LogKind>(['unreachable', 'read-failed', 'install-failed'])

/**
 * Lines newest first, as entries newest first: bursts of the same line
 * collapsed, and passing problems marked with when the worker connected
 * again, or, for commands, that one has run through since (`commandDoneAt`).
 */
export function buildEntries(rows: RawLog[], commandDoneAt: string | null = null): LogEntry[] {
  const entries: LogEntry[] = []
  for (const row of rows) {
    const prev = entries[entries.length - 1]
    if (
      prev &&
      prev.raw === row.message &&
      Math.abs(time(prev.firstAt) - time(row.created_at)) <= BURST_GAP_MS
    ) {
      prev.count++
      prev.firstAt = row.created_at
      continue
    }
    entries.push({
      id: row.id,
      ...describeLog(row.message),
      raw: row.message,
      at: row.created_at,
      firstAt: row.created_at,
      count: 1,
      overAt: null,
      overBy: null,
    })
  }
  let connectedAt: string | null = null
  for (const entry of entries) {
    if (entry.kind === 'connected') connectedAt = entry.firstAt
    else if (entry.level === 'info') continue
    else if (connectedAt && OVER_ON_CONNECT.has(entry.kind)) {
      entry.overAt = connectedAt
      entry.overBy = 'connected'
    } else if (
      entry.kind === 'commands-failed' &&
      commandDoneAt &&
      time(commandDoneAt) > time(entry.at)
    ) {
      entry.overAt = commandDoneAt
      entry.overBy = 'command'
    }
  }
  return entries
}

export const isProblem = (e: LogEntry) => e.level !== 'info'

export type LogFilter = 'all' | 'problems' | 'game' | 'commands' | 'legends'

export const LOG_FILTERS: Record<LogFilter, string> = {
  all: 'Everything',
  problems: 'Problems',
  game: 'The game',
  commands: 'Commands',
  legends: 'Legends',
}

export function matchesFilter(entry: LogEntry, filter: LogFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'problems') return isProblem(entry)
  return entry.source === filter
}

export function matchesSearch(entry: LogEntry, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return [entry.title, entry.detail, entry.raw].some((s) => s?.toLowerCase().includes(needle))
}

/**
 * The newest problem, if nothing good has been heard since: no connection
 * after it, and it is not over.
 */
export function openProblem(entries: LogEntry[]): LogEntry | null {
  for (const entry of entries) {
    if (entry.kind === 'connected') return null
    if (isProblem(entry)) return entry.overAt ? null : entry
  }
  return null
}

/** "21 times in 39 seconds" */
export function burstLabel(entry: LogEntry): string | null {
  if (entry.count < 2) return null
  const span =
    entry.at && entry.firstAt && entry.at !== entry.firstAt
      ? ` in ${formatDistanceStrict(new Date(entry.at), new Date(entry.firstAt))}`
      : ''
  return `${entry.count} times${span}`
}

/** "Over: connected again 9 hours later." */
export function overLabel(entry: LogEntry): string | null {
  if (!entry.overAt || !entry.at) return null
  if (entry.overBy === 'command') return 'Over: commands from the app have run since.'
  return `Over: connected again ${formatDistanceStrict(new Date(entry.overAt), new Date(entry.at))} later.`
}

export interface WorkerNow {
  running: boolean
  seenAt: string | null
  status: 'live' | 'menu' | 'offline' | null
}

const ago = (at: string | number) => formatDistanceToNow(new Date(at), { addSuffix: true })

/** What the worker is doing, then how things stand with problems, in two sentences. */
export function headline(entries: LogEntry[], worker: WorkerNow | null | undefined): string {
  const fort = entries.find((e) => e.kind === 'connected')?.title.replace(/^Connected to /, '')
  const now = !worker
    ? null
    : worker.seenAt && !worker.running
      ? `The worker is not running; it was last heard from ${ago(worker.seenAt)}.`
      : worker.status === 'live'
        ? `The worker is running and reading ${fort ?? 'your fortress'}.`
        : worker.status === 'menu'
          ? 'The worker is running; the game is on a menu.'
          : worker.status === 'offline'
            ? 'The worker is running but cannot reach the game.'
            : 'The worker is running.'
  if (!entries.length)
    return [
      now,
      'It notes here when it connects to the game or loses it, imports legends, or something goes wrong.',
    ]
      .filter(Boolean)
      .join(' ')
  const last = entries.find(isProblem)
  const open = openProblem(entries)
  const problems = !last
    ? 'It has not reported a problem.'
    : open
      ? `It reported a problem ${ago(open.at ?? 0)}, and has not connected to the game since.`
      : `It last reported a problem ${ago(last.at ?? 0)}, and has connected to the game since.`
  return [now, problems].filter(Boolean).join(' ')
}

/** For pasting into a bug report or the assistant. */
export function copyText(entry: LogEntry): string {
  const when = entry.at ? new Date(entry.at).toISOString() : 'unknown time'
  return `${when}  ${entry.raw}${entry.count > 1 ? `  (${entry.count} times)` : ''}`
}
