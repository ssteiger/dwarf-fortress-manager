import { Badge, Button, Skeleton, cn } from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { DicesIcon } from 'lucide-react'
import * as React from 'react'

import { LegendsSprite } from '~/lib/df-assets/legends'
import { kindLabel, titleCase } from '~/lib/legends/model'
import { plainText } from '~/lib/legends/prose'
import { type Stories, type Story, getStories } from '~/lib/legends/server/chronicle'
import { getStory } from '~/lib/legends/server/tellings'
import { PinButton } from './Journal'
import { EventLine, RecordLink, Section, Telling } from './LegendsChrome'
import { NarrateButton } from './Narrator'

export function useStories(worldId: number) {
  return useQuery({
    queryKey: ['legends', 'stories', worldId],
    queryFn: () => getStories({ data: { worldId } }),
    staleTime: 30 * 60_000,
  })
}

export function useToldStory(worldId: number, key: string | null) {
  return useQuery({
    queryKey: ['legends', 'story', worldId, key],
    queryFn: () => getStory({ data: { worldId, key: key ?? '' } }),
    enabled: key !== null,
    staleTime: 30 * 60_000,
  })
}

/** Groups whose stories open well on their own, in the order "Another" walks them. */
const FEATURED_GROUPS = [
  'battles',
  'slayers',
  'lives',
  'fallen',
  'artifacts',
  'contested',
  'hearts',
  'cursed',
]

/**
 * Stories to feature, one group after another so "Another" changes the kind
 * of story each time. Stories that name `civId` come first.
 */
export function featuredStories(stories: Stories | undefined, civId?: number | null): Story[] {
  if (!stories) return []
  const queues = FEATURED_GROUPS.map(
    (key) => stories.groups.find((g) => g.key === key)?.stories.slice(0, 4) ?? [],
  )
  const out: Story[] = []
  for (let round = 0; queues.some((q) => q.length > round); round++)
    for (const queue of queues) if (queue[round]) out.push(queue[round])
  if (civId === null || civId === undefined) return out
  const ours = (s: Story) => s.refs.some((r) => r.kind === 'entity' && r.id === civId)
  return [...out.filter(ours), ...out.filter((s) => !ours(s))]
}

/** Characters below which the opening paragraph runs on into the next. */
const OPENING_MIN = 160

