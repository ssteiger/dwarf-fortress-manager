import type { FortDiplomacy } from '@fortress/db-drizzle'
import { checkConsoleCommand } from '@fortress/db-drizzle/fortress-types'
import { Badge, cn } from '@fortress/ui'
import { Link } from '@tanstack/react-router'
import { BookOpenIcon } from 'lucide-react'

import { ConsoleCommandCard } from '~/lib/assistant/ConsoleCommandCard'
import { STANCE_CLASSES, type Stance, entityName, powerById } from '~/lib/fortress/diplomacy'

export interface DiplomacyCommand {
  command: string
  what: string
  /** Changes the world in a way the game would not on its own. */
  cheat?: boolean
}

/** A DFHack command with what it does; cheats say so before anything else. */
export function CommandItem({ command, what, cheat }: DiplomacyCommand) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm">
        {cheat ? (
          <Badge
            variant="outline"
            className="mr-2 border-amber-500/50 align-middle font-normal text-amber-900 dark:text-amber-200"
          >
            Cheat
          </Badge>
        ) : null}
        {what}
      </p>
      <ConsoleCommandCard command={command} problem={checkConsoleCommand(command)} />
    </div>
  )
}

export type OpenPower = (id: number) => void

export function StanceBadge({ stance, className }: { stance: Stance; className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn('shrink-0 font-normal', STANCE_CLASSES[stance.tone], className)}
      title={stance.detail}
    >
      {stance.label}
    </Badge>
  )
}

/** A group's name: opens its power when the page lists it, plain text otherwise. */
export function EntityName({
  d,
  id,
  onOpen,
  className,
}: {
  d: FortDiplomacy
  id: number | null | undefined
  onOpen: OpenPower
  className?: string
}) {
  const name = entityName(d, id)
  const powerId =
    id === null || id === undefined
      ? null
      : powerById(d, id)
        ? id
        : (d.entities[String(id)]?.power_id ?? null)
  if (powerId === null || !powerById(d, powerId)) return <span className={className}>{name}</span>
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation()
        onOpen(powerId)
      }}
      className={cn(
        'font-medium underline decoration-muted-foreground/40 underline-offset-4 hover:decoration-foreground',
        className,
      )}
    >
      {name}
    </button>
  )
}

/** The record in the legends export, when the export is of this world. */
export function LegendsLink({
  worldId,
  kind,
  id,
  label = 'Legends',
}: {
  worldId: number | null
  kind: 'entity' | 'site' | 'historical_event_collection' | 'historical_figure'
  id: number
  label?: string
}) {
  if (worldId === null) return null
  return (
    <Link
      to="/legends/$kind/$id"
      params={{ kind, id: String(id) }}
      search={{ world: worldId }}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      title="Open in legends"
    >
      <BookOpenIcon className="size-3.5" />
      {label}
    </Link>
  )
}

/** Small uppercase heading inside a card or the drawer. */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-medium text-muted-foreground">{children}</h3>
}
