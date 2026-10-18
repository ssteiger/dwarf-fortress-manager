import { postgres_db, schema } from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { and, eq, inArray, sql } from 'drizzle-orm'

import { num, objList, str } from '../events'
import { words } from '../model'
import { remember } from './memo'

/*
 * The gods your people worship, as the export records it: each figure's
 * `hf_link` entries of type `deity`, with the strength the export gives.
 */

const R = schema.legends_records

export interface GodWorshipper {
  figureId: number
  /** 0-100; null when the export gives none. */
  strength: number | null
}

export interface FortressGod {
  id: number
  name: string | null
  race: string | null
  spheres: string[]
  /** Most devout first. */
  worshippers: GodWorshipper[]
}

const MAX_FIGURES = 2000

/** The gods these figures worship, most worshippers first. */
async function godsOf(worldId: number, figureIds: number[]): Promise<FortressGod[]> {
  const ids = [...new Set(figureIds.filter((id) => Number.isInteger(id) && id >= 0))]
    .sort((a, b) => a - b)
    .slice(0, MAX_FIGURES)
  if (!ids.length) return []
  return remember(worldId, `gods:${ids.join(',')}`, async () => {
    const figures = await postgres_db
      .select({ id: R.id, links: sql<unknown>`${R.payload}->'hf_link'` })
      .from(R)
      .where(and(eq(R.world_id, worldId), eq(R.kind, 'historical_figure'), inArray(R.id, ids)))
    const byGod = new Map<number, GodWorshipper[]>()
    for (const f of figures) {
      for (const l of objList(f.links)) {
        if (str(l.link_type) !== 'deity') continue
        const god = num(l.hfid)
        if (god === null || god < 0) continue
        const list = byGod.get(god) ?? []
        list.push({ figureId: f.id, strength: num(l.link_strength) })
        byGod.set(god, list)
      }
    }
    if (!byGod.size) return []
    const gods = await postgres_db
      .select({
        id: R.id,
        name: R.name,
        race: sql<string | null>`${R.payload}->>'race'`,
        spheres: sql<unknown>`${R.payload}->'sphere'`,
      })
      .from(R)
      .where(
        and(
          eq(R.world_id, worldId),
          eq(R.kind, 'historical_figure'),
          inArray(R.id, [...byGod.keys()]),
        ),
      )
    const devotion = (w: GodWorshipper[]) => w.reduce((sum, x) => sum + (x.strength ?? 0), 0)
    return gods
      .map((g) => {
        const spheres = Array.isArray(g.spheres) ? g.spheres : g.spheres ? [g.spheres] : []
        return {
          id: g.id,
          name: g.name,
          race: words(g.race) || null,
          spheres: spheres.map(String),
          worshippers: (byGod.get(g.id) ?? []).sort(
            (a, b) => (b.strength ?? 0) - (a.strength ?? 0),
          ),
        }
      })
      .sort(
        (a, b) =>
          b.worshippers.length - a.worshippers.length ||
          devotion(b.worshippers) - devotion(a.worshippers) ||
          a.id - b.id,
      )
  })
}

export const getFortressGods = createServerFn({ method: 'GET' })
  .inputValidator((input: { worldId: number; figureIds: number[] }) => input)
  .handler(async ({ data }): Promise<FortressGod[]> => godsOf(data.worldId, data.figureIds))
