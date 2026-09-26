import { cn } from '@fortress/ui'
import { Link } from '@tanstack/react-router'
import { formatDistanceToNow } from 'date-fns'
import { FootprintsIcon } from 'lucide-react'
import type * as React from 'react'

import { LegendsSprite } from '~/lib/df-assets/legends'
import { kindLabel } from '~/lib/legends/model'
import { type TrailEntry, clearTrail, useTrail } from '~/lib/legends/trail'

function TrailLink({
  entry,
  worldId,
  className,
  children,
}: {
  entry: TrailEntry
  worldId: number
  className?: string
  children: React.ReactNode
}) {
  return (
    <Link
      to="/legends/$kind/$id"
      params={{ kind: entry.kind, id: String(entry.id) }}
      search={{ world: worldId }}
      className={className}
    >
      {children}
    </Link>
  )
}

/** A row of the records opened before this one, for hopping back along a thread. */
export function TrailBar({
  worldId,
  current,
}: {
  worldId: number
  current: { kind: string; id: number }
}) {
  const trail = useTrail(worldId).filter((e) => !(e.kind === current.kind && e.id === current.id))
  if (!trail.length) return null
  return (
    <nav
      aria-label="Recently opened"
      className="-mt-3 flex min-w-0 items-center gap-2 text-sm text-muted-foreground"
    >
      <FootprintsIcon className="size-3.5 shrink-0" aria-hidden />
      <span className="shrink-0">Your trail</span>
      <div className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
        {trail.slice(0, 8).map((entry) => (
          <TrailLink
            key={`${entry.kind}-${entry.id}`}
            entry={entry}
            worldId={worldId}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-foreground transition-colors hover:bg-accent"
          >
            {entry.sprite ? <LegendsSprite subject={entry.sprite} size={16} /> : null}
            <span className="max-w-[12rem] truncate">{entry.title}</span>
          </TrailLink>
        ))}
      </div>
    </nav>
  )
}

/** The trail as a list, for the overview page. */
export function TrailList({
  worldId,
  limit = 8,
  className,
}: {
  worldId: number
  limit?: number
  className?: string
}) {
  const trail = useTrail(worldId)
  if (!trail.length) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        Records you open will be listed here, so you can pick a thread back up.
      </p>
    )
  }
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <ul className="divide-y">
        {trail.slice(0, limit).map((entry) => (
          <li key={`${entry.kind}-${entry.id}`} className="flex items-center gap-3 py-2">
            {entry.sprite ? (
              <LegendsSprite subject={entry.sprite} size={28} className="-my-1 shrink-0" />
            ) : (
              <span className="size-7 shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <TrailLink
                entry={entry}
                worldId={worldId}
                className="block truncate font-medium text-primary underline-offset-4 hover:underline"
              >
                {entry.title}
              </TrailLink>
              <div className="truncate text-sm text-muted-foreground">
                {entry.detail || kindLabel(entry.kind)}
              </div>
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatDistanceToNow(entry.at, { addSuffix: true })}
            </span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="self-start text-xs text-muted-foreground hover:text-foreground hover:underline"
        onClick={() => clearTrail(worldId)}
      >
        Clear the trail
      </button>
    </div>
  )
}
