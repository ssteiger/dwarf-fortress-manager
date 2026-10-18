import type { FortUnit } from '@fortress/db-drizzle'
import { Skeleton } from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { HouseIcon } from 'lucide-react'
import * as React from 'react'

import { titleCase } from '~/lib/legends/model'
import { displayName } from '~/lib/legends/prose'
import type { DwarfKin } from '~/lib/legends/server/dwarf'
import { getDwarfInLegends } from '~/lib/legends/server/tellings'
import { AncestorSummary, ancestorLabel } from '../../../legends/-components/FamilyTree'
import { Fragments, RecordLink } from '../../../legends/-components/LegendsChrome'
import { Muted, Section } from './SheetParts'
import type { UnitLegendsRef } from './UnitLinks'

const SHOWN_KIN = 8

export function useDwarfInLegends(legends: UnitLegendsRef | null) {
  return useQuery({
    queryKey: ['legends', 'dwarf', legends?.worldId, legends?.figureId],
    queryFn: () =>
      legends
        ? getDwarfInLegends({ data: { worldId: legends.worldId, figureId: legends.figureId } })
        : null,
    enabled: legends !== null,
    staleTime: 10 * 60_000,
  })
}

/** One line for the opening text: the dwarf's most storied ancestor, when the record has one. */
export const FamousAncestorLine = ({
  legends,
  name,
}: {
  legends: UnitLegendsRef | null
  name: string
}) => {
  const story = useDwarfInLegends(legends)
  const famous = story.data?.famousAncestor
  if (!legends || !famous) return null
  const { ancestor, line } = famous
  return (
    <p className="text-sm text-muted-foreground">
      {name}’s {ancestorLabel(ancestor.generation, ancestor.relation)} was{' '}
      <RecordLink kind="historical_figure" id={ancestor.id} worldId={legends.worldId}>
        {ancestor.name ? displayName(ancestor.name) : 'a figure of note'}
      </RecordLink>
      . {line.length ? <Fragments fragments={line} worldId={legends.worldId} /> : null}
    </p>
  )
}

const KinRow = ({
  kin,
  worldId,
  dweller,
}: {
  kin: DwarfKin
  worldId: number
  dweller: FortUnit | undefined
}) => (
  <li className="flex flex-col gap-0.5">
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-muted-foreground">{titleCase(kin.relation)}</span>
      <RecordLink kind="historical_figure" id={kin.id} worldId={worldId}>
        {kin.name ? displayName(kin.name) : `Figure #${kin.id}`}
      </RecordLink>
      {dweller ? (
        <Link
          to="/fortress/citizens/$id"
          params={{ id: String(dweller.id) }}
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          <HouseIcon className="size-3.5" aria-hidden />
          lives in your fortress
        </Link>
      ) : kin.death !== null ? (
        <span className="text-muted-foreground">died {kin.death}</span>
      ) : null}
    </span>
    {kin.line?.length ? (
      <span className="text-muted-foreground">
        <Fragments fragments={kin.line} worldId={worldId} />
      </span>
    ) : null}
  </li>
)

/** The dwarf as the world's history records them: their line, kin, ancestors and civilization. */
export const WorldHistorySection = ({
  legends,
  units,
}: {
  legends: UnitLegendsRef | null
  units: Map<number, FortUnit>
}) => {
  const story = useDwarfInLegends(legends)
  const [allKin, setAllKin] = React.useState(false)
  const byFigure = React.useMemo(
    () => new Map([...units.values()].map((u) => [u.hist_figure_id, u])),
    [units],
  )
  if (!legends) return null
  const data = story.data
  const action = (
    <Link
      to="/legends/$kind/$id"
      params={{ kind: 'historical_figure', id: String(legends.figureId) }}
      search={{ world: legends.worldId }}
      className="text-primary underline-offset-4 hover:underline"
    >
      Their whole life
    </Link>
  )
  if (story.isPending)
    return (
      <Section title="From the world’s history">
        <Skeleton className="h-24 w-full" />
      </Section>
    )
  if (story.isError || !data)
    return (
      <Section title="From the world’s history" action={action}>
        <Muted>
          {story.isError
            ? 'The world’s history could not be read just now.'
            : 'The legends export has no record of them.'}
        </Muted>
      </Section>
    )
  const kin = allKin ? data.kin : data.kin.slice(0, SHOWN_KIN)
  const { ancestors } = data
  return (
    <Section title="From the world’s history" action={action}>
      <div className="flex flex-col gap-5 text-sm">
        {data.line.length ? (
          <p className="max-w-[70ch] text-base leading-relaxed">
            <Fragments fragments={data.line} worldId={legends.worldId} />
          </p>
        ) : null}

        {data.kin.length ? (
          <div className="flex flex-col gap-2">
            <h3 className="font-medium">Kin in the record</h3>
            <ul className="flex flex-col gap-2">
              {kin.map((k) => (
                <KinRow
                  key={`${k.relation}-${k.id}`}
                  kin={k}
                  worldId={legends.worldId}
                  dweller={byFigure.get(k.id)}
                />
              ))}
            </ul>
            {data.kin.length > SHOWN_KIN && !allKin ? (
              <button
                type="button"
                className="self-start text-muted-foreground hover:text-foreground hover:underline"
                onClick={() => setAllKin(true)}
              >
                Show {data.kin.length - SHOWN_KIN} more
              </button>
            ) : null}
          </div>
        ) : (
          <Muted>The record names none of their kin.</Muted>
        )}

        {ancestors.oldest || ancestors.famous.length ? (
          <div className="flex flex-col gap-2">
            <h3 className="font-medium">Their line</h3>
            <AncestorSummary
              oldest={ancestors.oldest}
              oldestLine={ancestors.oldestLine}
              famous={ancestors.famous}
              depth={ancestors.generations.length}
              worldId={legends.worldId}
            />
          </div>
        ) : null}

        {data.civ?.past.length ? (
          <div className="flex flex-col gap-2">
            <h3 className="font-medium">
              Their civilization,{' '}
              <RecordLink kind="entity" id={data.civ.id} worldId={legends.worldId}>
                {data.civ.name ? titleCase(data.civ.name) : 'unnamed'}
              </RecordLink>
            </h3>
            <p className="max-w-[70ch] leading-relaxed text-muted-foreground">
              <Fragments fragments={data.civ.past} worldId={legends.worldId} />
            </p>
          </div>
        ) : null}
      </div>
    </Section>
  )
}
