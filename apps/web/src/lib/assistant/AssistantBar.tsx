import { SparklesIcon } from 'lucide-react'

import { useAssistant } from './AssistantProvider'

/** Sits next to the search in the header and opens the assistant sidebar. */
export function AssistantBar() {
  const { setOpen } = useAssistant()
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Ask how to do something in the game"
      className="flex h-8 shrink-0 items-center gap-2 rounded-md border bg-background/60 px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent/60"
    >
      <SparklesIcon className="size-4 shrink-0" />
      <span className="hidden whitespace-nowrap lg:inline">Ask how to…</span>
      <kbd className="hidden rounded border bg-muted px-1.5 font-mono text-[10px] leading-4 md:inline">
        ⌘J
      </kbd>
    </button>
  )
}