/** The opening of one told story, with the way into the rest. */
export function FeaturedStory({
  worldId,
  candidates,
  title = 'A story from the record',
  start = 'first',
  action,
}: {
  worldId: number
  candidates: Story[]
  title?: string
  /** Open on the first candidate, or on one picked at random once they load. */
  start?: 'first' | 'random'
  action?: React.ReactNode
}) {
  const [at, setAt] = React.useState<number | null>(start === 'first' ? 0 : null)
  React.useEffect(() => {
    if (at === null && candidates.length) setAt(Math.floor(Math.random() * candidates.length))
  }, [at, candidates.length])
  const pick = candidates.length && at !== null ? candidates[at % candidates.length] : null
  const told = useToldStory(worldId, pick?.key ?? null)
  if (!pick) return null
  const paragraphs = told.data?.paragraphs ?? []
  // A bare birth line is no way into a story; carry on into the next paragraph.
  const opening = paragraphs.slice(
    0,
    paragraphs[0] && plainText(paragraphs[0]).length < OPENING_MIN ? 2 : 1,
  )
  return (
    <Section
      title={title}
      action={
        <div className="flex items-center gap-2">
          {candidates.length > 1 ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setAt((i) => (i ?? 0) + 1)}
            >
              <DicesIcon className="size-4" />
              Another
            </Button>
          ) : null}
          {action}
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div>
          <Link
            {...storyLink(pick, worldId)}
            className="text-lg font-medium text-primary underline-offset-4 hover:underline"
          >
            {pick.title}
          </Link>
          <p className="text-sm text-muted-foreground">
            {[told.data?.group.title, pick.year !== null ? `from ${pick.year}` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {told.isLoading ? (
          <div className="max-w-[70ch] space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ) : opening.length ? (
          <Telling paragraphs={opening} worldId={worldId} />
        ) : (
          <p className="max-w-[70ch] text-base">{pick.blurb}</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" asChild>
            <Link {...storyLink(pick, worldId)}>Read the story</Link>
          </Button>
          <PinButton
            worldId={worldId}
            target={{ kind: 'story', id: pick.key, title: pick.title }}
            size="sm"
            label="Pin"
          />
        </div>
      </div>
    </Section>
  )
}

/** A story's primary record, for links and the surprise button. */
export function leadRef(story: Story) {
  return story.refs[0] ?? null
}

/** Link props for a story's own page. */
export function storyLink(story: Pick<Story, 'key'>, worldId: number) {
  return {
    to: '/legends/stories/$key' as const,
    params: { key: story.key },
    search: { world: worldId },
  }
}

export function StoryCard({
  story,
  names,
  worldId,
  featured = false,
  actions,
}: {
  story: Story
  names: Stories['names']
  worldId: number
  featured?: boolean
  actions?: React.ReactNode
}) {
  const lead = leadRef(story)
  const refs = story.refs
    .filter((ref) => !ref.name || titleCase(ref.name) !== story.title)
    .slice(0, 5)
  const sprite =
    lead?.race && (lead.kind === 'historical_figure' || lead.kind === 'entity')
      ? { kind: lead.kind, id: lead.id, race: lead.race }
      : null
  const pin = (
    <PinButton
      worldId={worldId}
      target={{ kind: 'story', id: story.key, title: story.title }}
      size={featured ? 'sm' : 'icon'}
      label={featured ? 'Pin' : undefined}
    />
  )
  const narrate = (
    <NarrateButton
      worldId={worldId}
      subject={{ kind: 'story', key: story.key }}
      title={story.title}
      size={featured ? 'sm' : 'icon'}
      className={featured ? undefined : 'size-7 text-muted-foreground'}
    />
  )
  return (
    <div className={cn('flex gap-3', featured && 'rounded-lg border bg-muted/30 p-4')}>
      {sprite ? (
        <LegendsSprite subject={sprite} size={featured ? 48 : 32} className="mt-0.5 shrink-0" />
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Link
            {...storyLink(story, worldId)}
            className={cn(
              'font-medium text-primary underline-offset-4 hover:underline',
              featured && 'text-lg',
            )}
          >
            {story.title}
          </Link>
          {story.year !== null ? (
            <span className="text-sm text-muted-foreground tabular-nums">{story.year}</span>
          ) : null}
          {lead ? (
            <Badge variant="outline" className="font-normal">
              {kindLabel(lead.kind)}
            </Badge>
          ) : null}
          {featured ? null : (
            <span className="-my-1 ml-auto flex items-center self-center">
              {narrate}
              {pin}
            </span>
          )}
        </div>
        <p className={cn('mt-1 text-muted-foreground', featured ? 'text-base' : 'text-sm')}>
          {story.blurb}
        </p>
        {refs.length ? (
          <div className="mt-1 flex flex-wrap gap-x-3 text-sm">
            {refs.map((ref) => (
              <RecordLink
                key={`${ref.kind}-${ref.id}`}
                kind={ref.kind}
                id={ref.id}
                name={ref.name}
                worldId={worldId}
                className="font-normal"
              >
                {ref.name ? titleCase(ref.name) : `${kindLabel(ref.kind)} #${ref.id}`}
              </RecordLink>
            ))}
          </div>
        ) : null}
        {story.events?.length ? (
          <ol className="mt-2 divide-y text-sm">
            {story.events.slice(0, 3).map((event) => (
              <EventLine key={event.id} event={event} names={names} worldId={worldId} />
            ))}
          </ol>
        ) : null}
        {featured || actions ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {featured ? (
              <>
                <Button size="sm" variant="secondary" asChild>
                  <Link {...storyLink(story, worldId)}>Read the story</Link>
                </Button>
                {pin}
                {narrate}
              </>
            ) : null}
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  )
}
