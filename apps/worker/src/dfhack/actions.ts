import { DFHACK_ACTIONS, isDfhackAction } from '@fortress/db-drizzle'
import type { Config } from '../config'
import { runDfhackCommand } from './rpc'

const MAX_OUTPUT = 4000

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
  const output = lines.join('').trim()
  return output.length > MAX_OUTPUT ? `${output.slice(0, MAX_OUTPUT)}…` : output
}
