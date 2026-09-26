import type { FortUnit } from '@fortress/db-drizzle'
import { Badge, cn } from '@fortress/ui'
import * as React from 'react'

import { type PeopleGroup, type Relation, relations } from '~/lib/fortress/character'
import { humanize, splitPascal } from '~/lib/fortress/format'
import { Muted, PersonName, Section, SheetMissing, TONE_TEXT, capitalize } from './SheetParts'

const GROUPS: { key: PeopleGroup; title: string; empty: string; description?: string }[] = [
  { key: 'family', title: 'Family and bonds', empty: 'No family or bonds the game knows of.' },
  {
    key: 'friends',
    title: 'Friends',
    empty: 'No friends yet.',
    description: 'Friends, close friends and kindred spirits, as the game counts them.',
  },
  { key: 'foes', title: 'Grudges and dislikes', empty: 'Nobody they hold anything against.' },
  {
    key: 'acquaintances',
    title: 'Acquaintances',
    empty: 'Nobody else they know by sight.',
    description: 'People they have met without forming much of an opinion.',
  },
]

const SHOWN = 8

export function PeopleTab({
  unit,
  units,
  compact,
}: {
  unit: FortUnit
  units: Map<number, FortUnit>
  compact?: boolean
}) {
  const sheet = unit.sheet && !unit.sheet.error ? unit.sheet : null
  if (!sheet) return <SheetMissing what="Family, friends, grudges and the groups they belong to" />
  const rels = relations(sheet)
  const byGroup = new Map<PeopleGroup, Relation[]>()
  for (const r of rels) byGroup.set(r.group, [...(byGroup.get(r.group) ?? []), r])
  const memberships = sheet.groups.filter(([, , link]) => link !== 'POSITION')
  return (
    <div className={cn('grid gap-4', compact ? 'grid-cols-1' : 'lg:grid-cols-2')}>
      {GROUPS.map((group) => (
        <PeopleSection
          key={group.key}
          title={group.title}
          description={group.description}
          empty={group.empty}
          list={byGroup.get(group.key) ?? []}
          units={units}
          race={unit.race}
        />
      ))}
      <Section title="Belongs to" count={memberships.length}>
        {memberships.length ? (
          <ul className="flex flex-col gap-1.5 text-sm">
            {memberships.map(([name, type, link]) => (
              <li key={`${name}-${link}`} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{name}</span>
                <span className="text-muted-foreground">
                  {splitPascal(type).toLowerCase()}
                  {link !== 'MEMBER' ? ` · ${humanize(link).toLowerCase()}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <Muted>No civilization, faith or guild on record.</Muted>
        )}
      </Section>
    </div>
  )
}

function PeopleSection({
  title,
  description,
  empty,
  list,
  units,
  race,
}: {
  title: string
  description?: string
  empty: string
  list: Relation[]
  units: Map<number, FortUnit>
  race: string
}) {
  const [all, setAll] = React.useState(false)
  const shown = all ? list : list.slice(0, SHOWN)
  return (
    <Section
      title={title}
      count={list.length}
      description={description}
      action={
        list.length > SHOWN ? (
          <button
            type="button"
            className="text-primary underline-offset-4 hover:underline"
            onClick={() => setAll((v) => !v)}
          >
            {all ? 'Fewer' : `All ${list.length}`}
          </button>
        ) : null
      }
    >
      {list.length ? (
        <ul className="flex flex-col gap-2">
          {shown.map((r) => (
            <PersonRow
              key={`${r.person.kind}-${r.person.hf}`}
              relation={r}
              units={units}
              race={race}
            />
          ))}
        </ul>
      ) : (
        <Muted>{empty}</Muted>
      )}
    </Section>
  )
}

function PersonRow({
  relation,
  units,
  race,
}: {
  relation: Relation
  units: Map<number, FortUnit>
  race: string
}) {
  const { person, label, detail, tone } = relation
  const known = person.kind === 'known'
  const feelings = known
    ? [
        ['love', person.love],
        ['trust', person.trust],
        ['respect', person.respect],
        ['loyalty', person.loyalty],
        ['fear', person.fear],
      ]
        .filter(([, v]) => typeof v === 'number' && v !== 0)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')
    : ''
  return (
    <li
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-sm"
      title={feelings ? `How they feel: ${feelings}` : undefined}
    >
      <PersonName person={person} units={units} className={cn(!person.alive && 'opacity-60')} />
      <span className="flex flex-wrap items-center gap-1.5">
        <span className={TONE_TEXT[tone]}>{label}</span>
        {detail ? <span className="text-muted-foreground">· {detail}</span> : null}
        {person.race && person.race !== race ? (
          <Badge variant="outline" className="px-1.5 py-0 text-xs font-normal">
            {person.race}
          </Badge>
        ) : null}
        {!person.alive ? (
          <Badge variant="outline" className="px-1.5 py-0 text-xs font-normal">
            dead
          </Badge>
        ) : person.unit === null || !units.has(person.unit) ? (
          <span className="text-xs text-muted-foreground" title="Not on the map right now">
            away
          </span>
        ) : null}
        {known && person.met ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            {capitalize(`met ${person.met}×`)}
          </span>
        ) : null}
      </span>
    </li>
  )
}
