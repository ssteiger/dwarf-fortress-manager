import { Badge, Button, Skeleton } from '@fortress/ui'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import * as React from 'react'

import { LegendsSprite } from '~/lib/df-assets/legends'
import { kindLabel, titleCase } from '~/lib/legends/model'
import type { StoryRef } from '~/lib/legends/server/chronicle'
import { PinButton } from '../-components/Journal'
import {
  Breadcrumbs,
  EventLine,
  LegendsShell,
  RecordLink,
  Section,
  Telling,
  parseWorldSearch,
} from '../-components/LegendsChrome'
import { NarrateButton } from '../-components/Narrator'
import { useStories, useToldStory } from '../-components/Stories'
import { EmptyState } from '../../fortress/-components/FortChrome'

function StoryPage() {
  const { key } = Route.useParams()
  const { world } = Route.useSearch()
  return (
    <LegendsShell section="stories" world={world}>
      {({ worldId }) => <StoryBody worldId={worldId} storyKey={key} />}
    </LegendsShell>
  )
}

/** Events shown before "Show all". */
const RECORD_PREVIEW = 20

function StoryBody({ worldId, storyKey }: { worldId: number; storyKey: string }) {
  const story = useToldStory(worldId, storyKey)
  const stories = useStories(worldId)
  const [allEvents, setAllEvents] = React.useState(false)

  const next = React.useMemo(() => {
    const group = stories.data?.groups.find((g) => g.stories.some((s) => s.key === storyKey))
    if (!group || group.stories.length < 2) return null
    const at = group.stories.findIndex((s) => s.key === storyKey)
    return { group, story: group.stories[(at + 1) % group.stories.length] }
  }, [stories.data, storyKey])

  if (story.isLoading)
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-80" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-72 lg:col-span-2" />
          <Skeleton className="h-72" />
        </div>
      </div>
    )
  const told = story.data
  if (!told)
    return (
      <EmptyState title="That story is not in this world's record">
        The stories are drawn afresh when legends are imported, so this one may have moved on.{' '}
        <Link to="/legends/stories" search={{ world: worldId }} className="text-primary underline">
          See the stories there are now
        </Link>
        .
      </EmptyState>
    )

  const shown = allEvents ? told.events : told.events.slice(0, RECORD_PREVIEW)
  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs
        items={[
          { label: 'Stories', to: '/legends/stories', search: { world: worldId } },
          { label: told.group.title },
          { label: told.title },
        ]}
      />
      <header className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1 basis-64">
          <h2 className="text-2xl font-medium">{told.title}</h2>
          <p className="mt-1 text-base text-muted-foreground">
            {told.group.title}
            {told.year !== null ? ` · from ${told.year}` : null}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <NarrateButton
            worldId={worldId}
            subject={{ kind: 'story', key: told.key }}
            title={told.title}
            label="Tell it another way"
          />
          <PinButton
            worldId={worldId}
            target={{ kind: 'story', id: told.key, title: told.title }}
            size="sm"
            label="Pin to journal"
          />
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <Section title="The story">
            <Telling paragraphs={told.paragraphs} worldId={worldId} />
          </Section>
          {told.events.length ? (
            <Section
              title="The record behind it"
              count={told.eventTotal}
              description="The events the telling stands on, in the order they happened."
            >
              <ol className="divide-y text-sm">
                {shown.map((event) => (
                  <EventLine key={event.id} event={event} names={told.names} worldId={worldId} />
                ))}
              </ol>
              {told.events.length > shown.length ? (
                <Button
                  variant="link"
                  size="sm"
                  className="mt-2 px-0"
                  onClick={() => setAllEvents(true)}
                >
                  Show all {told.events.length}
                </Button>
              ) : null}
              {told.eventTotal > told.events.length ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  These are the first {told.events.length} of {told.eventTotal.toLocaleString()}.
                  The rest are on the pages of the people and places named here.
                </p>
              ) : null}
            </Section>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          {told.cast.length ? (
            <Section title="Who and where">
              <CastList cast={told.cast} worldId={worldId} />
            </Section>
          ) : null}
          {next ? (
            <Section title={`More from ${next.group.title.toLowerCase()}`}>
              <Link
                to="/legends/stories/$key"
                params={{ key: next.story.key }}
                search={{ world: worldId }}
                className="group flex items-start gap-2 text-sm"
              >
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-primary group-hover:underline">
                    {next.story.title}
                  </span>
                  <span className="mt-0.5 block text-muted-foreground">{next.story.blurb}</span>
                </span>
                <ArrowRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              </Link>
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function CastList({ cast, worldId }: { cast: StoryRef[]; worldId: number }) {
  return (
    <ul className="divide-y">
      {cast.map((ref) => (
        <li key={`${ref.kind}-${ref.id}`} className="flex items-center gap-3 py-2">
          <LegendsSprite
            subject={{ kind: ref.kind, id: ref.id, race: ref.race ?? null }}
            size={24}
            className="-my-1 shrink-0"
          />
          <RecordLink kind={ref.kind} id={ref.id} name={ref.name} worldId={worldId}>
            {ref.name ? titleCase(ref.name) : `An unnamed ${kindLabel(ref.kind).toLowerCase()}`}
          </RecordLink>
          <Badge variant="outline" className="ml-auto font-normal">
            {kindLabel(ref.kind)}
          </Badge>
        </li>
      ))}
    </ul>
  )
}

export const Route = createFileRoute('/_authenticated/_app/legends/stories/$key')({
  validateSearch: parseWorldSearch,
  component: StoryPage,
})
