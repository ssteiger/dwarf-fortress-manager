import type { UnitSheet } from '@fortress/db-drizzle'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { HouseIcon } from 'lucide-react'
import * as React from 'react'

import { displayName } from '~/lib/legends/prose'
import { type FortressGod, getFortressGods } from '~/lib/legends/server/gods'
import { useFortressContext } from './FortressTie'
import { RecordLink, Section } from './LegendsChrome'

const SHOWN_GODS = 6
const SHOWN_WORSHIPPERS = 12

export function useFortressGods(worldId: number | null, figureIds: number[]) {
  const ids = React.useMemo(() => [...new Set(figureIds)].sort((a, b) => a - b), [figureIds])
  return useQuery({
    queryKey: ['legends', 'gods', worldId, ids.join(',')],
    queryFn: () => getFortressGods({ data: { worldId: worldId ?? -1, figureIds: ids } }),
    enabled: worldId !== null && ids.length > 0,
    staleTime: 10 * 60_000,
  })
}

/** The gods of everyone living in your fortress, when the worlds match. */
export function useOurGods(worldId: number | null) {
  const fort = useFortressContext(worldId)
  const ids = React.useMemo(
    () => (fort.tie.data?.living ?? []).map((d) => d.figureId),
    [fort.tie.data],
  )
  return { fort, gods: useFortressGods(fort.matchesLive ? worldId : null, ids) }
}

const sphereKey = (spheres: string[]) =>
  spheres
    .map((s) => s.toLowerCase().replace(/_/g, ' '))
    .sort()
    .join('|')

const firstWord = (name: string | null) =>
  (name ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .split(/\s+/)[0] ?? ''

/**
 * The legends record of each god on a dwarf's sheet, among the gods their own
 * legends figure is linked to. The dump names gods in their own tongue and the
 * export often in translation, so the match is by spheres, then by first name;
 * a god is linked only when exactly one of the figure's gods fits.
 */
export function matchDeities(
  deities: UnitSheet['deities'],
  gods: FortressGod[],
): Map<string, FortressGod> {
  const out = new Map<string, FortressGod>()
  const taken = new Set<number>()
  for (const [name, , spheres] of deities) {
    const free = gods.filter((g) => !taken.has(g.id))
    const bySpheres = spheres.length
      ? free.filter((g) => sphereKey(g.spheres) === sphereKey(spheres))
      : []
    const byName = (bySpheres.length > 1 ? bySpheres : free).filter(
      (g) => firstWord(g.name) !== '' && firstWord(g.name) === firstWord(name),
    )
    const match = bySpheres.length === 1 ? bySpheres[0] : byName.length === 1 ? byName[0] : null
    if (match) {
      out.set(name, match)
      taken.add(match.id)
    }
  }
  return out
}

export const godName = (g: FortressGod) => (g.name ? displayName(g.name) : `God #${g.id}`)

/** "Prayed to in your fortress": which of your people worship this god, and how strongly. */
export const PrayedToHere = ({ worldId, godId }: { worldId: number; godId: number }) => {
  const { fort, gods } = useOurGods(worldId)
  const [all, setAll] = React.useState(false)
  const god = gods.data?.find((g) => g.id === godId)
  if (!fort.matchesLive || !god) return null
  const names = fort.tie.data?.names.historical_figure ?? {}
  const shown = all ? god.worshippers : god.worshippers.slice(0, SHOWN_WORSHIPPERS)
  return (
    <Section
      title="Prayed to in your fortress"
      count={god.worshippers.length}
      description={
        god.worshippers.length === 1
          ? 'One of your people worships this god.'
          : 'Your people who worship this god, most devout first.'
      }
    >
      <ul className="flex flex-col gap-1 text-sm">
        {shown.map((w) => {
          const dweller = fort.dwellerFor(w.figureId)
          const name = names[w.figureId] ? displayName(names[w.figureId]) : `Figure #${w.figureId}`
          return (
            <li key={w.figureId} className="flex items-baseline justify-between gap-3">
              {dweller ? (
                <Link
                  to="/fortress/citizens/$id"
                  params={{ id: String(dweller.unitId) }}
                  className="inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline"
                >
                  <HouseIcon className="size-3.5" aria-hidden />
                  {name}
                </Link>
              ) : (
                <RecordLink kind="historical_figure" id={w.figureId} worldId={worldId}>
                  {name}
                </RecordLink>
              )}
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {w.strength !== null ? `devotion ${w.strength}` : ''}
              </span>
            </li>
          )
        })}
      </ul>
      {god.worshippers.length > SHOWN_WORSHIPPERS && !all ? (
        <button
          type="button"
          className="self-start text-sm text-muted-foreground hover:text-foreground hover:underline"
          onClick={() => setAll(true)}
        >
          Show {god.worshippers.length - SHOWN_WORSHIPPERS} more
        </button>
      ) : null}
    </Section>
  )
}

/** The gods of your fortress, most worshipped first, with their spheres. */
export const OurGods = ({ worldId }: { worldId: number }) => {
  const { fort, gods } = useOurGods(worldId)
  const list = gods.data ?? []
  if (!fort.matchesLive || !list.length) return null
  return (
    <div>
      <div className="mb-1.5 text-muted-foreground">The gods of your fortress</div>
      <ul className="flex flex-col gap-1.5">
        {list.slice(0, SHOWN_GODS).map((g) => (
          <li key={g.id} className="flex flex-wrap items-baseline gap-x-2">
            <RecordLink kind="historical_figure" id={g.id} worldId={worldId}>
              {godName(g)}
            </RecordLink>
            {g.spheres.length ? (
              <span className="text-muted-foreground">of {g.spheres.slice(0, 3).join(', ')}</span>
            ) : null}
            <span className="ml-auto text-muted-foreground tabular-nums">
              {g.worshippers.length === 1 ? '1 worshipper' : `${g.worshippers.length} worshippers`}
            </span>
          </li>
        ))}
      </ul>
      {list.length > SHOWN_GODS ? (
        <p className="mt-1.5 text-muted-foreground">
          And {list.length - SHOWN_GODS} more {list.length - SHOWN_GODS === 1 ? 'god' : 'gods'} with
          fewer followers.
        </p>
      ) : null}
    </div>
  )
}
