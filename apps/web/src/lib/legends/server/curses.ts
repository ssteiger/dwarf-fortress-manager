import { postgres_db, schema } from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { and, eq, inArray, sql } from 'drizzle-orm'

import type { CurseKind } from '../../fortress/advice/types'
import { curseFamily } from './chronicle'

/*
 * The curses the export records on living figures (`active_interaction`):
 * vampirism, necromancy, lycanthropy and undeath (SECRET_UNDEAD_RES, the mark
 * of one a necromancer raised), as `curseFamily` reads them.
 */

const R = schema.legends_records

export interface FigureCurse {
  figureId: number
  kind: CurseKind
  /** "vampire", "necromancer", "weremoose", "undead". */
  what: string
}

function kindOf(token: string): Omit<FigureCurse, 'figureId'> | null {
  const family = curseFamily(token)
  if (family.key === 'vampire') return { kind: 'vampire', what: 'vampire' }
  if (family.key === 'necromancer') return { kind: 'necromancer', what: 'necromancer' }
  if (family.key === 'undead') return { kind: 'undead', what: 'undead' }
  if (family.key.startsWith('were-'))
    return { kind: 'werebeast', what: `were${family.key.slice(5).replace(/\s+/g, '')}` }
  return null
}

export const getFigureCurses = createServerFn({ method: 'GET' })
  .inputValidator((input: { worldId: number; figureIds: number[] }) => input)
  .handler(async ({ data }): Promise<FigureCurse[]> => {
    const ids = [...new Set(data.figureIds.filter((id) => Number.isInteger(id) && id >= 0))].slice(
      0,
      2000,
    )
    if (!ids.length) return []
    const rows = await postgres_db
      .select({ id: R.id, curses: sql<unknown>`${R.payload}->'active_interaction'` })
      .from(R)
      .where(
        and(
          eq(R.world_id, data.worldId),
          eq(R.kind, 'historical_figure'),
          inArray(R.id, ids),
          sql`${R.payload} ? 'active_interaction'`,
          sql`coalesce((${R.payload}->>'death_year')::int, -1) < 0`,
        ),
      )
    return rows.flatMap((r) => {
      const tokens = (Array.isArray(r.curses) ? r.curses : r.curses ? [r.curses] : []).map(String)
      const seen = new Set<CurseKind>()
      return tokens.flatMap((t) => {
        const curse = kindOf(t)
        if (!curse || seen.has(curse.kind)) return []
        seen.add(curse.kind)
        return [{ figureId: r.id, ...curse }]
      })
    })
  })
