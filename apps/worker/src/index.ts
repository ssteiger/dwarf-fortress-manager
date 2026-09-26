import { config } from './config'
import { installSnapshotScript, takeDump } from './dfhack/dump'
import { installNicknameScript } from './dfhack/nickname'
import { processPendingCommands, recoverInterruptedCommands } from './fortress/commands'
import { readStatus, storeLiveDump, storeMap, storeStatus } from './fortress/store'
import { scanAndImportLegends } from './legends/import'
import { logger } from './utils/logger'

/**
 * The fortress worker.
 *
 *  1. Installs the Lua dump script into the game's dfhack-config folder.
 *  2. Every DF_POLL_MS asks the running game (through DFHack) for a full dump of
 *     units, items, buildings, jobs, and announcements, and writes it to Postgres.
 *  3. Every DF_MAP_POLL_MS does the same with the map included.
 *  4. Once, in the background, imports any legends exports found next to the game.
 *  5. Every DF_COMMAND_POLL_MS between dumps, runs commands queued by the web
 *     app (nicknames, whitelisted DFHack actions), then dumps so the result shows.
 */

let polling = false
let commanding = false
let lastMapAt = 0
let lastStatus: string | null = null

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Run whatever the web app queued. Never overlaps itself. */
async function runQueuedCommands(): Promise<number> {
  if (commanding) return 0
  commanding = true
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
  } finally {
    commanding = false
  }
}

/** Between dumps: pick up queued commands quickly, and dump right after running any. */
async function commandTick(): Promise<void> {
  if (polling) return
  const processed = await runQueuedCommands()
  if (processed > 0) await pollOnce()
}

async function pollOnce(): Promise<void> {
  if (polling) return
  polling = true
  try {
    await runQueuedCommands()

    const due = Date.now() - lastMapAt >= config.mapPollMs
    const outcome = await takeDump(config, { withMap: due })

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
    polling = false
  }
}

async function startWorker() {
  console.log('Starting fortress worker...')
  console.log(`  game folder : ${config.gameDir}`)
  console.log(`  dfhack      : ${config.dfhackHost}:${config.dfhackPort}`)
  console.log(
    `  poll        : every ${config.pollMs / 1000}s (map every ${config.mapPollMs / 1000}s)`,
  )

  try {
    const [snapshotRefreshed, nicknameRefreshed] = await Promise.all([
      installSnapshotScript(config),
      installNicknameScript(config),
    ])
    console.log(
      snapshotRefreshed
        ? 'Installed fortress-snapshot.lua into dfhack-config/'
        : 'fortress-snapshot.lua is up to date',
    )
    console.log(
      nicknameRefreshed
        ? 'Installed set-nickname.lua into dfhack-config/'
        : 'set-nickname.lua is up to date',
    )
  } catch (err) {
    console.error('Could not install DFHack scripts:', describeError(err))
    await logger.error(`Fortress worker: could not install DFHack scripts (${describeError(err)})`)
    process.exit(1)
  }

  await recoverInterruptedCommands()
  lastStatus = await readStatus().catch(() => null)

  await pollOnce()
  setInterval(() => {
    void pollOnce()
  }, config.pollMs)
  setInterval(() => {
    void commandTick()
  }, config.commandPollMs)

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
