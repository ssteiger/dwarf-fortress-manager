import type { DiplomacyRelation, FortPower } from '@fortress/db-drizzle'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from '@fortress/ui'
import { NetworkIcon } from 'lucide-react'
import * as React from 'react'

import {
  isWarRelation,
  peopleOf,
  powerName,
  relationBetween,
  relationWord,
} from '~/lib/fortress/diplomacy'
import type { OpenPower } from './shared'

const GRID_SIZE = 10
const WARS_SHOWN = 6

const CELL: Record<DiplomacyRelation, string> = {
  TotalWar: 'bg-red-600',
  Skirmishing: 'bg-red-400',
  Peace: 'bg-sky-500/60',
  AcceptingTribute: 'bg-amber-500',
  OfferingTribute: 'bg-amber-500',
  NoContact: '',
}

const LEGEND: { relation: DiplomacyRelation; label: string }[] = [
  { relation: 'TotalWar', label: 'At war' },
  { relation: 'Skirmishing', label: 'Skirmishing' },
  { relation: 'AcceptingTribute', label: 'Tribute' },
  { relation: 'Peace', label: 'At peace' },
]

/** How the nearest powers stand with each other, as either side records it. */
export function RelationsGrid({ powers, onOpen }: { powers: FortPower[]; onOpen: OpenPower }) {
  const [allWars, setAllWars] = React.useState(false)
  const shown = powers.filter((p) => p.own || p.site_count > 0).slice(0, GRID_SIZE)
  const wars: [FortPower, FortPower][] = []
  for (let i = 0; i < powers.length; i++)
    for (let j = i + 1; j < powers.length; j++)
      if (isWarRelation(relationBetween(powers[i], powers[j]))) wars.push([powers[i], powers[j]])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <NetworkIcon className="size-4 text-primary" />
          Between your neighbours
        </CardTitle>
        <CardDescription>
          How the {shown.length} nearest stand with each other. A war next door can spill onto your
          map when armies march past.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr>
                <th />
                {shown.map((p, i) => (
                  <th
                    key={p.id}
                    className="w-7 pb-1 text-center text-xs font-normal text-muted-foreground tabular-nums"
                    title={powerName(p)}
                  >
                    {i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((a, i) => (
                <tr key={a.id}>
                  <th className="max-w-[16rem] py-0.5 pr-3 text-left font-normal">
                    <button
                      type="button"
                      onClick={() => onOpen(a.id)}
                      className="flex min-w-0 items-baseline gap-1.5 hover:underline"
                    >
                      <span className="text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                      <span className="truncate">{powerName(a)}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{peopleOf(a)}</span>
                    </button>
                  </th>
                  {shown.map((b, j) => {
                    const relation = i === j ? null : relationBetween(a, b)
                    return (
                      <td key={b.id} className="p-0.5 text-center">
                        {i === j ? (
                          <span className="mx-auto block size-5 rounded-sm bg-muted" />
                        ) : (
                          <span
                            title={`${powerName(a)} and ${powerName(b)}: ${relationWord(relation)}`}
                            className={cn(
                              'mx-auto block size-5 rounded-sm border',
                              relation ? CELL[relation] : '',
                              relation && relation !== 'NoContact' && 'border-transparent',
                            )}
                          />
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {LEGEND.map((entry) => (
            <li key={entry.relation} className="flex items-center gap-1.5">
              <span className={cn('size-3 rounded-sm', CELL[entry.relation])} />
              {entry.label}
            </li>
          ))}
          <li className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm border" />
            No contact
          </li>
        </ul>
        {wars.length ? (
          <div className="flex flex-col gap-1.5 border-t pt-3 text-sm">
            <p className="text-muted-foreground">At war with each other:</p>
            <ul className="flex flex-col gap-1">
              {(allWars ? wars : wars.slice(0, WARS_SHOWN)).map(([a, b]) => (
                <li key={`${a.id}-${b.id}`}>
                  <button type="button" className="hover:underline" onClick={() => onOpen(a.id)}>
                    {powerName(a)}
                  </button>{' '}
                  <span className="text-muted-foreground">({peopleOf(a)})</span> and{' '}
                  <button type="button" className="hover:underline" onClick={() => onOpen(b.id)}>
                    {powerName(b)}
                  </button>{' '}
                  <span className="text-muted-foreground">({peopleOf(b)})</span>
                </li>
              ))}
            </ul>
            {wars.length > WARS_SHOWN ? (
              <button
                type="button"
                className="self-start text-muted-foreground hover:text-foreground hover:underline"
                onClick={() => setAllWars(!allWars)}
              >
                {allWars ? 'Fewer' : `All ${wars.length} pairs at war`}
              </button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
