import type { FortDiplomacy } from '@fortress/db-drizzle'
import { checkConsoleCommand } from '@fortress/db-drizzle/fortress-types'
import { Badge, cn } from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { BookOpenIcon } from 'lucide-react'

import { ConsoleCommandCard } from '~/lib/assistant/ConsoleCommandCard'
import {
  STANCE_CLASSES,
  type Stance,
  entityName,
  powerById,
  warBehind,
  warSides,
  warSpan,
  warTally,
} from '~/lib/fortress/diplomacy'
import { titleCase } from '~/lib/legends/model'
import { getWarTelling } from '~/lib/legends/server/tellings'
import { Fragments } from '../../../legends/-components/LegendsChrome'

export interface DiplomacyCommand {
  command: string
  what: string
  /** Changes the world in a way the game would not on its own. */
  cheat?: boolean
}

/** A DFHack command with what it does; cheats say so before anything else. */
export const CommandItem = ({ command, what, cheat }: DiplomacyCommand) => {
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

export const StanceBadge = ({ stance, className }: { stance: Stance; className?: string }) => {
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
export const EntityName = ({
  d,
  id,
  onOpen,
  className,
}: {
  d: FortDiplomacy
  id: number | null | undefined
  onOpen: OpenPower
  className?: string
}) => {
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
export const LegendsLink = ({
  worldId,
  kind,
  id,
  label = 'Legends',
}: {
  worldId: number | null
  kind: 'entity' | 'site' | 'historical_event_collection' | 'historical_figure'
  id: number
  label?: string
}) => {
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

export function useWarTelling(worldId: number | null, warId: number | null) {
  return useQuery({
    queryKey: ['legends', 'war-telling', worldId, warId],
    queryFn: () => getWarTelling({ data: { worldId: worldId ?? -1, warId: warId ?? -1 } }),
    enabled: worldId !== null && warId !== null,
    staleTime: 10 * 60_000,
  })
}

/**
 * The war an invasion belongs to, matched by the invader's civilization id:
 * the legends' telling when the export is of this world, the game's own
 * tally otherwise. Nothing when no war of yours names them.
 */
export const WarBehind = ({
  d,
  civId,
  worldId,
  className,
}: {
  d: FortDiplomacy
  civId: number
  worldId: number | null
  className?: string
}) => {
  const war = warBehind(d, civId)
  const told = useWarTelling(worldId, war?.id ?? null)
  if (!war) return null
  return (
    <div className={cn('flex flex-col gap-1 text-sm', className)}>
      <p>
        <span className="text-muted-foreground">The war behind it: </span>
        {worldId !== null ? (
          <Link
            to="/legends/$kind/$id"
            params={{ kind: 'historical_event_collection', id: String(war.id) }}
            search={{ world: worldId }}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {war.name ? titleCase(war.name) : 'an unnamed war'}
          </Link>
        ) : (
          <span className="font-medium">{war.name ? titleCase(war.name) : 'an unnamed war'}</span>
        )}
        <span className="text-muted-foreground"> · {warSpan(war, d.year)}</span>
      </p>
      {told.data?.length ? (
        <p className="max-w-[70ch] leading-relaxed text-muted-foreground">
          <Fragments fragments={told.data} worldId={worldId} />
        </p>
      ) : (
        <p className="text-muted-foreground">
          {warSides(d, war)}. {warTally(war)}.
        </p>
      )}
    </div>
  )
}

/** Small uppercase heading inside a card or the drawer. */
export const SectionLabel = ({ children }: { children: React.ReactNode }) => {
  return <h3 className="text-sm font-medium text-muted-foreground">{children}</h3>
}
