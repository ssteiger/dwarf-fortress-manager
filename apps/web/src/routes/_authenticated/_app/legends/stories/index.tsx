import { Button } from '@fortress/ui'
import { createFileRoute } from '@tanstack/react-router'
import * as React from 'react'

import type { Stories, StoryGroup } from '~/lib/legends/chronicle'
import { LegendsShell, Section, parseWorldSearch } from '../-components/LegendsChrome'
import { FeaturedStory, StoryCard, featuredStories, useStories } from '../-components/Stories'

function StoriesPage() {
  const { world } = Route.useSearch()
  return (
    <LegendsShell section="stories" world={world}>
      {({ worldId, live, matchesLive }) => (
        <StoriesBody worldId={worldId} civId={matchesLive ? (live?.civId ?? null) : null} />
      )}
    </LegendsShell>
  )
}

function StoriesBody({ worldId, civId }: { worldId: number; civId: number | null }) {
  const stories = useStories(worldId)
  const featured = React.useMemo(() => featuredStories(stories.data, civId), [stories.data, civId])

  if (!stories.data) {
    return (
      <p className="text-sm text-muted-foreground">
        {stories.isLoading ? 'Sifting the chronicles for stories…' : 'No stories yet.'}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <FeaturedStory worldId={worldId} candidates={featured} />

      <nav aria-label="Story groups" className="flex flex-wrap gap-2">
        {stories.data.groups.map((group) => (
          <a
            key={group.key}
            href={`#stories-${group.key}`}
            className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors hover:bg-accent"
          >
            {group.title}
            <span className="tabular-nums text-muted-foreground">{group.stories.length}</span>
          </a>
        ))}
      </nav>

      <div className="gap-4 lg:columns-2">
        {stories.data.groups.map((group) => (
          <StoryGroupSection
            key={group.key}
            group={group}
            names={stories.data.names}
            worldId={worldId}
          />
        ))}
      </div>
    </div>
  )
}

const GROUP_PREVIEW = 3

function StoryGroupSection({
  group,
  names,
  worldId,
}: {
  group: StoryGroup
  names: Stories['names']
  worldId: number
}) {
  const [all, setAll] = React.useState(false)
  const shown = all ? group.stories : group.stories.slice(0, GROUP_PREVIEW)
  return (
    <div id={`stories-${group.key}`} className="mb-4 scroll-mt-4 break-inside-avoid">
      <Section title={group.title} description={group.description} count={group.stories.length}>
        <ul className="flex flex-col divide-y">
          {shown.map((story) => (
            <li key={story.key} className="py-3 first:pt-0 last:pb-0">
              <StoryCard story={story} names={names} worldId={worldId} />
            </li>
          ))}
        </ul>
        {group.stories.length > GROUP_PREVIEW ? (
          <Button variant="link" size="sm" className="mt-2 px-0" onClick={() => setAll((v) => !v)}>
            {all ? 'Show fewer' : `Show all ${group.stories.length}`}
          </Button>
        ) : null}
      </Section>
    </div>
  )
}

export const Route = createFileRoute('/_authenticated/_app/legends/stories/')({
  validateSearch: parseWorldSearch,
  component: StoriesPage,
})
