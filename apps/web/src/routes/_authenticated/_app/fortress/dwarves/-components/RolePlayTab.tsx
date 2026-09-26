import type { FortUnit } from '@fortress/db-drizzle'
import { Badge, Button, Textarea, cn } from '@fortress/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import {
  CopyIcon,
  Loader2Icon,
  MessageCircleIcon,
  NotebookPenIcon,
  RefreshCwIcon,
  SendIcon,
  SparklesIcon,
} from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import {
  type CharacterSheet,
  VOICE_MODES,
  type VoiceMode,
  characterSheet,
  storyHooks,
} from '~/lib/fortress/character'
import { formatGameTick, unitDisplayName } from '~/lib/fortress/format'
import type { GameTime } from '~/lib/fortress/insights'
import {
  type VoiceTurn,
  type Voiced,
  getUnitDossier,
  getUnitNote,
  getVoiceStatus,
  saveUnitNote,
  speakAs,
} from '~/lib/fortress/roleplay'
import { Muted, Section, SheetLine, capitalize } from './SheetParts'

const SHEET_ROWS: [keyof CharacterSheet, string][] = [
  ['temperament', 'Temperament'],
  ['holds', 'Holds dear'],
  ['scorns', 'Scorns'],
  ['dreams', 'Dreams'],
  ['loves', 'Loves'],
  ['hates', 'Cannot stand'],
  ['faith', 'Faith'],
  ['bonds', 'Bonds'],
  ['grudges', 'Grudges'],
  ['haunted', 'Haunted by'],
  ['talents', 'Talents'],
  ['physique', 'Body and mind'],
]

function sheetText(unit: FortUnit, sheet: CharacterSheet): string {
  const lines = [`${unitDisplayName(unit)}, ${unit.profession}, ${Math.floor(unit.age)} years`]
  for (const [key, label] of SHEET_ROWS)
    if (sheet[key].length) lines.push(`${label}: ${sheet[key].join('; ')}`)
  return lines.join('\n')
}

async function copy(text: string, what = 'Copied') {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(what)
  } catch {
    toast.error('The clipboard would not take it.')
  }
}

function useUnitNote(unitId: number) {
  const client = useQueryClient()
  const key = ['fort', 'unit-note', unitId]
  const query = useQuery({
    queryKey: key,
    queryFn: () => getUnitNote({ data: { unitId } }),
    staleTime: 60_000,
  })
  const [draft, setDraft] = React.useState<string | null>(null)
  const save = useMutation({
    mutationFn: (note: string) => saveUnitNote({ data: { unitId, note } }),
    onSuccess: (saved) => {
      client.setQueryData(key, saved)
      setDraft(null)
    },
    onError: (error) => toast.error(error.message),
  })
  const note = draft ?? query.data?.note ?? ''
  const append = (text: string) => {
    const next = note.trim() ? `${note.trimEnd()}\n\n${text}` : text
    save.mutate(next, { onSuccess: () => toast.success('Added to your notes') })
  }
  return { query, note, draft, setDraft, save, append }
}

