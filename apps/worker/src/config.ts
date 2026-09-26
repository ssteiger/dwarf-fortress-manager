import os from 'node:os'
import path from 'node:path'

/**
 * Where the CrossOver bottle keeps the Steam copy of Dwarf Fortress on this
 * machine. Override with DF_GAME_DIR when the game lives somewhere else.
 */
const DEFAULT_GAME_DIR = path.join(
  os.homedir(),
  'Library/Application Support/CrossOver/Bottles/Steam/drive_c/Program Files (x86)/Steam/steamapps/common/Dwarf Fortress',
)

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const config = {
  /** Folder that contains "Dwarf Fortress.exe" and dfhack-config/. */
  gameDir: process.env.DF_GAME_DIR || DEFAULT_GAME_DIR,
  /** Folder to scan for *-legends.xml exports. Defaults to the game folder. */
  legendsDir: process.env.DF_LEGENDS_DIR || process.env.DF_GAME_DIR || DEFAULT_GAME_DIR,
  dfhackHost: process.env.DFHACK_HOST || '127.0.0.1',
  dfhackPort: intEnv('DFHACK_PORT', 5000),
  /** How often to dump units, items, buildings, jobs, and announcements. */
  pollMs: intEnv('DF_POLL_MS', 30_000),
  /** How often to dump the map. Each map dump pauses the game for a few seconds. */
  mapPollMs: intEnv('DF_MAP_POLL_MS', 300_000),
  /** How often to look for commands queued by the web app between dumps. */
  commandPollMs: intEnv('DF_COMMAND_POLL_MS', 2_000),
  /** Set to "0" to skip the legends import entirely. */
  importLegends: process.env.DF_IMPORT_LEGENDS !== '0',
} as const

export type Config = typeof config
