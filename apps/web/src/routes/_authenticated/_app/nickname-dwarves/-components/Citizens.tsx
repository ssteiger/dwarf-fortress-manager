import type { FortUnit } from '@fortress/db-drizzle/fortress-types'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Skeleton,
  Switch,
  cn,
} from '@fortress/ui'
import {
  BookmarkIcon,
  CheckIcon,
  ChevronDownIcon,
  Loader2Icon,
  RotateCcwIcon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react'
import * as React from 'react'

import { CreatureSprite } from '~/lib/df-assets/components'
import type { DwarfName } from '~/lib/fortress/people/dossier'
import {
  type DossierFact,
  MAX_NICKNAME_LENGTH,
  type NicknameIdea,
  type RememberedNickname,
} from '../-server'
import { EmptyState } from '../../fortress/-components/FortChrome'

export interface CitizenRow {
  unit: FortUnit
  draft: string
  /** `label` is the idea as it would go into the game. */
  ideas: (NicknameIdea & { label: string })[]
  name: DwarfName | null
  facts: DossierFact[]
  remembered: RememberedNickname | null
  flash: boolean
  asking: boolean
}

type Change = 'none' | 'new' | 'rename' | 'clear'

function changeOf(unit: FortUnit, draft: string): Change {
  const current = unit.nickname?.trim() ?? ''
  const next = draft.trim()
  if (next === current) return 'none'
  if (!next) return 'clear'
  return current ? 'rename' : 'new'
}

export function Citizens({
  rows,
  total,
  withoutNickname,
  writer,
  search,
  onSearch,
  unnamedOnly,
  onUnnamedOnly,
  alliterative,
  onAlliterative,
  loadingIdeas,
  disabled,
  onType,
  onPick,
  onBrowse,
  onQueue,
  onAsk,
}: {
  /** The citizens shown, after search and filters. */
  rows: CitizenRow[]
  /** Every living citizen, shown or not. */
  total: number
  withoutNickname: number
  writer: { enabled: boolean; model: string | null } | undefined
  search: string
  onSearch: (value: string) => void
  unnamedOnly: boolean
  onUnnamedOnly: (on: boolean) => void
  alliterative: boolean
  onAlliterative: (on: boolean) => void
  loadingIdeas: boolean
  disabled: boolean
  onType: (unitId: number, typed: string) => void
  onPick: (unitId: number, nickname: string) => void
  /** Opens the picker over the whole list; null while the list is empty. */
  onBrowse: ((unitId: number) => void) | null
  onQueue: (unit: FortUnit) => void
  onAsk: (unit: FortUnit) => void
}) {
  const query = search.trim()
  const canAsk = Boolean(writer?.enabled)
  const waiting = rows.filter((row) => changeOf(row.unit, row.draft) !== 'none').length
  return (
    <Card>
      <CardHeader>
        <CardTitle>Living citizens</CardTitle>
        <CardDescription className="max-w-3xl">
          Each idea rests on something real: a favourite food that is somebody's brain, a missing
          toe, a parent's nickname, a job they are hopeless at, a mishap from the chronicle. Pick
          one, edit it or type your own, then queue it.{' '}
          {writer?.enabled
            ? `${writer.model} can write more from the same facts.`
            : 'Set LEGENDS_NARRATOR_PROVIDER and LEGENDS_NARRATOR_API_KEY to have a language model write them too.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="relative w-full max-w-md">
              <SearchIcon className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => onSearch(event.target.value)}
                placeholder="Search by name, nickname or job"
                aria-label="Search citizens"
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch id="nickname-unnamed" checked={unnamedOnly} onCheckedChange={onUnnamedOnly} />
              <Label htmlFor="nickname-unnamed" className="font-normal">
                No nickname yet
                <span className="text-muted-foreground tabular-nums">({withoutNickname})</span>
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="nickname-alliterate"
                checked={alliterative}
                onCheckedChange={onAlliterative}
              />
              <Label htmlFor="nickname-alliterate" className="font-normal">
                Alliterate
                <span className="text-muted-foreground">(Bad Bargain → Bob the Bad Bargain)</span>
              </Label>
            </div>
          </div>
          {rows.length ? (
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className={cn('tabular-nums', waiting && 'font-medium text-foreground')}>
                {waiting
                  ? `${waiting} of ${rows.length} shown would change when queued.`
                  : 'Every box shown matches the game.'}
              </span>
              <span className="inline-flex items-center gap-1">
                <BookmarkIcon className="size-3.5" aria-hidden />
                from your names
              </span>
              {canAsk ? (
                <span className="inline-flex items-center gap-1">
                  <SparklesIcon className="size-3.5" aria-hidden />
                  written by the AI
                </span>
              ) : null}
              <span>unmarked ideas come from their story</span>
            </p>
          ) : null}
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title={
              total === 0
                ? 'No living citizens found'
                : unnamedOnly && !query
                  ? 'Everyone has a nickname'
                  : 'No matches'
            }
          >
            {total === 0
              ? 'Wait for the worker to capture a loaded fortress.'
              : unnamedOnly && !query
                ? 'Turn off "No nickname yet" to rename someone.'
                : 'Try a different search.'}
          </EmptyState>
        ) : (
          <div className="@container divide-y rounded-lg border">
            {rows.map((row) => (
              <NicknameRow
                key={row.unit.id}
                {...row}
                loadingIdeas={loadingIdeas}
                disabled={disabled}
                canAsk={canAsk}
                onType={(typed) => onType(row.unit.id, typed)}
                onPick={(idea) => onPick(row.unit.id, idea)}
                onBrowse={onBrowse ? () => onBrowse(row.unit.id) : null}
                onQueue={() => onQueue(row.unit)}
                onAsk={() => onAsk(row.unit)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

const SOURCE_LABEL: Record<NicknameIdea['source'], string> = {
  facts: 'From their story',
  model: 'Written by the AI',
  list: 'From your names',
}

function SourceIcon({ source }: { source: NicknameIdea['source'] }) {
  if (source === 'model') return <SparklesIcon className="size-3" aria-hidden />
  if (source === 'list') return <BookmarkIcon className="size-3" aria-hidden />
  return null
}

/** What queueing the box would do, said next to it. */
function Preview({
  change,
  draft,
  current,
  name,
}: {
  change: Change
  draft: string
  current: string
  name: DwarfName | null
}) {
  if (change === 'none') return null
  if (change === 'clear') {
    const plain = [name?.given, name?.surname].filter(Boolean).join(' ')
    return (
      <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
        <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Queueing this takes away “{current}”{plain ? `, and they go back to ${plain}` : ''}.
        </span>
      </p>
    )
  }
  const text = draft.trim()
  const meaning = name?.meaning && name.meaning !== name.surname ? name.meaning : null
  return (
    <p className="text-sm text-muted-foreground">
      {change === 'rename' ? 'Replaces their nickname. ' : ''}In the game:{' '}
      <span className="font-medium text-foreground">
        `{text}'{name?.surname ? ` ${name.surname}` : ''}
      </span>
      {meaning ? (
        <>
          {' '}
          · {text} {meaning}
        </>
      ) : null}
    </p>
  )
}

const LINK =
  'inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline disabled:pointer-events-none disabled:opacity-50'

function NicknameRow({
  unit,
  draft,
  ideas,
  name,
  facts,
  remembered,
  flash,
  loadingIdeas,
  disabled,
  canAsk,
  asking,
  onType,
  onPick,
  onBrowse,
  onQueue,
  onAsk,
}: CitizenRow & {
  loadingIdeas: boolean
  disabled: boolean
  canAsk: boolean
  onType: (value: string) => void
  onPick: (nickname: string) => void
  onBrowse: (() => void) | null
  onQueue: () => void
  onAsk: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const current = unit.nickname?.trim() ?? ''
  const change = changeOf(unit, draft)
  const chosen = ideas.find((idea) => idea.label.toLowerCase() === draft.trim().toLowerCase())
  const realName = [name?.given, name?.surname].filter(Boolean).join(' ') || unit.readable
  const inputId = `nickname-${unit.id}`
  return (
    <form
      id={`dwarf-${unit.id}`}
      className={cn(
        'grid scroll-mt-24 grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 p-4 transition-colors duration-700 @2xl:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] @2xl:items-start',
        flash && 'bg-primary/10',
      )}
      onSubmit={(event) => {
        event.preventDefault()
        if (change !== 'none') onQueue()
      }}
    >
      <div className="col-start-1 row-start-1 flex min-w-0 items-start gap-3">
        <CreatureSprite unit={unit} size={36} className="shrink-0" />
        <div className="min-w-0 space-y-0.5">
          <label htmlFor={inputId} className="block truncate font-medium" title={unit.readable}>
            {realName}
          </label>
          <div className="truncate text-sm text-muted-foreground">{unit.profession}</div>
          <div className="text-sm">
            {current ? (
              <>
                <span className="text-muted-foreground">Goes by </span>
                <span className="font-medium">{current}</span>
              </>
            ) : (
              <span className="text-muted-foreground">No nickname yet</span>
            )}
          </div>
          {remembered?.why ? (
            <p className="line-clamp-2 text-sm text-muted-foreground" title={remembered.why}>
              {remembered.source === 'list' ? remembered.why : `Named for: ${remembered.why}`}
            </p>
          ) : null}
        </div>
      </div>

      <div className="col-start-2 row-start-1 @2xl:col-start-3">
        <Button
          type="submit"
          variant={change === 'none' ? 'outline' : 'default'}
          disabled={disabled || change === 'none'}
          title={
            change === 'none'
              ? 'The box matches the game. Change it to queue a new nickname.'
              : 'Send this nickname to the game on the worker’s next poll'
          }
        >
          <SendIcon className="size-4" />
          Queue
        </Button>
      </div>

      <div className="col-span-2 flex min-w-0 flex-col gap-2 @2xl:col-span-1 @2xl:col-start-2 @2xl:row-start-1">
        <div className="relative">
          <Input
            id={inputId}
            maxLength={MAX_NICKNAME_LENGTH}
            value={draft}
            placeholder={
              current ? 'Empty takes their nickname away' : 'Type a nickname or pick one'
            }
            onChange={(event) => onType(event.target.value)}
            disabled={disabled}
            className={cn(
              'pr-16',
              change !== 'none' && 'border-primary/60',
              change === 'clear' && 'border-amber-500/70',
            )}
          />
          <div className="absolute inset-y-0 right-1 flex items-center">
            {change !== 'none' ? (
              <button
                type="button"
                onClick={() => onType(current)}
                disabled={disabled}
                title={current ? `Back to “${current}”` : 'Back to no nickname'}
                aria-label={`Undo the change for ${realName}`}
                className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                <RotateCcwIcon className="size-3.5" aria-hidden />
              </button>
            ) : null}
            {draft ? (
              <button
                type="button"
                onClick={() => onType('')}
                disabled={disabled}
                title="Empty the box"
                aria-label={`Empty the nickname box for ${realName}`}
                className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                <XIcon className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
        </div>
        <Preview change={change} draft={draft} current={current} name={name} />
        {chosen?.why && change !== 'none' ? (
          <p className="text-sm text-muted-foreground">{chosen.why}</p>
        ) : null}

        {ideas.length ? (
          <ul className="flex flex-wrap gap-1.5" aria-label={`Ideas for ${realName}`}>
            {ideas.map((idea) => {
              const active = idea === chosen
              return (
                <li key={idea.nickname}>
                  <button
                    type="button"
                    onClick={() => onPick(idea.nickname)}
                    disabled={disabled}
                    title={`${SOURCE_LABEL[idea.source]}. ${idea.why}`}
                    aria-pressed={active}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50',
                      idea.source === 'list' && !active && 'border-dashed',
                      active && 'border-primary bg-primary/10 text-primary hover:bg-primary/15',
                    )}
                  >
                    {active ? (
                      <CheckIcon className="size-3" aria-hidden />
                    ) : (
                      <SourceIcon source={idea.source} />
                    )}
                    {idea.label}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : loadingIdeas ? (
          <div className="flex gap-1.5" aria-label="Loading ideas">
            {[24, 32, 20].map((width) => (
              <Skeleton key={width} className="h-6" style={{ width: `${width * 4}px` }} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No ideas from their story yet. Type one{canAsk ? ' or have the AI write some' : ''}.
          </p>
        )}

        {facts.length || onBrowse || canAsk ? (
          <div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              {facts.length ? (
                <button
                  type="button"
                  onClick={() => setOpen((v) => !v)}
                  aria-expanded={open}
                  className={LINK}
                >
                  What sets them apart
                  <span className="text-muted-foreground tabular-nums">({facts.length})</span>
                  <ChevronDownIcon
                    className={cn('size-3.5 transition-transform', open && 'rotate-180')}
                  />
                </button>
              ) : null}
              {onBrowse ? (
                <button type="button" onClick={onBrowse} disabled={disabled} className={LINK}>
                  <BookmarkIcon className="size-3.5" aria-hidden />
                  Pick from your names
                </button>
              ) : null}
              {canAsk ? (
                <button
                  type="button"
                  onClick={onAsk}
                  disabled={asking}
                  title="Have the AI write three new names from their story"
                  className={LINK}
                >
                  {asking ? (
                    <Loader2Icon className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <SparklesIcon className="size-3.5" aria-hidden />
                  )}
                  {asking ? 'Writing…' : 'Write new ideas'}
                </button>
              ) : null}
            </div>
            {open && facts.length ? (
              <ul className="mt-2 flex flex-col gap-1 rounded-md bg-muted/50 px-3 py-2 text-sm">
                {facts.map((fact) => (
                  <li key={fact.text} className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1">
                      {fact.text.charAt(0).toUpperCase()}
                      {fact.text.slice(1)}
                    </span>
                    {fact.only ? (
                      <Badge variant="outline" className="font-normal">
                        only them
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </form>
  )
}
