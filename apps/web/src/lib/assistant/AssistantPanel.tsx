import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Textarea,
} from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { Loader2Icon, SendIcon, SparklesIcon } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { type ChatTurn, useAssistant } from './AssistantProvider'
import { ConsoleCommandCard } from './ConsoleCommandCard'
import { ReplyText } from './ReplyText'
import { getAssistantStatus } from './server'

const EXAMPLES = [
  'Queue 10 beds',
  'How do I set up a hospital?',
  'Why are my dwarves unhappy?',
  'How do I keep the drink flowing?',
]

export function AssistantPanel() {
  const { open, setOpen, turns, asking, ask, reset } = useAssistant()
  const status = useQuery({
    queryKey: ['assistant', 'status'],
    queryFn: () => getAssistantStatus(),
    enabled: open,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const [draft, setDraft] = React.useState('')
  const bottom = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (open && (turns.length || asking)) bottom.current?.scrollIntoView({ block: 'end' })
  }, [open, turns.length, asking])

  const send = (question: string) => {
    const text = question.trim()
    if (!text || asking) return
    setDraft('')
    ask(text).catch((error: Error) => {
      setDraft(text)
      toast.error(error.message)
    })
  }

  const enabled = status.data?.enabled ?? false

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b pr-12">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="flex items-center gap-2">
              <SparklesIcon className="size-4 text-muted-foreground" />
              Ask how to…
            </SheetTitle>
            {turns.length ? (
              <Button variant="ghost" size="sm" className="h-7" onClick={reset} disabled={asking}>
                New conversation
              </Button>
            ) : null}
          </div>
          <SheetDescription>
            A language model answers with your fortress in mind. Commands it suggests run only after
            you read and confirm them.
            {status.data?.model ? (
              <span className="text-xs"> Model: {status.data.model}.</span>
            ) : null}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4">
          {status.isPending ? (
            <Skeleton className="h-24 rounded-lg" />
          ) : !enabled ? (
            <NotConfigured />
          ) : turns.length || asking ? (
            <ol className="flex flex-col gap-3 text-sm">
              {turns.map((turn) => (
                <Turn key={turn.id} turn={turn} />
              ))}
              {asking ? (
                <li className="inline-flex items-center gap-2 self-start rounded-lg border bg-muted/40 px-3 py-2 text-muted-foreground">
                  <Loader2Icon className="size-3.5 animate-spin" />
                  Looking at your fortress…
                </li>
              ) : null}
            </ol>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Ask how to do something in the game, or what to do about something in your fortress.
                For example:
              </p>
              <div className="flex flex-wrap gap-2">
                {EXAMPLES.map((example) => (
                  <Button
                    key={example}
                    variant="outline"
                    size="sm"
                    className="h-auto py-1.5 font-normal"
                    onClick={() => send(example)}
                  >
                    {example}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div ref={bottom} />
        </div>

        <form
          className="flex items-end gap-2 border-t p-3"
          onSubmit={(event) => {
            event.preventDefault()
            send(draft)
          }}
        >
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                send(draft)
              }
            }}
            placeholder={turns.length ? 'Ask something else…' : 'How do I…'}
            maxLength={1000}
            rows={2}
            className="max-h-40 min-h-10 resize-none"
            disabled={!enabled}
            aria-label="Question for the assistant"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!enabled || asking || !draft.trim()}
            aria-label="Ask"
          >
            {asking ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <SendIcon className="size-4" />
            )}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  )
}

function Turn({ turn }: { turn: ChatTurn }) {
  if (turn.role === 'player')
    return (
      <li className="max-w-[85%] self-end rounded-lg bg-primary/15 px-3 py-2 whitespace-pre-line">
        {turn.text}
      </li>
    )
  return (
    <li className="flex flex-col gap-2 self-stretch rounded-lg border bg-muted/30 p-3">
      {turn.parts.map((part, i) => {
        // Parts of one reply never reorder, so their position is a stable key.
        const key = i
        if (part.kind === 'text') return <ReplyText key={key} text={part.text} />
        if (part.kind === 'command')
          return <ConsoleCommandCard key={key} command={part.command} problem={part.problem} />
        return (
          <pre
            key={key}
            className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre"
          >
            {part.text}
          </pre>
        )
      })}
    </li>
  )
}

function NotConfigured() {
  const variables: [string, string][] = [
    ['LEGENDS_NARRATOR_PROVIDER', 'openai, anthropic or cursor'],
    [
      'LEGENDS_NARRATOR_API_KEY',
      "the provider's API key; for cursor, a key from cursor.com/dashboard → Integrations",
    ],
    ['LEGENDS_NARRATOR_MODEL', 'optional; a stronger model gives better advice'],
    ['LEGENDS_NARRATOR_BASE_URL', 'optional; for a local server such as Ollama or LM Studio'],
  ]
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="font-medium">No language model is set up yet.</p>
      <p className="text-muted-foreground">
        Add these to <code className="rounded bg-muted px-1 py-0.5 text-xs">apps/web/.env</code> and
        restart the web app. The same setting turns on the legends narrator and a dwarf's voice.
      </p>
      <dl className="flex flex-col gap-2">
        {variables.map(([name, what]) => (
          <div key={name} className="flex flex-col gap-0.5">
            <dt>
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{name}</code>
            </dt>
            <dd className="text-muted-foreground">{what}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
