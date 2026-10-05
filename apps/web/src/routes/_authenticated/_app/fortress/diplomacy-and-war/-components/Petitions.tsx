import type { FortAgreement, FortDiplomacy } from '@fortress/db-drizzle'
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, cn } from '@fortress/ui'
import { ScrollTextIcon } from 'lucide-react'
import * as React from 'react'

import { plural } from '~/lib/fortress/advice/phrasing'
import { humanize } from '~/lib/fortress/format'
import { EntityName, type OpenPower } from './shared'

const STATUS: Record<FortAgreement['status'], { label: string; className: string }> = {
  outstanding: {
    label: 'Agreed, not built yet',
    className: 'border-transparent bg-amber-500/20 text-amber-900 dark:text-amber-200',
  },
  satisfied: {
    label: 'Built',
    className: 'border-transparent bg-emerald-500/15 text-emerald-800 dark:text-emerald-200',
  },
  denied: { label: 'Turned down', className: 'text-muted-foreground' },
  expired: { label: 'Ran out', className: 'text-muted-foreground' },
}

const ORDER: FortAgreement['status'][] = ['outstanding', 'satisfied', 'expired', 'denied']

const OLDER_SHOWN = 4

/** "a guildhall for their craftsman guild", "a temple to Ama". */
function wish(a: FortAgreement): string {
  if (a.kind !== 'Location') return humanize(a.kind).toLowerCase()
  const place = (a.location ?? 'location').toLowerCase()
  if (a.deity) return `a ${place} to ${a.deity}`
  if (a.profession) return `a ${place} for their ${a.profession.toLowerCase()} guild`
  return `a ${place}`
}

interface PetitionRow {
  agreement: FortAgreement
  /** The same petition with the same answer, asked this many times in a row. */
  count: number
}

function collapse(agreements: FortAgreement[]): PetitionRow[] {
  const rows: PetitionRow[] = []
  for (const agreement of agreements) {
    const last = rows[rows.length - 1]
    if (
      last &&
      last.agreement.status === agreement.status &&
      wish(last.agreement) === wish(agreement) &&
      last.agreement.parties.join() === agreement.parties.join()
    )
      last.count++
    else rows.push({ agreement, count: 1 })
  }
  return rows
}

/** Temple and guildhall petitions, the agreed ones still to build first. */
export function Petitions({ d, onOpen }: { d: FortDiplomacy; onOpen: OpenPower }) {
  const [all, setAll] = React.useState(false)
  const sorted = [...d.agreements].sort(
    (a, b) =>
      ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || b.year - a.year || b.tick - a.tick,
  )
  const open = sorted.filter((a) => a.status === 'outstanding')
  const rest = collapse(sorted.filter((a) => a.status !== 'outstanding'))
  const shown: PetitionRow[] = [
    ...open.map((agreement) => ({ agreement, count: 1 })),
    ...(all ? rest : rest.slice(0, OLDER_SHOWN)),
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ScrollTextIcon className="size-4 text-primary" />
          Petitions
        </CardTitle>
        <CardDescription>
          {open.length
            ? `You agreed to ${plural(open.length, 'petition')} and have not built ${open.length === 1 ? 'it' : 'them'} yet. Zone the temple or guildhall at the size asked for; an agreement left too long runs out and upsets those who asked.`
            : 'Guilds and congregations ask for halls and temples once your fortress grows. Agreeing and building them keeps them content.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No petitions yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {shown.map(({ agreement: a, count }) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                <span className="text-muted-foreground tabular-nums">Year {a.year}</span>
                <span className="min-w-0 flex-1">
                  {a.parties.length ? (
                    a.parties.map((id, i) => (
                      <React.Fragment key={id}>
                        {i > 0 ? ' and ' : null}
                        <EntityName d={d} id={id} onOpen={onOpen} />
                      </React.Fragment>
                    ))
                  ) : (
                    <span>Someone</span>
                  )}{' '}
                  asked for {wish(a)}.
                </span>
                <Badge variant="outline" className={cn('font-normal', STATUS[a.status].className)}>
                  {count > 1 ? `${STATUS[a.status].label}, ${count} times` : STATUS[a.status].label}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {rest.length > OLDER_SHOWN ? (
          <button
            type="button"
            className="mt-3 text-sm text-muted-foreground hover:text-foreground hover:underline"
            onClick={() => setAll(!all)}
          >
            {all ? 'Fewer' : 'All older petitions'}
          </button>
        ) : null}
      </CardContent>
    </Card>
  )
}