export function RolePlayTab({
  unit,
  now,
  compact,
}: {
  unit: FortUnit
  now: GameTime | null
  compact?: boolean
}) {
  const sheet = unit.sheet && !unit.sheet.error ? unit.sheet : null
  const character = React.useMemo(() => characterSheet(unit, sheet), [unit, sheet])
  const hooks = React.useMemo(() => storyHooks(unit, sheet, now), [unit, sheet, now])
  const notes = useUnitNote(unit.id)
  const citizen = unit.flags.includes('citizen')
  const dossier = useQuery({
    queryKey: ['fort', 'unit-dossier', unit.id],
    queryFn: () => getUnitDossier({ data: { unitId: unit.id } }),
    enabled: citizen,
    staleTime: 5 * 60_000,
  })
  const rows = SHEET_ROWS.filter(([key]) => character[key].length)
  return (
    <div className={cn('grid gap-4', compact ? 'grid-cols-1' : 'lg:grid-cols-2')}>
      <Section
        title="Character sheet"
        className={compact ? undefined : 'lg:row-span-2'}
        action={
          rows.length ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
              onClick={() => copy(sheetText(unit, character), 'Character sheet copied')}
            >
              <CopyIcon className="size-3.5" />
              Copy
            </button>
          ) : null
        }
        description="Who to play, drawn from their personality, beliefs, likes and history in the game."
      >
        {rows.length ? (
          <dl className="flex flex-col gap-2.5">
            {rows.map(([key, label]) => (
              <SheetLine key={key} label={label}>
                {capitalize(character[key].join('; '))}.
              </SheetLine>
            ))}
          </dl>
        ) : (
          <Muted>The game has not given them much of a character to go on.</Muted>
        )}
      </Section>

      <Section
        title="Story hooks"
        count={hooks.length}
        description="Loose threads in their life, each worth a scene."
      >
        {hooks.length ? (
          <ul className="flex flex-col gap-2 text-sm">
            {hooks.map((hook) => (
              <li key={hook.key} className="rounded-lg border px-3 py-2 leading-relaxed">
                {hook.text}
              </li>
            ))}
          </ul>
        ) : (
          <Muted>Their life is quiet for now.</Muted>
        )}
      </Section>

      {citizen ? (
        <Section
          title="What sets them apart"
          description="What no one else in the fortress shares, or few do: good material for a nickname or a scene."
        >
          {dossier.data?.facts.length ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {dossier.data.facts.map((fact) => (
                <li key={fact.text} className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1">
                    {dossier.data?.callName ?? unitDisplayName(unit)} {fact.text}.
                  </span>
                  {fact.only ? (
                    <Badge variant="outline" className="shrink-0 font-normal">
                      only them
                    </Badge>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <Muted>
              {dossier.isLoading ? 'Comparing them with everyone else…' : 'Nothing stands out yet.'}
            </Muted>
          )}
        </Section>
      ) : null}

      <VoiceSection unit={unit} now={now} onKeep={notes.append} />

      <Section
        title={
          <span className="flex items-center gap-2">
            <NotebookPenIcon className="size-4 text-primary" />
            Your notes
          </span>
        }
        className={compact ? undefined : 'lg:col-span-2'}
        description="Backstory, voice, what happened in your telling. Only you see them; they stay with this fortress."
      >
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            notes.save.mutate(notes.note, { onSuccess: () => toast.success('Notes saved') })
          }}
        >
          <Textarea
            value={notes.note}
            onChange={(event) => notes.setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                notes.save.mutate(notes.note, { onSuccess: () => toast.success('Notes saved') })
              }
            }}
            placeholder={`Who is ${unitDisplayName(unit)} in your story?`}
            className="min-h-32"
            disabled={notes.query.isLoading}
            aria-label="Your notes"
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>
              {notes.draft !== null
                ? 'Unsaved changes'
                : notes.query.data?.updatedAt
                  ? `Saved ${formatDistanceToNow(new Date(notes.query.data.updatedAt), { addSuffix: true })}`
                  : null}
            </span>
            <Button type="submit" size="sm" disabled={notes.draft === null || notes.save.isPending}>
              {notes.save.isPending ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </form>
      </Section>
    </div>
  )
}

