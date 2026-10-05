import { checkConsoleCommand } from '@fortress/db-drizzle/fortress-types'
import {
  Badge,
  Button,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  Skeleton,
} from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { ListOrderedIcon, XIcon } from 'lucide-react'
import * as React from 'react'

import { ConsoleCommandCard } from '~/lib/assistant/ConsoleCommandCard'
import type { FixNote, FixStep } from '~/lib/fortress/fixes'
import { getFortFixes } from '~/lib/fortress/server'

/** Opens the work orders that make what the stuck jobs lack, one step at a time. */
export function FixStepsButton() {
  const [open, setOpen] = React.useState(false)
  return (
    <Drawer direction="right" open={open} onOpenChange={setOpen}>
      <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <ListOrderedIcon className="size-3.5" />
        Fix step by step
      </Button>
      <DrawerContent className="data-[vaul-drawer-direction=right]:h-full data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:sm:max-w-xl">
        <DrawerHeader className="border-b">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <DrawerTitle>Get the stuck jobs going</DrawerTitle>
              <DrawerDescription className="mt-1">
                The work orders that make what the suspended and failing jobs lack, in the order to
                add them: each makes what a later one needs. Run one in DFHack once you have read
                it, or copy it into DFHack's console. New orders wait until the manager has checked
                them.
              </DrawerDescription>
            </div>
            <DrawerClose asChild>
              <Button size="icon" variant="ghost" aria-label="Close">
                <XIcon className="size-4" />
              </Button>
            </DrawerClose>
          </div>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{open ? <FixPlan /> : null}</div>
      </DrawerContent>
    </Drawer>
  )
}

function FixPlan() {
  const { data, isLoading } = useQuery({
    queryKey: ['fort', 'fixes'],
    queryFn: () => getFortFixes(),
  })
  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-6">
      {data.steps.length ? (
        <ol className="flex flex-col gap-6">
          {data.steps.map((step, i) => (
            <StepItem key={step.key} step={step} number={i + 1} />
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">
          No work order would help: nothing stuck is short of something the fortress can make.
        </p>
      )}
      {data.notes.length ? <Notes notes={data.notes} /> : null}
      {data.capturedAt ? (
        <p className="text-xs text-muted-foreground">
          From the game read {formatDistanceToNow(new Date(data.capturedAt), { addSuffix: true })}.
          Buildings placed with DFHack's buildingplan take their items as soon as they exist; other
          suspended jobs need resuming in the game.
        </p>
      ) : null}
    </div>
  )
}

function StepItem({ step, number }: { step: FixStep; number: number }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums">
        {number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-medium">{step.title}</span>
          <Badge variant={step.manual ? 'outline' : 'secondary'} className="font-normal">
            {step.manual ? 'In the game' : 'Work order'}
          </Badge>
        </div>
        <ul className="flex flex-col gap-0.5 text-sm text-muted-foreground">
          {[...new Set(step.why)].map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
        {step.hint ? <p className="text-sm">{step.hint}</p> : null}
        {step.ordered ? (
          <p className="text-sm text-amber-700 dark:text-amber-300">{step.ordered}</p>
        ) : null}
        {step.command ? (
          <ConsoleCommandCard command={step.command} problem={checkConsoleCommand(step.command)} />
        ) : null}
      </div>
    </li>
  )
}

function Notes({ notes }: { notes: FixNote[] }) {
  return (
    <section className="flex flex-col gap-3 border-t pt-4">
      <h3 className="text-sm font-medium">What a work order would not fix</h3>
      <ul className="flex flex-col gap-3">
        {notes.map((note) => (
          <li key={note.key} className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{note.title}</span>
            <span className="text-sm text-muted-foreground">{note.text}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
