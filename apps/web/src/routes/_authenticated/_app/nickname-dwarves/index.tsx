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
  Switch,
  cn,
} from '@fortress/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  BookmarkIcon,
  ChevronDownIcon,
  Loader2Icon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
  WandSparklesIcon,
} from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { CreatureSprite } from '~/lib/df-assets/components'
import { alliterate, alliterateAll, alliterationKey } from '~/lib/fortress/alliteration'
import type { DwarfName } from '~/lib/fortress/dossier'
import { FORT_REFRESH_MS, useFortOverview } from '~/lib/fortress/queries'
import { getFortUnits } from '~/lib/fortress/server'
import { EmptyState, PageHeader, StatusBanner } from '../fortress/-components/FortChrome'
import { NameList } from './-components/NameList'
import {
  type DossierFact,
  MAX_NICKNAME_LENGTH,
  type NicknameAssignment,
  type NicknameIdea,
  type RememberedNickname,
  WRITE_BATCH_SIZE,
  getNicknameIdeas,
  queueDwarfNicknames,
  writeNicknames,
} from './-server'
import { livingCitizens } from './-utils'

export const Route = createFileRoute('/_authenticated/_app/nickname-dwarves/')({
  component: RouteComponent,
})

const MAX_IDEAS = 6
const MAX_QUEUE = 250
const PARALLEL_WRITES = 3
const ALLITERATE_KEY = 'nickname-dwarves-alliterate'
const FLASH_MS = 1600

/** What the player put in a dwarf's box: their own words, or one of the ideas as offered. */
type Draft = { typed: string } | { idea: string }

function useAlliteration(): [boolean, (on: boolean) => void] {
  const [on, setOn] = React.useState(false)
  React.useEffect(() => {
    if (localStorage.getItem(ALLITERATE_KEY) === 'on') setOn(true)
  }, [])
  return [
    on,
    (next) => {
      setOn(next)
      localStorage.setItem(ALLITERATE_KEY, next ? 'on' : 'off')
    },
  ]
}

