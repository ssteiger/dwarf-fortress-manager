import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Textarea,
  cn,
} from '@fortress/ui'
import { useMutation } from '@tanstack/react-query'
import { BookmarkIcon, Loader2Icon, PlusIcon, XIcon } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { type ListedName, MAX_LIST, addToNameList, removeFromNameList } from '../-server'
import { SSTEIGER_NAMES, VONGALACTIC_NAMES } from './names'

const ORDER: Record<ListedName['state'], number> = { fits: 0, wildcard: 1, spare: 2, used: 3 }

export function statusOf(entry: ListedName, called: string): string {
  if (entry.state === 'used') return `${called} goes by it`
  if (entry.state === 'fits') return `fits ${called}`
  if (entry.state === 'wildcard') return `wild card for ${called}`
  return 'no dwarf free'
}

export function NameList({
  list,
  calledBy,
  onChanged,
  onShow,
}: {
  list: ListedName[]
  /** Unit id -> what to call that dwarf in a few words. */
  calledBy: Map<number, string>
  onChanged: () => void
  onShow: (unitId: number) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [text, setText] = React.useState('')
  const entering = editing || list.length === 0
  const pasted = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const listed = new Set(list.map((entry) => entry.name.toLowerCase()))
  const missingVonGalactic = VONGALACTIC_NAMES.filter((name) => !listed.has(name.toLowerCase()))
  const missingSsteiger = SSTEIGER_NAMES.filter((name) => !listed.has(name.toLowerCase()))

  const add = useMutation({
    mutationFn: (names: string[]) => addToNameList({ data: { names } }),
    onSuccess: ({ added }) => {
      toast.success(
        added
          ? `${added} name${added === 1 ? '' : 's'} added. Each one goes to the dwarf it fits best.`
          : 'Those names are on your list already.',
      )
      setText('')
      setEditing(false)
      onChanged()
    },
    onError: (error) => toast.error(error.message),
  })
  const remove = useMutation({
    mutationFn: (ids: number[]) => removeFromNameList({ data: { ids } }),
    onSuccess: () => onChanged(),
    onError: (error) => toast.error(error.message),
  })

  const sorted = [...list].sort(
    (a, b) => ORDER[a.state] - ORDER[b.state] || a.name.localeCompare(b.name),
  )
  const fits = list.filter((entry) => entry.state === 'fits').length

  return (
    <Card>
      <CardHeader className="max-sm:has-data-[slot=card-action]:grid-cols-1">
        <CardTitle className="flex items-center gap-2">
          Your names
          {list.length ? (
            <Badge variant="secondary" className="tabular-nums">
              {list.length}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription className="max-w-2xl">
          {list.length
            ? `Names you love, waiting for the right dwarf. ${fits ? `${fits} found a dwarf they fit and show up first in that dwarf's ideas.` : 'None fit anyone yet.'} The rest go to dwarves without a nickname as wild cards.`
            : 'Keep names you love here, from streams, friends or your own head. Each one goes to the dwarf whose story it fits best, and the AI may hand them out too.'}
        </CardDescription>
        {list.length ? (
          <CardAction className="flex items-center gap-2 max-sm:col-start-1 max-sm:row-span-1 max-sm:row-start-3 max-sm:mt-2 max-sm:justify-self-start">
            <Button size="sm" variant="outline" onClick={() => setEditing((on) => !on)}>
              <PlusIcon className="size-4" />
              Add names
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost" disabled={remove.isPending}>
                  Remove all
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove all {list.length} names?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Your list empties. Nicknames already given in the game stay as they are.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep them</AlertDialogCancel>
                  <AlertDialogAction onClick={() => remove.mutate(list.map((entry) => entry.id))}>
                    Remove all
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {entering ? (
          <form
            className="flex max-w-2xl flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              if (pasted.length) add.mutate(pasted)
            }}
          >
            <Textarea
              aria-label="Names to add, one per line"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={'One name per line, for example:\nTiny Toes Thompson\nOSHA Supervisor'}
              className="min-h-24"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" disabled={!pasted.length || add.isPending}>
                {add.isPending ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <BookmarkIcon className="size-4" />
                )}
                {pasted.length > 1 ? `Add ${pasted.length} names` : 'Add name'}
              </Button>
              {missingVonGalactic.length ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={add.isPending}
                  onClick={() => add.mutate(missingVonGalactic)}
                >
                  {list.length === 0
                    ? `Start with the ${missingVonGalactic.length} VonGalactic names`
                    : `Add the ${missingVonGalactic.length} VonGalactic names you don't have yet`}
                </Button>
              ) : null}
              {missingSsteiger.length ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={add.isPending}
                  onClick={() => add.mutate(missingSsteiger)}
                >
                  {list.length === 0
                    ? `Start with the ${missingSsteiger.length} ssteiger names`
                    : `Add the ${missingSsteiger.length} ssteiger names you don't have yet`}
                </Button>
              ) : null}
              {missingVonGalactic.length || missingSsteiger.length ? null : (
                <span className="text-sm text-muted-foreground">
                  Up to {MAX_LIST} names. Duplicates are skipped.
                </span>
              )}
            </div>
          </form>
        ) : null}
        {sorted.length ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Your names">
            {sorted.map((entry) => {
              const called = entry.unitId !== null ? (calledBy.get(entry.unitId) ?? 'a dwarf') : ''
              const status = statusOf(entry, called)
              return (
                <li
                  key={entry.id}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md border py-0.5 pr-0.5 pl-2 text-sm',
                    entry.state === 'used' && 'border-dashed',
                  )}
                >
                  <span className="font-medium">{entry.name}</span>
                  {entry.unitId !== null ? (
                    <button
                      type="button"
                      onClick={() => entry.unitId !== null && onShow(entry.unitId)}
                      className={cn(
                        'text-left underline-offset-4 hover:text-foreground hover:underline',
                        entry.state === 'fits'
                          ? 'text-emerald-700 dark:text-emerald-400'
                          : 'text-muted-foreground',
                      )}
                    >
                      {status}
                    </button>
                  ) : (
                    <span className="text-muted-foreground">{status}</span>
                  )}
                  <button
                    type="button"
                    onClick={() => remove.mutate([entry.id])}
                    disabled={remove.isPending}
                    aria-label={`Remove ${entry.name} from your list`}
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                  >
                    <XIcon className="size-3.5" aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  )
}
