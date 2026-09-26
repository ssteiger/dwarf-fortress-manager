import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  cn,
} from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { CopyIcon, FeatherIcon, RefreshCwIcon } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import {
  NARRATOR_STYLES,
  type Narration,
  type NarratorStyle,
  type NarratorSubject,
  getNarratorStatus,
  narrate,
} from '~/lib/legends/narrator'
import { useJournalMutations } from './Journal'
import { FilterChip } from './Timeline'

export function useNarratorStatus() {
  return useQuery({
    queryKey: ['legends', 'narrator-status'],
    queryFn: () => getNarratorStatus(),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

function subjectId(subject: NarratorSubject): string {
  switch (subject.kind) {
    case 'span':
      return `span:${subject.from}-${subject.to}`
    case 'record':
      return `${subject.recordKind}:${subject.id}`
    case 'story':
      return `story:${subject.key}`
  }
}

/**
 * "Narrate" for a span, a record or a story. Renders nothing unless the
 * server has a narrator configured, so pages look the same without one.
 */
export function NarrateButton({
  worldId,
  subject,
  title,
  size = 'sm',
  className,
}: {
  worldId: number
  subject: NarratorSubject
  /** What the dialog calls the subject; also the journal title. */
  title: string
  size?: 'sm' | 'icon'
  className?: string
}) {
  const status = useNarratorStatus()
  const [open, setOpen] = React.useState(false)
  if (!status.data?.enabled) return null
  return (
    <>
      <Button
        type="button"
        variant={size === 'icon' ? 'ghost' : 'outline'}
        size={size}
        className={cn(size === 'icon' ? 'size-8' : 'gap-1.5', className)}
        onClick={() => setOpen(true)}
        aria-label={size === 'icon' ? 'Narrate' : undefined}
        title="Have the narrator tell it"
      >
        <FeatherIcon className="size-4" />
        {size === 'sm' ? 'Narrate' : null}
      </Button>
      {open ? (
        <NarrationDialog
          worldId={worldId}
          subject={subject}
          title={title}
          model={status.data.model}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}

function NarrationDialog({
  worldId,
  subject,
  title,
  model,
  onClose,
}: {
  worldId: number
  subject: NarratorSubject
  title: string
  model: string | null
  onClose: () => void
}) {
  const [style, setStyle] = React.useState<NarratorStyle>('chronicle')
  // Each retelling gets a new nonce; the first asks the memo, the rest ask the model.
  const [attempt, setAttempt] = React.useState(0)
  const { save } = useJournalMutations(worldId)
  const run = useQuery({
    queryKey: ['legends', 'narration', worldId, subject, style, attempt],
    queryFn: () => narrate({ data: { worldId, subject, style, fresh: attempt > 0 } }),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })
  const result: Narration | null = run.data ?? null

  const copy = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.text)
      toast.success('Copied')
    } catch {
      toast.error('The clipboard would not take it')
    }
  }
  const saveToJournal = () => {
    if (!result) return
    save.mutate(
      {
        target: {
          kind: 'narration',
          id: `${subjectId(subject)}:${style}`,
          title: `${title} — narrated`,
        },
        note: result.text,
        tags: ['narration', style],
      },
      { onSuccess: () => toast.success('Saved to your journal') },
    )
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FeatherIcon className="size-4" />
            {title}
          </DialogTitle>
          <DialogDescription>
            Told from {result ? `${result.facts} facts` : 'the facts'} the records hold
            {model ? ` by ${model}` : ''}. The narrator is told to invent nothing; treat it as a
            reading, not a source.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {NARRATOR_STYLES.map((s) => (
            <FilterChip key={s.key} active={style === s.key} onClick={() => setStyle(s.key)}>
              <span title={s.hint}>{s.label}</span>
            </FilterChip>
          ))}
        </div>
        <div className="min-h-32">
          {run.isPending ? (
            <p className="text-sm text-muted-foreground">The narrator is reading the records…</p>
          ) : run.isError ? (
            <p className="text-sm text-destructive">{(run.error as Error).message}</p>
          ) : result ? (
            <div className="flex flex-col gap-3 text-base leading-relaxed">
              {result.text.split(/\n{2,}/).map((para, i) => (
                <p key={`${i}-${para.slice(0, 12)}`}>{para}</p>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => setAttempt((n) => n + 1)}
            disabled={run.isPending}
          >
            <RefreshCwIcon className={cn('size-3.5', run.isPending && 'animate-spin')} />
            Tell it again
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={copy} disabled={!result}>
            <CopyIcon className="size-3.5" />
            Copy
          </Button>
          <Button size="sm" onClick={saveToJournal} disabled={!result || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save to journal'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