function prefersReducedMotion(): boolean {
  return (
    document.documentElement.dataset.motion === 'reduce' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function RouteComponent() {
  const overview = useFortOverview()
  const { data, isFetching, refetch } = useQuery({
    queryKey: ['fort', 'units'],
    queryFn: () => getFortUnits(),
    refetchInterval: FORT_REFRESH_MS * 2,
  })
  // Fetched once per visit so suggestions stay put while the dump refreshes underneath.
  const ideasQuery = useQuery({
    queryKey: ['fort', 'nickname-ideas'],
    queryFn: () => getNicknameIdeas(),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  })
  const [search, setSearch] = React.useState('')
  const [unnamedOnly, setUnnamedOnly] = React.useState(false)
  const [drafts, setDrafts] = React.useState<Record<number, Draft>>({})
  const [alliterative, setAlliterative] = useAlliteration()
  const [written, setWritten] = React.useState<Record<number, NicknameIdea[]>>({})
  const [writing, setWriting] = React.useState<{ done: number; total: number } | null>(null)
  const [asking, setAsking] = React.useState<ReadonlySet<number>>(new Set())
  const [flash, setFlash] = React.useState<number | null>(null)

  const mutation = useMutation({
    mutationFn: (assignments: NicknameAssignment[]) =>
      queueDwarfNicknames({ data: { assignments } }),
    onSuccess: ({ queued }) => {
      toast.success(
        `${queued} nickname${queued === 1 ? '' : 's'} queued. The worker will apply ${
          queued === 1 ? 'it' : 'them'
        } on its next poll.`,
      )
    },
    onError: (error) => toast.error(error.message),
  })

  const dossiers = React.useMemo(
    () => new Map((ideasQuery.data?.dwarves ?? []).map((d) => [d.unitId, d])),
    [ideasQuery.data],
  )
  const writer = ideasQuery.data?.writer
  const list = ideasQuery.data?.list ?? []
  const citizens = React.useMemo(() => livingCitizens(data?.units ?? []), [data?.units])
  const withoutNickname = citizens.filter((unit) => !unit.nickname?.trim()).length
  const query = search.trim().toLowerCase()
  const visibleCitizens = React.useMemo(
    () =>
      citizens.filter(
        (unit) =>
          (!unnamedOnly || !unit.nickname?.trim()) &&
          (!query ||
            [unit.readable, unit.name, unit.name_english, unit.nickname, unit.profession]
              .filter(Boolean)
              .some((value) => value?.toLowerCase().includes(query))),
      ),
    [citizens, query, unnamedOnly],
  )
  const calledBy = React.useMemo(
    () =>
      new Map(
        citizens.map((unit) => [
          unit.id,
          unit.nickname?.trim() || dossiers.get(unit.id)?.name?.given || unit.readable,
        ]),
      ),
    [citizens, dossiers],
  )
  const isLive = overview.data?.state?.status === 'live'

  React.useEffect(() => {
    if (flash === null) return
    const timer = setTimeout(() => setFlash(null), FLASH_MS)
    return () => clearTimeout(timer)
  }, [flash])

  function ideasFor(unit: FortUnit): NicknameIdea[] {
    const seen = new Set<string>()
    return [...(written[unit.id] ?? []), ...(dossiers.get(unit.id)?.ideas ?? [])]
      .filter((idea) => {
        const key = idea.nickname.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, MAX_IDEAS)
  }

  const alliterated = alliterative
    ? alliterateAll(
        citizens.map((unit) => ({ unit, nicknames: ideasFor(unit).map((idea) => idea.nickname) })),
        MAX_NICKNAME_LENGTH,
      )
    : null

  /** An idea as it goes into the game, with the alliterative first name when that is on. */
  function present(unit: FortUnit, nickname: string): string {
    if (!alliterated) return nickname
    return (
      alliterated.get(alliterationKey(unit.id, nickname)) ??
      alliterate(nickname, unit, MAX_NICKNAME_LENGTH)
    )
  }

  function draftFor(unit: FortUnit): string {
    const draft = drafts[unit.id]
    if (draft) return 'typed' in draft ? draft.typed : present(unit, draft.idea)
    const first = ideasFor(unit)[0]
    return unit.nickname?.trim() || (first ? present(unit, first.nickname) : '')
  }

  /** The draft before alliteration, which is what the model should steer clear of. */
  function plainDraftFor(unit: FortUnit): string {
    const draft = drafts[unit.id]
    if (draft) return 'typed' in draft ? draft.typed : draft.idea
    return unit.nickname?.trim() || ideasFor(unit)[0]?.nickname || ''
  }

  /** The idea behind what is in the box, so its reason travels with it into the game. */
  function originOf(unit: FortUnit, nickname: string): Pick<NicknameAssignment, 'why' | 'source'> {
    const key = nickname.trim().toLowerCase()
    const idea = ideasFor(unit).find(
      (i) => i.nickname.toLowerCase() === key || present(unit, i.nickname).toLowerCase() === key,
    )
    return idea ? { why: idea.why, source: idea.source } : { why: null, source: 'typed' }
  }

  const changes = visibleCitizens.filter(
    (unit) => draftFor(unit).trim() !== (unit.nickname?.trim() ?? ''),
  )
  const allWritten = visibleCitizens.every((unit) => written[unit.id]?.length)

  function queue(units: FortUnit[]) {
    mutation.mutate(
      units.slice(0, MAX_QUEUE).map((unit) => {
        const nickname = draftFor(unit)
        return { unitId: unit.id, nickname, ...originOf(unit, nickname) }
      }),
      { onSuccess: () => void ideasQuery.refetch() },
    )
  }

  function fillFirstIdeas() {
    setDrafts((current) => {
      const next = { ...current }
      for (const unit of visibleCitizens) {
        const first = ideasFor(unit)[0]
        if (first) next[unit.id] = { idea: first.nickname }
      }
      return next
    })
  }

  /** Brings a dwarf's row into view, clearing filters that hide it. */
  function show(unitId: number) {
    const unit = citizens.find((u) => u.id === unitId)
    if (!unit) return
    setSearch('')
    if (unit.nickname?.trim()) setUnnamedOnly(false)
    setFlash(unitId)
    requestAnimationFrame(() => {
      const row = document.getElementById(`dwarf-${unitId}`)
      row?.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'center',
      })
      row?.querySelector('input')?.focus({ preventScroll: true })
    })
  }

  /** Names already on screen for anyone outside `ids`, so the model does not hand them out twice. */
  function namesOutside(ids: number[]): string[] {
    const inside = new Set(ids)
    return citizens.flatMap((unit) =>
      inside.has(unit.id) ? [] : [plainDraftFor(unit), ideasFor(unit)[0]?.nickname ?? ''],
    )
  }

  async function write(targets: FortUnit[], fresh: boolean) {
    const ids = targets.map((unit) => unit.id)
    const single = ids.length === 1
    const batches: number[][] = []
    for (let i = 0; i < ids.length; i += WRITE_BATCH_SIZE) {
      batches.push(ids.slice(i, i + WRITE_BATCH_SIZE))
    }
    if (single) setAsking((current) => new Set(current).add(ids[0]))
    else setWriting({ done: 0, total: ids.length })
    let next = 0
    const run = async () => {
      while (next < batches.length) {
        const batch = batches[next++]
        const shown = fresh
          ? targets
              .filter((unit) => batch.includes(unit.id))
              .flatMap((unit) => ideasFor(unit).map((idea) => idea.nickname))
          : []
        const avoid = [...namesOutside(batch), ...shown].filter(Boolean)
        const result = await writeNicknames({ data: { unitIds: batch, avoid, fresh } })
        setWritten((current) => {
          const updated = { ...current }
          for (const dwarf of result.dwarves) {
            if (dwarf.ideas.length) updated[dwarf.unitId] = dwarf.ideas
          }
          return updated
        })
        if (!single) setWriting((w) => (w ? { ...w, done: w.done + batch.length } : w))
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(PARALLEL_WRITES, batches.length) }, run))
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      if (single)
        setAsking((current) => {
          const updated = new Set(current)
          updated.delete(ids[0])
          return updated
        })
      else setWriting(null)
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            Nickname dwarves
            <Badge variant="outline" className="text-sm font-normal">
              Proof of concept
            </Badge>
          </span>
        }
        description="Names worth shouting across the dining hall, each pinned on something only that dwarf has eaten, lost, loved, botched or survived. The worker applies queued names to the running game through DFHack on its next poll."
        updatedAt={data?.capturedAt}
        isFetching={isFetching || ideasQuery.isFetching}
        onRefresh={() => {
          refetch()
          ideasQuery.refetch()
        }}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {writer?.enabled ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => write(visibleCitizens, allWritten)}
                disabled={writing !== null || visibleCitizens.length === 0}
                title={`Have ${writer.model} write three names for each dwarf shown`}
              >
                {writing ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <SparklesIcon className="size-4" />
                )}
                {writing
                  ? `Writing ${writing.done}/${writing.total}`
                  : allWritten
                    ? 'Write again'
                    : 'Write with AI'}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              onClick={fillFirstIdeas}
              disabled={!isLive || visibleCitizens.length === 0}
              title="Put each dwarf's first idea in their box, over current nicknames too. Nothing reaches the game until you queue it."
            >
              <WandSparklesIcon className="size-4" />
              Use first ideas
            </Button>
            <Button
              size="sm"
              onClick={() => queue(changes)}
              disabled={!isLive || changes.length === 0 || mutation.isPending}
            >
              {mutation.isPending ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <SendIcon className="size-4" />
              )}
              Queue {Math.min(changes.length, MAX_QUEUE)}
            </Button>
          </div>
        }
      />
      <StatusBanner state={overview.data?.state} />

      {ideasQuery.data ? (
        <NameList
          list={list}
          calledBy={calledBy}
          onChanged={() => void ideasQuery.refetch()}
          onShow={show}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Living citizens</CardTitle>
          <CardDescription className="max-w-3xl">
            Each idea rests on something real: a favourite food that is somebody's brain, a missing
            toe, a parent's nickname, a job they are hopeless at, a mishap from the chronicle. Pick
            one, edit it or type your own; an empty box clears the nickname.{' '}
            {writer?.enabled
              ? `${writer.model} can write more from the same facts.`
              : 'Set LEGENDS_NARRATOR_PROVIDER and LEGENDS_NARRATOR_API_KEY to have a language model write them too.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <div className="relative w-full max-w-md">
              <SearchIcon className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search citizens"
                aria-label="Search citizens"
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="nickname-unnamed"
                checked={unnamedOnly}
                onCheckedChange={setUnnamedOnly}
              />
              <Label htmlFor="nickname-unnamed" className="font-normal">
                No nickname yet
                <span className="text-muted-foreground tabular-nums">({withoutNickname})</span>
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="nickname-alliterate"
                checked={alliterative}
                onCheckedChange={setAlliterative}
              />
              <Label htmlFor="nickname-alliterate" className="font-normal">
                Alliterate
                <span className="text-muted-foreground">(Bad Bargain → Bob the Bad Bargain)</span>
              </Label>
            </div>
          </div>

          {visibleCitizens.length === 0 ? (
            <EmptyState
              title={
                citizens.length === 0
                  ? 'No living citizens found'
                  : unnamedOnly && !query
                    ? 'Everyone has a nickname'
                    : 'No matches'
              }
            >
              {citizens.length === 0
                ? 'Wait for the worker to capture a loaded fortress.'
                : unnamedOnly && !query
                  ? 'Turn off "No nickname yet" to rename someone.'
                  : 'Try a different search.'}
            </EmptyState>
          ) : (
            <div className="divide-y rounded-lg border">
              {visibleCitizens.map((unit) => {
                const dossier = dossiers.get(unit.id)
                return (
                  <NicknameRow
                    key={unit.id}
                    unit={unit}
                    draft={draftFor(unit)}
                    ideas={ideasFor(unit).map((idea) => ({
                      ...idea,
                      label: present(unit, idea.nickname),
                    }))}
                    name={dossier?.name ?? null}
                    facts={dossier?.facts ?? []}
                    remembered={dossier?.remembered ?? null}
                    flash={flash === unit.id}
                    loadingIdeas={ideasQuery.isPending}
                    disabled={!isLive || mutation.isPending}
                    canAsk={Boolean(writer?.enabled)}
                    asking={asking.has(unit.id)}
                    onType={(typed) =>
                      setDrafts((current) => ({ ...current, [unit.id]: { typed } }))
                    }
                    onPick={(idea) => setDrafts((current) => ({ ...current, [unit.id]: { idea } }))}
                    onQueue={() => queue([unit])}
                    onAsk={() => write([unit], true)}
                  />
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

const SOURCE_LABEL: Record<NicknameIdea['source'], string> = {
  facts: 'From their story',
  model: 'Written by the AI',
  list: 'From your list',
}

function SourceIcon({ source }: { source: NicknameIdea['source'] }) {
  if (source === 'model') return <SparklesIcon className="size-3" aria-hidden />
  if (source === 'list') return <BookmarkIcon className="size-3" aria-hidden />
  return null
}

/** How the game prints it: `Nickname' Surname, then the surname in plain words. */
function InGame({ nickname, name }: { nickname: string; name: DwarfName | null }) {
  const text = nickname.trim()
  if (!text || !name?.surname) return null
  const meaning = name.meaning && name.meaning !== name.surname ? name.meaning : null
  return (
    <p className="text-sm text-muted-foreground">
      In the game:{' '}
      <span className="font-medium text-foreground">
        `{text}' {name.surname}
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
  onQueue,
  onAsk,
}: {
  unit: FortUnit
  draft: string
  /** `label` is the idea as it would go into the game. */
  ideas: (NicknameIdea & { label: string })[]
  name: DwarfName | null
  facts: DossierFact[]
  remembered: RememberedNickname | null
  flash: boolean
  loadingIdeas: boolean
  disabled: boolean
  canAsk: boolean
  asking: boolean
  onType: (value: string) => void
  onPick: (nickname: string) => void
  onQueue: () => void
  onAsk: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const chosen = ideas.find((idea) => idea.label.toLowerCase() === draft.trim().toLowerCase())
  return (
    <form
      id={`dwarf-${unit.id}`}
      className={cn(
        'grid scroll-mt-24 gap-3 p-3 transition-colors duration-700 md:grid-cols-[minmax(220px,1fr)_minmax(260px,440px)_auto] md:items-start',
        flash && 'bg-primary/10',
      )}
      onSubmit={(event) => {
        event.preventDefault()
        onQueue()
      }}
    >
      <div className="flex min-w-0 items-start gap-3 md:pt-1">
        <CreatureSprite unit={unit} size={36} className="shrink-0" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{unit.readable}</span>
            {unit.nickname ? <Badge variant="secondary">{unit.nickname}</Badge> : null}
          </div>
          <div className="truncate text-sm text-muted-foreground">
            {unit.profession} · unit {unit.id}
          </div>
          {remembered?.why ? (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground" title={remembered.why}>
              {remembered.source === 'list' ? remembered.why : `Named for: ${remembered.why}`}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <Input
          aria-label={`Nickname for ${unit.readable}`}
          maxLength={MAX_NICKNAME_LENGTH}
          value={draft}
          placeholder="Type a nickname"
          onChange={(event) => onType(event.target.value)}
          disabled={disabled}
        />
        <InGame nickname={draft} name={name} />
        {ideas.length ? (
          <div className="flex flex-wrap gap-1.5">
            {ideas.map((idea) => {
              const active = idea === chosen
              return (
                <button
                  key={idea.nickname}
                  type="button"
                  onClick={() => onPick(idea.nickname)}
                  disabled={disabled}
                  title={`${SOURCE_LABEL[idea.source]}. ${idea.why}`}
                  aria-pressed={active}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50',
                    idea.source === 'list' && !active && 'border-dashed',
                    active && 'border-primary bg-primary/10 text-primary',
                  )}
                >
                  <SourceIcon source={idea.source} />
                  {idea.label}
                </button>
              )
            })}
          </div>
        ) : loadingIdeas ? (
          <p className="text-sm text-muted-foreground">Digging through their story…</p>
        ) : null}
        {chosen?.why ? <p className="text-sm text-muted-foreground">{chosen.why}</p> : null}
        {facts.length ? (
          <div>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
            >
              What sets them apart
              <ChevronDownIcon
                className={cn('size-3.5 transition-transform', open && 'rotate-180')}
              />
            </button>
            {open ? (
              <ul className="mt-1.5 flex flex-col gap-1 text-sm">
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

      <div className="flex items-center gap-2">
        {canAsk ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9"
            onClick={onAsk}
            disabled={asking}
            title="Have the model write three new names for this dwarf"
            aria-label={`Write new names for ${unit.readable}`}
          >
            {asking ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <SparklesIcon className="size-4" />
            )}
          </Button>
        ) : null}
        <Button type="submit" variant="outline" disabled={disabled}>
          Queue
        </Button>
      </div>
    </form>
  )
}
