import { Badge, Button, cn } from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import type * as React from 'react'

import { LegendsSprite } from '~/lib/df-assets/legends'
import { type Stories, type Story, getStories } from '~/lib/legends/chronicle'
import { kindLabel, titleCase } from '~/lib/legends/model'
import { PinButton } from './Journal'
import { EventLine, RecordLink } from './LegendsChrome'
import { NarrateButton } from './Narrator'

export function useStories(worldId: number) {
  return useQuery({
    queryKey: ['legends', 'stories', worldId],
    queryFn: () => getStories({ data: { worldId } }),
    staleTime: 30 * 60_000,
  })
}

/** A story's primary record, for links and the surprise button. */
export function leadRef(story: Story) {
  return story.refs[0] ?? null
}

export function StoryCard({
  story,
  names,
  worldId,
  featured = false,
  onOpen,
  actions,
}: {
  story: Story
  names: Stories['names']
  worldId: number
  featured?: boolean
  onOpen?: () => void
  actions?: React.ReactNode
}) {
  const lead = leadRef(story)
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
          {lead ? (
            <RecordLink
              kind={lead.kind}
              id={lead.id}
              name={lead.name}
              worldId={worldId}
              className={featured ? 'text-lg' : undefined}
            >
              {story.title}
            </RecordLink>
          ) : (
            <span className={cn('font-medium', featured && 'text-lg')}>{story.title}</span>
          )}
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
        <p
          className={cn(
            'mt-1 leading-relaxed text-muted-foreground',
            featured ? 'text-base' : 'text-sm',
          )}
        >
          {story.blurb}
        </p>
        {story.refs.length > 1 ? (
          <div className="mt-1 flex flex-wrap gap-x-3 text-sm">
            {story.refs.slice(1, 6).map((ref) => (
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
            {story.events.map((event) => (
              <EventLine key={event.id} event={event} names={names} worldId={worldId} />
            ))}
          </ol>
        ) : null}
        {featured || onOpen || actions ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {onOpen ? (
              <Button size="sm" variant="secondary" onClick={onOpen}>
                Follow the thread
              </Button>
            ) : null}
            {featured ? (
              <>
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
