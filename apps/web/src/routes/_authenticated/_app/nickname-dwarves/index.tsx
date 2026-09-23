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
} from '@fortress/ui'
import { useMutation, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Loader2Icon, SearchIcon, SparklesIcon } from 'lucide-react'
import * as React from 'react'
import { toast } from 'sonner'

import { CreatureSprite } from '~/lib/df-assets/components'
import { FORT_REFRESH_MS, useFortOverview } from '~/lib/fortress/queries'
import { getFortUnits } from '~/lib/fortress/server'
import { EmptyState, PageHeader, StatusBanner } from '../fortress/-components/FortChrome'
import { MAX_NICKNAME_LENGTH, type NicknameAssignment, queueDwarfNicknames } from './-server'
import { livingCitizens, suggestedNickname } from './-utils'

export const Route = createFileRoute('/_authenticated/_app/nickname-dwarves/')({
  component: RouteComponent,
})

function RouteComponent() {
  const overview = useFortOverview()
  const { data, isFetching, refetch } = useQuery({
    queryKey: ['fort', 'units'],
    queryFn: () => getFortUnits(),
    refetchInterval: FORT_REFRESH_MS * 2,
  })
  const [search, setSearch] = React.useState('')
  const [drafts, setDrafts] = React.useState<Record<number, string>>({})

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

  const citizens = React.useMemo(() => livingCitizens(data?.units ?? []), [data?.units])
  const query = search.trim().toLowerCase()
  const visibleCitizens = React.useMemo(
    () =>
      query
        ? citizens.filter((unit) =>
            [unit.readable, unit.name, unit.name_english, unit.nickname, unit.profession]
              .filter(Boolean)
              .some((value) => value?.toLowerCase().includes(query)),
          )
        : citizens,
    [citizens, query],
  )
  const unnamed = citizens.filter((unit) => !unit.nickname?.trim())
  const isLive = overview.data?.state?.status === 'live'

  function draftFor(unit: FortUnit): string {
    return drafts[unit.id] ?? unit.nickname ?? suggestedNickname(unit)
  }

  function submit(unit: FortUnit) {
    mutation.mutate([{ unitId: unit.id, nickname: draftFor(unit) }])
  }

  function nicknameUnnamed() {
    mutation.mutate(
      unnamed.slice(0, 250).map((unit) => ({
        unitId: unit.id,
        nickname: drafts[unit.id] ?? suggestedNickname(unit),
      })),
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 lg:p-6">
      <PageHeader
        eyebrow="Proof of concept"
        title="Nickname dwarves"
        description="Queue player nicknames for living citizens. The worker safely applies them to the running game through DFHack on its next poll."
        updatedAt={data?.capturedAt}
        isFetching={isFetching}
        onRefresh={() => refetch()}
        actions={
          <Button
            size="sm"
            onClick={nicknameUnnamed}
            disabled={!isLive || unnamed.length === 0 || mutation.isPending}
          >
            {mutation.isPending ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <SparklesIcon className="size-4" />
            )}
            Auto-nickname {Math.min(unnamed.length, 250)}
          </Button>
        }
      />
      <StatusBanner state={overview.data?.state} />

      <Card>
        <CardHeader>
          <CardTitle>Living citizens</CardTitle>
          <CardDescription>
            Suggestions are stable for each unit. Edit any value before queuing it; an empty
            nickname clears the current one.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative max-w-md">
            <SearchIcon className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search citizens"
              className="pl-9"
            />
          </div>

          {visibleCitizens.length === 0 ? (
            <EmptyState title={citizens.length === 0 ? 'No living citizens found' : 'No matches'}>
              {citizens.length === 0
                ? 'Wait for the worker to capture a loaded fortress.'
                : 'Try a different search.'}
            </EmptyState>
          ) : (
            <div className="divide-y rounded-lg border">
              {visibleCitizens.map((unit) => (
                <form
                  key={unit.id}
                  className="grid gap-3 p-3 md:grid-cols-[minmax(220px,1fr)_minmax(180px,280px)_auto] md:items-center"
                  onSubmit={(event) => {
                    event.preventDefault()
                    submit(unit)
                  }}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <CreatureSprite unit={unit} size={36} className="shrink-0" />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{unit.readable}</span>
                        {unit.nickname ? <Badge variant="secondary">{unit.nickname}</Badge> : null}
                      </div>
                      <div className="truncate text-sm text-muted-foreground">
                        {unit.profession} · unit {unit.id}
                      </div>
                    </div>
                  </div>
                  <Input
                    aria-label={`Nickname for ${unit.readable}`}
                    maxLength={MAX_NICKNAME_LENGTH}
                    value={draftFor(unit)}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [unit.id]: event.target.value,
                      }))
                    }
                    disabled={!isLive || mutation.isPending}
                  />
                  <Button type="submit" variant="outline" disabled={!isLive || mutation.isPending}>
                    Queue
                  </Button>
                </form>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
