import type { FortUnit } from '@fortress/db-drizzle/fortress-types'
import { Badge, Button } from '@fortress/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Loader2Icon, SendIcon, SparklesIcon, WandSparklesIcon } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { useFortOverview } from '~/lib/fortress/client/queries'
import { alliterate, alliterateAll, alliterationKey } from '~/lib/fortress/nicknames/alliteration'
import { getFortUnits } from '~/lib/fortress/server/units'
import { PageHeader, StatusBanner } from '../fortress/-components/FortChrome'
import { Citizens } from './-components/Citizens'
import { NameList } from './-components/NameList'
import { NamePicker } from './-components/NamePicker'
import {
  MAX_NICKNAME_LENGTH,
  type NicknameAssignment,
  type NicknameIdea,
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
type Draft = { typed: string } | { idea: string; listed?: boolean }

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
  const [picking, setPicking] = React.useState<number | null>(null)

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
    if (idea) return { why: idea.why, source: idea.source }
    const draft = drafts[unit.id]
    if (draft && 'listed' in draft && present(unit, draft.idea).toLowerCase() === key) {
      return { why: 'From your list.', source: 'list' }
    }
    return { why: null, source: 'typed' }
  }

  const changes = visibleCitizens.filter(
    (unit) => draftFor(unit).trim() !== (unit.nickname?.trim() ?? ''),
  )
  const allWritten = visibleCitizens.every((unit) => written[unit.id]?.length)

  const citizenById = React.useMemo(() => new Map(citizens.map((u) => [u.id, u])), [citizens])
  /** Every name on the list that has a dwarf to go to, with the name as it would go into the game. */
  const fromList = list.flatMap((entry) => {
    if (entry.state !== 'fits' && entry.state !== 'wildcard') return []
    const unit = entry.unitId !== null ? citizenById.get(entry.unitId) : undefined
    if (!unit) return []
    const nickname = present(unit, entry.name)
    return nickname === (unit.nickname?.trim() ?? '') ? [] : [{ unit, name: entry.name, nickname }]
  })

  function applyList() {
    const placed = fromList.slice(0, MAX_QUEUE)
    mutation.mutate(
      placed.map(({ unit, name, nickname }): NicknameAssignment => {
        const key = name.toLowerCase()
        const idea = dossiers
          .get(unit.id)
          ?.ideas.find((i) => i.source === 'list' && i.nickname.toLowerCase() === key)
        return { unitId: unit.id, nickname, why: idea?.why ?? 'From your list.', source: 'list' }
      }),
      {
        onSuccess: () => {
          setDrafts((current) => {
            const next = { ...current }
            for (const { unit, name } of placed) next[unit.id] = { idea: name, listed: true }
            return next
          })
          void ideasQuery.refetch()
        },
      },
    )
  }

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
        title={<span className="flex flex-wrap items-center gap-3">Nickname dwarves</span>}
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

      <NamePicker
        target={
          picking !== null ? { unitId: picking, called: calledBy.get(picking) ?? 'them' } : null
        }
        list={list}
        calledBy={calledBy}
        onPick={(unitId, name) =>
          setDrafts((current) => ({ ...current, [unitId]: { idea: name, listed: true } }))
        }
        onClose={() => setPicking(null)}
      />

      <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
        {ideasQuery.data ? (
          <div className="xl:sticky xl:top-6 xl:order-last xl:h-[calc(100svh-3rem)]">
            <NameList
              className="h-full"
              list={list}
              calledBy={calledBy}
              onChanged={() => void ideasQuery.refetch()}
              onShow={show}
              apply={{
                count: Math.min(fromList.length, MAX_QUEUE),
                replacing: fromList.filter(({ unit }) => unit.nickname?.trim()).length,
                pending: mutation.isPending,
                disabled: !isLive,
                onApply: applyList,
              }}
            />
          </div>
        ) : null}
        <Citizens
          rows={visibleCitizens.map((unit) => {
            const dossier = dossiers.get(unit.id)
            return {
              unit,
              draft: draftFor(unit),
              ideas: ideasFor(unit).map((idea) => ({
                ...idea,
                label: present(unit, idea.nickname),
              })),
              name: dossier?.name ?? null,
              facts: dossier?.facts ?? [],
              remembered: dossier?.remembered ?? null,
              flash: flash === unit.id,
              asking: asking.has(unit.id),
            }
          })}
          total={citizens.length}
          withoutNickname={withoutNickname}
          writer={writer}
          search={search}
          onSearch={setSearch}
          unnamedOnly={unnamedOnly}
          onUnnamedOnly={setUnnamedOnly}
          alliterative={alliterative}
          onAlliterative={setAlliterative}
          loadingIdeas={ideasQuery.isPending}
          disabled={!isLive || mutation.isPending}
          onType={(unitId, typed) => setDrafts((current) => ({ ...current, [unitId]: { typed } }))}
          onPick={(unitId, idea) => setDrafts((current) => ({ ...current, [unitId]: { idea } }))}
          onBrowse={list.length ? setPicking : null}
          onQueue={(unit) => queue([unit])}
          onAsk={(unit) => write([unit], true)}
        />
      </div>
    </div>
  )
}
