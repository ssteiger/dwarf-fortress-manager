import { WORKER_HEARTBEAT_MS } from '@fortress/db-drizzle'
import { config } from './config'
import { installSnapshotScript, takeDump } from './dfhack/dump'
import { installNicknameScript } from './dfhack/nickname'
import { installUnitActionScript } from './dfhack/unit-action'
import { processPendingCommands, recoverInterruptedCommands } from './fortress/commands'
import { type DumpSchedule, answerDumpRequests, markAlive, readSchedule } from './fortress/schedule'
import { readStatus, storeLiveDump, storeMap, storeStatus } from './fortress/store'
import { scanAndImportLegends } from './legends/import'
import { logger } from './utils/logger'

/**
 * The fortress worker.
 *
 *  1. Installs the Lua dump script into the game's dfhack-config folder.
 *  2. Every DF_COMMAND_POLL_MS, runs commands queued by the web app (nicknames,
 *     whitelisted DFHack actions, actions on one unit) and reads the dump
 *     schedule chosen in Settings (fort_worker).
 *  3. Asks the running game (through DFHack) for a full dump of units, items,
 *     buildings, jobs and announcements, and writes it to Postgres: when the
 *     app asks for one, and, with automatic dumps on, once the chosen interval
 *     has passed since the last dump ended or right after running commands.
 *     The map comes along at most every DF_MAP_POLL_MS.
 *  4. Once, in the background, imports any legends exports found next to the game.
 *  5. Every WORKER_HEARTBEAT_MS, marks itself alive so the app can tell it is
 *     running between dumps.
 */

let ticking = false
let lastDumpAt = 0
let lastMapAt = 0
let lastStatus: string | null = null
let lastSchedule: string | null = null
let scheduleUnreadable = false

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function describeSchedule(schedule: DumpSchedule): string {
  if (!schedule.auto) return 'only when asked from the app'
  const seconds = schedule.intervalMs / 1000
  return seconds < 120 ? `every ${seconds}s` : `every ${seconds / 60} min`
}

/** The schedule from Settings, or DF_POLL_MS while the database cannot say. */
async function currentSchedule(): Promise<DumpSchedule> {
  let schedule: DumpSchedule
  try {
    schedule = await readSchedule(config)
    scheduleUnreadable = false
  } catch (err) {
    if (!scheduleUnreadable)
      console.error(`Could not read the dump schedule, using DF_POLL_MS: ${describeError(err)}`)
    scheduleUnreadable = true
    schedule = { auto: true, intervalMs: config.pollMs, requested: false }
  }
  const described = describeSchedule(schedule)
  if (described !== lastSchedule) {
    console.log(`Dumps: ${described} (map at most every ${config.mapPollMs / 1000}s)`)
    lastSchedule = described
  }
  return schedule
}

/** Run whatever the web app queued. */
async function runQueuedCommands(): Promise<number> {
  try {
    const processed = await processPendingCommands(config)
    if (processed > 0) console.log(`Processed ${processed} fortress command(s).`)
    return processed
  } catch (err) {
    console.error('Could not process fortress commands:', err)
    await logger
      .error(`Fortress worker: command processing failed (${describeError(err)})`)
      .catch(() => {})
    return 0
  }
}

/** Commands first, then a dump if one was asked for or is due. Never overlaps itself. */
async function tick(): Promise<void> {
  if (ticking) return
  ticking = true
  try {
    const processed = await runQueuedCommands()
    const schedule = await currentSchedule()
    const due = schedule.auto && (processed > 0 || Date.now() - lastDumpAt >= schedule.intervalMs)
    if (schedule.requested || due) await pollOnce()
  } finally {
    ticking = false
  }
}

async function pollOnce(): Promise<void> {
  try {
    const mapDue = Date.now() - lastMapAt >= config.mapPollMs
    const outcome = await takeDump(config, { withMap: mapDue })

    if (outcome.kind === 'live') {
      const { payload } = outcome
      const { newEvents } = await storeLiveDump(payload, outcome.elapsedMs)
      if (payload.map) {
        await storeMap(payload)
        lastMapAt = Date.now()
      }
      const label = `${payload.world?.site_name ?? 'fortress'} · ${payload.units?.rows.length ?? 0} units, ${payload.items?.rows.length ?? 0} items${payload.map ? `, ${payload.map.blocks.length} map blocks` : ''}`
      console.log(
        `[${new Date().toLocaleTimeString()}] dump ok (${(outcome.bytes / 1024).toFixed(0)} KB, game paused ${outcome.elapsedMs} ms): ${label}${newEvents ? `, ${newEvents} new announcements` : ''}`,
      )
      if (lastStatus !== 'live') await logger.info(`Fortress worker connected: ${label}`)
      lastStatus = 'live'
      return
    }

    if (outcome.kind === 'menu') {
      await storeStatus('menu', null)
      if (lastStatus !== 'menu') {
        console.log('Game is running but no fortress is loaded.')
        await logger.info('Fortress worker: game is on a menu, waiting for a fortress to load')
      }
      lastStatus = 'menu'
      return
    }

    if (outcome.kind === 'offline') {
      await storeStatus('offline', outcome.error)
      if (lastStatus !== 'offline') {
        console.log(
          `Dwarf Fortress is not reachable on ${config.dfhackHost}:${config.dfhackPort} (${outcome.error})`,
        )
        await logger.warn(`Fortress worker: game unreachable (${outcome.error})`)
      }
      lastStatus = 'offline'
      return
    }

    await storeStatus('offline', outcome.error)
    console.error(`Dump failed: ${outcome.error}`)
    if (lastStatus !== 'error')
      await logger.error(`Fortress worker: dump failed (${outcome.error})`)
    lastStatus = 'error'
  } catch (err) {
    console.error('Poll failed:', err)
    await logger.error(`Fortress worker: poll failed (${describeError(err)})`).catch(() => {})
  } finally {
    lastDumpAt = Date.now()
    await answerDumpRequests().catch((err) => {
      console.error('Could not answer dump requests:', describeError(err))
    })
  }
}

async function startWorker() {
  console.log('Starting fortress worker...')
  console.log(`  game folder : ${config.gameDir}`)
  console.log(`  dfhack      : ${config.dfhackHost}:${config.dfhackPort}`)

  try {
    const installed = await Promise.all([
      installSnapshotScript(config).then((fresh) => ['fortress-snapshot.lua', fresh] as const),
      installNicknameScript(config).then((fresh) => ['set-nickname.lua', fresh] as const),
      installUnitActionScript(config).then((fresh) => ['unit-action.lua', fresh] as const),
    ])
    for (const [name, fresh] of installed) {
      console.log(fresh ? `Installed ${name} into dfhack-config/` : `${name} is up to date`)
    }
  } catch (err) {
    console.error('Could not install DFHack scripts:', describeError(err))
    await logger.error(`Fortress worker: could not install DFHack scripts (${describeError(err)})`)
    process.exit(1)
  }

  await recoverInterruptedCommands()
  lastStatus = await readStatus().catch(() => null)

  await tick()
  setInterval(() => {
    void tick()
  }, config.commandPollMs)

  // On its own timer, so a long dump does not make the worker look gone.
  const heartbeat = () => {
    markAlive().catch(() => {})
  }
  heartbeat()
  setInterval(heartbeat, WORKER_HEARTBEAT_MS)

  if (config.importLegends) {
    scanAndImportLegends(config.legendsDir).catch((err) => {
      console.error('Legends import failed:', err)
    })
  }
}

startWorker().catch((err) => {
  console.error('Error starting worker:', err)
  process.exit(1)
})
