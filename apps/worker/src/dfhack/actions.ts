import {
  DFHACK_ACTIONS,
  checkConsoleCommand,
  isDfhackAction,
  splitConsoleCommand,
} from '@fortress/db-drizzle'
import type { Config } from '../config'
import { runDfhackCommand } from './rpc'

const MAX_OUTPUT = 4000

function capOutput(lines: string[]): string {
  const output = lines.join('').trim()
  return output.length > MAX_OUTPUT ? `${output.slice(0, MAX_OUTPUT)}…` : output
}

/**
 * Run one whitelisted DFHack action and return what it printed. The action
 * key is all the web app sends; the command itself only ever comes from
 * DFHACK_ACTIONS.
 */
export async function runDfhackAction(config: Config, action: string | null): Promise<string> {
  if (!isDfhackAction(action)) throw new Error(`"${action}" is not an allowed DFHack action`)
  const spec = DFHACK_ACTIONS[action]
  const lines = await runDfhackCommand(spec.command, [...spec.args], {
    host: config.dfhackHost,
    port: config.dfhackPort,
    timeoutMs: 60_000,
  })
  return capOutput(lines)
}

/**
 * Run a console command as the player confirmed it in the assistant. The same
 * check the web app made runs again here, then the line is split the way
 * DFHack's console would split it.
 */
export async function runConsoleCommand(config: Config, text: string | null): Promise<string> {
  const problem = checkConsoleCommand(text)
  if (problem || text === null) throw new Error(problem ?? 'No command')
  const [command, ...args] = splitConsoleCommand(text.trim())
  const lines = await runDfhackCommand(command, args, {
    host: config.dfhackHost,
    port: config.dfhackPort,
    timeoutMs: 60_000,
  })
  return capOutput(lines)
}
