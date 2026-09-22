import fs from 'node:fs/promises'
import path from 'node:path'
import type { FortDumpPayload } from '@fortress/db-drizzle'
import type { Config } from '../config'
import { DfhackError, runDfhackCommand } from './rpc'

const SCRIPT_NAME = 'fortress-snapshot.lua'
const FAST_DUMP_NAME = 'fortress-dump.json'
const MAP_DUMP_NAME = 'fortress-dump-map.json'

/** The Lua source ships next to this file; the worker always runs from apps/worker. */
const scriptSource =
  process.env.DF_SNAPSHOT_SCRIPT || path.resolve(process.cwd(), 'src/dfhack', SCRIPT_NAME)

export type DumpOutcome =
  | { kind: 'live'; payload: FortDumpPayload; bytes: number; elapsedMs: number }
  | { kind: 'menu' }
  | { kind: 'offline'; error: string }
  | { kind: 'error'; error: string }

/**
 * Copy the Lua dump script into <game>/dfhack-config/ so DFHack can run it.
 * Returns true when the file was written or refreshed.
 */
export async function installSnapshotScript(config: Config): Promise<boolean> {
  const source = await fs.readFile(scriptSource, 'utf8')
  const targetDir = path.join(config.gameDir, 'dfhack-config')
  await fs.mkdir(targetDir, { recursive: true })
  const target = path.join(targetDir, SCRIPT_NAME)
  const existing = await fs.readFile(target, 'utf8').catch(() => null)
  if (existing === source) return false
  await fs.writeFile(target, source, 'utf8')
  return true
}

/**
 * Ask the running game to write a dump file, then read it back.
 * The map is optional because it takes a few seconds of game time.
 */
export async function takeDump(
  config: Config,
  { withMap }: { withMap: boolean },
): Promise<DumpOutcome> {
  const fileName = withMap ? MAP_DUMP_NAME : FAST_DUMP_NAME
  const relativeOut = `dfhack-config/${fileName}`
  let lines: string[]
  try {
    lines = await runDfhackCommand(
      'lua',
      ['--file', `dfhack-config/${SCRIPT_NAME}`, relativeOut, withMap ? '1' : '0'],
      { host: config.dfhackHost, port: config.dfhackPort, timeoutMs: withMap ? 180_000 : 60_000 },
    )
  } catch (err) {
    if (err instanceof DfhackError && (err.code === 'unreachable' || err.code === 'timeout')) {
      return { kind: 'offline', error: err.message }
    }
    return { kind: 'error', error: err instanceof Error ? err.message : String(err) }
  }

  const status = lines
    .join('')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1)
  if (!status) return { kind: 'error', error: 'DFHack returned no status line' }
  if (status === 'MENU') return { kind: 'menu' }
  if (status.startsWith('ERR')) return { kind: 'error', error: status.slice(3).trim() }
  const match = /^OK (\d+) (\d+)$/.exec(status)
  if (!match) return { kind: 'error', error: `unexpected status "${status}"` }

  const filePath = path.join(config.gameDir, 'dfhack-config', fileName)
  const raw = await fs.readFile(filePath, 'utf8')
  const payload = JSON.parse(raw) as FortDumpPayload
  return {
    kind: 'live',
    payload,
    bytes: Number.parseInt(match[1], 10),
    elapsedMs: Number.parseInt(match[2], 10),
  }
}
