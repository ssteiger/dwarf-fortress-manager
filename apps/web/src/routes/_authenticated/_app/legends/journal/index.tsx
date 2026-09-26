import { Badge, Button, cn } from '@fortress/ui'
import { Link, createFileRoute } from '@tanstack/react-router'
import { formatDistanceToNow } from 'date-fns'
import { BookmarkIcon, CopyIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import type { LegendsNote } from '~/lib/legends/journal'
import { kindLabel, titleCase } from '~/lib/legends/model'
import { NoteEditor, useJournal, useJournalMutations } from '../-components/Journal'
import { LegendsShell, Section, parseWorldSearch } from '../-components/LegendsChrome'
import { FilterChip } from '../-components/Timeline'
import { EmptyState } from '../../fortress/-components/FortChrome'

const SPECIAL_KINDS: Record<string, string> = {
  event: 'Event',
  span: 'Years',
  story: 'Story',
  narration: 'Narration',
}

function targetLabel(kind: string): string {
  return SPECIAL_KINDS[kind] ?? kindLabel(kind)
}

/** Where a note points, as router link props; null when there is no page. */
function targetLink(note: LegendsNote, worldId: number) {
  if (note.target_kind === 'span') {
    const [from, to] = note.target_id.split('-').map(Number)
    if (Number.isFinite(from) && Number.isFinite(to))
      return { to: '/legends/history' as const, search: { world: worldId, from, to } }
    return null
  }
  if (note.target_kind === 'story')
    return { to: '/legends/stories' as const, search: { world: worldId } }
  if (note.target_kind === 'event' || note.target_kind === 'narration') return null
  return {
    to: '/legends/$kind/$id' as const,
    params: { kind: note.target_kind, id: note.target_id },
    search: { world: worldId },
  }
}

function exportText(notes: LegendsNote[], worldName: string): string {
  const lines = [`# Journal — ${worldName}`, '']
  for (const note of notes) {
    lines.push(`## ${note.title || `${targetLabel(note.target_kind)} ${note.target_id}`}`)
    lines.push(
      `_${targetLabel(note.target_kind)}_${note.tags.length ? ` · ${note.tags.map((t) => `#${t}`).join(' ')}` : ''}`,
    )
    if (note.note.trim()) {
      lines.push('')
      lines.push(note.note.trim())
    }
    lines.push('')
  }
  return lines.join('\n')
}

function JournalPage() {
  const { world } = Route.useSearch()
  return (
    <LegendsShell section="journal" world={world}>
      {({ worldId, selectedWorld }) => (
        <JournalBody
          worldId={worldId}
          worldName={titleCase(selectedWorld.name ?? selectedWorld.key)}
        />
      )}
    </LegendsShell>
  )
}

function JournalBody({ worldId, worldName }: { worldId: number; worldName: string }) {
  const journal = useJournal(worldId)
  const [tag, setTag] = React.useState<string | null>(null)
  const notes = journal.data ?? []
  const tags = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const note of notes) for (const t of note.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [notes])
  const shown = tag ? notes.filter((n) => n.tags.includes(tag)) : notes

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportText(shown, worldName))
      toast.success(`Copied ${shown.length} ${shown.length === 1 ? 'note' : 'notes'} as text`)
    } catch {
      toast.error('The clipboard would not take it')
    }
  }

  return (
    <Section
      title="Your journal"
      count={notes.length || null}
      description="What you have pinned in this world: figures, places, years, stories and the notes you left on them. Only you can see it."
      action={
        notes.length ? (
          <Button variant="outline" size="sm" className="gap-2" onClick={copy}>
            <CopyIcon className="size-4" />
            Copy as text
          </Button>
        ) : null
      }
    >
      {journal.isLoading ? (
        <p className="text-sm text-muted-foreground">Opening the journal…</p>
      ) : !notes.length ? (
        <EmptyState title="Nothing pinned yet">
          Look for the <BookmarkIcon className="inline size-4 align-text-bottom" /> mark beside
          figures, sites, events, chronicles and stories. Pin what catches your eye, leave a note,
          and it collects here.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          {tags.length ? (
            <div className="flex flex-wrap gap-2">
              <FilterChip active={tag === null} onClick={() => setTag(null)} count={notes.length}>
                Everything
              </FilterChip>
              {tags.map(([t, count]) => (
                <FilterChip key={t} active={tag === t} onClick={() => setTag(t)} count={count}>
                  #{t}
                </FilterChip>
              ))}
            </div>
          ) : null}
          <ul className="flex flex-col divide-y">
            {shown.map((note) => (
              <NoteRow key={note.id} note={note} worldId={worldId} onTag={setTag} />
            ))}
          </ul>
        </div>
      )}
    </Section>
  )
}

function NoteRow({
  note,
  worldId,
  onTag,
}: {
  note: LegendsNote
  worldId: number
  onTag: (tag: string) => void
}) {
  const { save, remove } = useJournalMutations(worldId)
  const [editing, setEditing] = React.useState(false)
  const link = targetLink(note, worldId)
  const title = note.title || `${targetLabel(note.target_kind)} ${note.target_id}`
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {link ? (
          <Link {...link} className="font-medium text-primary underline-offset-4 hover:underline">
            {title}
          </Link>
        ) : (
          <span className="font-medium">{title}</span>
        )}
        <Badge variant="outline" className="font-normal">
          {targetLabel(note.target_kind)}
        </Badge>
        {note.tags.map((t) => (
          <button
            key={t}
            type="button"
            className="text-sm text-muted-foreground hover:text-foreground hover:underline"
            onClick={() => onTag(t)}
          >
            #{t}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(note.updated_at), { addSuffix: true })}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          aria-label="Edit note"
          onClick={() => setEditing((e) => !e)}
        >
          <PencilIcon className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground hover:text-destructive"
          aria-label="Remove from journal"
          onClick={() => remove.mutate(note.id)}
          disabled={remove.isPending}
        >
          <Trash2Icon className="size-3.5" />
        </Button>
      </div>
      {editing ? (
        <NoteEditor
          note={note.note}
          tags={note.tags}
          saving={save.isPending}
          autoFocus
          onSave={(text, tags) =>
            save.mutate(
              {
                target: { kind: note.target_kind, id: note.target_id, title: note.title },
                note: text,
                tags,
              },
              { onSuccess: () => setEditing(false) },
            )
          }
          onRemove={() => remove.mutate(note.id)}
        />
      ) : note.note.trim() ? (
        <p className={cn('whitespace-pre-wrap text-sm leading-relaxed')}>{note.note}</p>
      ) : (
        <p className="text-sm text-muted-foreground">No note yet.</p>
      )}
    </li>
  )
}

export const Route = createFileRoute('/_authenticated/_app/legends/journal/')({
  validateSearch: parseWorldSearch,
  component: JournalPage,
})
