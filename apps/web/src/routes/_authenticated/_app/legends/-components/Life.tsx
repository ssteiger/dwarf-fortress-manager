import { Skeleton } from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import type * as React from 'react'

import { getLifeStory } from '~/lib/legends/tellings'

import { Section, Telling } from './LegendsChrome'
import { NarrateButton } from './Narrator'

/** A figure's life told from the record, ahead of the lists it is built from. */
export function TheirLife({
  worldId,
  id,
  title,
  before,
}: {
  worldId: number
  id: number
  title: string
  /** Shown above the telling, e.g. the figure's tie to your fortress. */
  before?: React.ReactNode
}) {
  const life = useQuery({
    queryKey: ['legends', 'life', worldId, id],
    queryFn: () => getLifeStory({ data: { worldId, id } }),
    staleTime: 10 * 60_000,
  })
  const paragraphs = life.data?.paragraphs ?? []
  if (!life.isLoading && !paragraphs.length && !before) return null
  return (
    <Section
      title="Their life"
      action={
        <NarrateButton
          worldId={worldId}
          subject={{ kind: 'record', recordKind: 'historical_figure', id }}
          title={title}
          label="Tell it another way"
        />
      }
    >
      {before}
      {life.isLoading ? (
        <div className="max-w-[70ch] space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="mt-4 h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : life.isError ? (
        <p className="text-sm text-muted-foreground">
          The life could not be told just now. The lists below hold the same record.
        </p>
      ) : (
        <Telling paragraphs={paragraphs} worldId={worldId} />
      )}
    </Section>
  )
}
