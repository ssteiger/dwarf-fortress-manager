import { type LegendsPayload, postgres_db, schema } from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { and, eq } from 'drizzle-orm'

import type { Prose } from '../prose'
import { type DwarfInLegends, dwarfInLegends } from './dwarf'
import { type AncestorLine, lineOf } from './family'
import { type LifeStory, tellLife } from './lives'
import { warOpening } from './openings'
import { type ToldStory, tellStory } from './tales'

/*
 * The browser's way to the told lives and stories. The tellers themselves are
 * server only; this module carries nothing but the server functions.
 */

export const getLifeStory = createServerFn({ method: 'GET' })
  .inputValidator((input: { worldId: number; id: number }) => input)
  .handler(async ({ data }): Promise<LifeStory | null> => tellLife(data.worldId, data.id))

export const getStory = createServerFn({ method: 'GET' })
  .inputValidator((input: { worldId: number; key: string }) => input)
  .handler(async ({ data }): Promise<ToldStory | null> => tellStory(data.worldId, data.key))

/** A war in one paragraph: its sides, years, battles and conquests, and how it ended. */
export const getWarTelling = createServerFn({ method: 'GET' })
  .inputValidator((input: { worldId: number; warId: number }) => input)
  .handler(async ({ data }): Promise<Prose> => {
    const rows = await postgres_db
      .select({ payload: schema.legends_records.payload })
      .from(schema.legends_records)
      .where(
        and(
          eq(schema.legends_records.world_id, data.worldId),
          eq(schema.legends_records.kind, 'historical_event_collection'),
          eq(schema.legends_records.id, data.warId),
          eq(schema.legends_records.type, 'war'),
        ),
      )
      .limit(1)
    const payload = rows[0]?.payload as LegendsPayload | undefined
    return payload ? warOpening(data.worldId, data.warId, payload) : []
  })

/** One of your dwarves in the world's history: their line, kin, ancestors and civilization. */
export const getDwarfInLegends = createServerFn({ method: 'GET' })
  .inputValidator((input: { worldId: number; figureId: number }) => input)
  .handler(
    async ({ data }): Promise<DwarfInLegends | null> => dwarfInLegends(data.worldId, data.figureId),
  )

/** A figure's mothers and fathers, generation by generation, with the famous ones told. */
export const getAncestorLine = createServerFn({ method: 'GET' })
  .inputValidator((input: { worldId: number; id: number; maxGen?: number }) => input)
  .handler(
    async ({ data }): Promise<AncestorLine> => lineOf(data.worldId, data.id, data.maxGen ?? 10),
  )
