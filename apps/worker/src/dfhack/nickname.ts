import fs from 'node:fs/promises'
import path from 'node:path'
import type { Config } from '../config'
import { runDfhackCommand } from './rpc'

const SCRIPT_NAME = 'set-nickname.lua'
const scriptSource = path.resolve(process.cwd(), 'src/dfhack', SCRIPT_NAME)

export async function installNicknameScript(config: Config): Promise<boolean> {
  const source = await fs.readFile(scriptSource, 'utf8')
  const targetDir = path.join(config.gameDir, 'dfhack-config')
  await fs.mkdir(targetDir, { recursive: true })
  const target = path.join(targetDir, SCRIPT_NAME)
  const existing = await fs.readFile(target, 'utf8').catch(() => null)
  if (existing === source) return false
  await fs.writeFile(target, source, 'utf8')
  return true
}

export async function setUnitNickname(
  config: Config,
  unitId: number,
  nickname: string,
): Promise<void> {
  const lines = await runDfhackCommand(
    'lua',
    ['--file', `dfhack-config/${SCRIPT_NAME}`, String(unitId), nickname],
    { host: config.dfhackHost, port: config.dfhackPort, timeoutMs: 15_000 },
  )
  const status = lines
    .join('')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)

  if (status === `OK ${unitId}`) return
  if (status === 'MENU') throw new Error('no fortress is loaded')
  if (status?.startsWith('ERR ')) throw new Error(status.slice(4))
  throw new Error(status ? `unexpected DFHack status "${status}"` : 'DFHack returned no status')
}
