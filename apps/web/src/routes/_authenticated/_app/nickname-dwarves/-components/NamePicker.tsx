import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@fortress/ui'
import * as React from 'react'

import type { ListedName } from '../-server'
import { statusOf } from './NameList'

/** Lets the player put any name from their list in one dwarf's box. */
export function NamePicker({
  target,
  list,
  calledBy,
  onPick,
  onClose,
}: {
  target: { unitId: number; called: string } | null
  list: ListedName[]
  calledBy: Map<number, string>
  onPick: (unitId: number, name: string) => void
  onClose: () => void
}) {
  // Kept while the dialog animates out, after `target` is already null.
  const last = React.useRef(target)
  if (target) last.current = target
  const shown = target ?? last.current

  const byName = (a: ListedName, b: ListedName) => a.name.localeCompare(b.name)
  const theirs = list.filter((e) => e.state !== 'used' && e.unitId === shown?.unitId).sort(byName)
  const free = list.filter((e) => e.state !== 'used' && e.unitId !== shown?.unitId).sort(byName)
  const used = list.filter((e) => e.state === 'used').sort(byName)

  function item(entry: ListedName) {
    const called = entry.unitId !== null ? (calledBy.get(entry.unitId) ?? 'a dwarf') : ''
    const hint =
      entry.unitId === shown?.unitId
        ? entry.state === 'used'
          ? 'their nickname now'
          : null
        : entry.state === 'spare'
          ? null
          : statusOf(entry, called)
    return (
      <CommandItem
        key={entry.id}
        value={entry.name}
        onSelect={() => {
          if (shown) onPick(shown.unitId, entry.name)
          onClose()
        }}
      >
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
        {hint ? <span className="shrink-0 text-xs text-muted-foreground">{hint}</span> : null}
      </CommandItem>
    )
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b px-4 py-3 text-left">
          <DialogTitle>Pick a name for {shown?.called}</DialogTitle>
          <DialogDescription>
            It goes in their box. Nothing reaches the game until you queue it.
          </DialogDescription>
        </DialogHeader>
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2">
          <CommandInput placeholder="Search your names…" aria-label="Search your names" />
          <CommandList className="max-h-[min(420px,60vh)]">
            <CommandEmpty>None of your names match.</CommandEmpty>
            {theirs.length ? (
              <CommandGroup heading={`Picked out for ${shown?.called}`}>
                {theirs.map(item)}
              </CommandGroup>
            ) : null}
            {free.length ? (
              <CommandGroup heading="Not in use">{free.map(item)}</CommandGroup>
            ) : null}
            {used.length ? <CommandGroup heading="In use">{used.map(item)}</CommandGroup> : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
