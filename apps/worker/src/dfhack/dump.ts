import fs from 'node:fs/promises'
import path from 'node:path'
import { type DumpStep, type FortDumpPayload, dumpSteps } from '@fortress/db-drizzle'
import type { Config } from '../config'
import { DfhackError, runDfhackCommand } from './rpc'

const SCRIPT_NAME = 'fortress-snapshot.lua'
const FAST_DUMP_NAME = 'fortress-dump.json'
const MAP_DUMP_NAME = 'fortress-dump-map.json'
const PROGRESS_POLL_MS = 250

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
 * Follow the step the script writes next to its dump. Steps only move
 * forward, so a slow read of the file never takes the progress back.
 */
function watchProgress(
  filePath: string,
  withMap: boolean,
  onStep: (step: DumpStep) => Promise<void>,
): { stop: () => Promise<void> } {
  const order = dumpSteps(withMap)
  let reached = order.indexOf('game')
  let stopped = false
  let reported = Promise.resolve()
  const check = async (last: boolean) => {
    const text = await fs.readFile(filePath, 'utf8').catch(() => '')
    if (stopped && !last) return
    const index = order.indexOf(text.trim() as DumpStep)
    if (index <= reached) return
    reached = index
    const step = order[index]
    reported = reported.then(() => onStep(step))
  }
  const timer = setInterval(() => void check(false), PROGRESS_POLL_MS)
  return {
    stop: async () => {
      stopped = true
      clearInterval(timer)
      await check(true)
      await reported
      await fs.rm(filePath, { force: true }).catch(() => {})
    },
  }
}

/**
 * Ask the running game to write a dump file, then read it back.
 * The map is optional because it takes a few seconds of game time.
 * `onStep` hears each part the script moves on to while the game is paused.
 */
export async function takeDump(
  config: Config,
  {
    withMap,
    onStep = async () => {},
  }: { withMap: boolean; onStep?: (step: DumpStep) => Promise<void> },
): Promise<DumpOutcome> {
  const fileName = withMap ? MAP_DUMP_NAME : FAST_DUMP_NAME
  const relativeOut = `dfhack-config/${fileName}`
  const progressPath = path.join(config.gameDir, `${relativeOut}.progress`)
  await fs.rm(progressPath, { force: true }).catch(() => {})
  const progress = watchProgress(progressPath, withMap, onStep)

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
  } finally {
    await progress.stop()
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
