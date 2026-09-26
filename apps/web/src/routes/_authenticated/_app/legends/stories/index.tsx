import { Button } from '@fortress/ui'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { DicesIcon } from 'lucide-react'
import * as React from 'react'

import type { Stories, Story, StoryGroup } from '~/lib/legends/chronicle'
import { LegendsShell, Section, parseWorldSearch } from '../-components/LegendsChrome'
import { StoryCard, leadRef, useStories } from '../-components/Stories'

function StoriesPage() {
  const { world } = Route.useSearch()
  return (
    <LegendsShell section="stories" world={world}>
      {({ worldId }) => <StoriesBody worldId={worldId} />}
    </LegendsShell>
  )
}

function StoriesBody({ worldId }: { worldId: number }) {
  const navigate = useNavigate()
  const stories = useStories(worldId)
  const [surprise, setSurprise] = React.useState<Story | null>(null)

  const all = React.useMemo(
    () => (stories.data?.groups ?? []).flatMap((g) => g.stories.filter((s) => leadRef(s))),
    [stories.data],
  )
  const rollTheDice = () => {
    if (!all.length) return
    // Weight by score so the great stories come up more often, never only.
    const weights = all.map((s) => 1 + Math.log1p(Math.max(0, s.score)))
    let pick = Math.random() * weights.reduce((a, b) => a + b, 0)
    let chosen = all[all.length - 1]
    for (let i = 0; i < all.length; i++) {
      pick -= weights[i]
      if (pick <= 0) {
        chosen = all[i]
        break
      }
    }
    setSurprise(chosen)
  }

  if (!stories.data) {
    return (
      <p className="text-sm text-muted-foreground">
        {stories.isLoading ? 'Sifting the chronicles for stories…' : 'No stories yet.'}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Stories worth reading"
        description="What stands out in the records: the bloodiest battles, the deadliest beasts, the lives most written about, and the strange ends. Jump to a group, or click a name to follow the thread."
        action={
          <Button variant="outline" size="sm" className="gap-2" onClick={rollTheDice}>
            <DicesIcon className="size-4" />
            Surprise me
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
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
          {surprise ? (
            <StoryCard
              story={surprise}
              names={stories.data.names}
              worldId={worldId}
              featured
              onOpen={() => {
                const ref = leadRef(surprise)
                if (ref)
                  navigate({
                    to: '/legends/$kind/$id',
                    params: { kind: ref.kind, id: String(ref.id) },
                    search: { world: worldId },
                  })
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Or roll the dice for a story picked from the whole record, weighted towards the great
              ones.
            </p>
          )}
        </div>
      </Section>

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

const GROUP_PREVIEW = 5

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
        {group.stories.length > shown.length ? (
          <Button variant="link" size="sm" className="mt-2 px-0" onClick={() => setAll(true)}>
            Show all {group.stories.length}
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
