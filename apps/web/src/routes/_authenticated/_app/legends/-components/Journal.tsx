import { Button, Input, Popover, PopoverContent, PopoverTrigger, Textarea, cn } from '@fortress/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookmarkIcon } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import {
  type LegendsNote,
  type NoteTarget,
  deleteNote,
  listNotes,
  upsertNote,
} from '~/lib/legends/journal'

export const journalKey = (worldId: number) => ['legends', 'journal', worldId] as const

export function useJournal(worldId: number) {
  return useQuery({
    queryKey: journalKey(worldId),
    queryFn: () => listNotes({ data: { worldId } }),
    staleTime: 60_000,
  })
}

/** Save and delete, keeping the journal list in sync. */
export function useJournalMutations(worldId: number) {
  const client = useQueryClient()
  const key = journalKey(worldId)
  const save = useMutation({
    mutationFn: (input: { target: NoteTarget; note?: string; tags?: string[] }) =>
      upsertNote({ data: { worldId, ...input } }),
    onSuccess: (row) => {
      client.setQueryData<LegendsNote[]>(key, (prev) => {
        const rest = (prev ?? []).filter((n) => n.id !== row.id)
        return [row, ...rest]
      })
    },
    onError: (error) => toast.error(error.message),
  })
  const remove = useMutation({
    mutationFn: (id: number) => deleteNote({ data: { id } }),
    onSuccess: ({ id }) => {
      client.setQueryData<LegendsNote[]>(key, (prev) => (prev ?? []).filter((n) => n.id !== id))
    },
    onError: (error) => toast.error(error.message),
  })
  return { save, remove }
}

export function findNote(
  notes: LegendsNote[] | undefined,
  target: Pick<NoteTarget, 'kind' | 'id'>,
): LegendsNote | undefined {
  return notes?.find((n) => n.target_kind === target.kind && n.target_id === target.id)
}

/** Parse a comma or space separated tag line. */
export function splitTags(line: string): string[] {
  return line
    .split(/[,\s]+/)
    .map((t) => t.trim().replace(/^#/, ''))
    .filter(Boolean)
}

/**
 * Note editor shared by the pin popover and the journal page. Saves on
 * demand; the parent decides what "saved" and "removed" mean.
 */
export function NoteEditor({
  note,
  tags,
  saving,
  onSave,
  onRemove,
  autoFocus = false,
  compact = false,
}: {
  note: string
  tags: string[]
  saving: boolean
  onSave: (note: string, tags: string[]) => void
  onRemove?: () => void
  autoFocus?: boolean
  compact?: boolean
}) {
  const [text, setText] = React.useState(note)
  const [tagLine, setTagLine] = React.useState(tags.join(', '))
  React.useEffect(() => setText(note), [note])
  React.useEffect(() => setTagLine(tags.join(', ')), [tags])
  const dirty = text !== note || splitTags(tagLine).join(',') !== tags.join(',')
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What do you make of this? A theory, a reminder, a line for the saga…"
        rows={compact ? 3 : 5}
        autoFocus={autoFocus}
        className="text-sm"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onSave(text, splitTags(tagLine))
        }}
      />
      <Input
        value={tagLine}
        onChange={(e) => setTagLine(e.target.value)}
        placeholder="Tags: villain, my-fortress, chapter-3"
        className="h-8 text-sm"
        aria-label="Tags"
      />
      <div className="flex items-center justify-between gap-2">
        {onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={onRemove}
            disabled={saving}
          >
            Remove
          </Button>
        ) : (
          <span />
        )}
        <Button
          type="button"
          size="sm"
          onClick={() => onSave(text, splitTags(tagLine))}
          disabled={saving || (!dirty && Boolean(onRemove))}
        >
          {saving ? 'Saving…' : onRemove ? 'Save' : 'Pin'}
        </Button>
      </div>
    </div>
  )
}

/**
 * Pin anything to the journal. Filled when pinned; opens a small editor for
 * the note and tags. `target.title` is what the journal will show.
 */
export function PinButton({
  worldId,
  target,
  className,
  size = 'icon',
  label,
}: {
  worldId: number
  target: NoteTarget
  className?: string
  size?: 'icon' | 'sm'
  /** Visible text beside the icon, for prominent placements. */
  label?: string
}) {
  const journal = useJournal(worldId)
  const { save, remove } = useJournalMutations(worldId)
  const existing = findNote(journal.data, target)
  const [open, setOpen] = React.useState(false)
  const pinned = Boolean(existing)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={size === 'icon' ? 'ghost' : 'outline'}
          size={size}
          aria-label={pinned ? 'Edit journal note' : 'Pin to journal'}
          aria-pressed={pinned}
          title={pinned ? 'In your journal' : 'Pin to journal'}
          className={cn(
            size === 'icon' && 'size-7',
            pinned ? 'text-primary' : 'text-muted-foreground',
            className,
          )}
        >
          <BookmarkIcon className={cn('size-4', pinned && 'fill-current')} />
          {label ? <span>{pinned ? 'In journal' : label}</span> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <p className="mb-2 truncate text-sm font-medium" title={target.title}>
          {target.title}
        </p>
        <NoteEditor
          note={existing?.note ?? ''}
          tags={existing?.tags ?? []}
          saving={save.isPending || remove.isPending}
          autoFocus
          compact
          onSave={(note, tags) =>
            save.mutate(
              { target, note, tags },
              {
                onSuccess: () => {
                  setOpen(false)
                  toast.success(existing ? 'Note saved' : 'Pinned to your journal')
                },
              },
            )
          }
          onRemove={
            existing
              ? () => remove.mutate(existing.id, { onSuccess: () => setOpen(false) })
              : undefined
          }
        />
      </PopoverContent>
    </Popover>
  )
}
