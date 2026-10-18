import type { FortUnit } from '@fortress/db-drizzle'
import { Button } from '@fortress/ui'
import { Loader2Icon } from 'lucide-react'

import { skillName } from '~/lib/fortress/people/character'
import { usePreferences } from '~/lib/preferences'
import { CopyCommand } from '../../-components/Guide'
import { useUnitCommands } from './useUnitCommands'

/** Turns one labor on or off for this dwarf in the game. */
export const LaborButton = ({
  unit,
  skill,
  on,
  label,
}: {
  unit: FortUnit
  skill: string
  on: boolean
  label?: string
}) => {
  const { oneClickActions } = usePreferences()
  const { queue, latest } = useUnitCommands(unit.id)
  const text = `${skill}:${on ? 'on' : 'off'}`
  const run = latest('labor')
  const busy =
    queue.isPending ||
    (run?.text === text && (run.status === 'pending' || run.status === 'processing'))
  const words = label ?? `${on ? 'Allow' : 'Stop'} ${skillName(skill, unit).toLowerCase()}`
  if (!oneClickActions) {
    return (
      <CopyCommand
        shortcut={{
          command: `lua local u=df.unit.find(${unit.id}); local t,s=("${text}"):match("^([A-Z0-9_]+):(on|off)$"); local id=df.unit_labor[t] or (df.job_skill[t] and df.job_skill.attrs[df.job_skill[t]].labor); if id and id>=0 then u.status.labors[id]=(s=="on") end`,
          what: 'Paste into the DFHack console.',
        }}
      />
    )
  }
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 gap-1.5 px-2 text-xs"
      disabled={busy}
      onClick={() => queue.mutate({ action: 'labor', text })}
    >
      {busy ? <Loader2Icon className="size-3 animate-spin" /> : null}
      {words}
    </Button>
  )
}
