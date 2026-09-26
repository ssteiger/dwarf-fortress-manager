import { type LegendsNote, postgres_db, schema } from '@fortress/db-drizzle'
import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq } from 'drizzle-orm'

import { getSupabaseServerClient } from '~/lib/utils/supabase/server'

/**
 * The reader's journal: pins and notes, scoped to the signed-in user. Only
 * server functions and types are exported here; the handlers are stripped
 * from the client bundle.
 */

/** What a note points at. Record kinds use the record id; the rest are keys. */
export type NoteTargetKind =
  | 'historical_figure'
  | 'site'
  | 'entity'
  | 'artifact'
  | 'region'
  | 'underground_region'
  | 'historical_event_collection'
  | 'written_content'
  | 'event'
  | 'span'
  | 'story'
  | 'narration'
  | (string & {})

export interface NoteTarget {
  kind: NoteTargetKind
  id: string
  /** What was pinned, in words. */
  title: string
}

export type { LegendsNote }

const MAX_NOTE = 20_000
const MAX_TITLE = 400
const MAX_TAGS = 12

async function requireUser(): Promise<string> {
  const {
    data: { user },
  } = await getSupabaseServerClient().auth.getUser()
  if (!user) throw new Error('Sign in to keep a journal')
  return user.id
}

function cleanTags(tags: string[] | undefined): string[] {
  const seen = new Set<string>()
  for (const raw of tags ?? []) {
    const tag = raw.trim().replace(/^#/, '').toLowerCase().slice(0, 40)
    if (tag) seen.add(tag)
    if (seen.size >= MAX_TAGS) break
  }
  return [...seen]
}

export const listNotes = createServerFn({ method: 'GET' })
  .inputValidator((input: { worldId: number }) => input)
  .handler(async ({ data }): Promise<LegendsNote[]> => {
    const userId = await requireUser()
    const N = schema.legends_notes
    return postgres_db
      .select()
      .from(N)
      .where(and(eq(N.user_id, userId), eq(N.world_id, data.worldId)))
      .orderBy(desc(N.updated_at))
  })

export const upsertNote = createServerFn({ method: 'POST' })
  .inputValidator(
    (input: {
      worldId: number
      target: NoteTarget
      note?: string
      tags?: string[]
    }) => input,
  )
  .handler(async ({ data }): Promise<LegendsNote> => {
    const userId = await requireUser()
    const N = schema.legends_notes
    const title = data.target.title.trim().slice(0, MAX_TITLE)
    const note = (data.note ?? '').slice(0, MAX_NOTE)
    const tags = cleanTags(data.tags)
    const [row] = await postgres_db
      .insert(N)
      .values({
        user_id: userId,
        world_id: data.worldId,
        target_kind: data.target.kind,
        target_id: data.target.id,
        title,
        note,
        tags,
      })
      .onConflictDoUpdate({
        target: [N.user_id, N.world_id, N.target_kind, N.target_id],
        set: {
          title,
          note,
          tags,
          updated_at: new Date().toISOString(),
        },
      })
      .returning()
    if (!row) throw new Error('The note could not be saved')
    return row
  })

export const deleteNote = createServerFn({ method: 'POST' })
  .inputValidator((input: { id: number }) => input)
  .handler(async ({ data }): Promise<{ id: number }> => {
    const userId = await requireUser()
    const N = schema.legends_notes
    await postgres_db.delete(N).where(and(eq(N.id, data.id), eq(N.user_id, userId)))
    return { id: data.id }
  })