function VoiceSection({
  unit,
  now,
  onKeep,
}: {
  unit: FortUnit
  now: GameTime | null
  onKeep: (text: string) => void
}) {
  const status = useQuery({
    queryKey: ['fort', 'voice-status'],
    queryFn: () => getVoiceStatus(),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const [mode, setMode] = React.useState<VoiceMode>('voice')
  const [results, setResults] = React.useState<Partial<Record<VoiceMode, Voiced>>>({})
  const [turns, setTurns] = React.useState<VoiceTurn[]>([])
  const [question, setQuestion] = React.useState('')
  const name = unitDisplayName(unit)
  const speak = useMutation({
    mutationFn: (input: { mode: VoiceMode; fresh?: boolean; question?: string }) =>
      speakAs({
        data: {
          unitId: unit.id,
          mode: input.mode,
          fresh: input.fresh,
          question: input.question,
          history: input.mode === 'ask' ? turns : undefined,
        },
      }),
    onSuccess: (voiced, input) => {
      if (input.mode === 'ask') {
        setTurns((t) => [
          ...t,
          { role: 'player', text: input.question ?? '' },
          { role: 'dwarf', text: voiced.text },
        ])
        setQuestion('')
      } else setResults((r) => ({ ...r, [input.mode]: voiced }))
    },
    onError: (error) => toast.error(error.message),
  })

  if (!status.data?.enabled) {
    return (
      <Section title="Their voice">
        <Muted>
          Set <code className="rounded bg-muted px-1 text-xs">LEGENDS_NARRATOR_PROVIDER</code> and{' '}
          <code className="rounded bg-muted px-1 text-xs">LEGENDS_NARRATOR_API_KEY</code> to have a
          language model speak as {name}, from nothing but the facts on this page.
        </Muted>
      </Section>
    )
  }

  const spec = VOICE_MODES.find((m) => m.key === mode) ?? VOICE_MODES[0]
  const result = mode === 'ask' ? null : results[mode]
  const busy = speak.isPending && speak.variables?.mode === mode
  const date = now ? ` (${formatGameTick(now.year, now.tick)})` : ''
  const keep = (text: string) => onKeep(`— ${spec.label}${date}\n${text}`)
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <SparklesIcon className="size-4 text-primary" />
          Their voice
        </span>
      }
      description={`${status.data.model} speaks as ${name} from the facts on this page and the chronicle. Treat it as a reading, not the record.`}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-1.5">
          {VOICE_MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              title={m.hint}
              aria-pressed={mode === m.key}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors hover:bg-accent',
                mode === m.key &&
                  'border-primary bg-primary text-primary-foreground hover:bg-primary/90',
              )}
            >
              {m.key === 'ask' ? <MessageCircleIcon className="size-3.5" /> : null}
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">{spec.hint}</p>

        {mode === 'ask' ? (
          <div className="flex flex-col gap-2">
            {turns.length ? (
              <ol className="flex flex-col gap-2 text-sm">
                {turns.map((turn, i) => (
                  <li
                    // Turns only ever get appended.
                    // biome-ignore lint/suspicious/noArrayIndexKey: see above
                    key={i}
                    className={cn(
                      'max-w-[90%] rounded-lg px-3 py-2 leading-relaxed whitespace-pre-line',
                      turn.role === 'player'
                        ? 'self-end bg-primary/15'
                        : 'self-start border bg-muted/40',
                    )}
                  >
                    {turn.role === 'dwarf' ? (
                      <span className="mb-0.5 block text-xs font-medium text-muted-foreground">
                        {name}
                      </span>
                    ) : null}
                    {turn.text}
                  </li>
                ))}
              </ol>
            ) : null}
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                if (question.trim()) speak.mutate({ mode: 'ask', question: question.trim() })
              }}
            >
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder={turns.length ? 'Ask something else…' : `What would you ask ${name}?`}
                maxLength={500}
                className="h-9 min-w-0 flex-1 rounded-md border bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                disabled={busy}
                aria-label={`Question for ${name}`}
              />
              <Button type="submit" size="sm" className="h-9" disabled={busy || !question.trim()}>
                {busy ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : (
                  <SendIcon className="size-3.5" />
                )}
                Ask
              </Button>
            </form>
            {turns.length ? (
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setTurns([])}>
                  Start over
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    keep(
                      turns
                        .map((t) => `${t.role === 'player' ? 'You' : name}: ${t.text}`)
                        .join('\n'),
                    )
                  }
                >
                  <NotebookPenIcon className="size-3.5" />
                  Add to notes
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {result ? (
              <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-base leading-relaxed">
                {result.text.split(/\n{2,}/).map((para, i) => (
                  <p
                    // Paragraphs of one reply never reorder.
                    // biome-ignore lint/suspicious/noArrayIndexKey: see above
                    key={i}
                    className="whitespace-pre-line"
                  >
                    {para}
                  </p>
                ))}
              </div>
            ) : busy ? (
              <p className="text-sm text-muted-foreground">Listening…</p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              {result ? (
                <>
                  <Button variant="ghost" size="sm" onClick={() => copy(result.text)}>
                    <CopyIcon className="size-3.5" />
                    Copy
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => keep(result.text)}>
                    <NotebookPenIcon className="size-3.5" />
                    Add to notes
                  </Button>
                </>
              ) : null}
              <Button
                size="sm"
                onClick={() => speak.mutate({ mode, fresh: Boolean(result) })}
                disabled={busy}
              >
                {busy ? (
                  <Loader2Icon className="size-3.5 animate-spin" />
                ) : result ? (
                  <RefreshCwIcon className="size-3.5" />
                ) : (
                  <SparklesIcon className="size-3.5" />
                )}
                {result ? 'Again' : spec.label}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Section>
  )
}
