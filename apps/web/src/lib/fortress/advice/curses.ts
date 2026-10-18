import type { FortUnit } from '@fortress/db-drizzle'

import { isLiving } from '../format'
import { isCitizenish } from '../people/units'
import type { CurseKind, LegendsCurse } from './types'

/*
 * Client-safe: which of your own people carry a curse, from the syndrome
 * classes and flags the dump shows on them, and from the curses the legends
 * export records on their historical figures.
 */

export interface CursedDwarf {
  unit: FortUnit
  kind: CurseKind
  /** "vampire", "necromancer", "weremoose", "undead". */
  what: string
  /** Where the fact comes from: the game's own syndromes and flags, or the legends export. */
  source: 'dump' | 'legends'
}

const SYN_CLASS: Record<string, CurseKind> = {
  VAMPCURSE: 'vampire',
  NECROMANCER: 'necromancer',
  WERECURSE: 'werebeast',
}

/** Living citizens with a curse, one line per dwarf and kind, the dump's word first. */
export function cursedDwarves(units: FortUnit[], legends: LegendsCurse[] = []): CursedDwarf[] {
  const out: CursedDwarf[] = []
  const seen = new Map<string, CursedDwarf>()
  const add = (c: CursedDwarf) => {
    const key = `${c.unit.id}:${c.kind}`
    const known = seen.get(key)
    if (known) {
      // The export names the beast ("weremoose") where the game's class only says werebeast.
      if (known.what === known.kind) known.what = c.what
      return
    }
    seen.set(key, c)
    out.push(c)
  }
  const citizens = units.filter((u) => isLiving(u) && isCitizenish(u))
  for (const unit of citizens) {
    for (const cls of unit.look?.syn_classes ?? []) {
      const kind = SYN_CLASS[cls]
      if (kind) add({ unit, kind, what: kind, source: 'dump' })
    }
    if (unit.flags.includes('undead') && !out.some((c) => c.unit.id === unit.id))
      add({ unit, kind: 'undead', what: 'undead', source: 'dump' })
  }
  const byId = new Map(citizens.map((u) => [u.id, u]))
  for (const curse of legends) {
    const unit = byId.get(curse.unitId)
    if (unit) add({ unit, kind: curse.kind, what: curse.what, source: 'legends' })
  }
  return out
}
