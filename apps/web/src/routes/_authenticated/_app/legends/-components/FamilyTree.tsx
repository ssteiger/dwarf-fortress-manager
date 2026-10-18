import { Button, cn } from '@fortress/ui'
import { useQuery } from '@tanstack/react-query'
import { HouseIcon } from 'lucide-react'
import * as React from 'react'

import { titleCase } from '~/lib/legends/model'
import { type Prose, displayName } from '~/lib/legends/prose'
import type { AncestorEntry, FamilyTree as Family, FamilyMember } from '~/lib/legends/server/family'
import { getAncestorLine } from '~/lib/legends/server/tellings'
import { useFortressContext } from './FortressTie'
import { Fragments, RecordLink } from './LegendsChrome'

/** How a descendant names an ancestor: "grandmother", "great-great-grandfather". */
export function ancestorLabel(generation: number, relation: 'mother' | 'father'): string {
  if (generation <= 1) return relation
  if (generation === 2) return `grand${relation}`
  if (generation <= 4) return `${'great-'.repeat(generation - 2)}grand${relation}`
  return `${relation === 'mother' ? 'ancestress' : 'ancestor'}, ${generation} generations back`
}

function generationLabel(generation: number): string {
  if (generation === 1) return 'Parents'
  if (generation === 2) return 'Grandparents'
  if (generation <= 4) return `${titleCase('great-'.repeat(generation - 2))}grandparents`
  return `${generation} generations back`
}

/** "born 120", "120–188", "before history", "deity". */
function lifeSpan(m: FamilyMember): string {
  if (m.deity) return 'deity'
  if (m.birth === null) return m.death !== null ? `died ${m.death}` : ''
  if (m.birth < 0)
    return m.death !== null ? `older than history, died ${m.death}` : 'older than history'
  return m.death !== null ? `${m.birth}–${m.death}` : `born ${m.birth}`
}

const Person = ({
  member,
  note,
  worldId,
  self = false,
}: {
  member: FamilyMember
  note?: string
  worldId: number
  self?: boolean
}) => {
  const fort = useFortressContext(worldId)
  const ours = fort.dwellerFor(member.id) !== null
  const detail = [note, member.race, lifeSpan(member)].filter(Boolean).join(' · ')
  const name = member.name ? displayName(member.name) : `Figure #${member.id}`
  return (
    <div
      className={cn(
        'flex min-w-40 max-w-64 flex-col gap-0.5 rounded-md border px-2.5 py-1.5',
        self && 'bg-muted/60',
        ours && 'border-primary/40',
      )}
    >
      {self ? (
        <span className="font-medium">{name}</span>
      ) : (
        <RecordLink kind="historical_figure" id={member.id} worldId={worldId}>
          {name}
        </RecordLink>
      )}
      {detail ? <span className="text-sm text-muted-foreground">{detail}</span> : null}
      {ours && !self ? (
        <span className="inline-flex items-center gap-1 text-sm text-primary">
          <HouseIcon className="size-3.5" />
          lives in your fortress
        </span>
      ) : null}
    </div>
  )
}

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid gap-2 sm:grid-cols-[9rem_1fr] sm:gap-4">
    <div className="pt-1.5 text-sm text-muted-foreground">{label}</div>
    <div className="flex flex-wrap gap-2">{children}</div>
  </div>
)

const relationNote: Record<string, string> = {
  spouse: 'spouse',
  'former spouse': 'former spouse',
  'late spouse': 'late spouse',
  lover: 'lover',
  'former lover': 'former lover',
}

/**
 * The figure among their kin: grandparents, parents, the figure with partners,
 * siblings and children, and on request every older generation the record keeps.
 */
export const FamilyTree = ({
  family,
  self,
  worldId,
}: {
  family: Family
  self: FamilyMember
  worldId: number
}) => {
  const [older, setOlder] = React.useState(false)
  const line = useQuery({
    queryKey: ['legends', 'ancestors', worldId, self.id],
    queryFn: () => getAncestorLine({ data: { worldId, id: self.id } }),
    enabled: family.parents.length > 0,
    staleTime: 10 * 60_000,
  })
  const deeper = (line.data?.generations ?? []).slice(2)
  const parentName = new Map(
    family.parents.map((p) => [p.id, p.relation === 'mother' ? "Mother's side" : "Father's side"]),
  )
  const grandSides = [...new Set(family.grandparents.map((g) => g.of))]

  return (
    <div className="flex flex-col gap-4">
      {line.data && (line.data.oldest || line.data.famous.length) ? (
        <AncestorSummary
          oldest={line.data.oldest}
          oldestLine={line.data.oldestLine}
          famous={line.data.famous}
          depth={line.data.generations.length}
          worldId={worldId}
        />
      ) : null}

      {older && deeper.length
        ? [...deeper].reverse().map((generation) => (
            <Row key={generation[0].generation} label={generationLabel(generation[0].generation)}>
              {generation.map((a) => (
                <Person
                  key={`${a.id}-${a.child}`}
                  member={a}
                  note={ancestorLabel(a.generation, a.relation)}
                  worldId={worldId}
                />
              ))}
            </Row>
          ))
        : null}

      {family.grandparents.length ? (
        <Row label="Grandparents">
          {grandSides.map((side) => (
            <React.Fragment key={side}>
              {family.grandparents
                .filter((g) => g.of === side)
                .map((g) => (
                  <Person
                    key={`${g.id}-${g.of}`}
                    member={g}
                    note={`${grandSides.length > 1 ? `${parentName.get(side) ?? ''}, ` : ''}grand${g.relation}`}
                    worldId={worldId}
                  />
                ))}
            </React.Fragment>
          ))}
        </Row>
      ) : null}

      {family.parents.length ? (
        <Row label="Parents">
          {family.parents.map((p) => (
            <Person key={p.id} member={p} note={p.relation} worldId={worldId} />
          ))}
        </Row>
      ) : null}

      <Row label={family.partners.length ? 'With partners' : 'This figure'}>
        <Person member={self} worldId={worldId} self />
        {family.partners.map((p) => (
          <Person
            key={p.id}
            member={p}
            note={relationNote[p.relation] ?? p.relation}
            worldId={worldId}
          />
        ))}
      </Row>

      {family.siblings.length ? (
        <Row label="Siblings">
          {family.siblings.map((s) => (
            <Person key={s.id} member={s} worldId={worldId} />
          ))}
        </Row>
      ) : null}

      {family.children.length ? (
        <Row label="Children">
          {family.children.map((c) => (
            <Person key={c.id} member={c} worldId={worldId} />
          ))}
        </Row>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {deeper.length ? (
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0"
            onClick={() => setOlder((v) => !v)}
          >
            {older
              ? 'Hide the older generations'
              : `Show ${deeper.length} older generation${deeper.length === 1 ? '' : 's'}`}
          </Button>
        ) : line.isLoading && family.parents.length ? (
          <span>Tracing the line further back…</span>
        ) : null}
        {family.unrecorded ? (
          <span>
            {family.unrecorded} more relative{family.unrecorded === 1 ? ' is' : 's are'} mentioned
            but not recorded in this export.
          </span>
        ) : null}
      </div>
    </div>
  )
}

/** The furthest-back ancestor and the famous ones, a line each. */
export const AncestorSummary = ({
  oldest,
  oldestLine,
  famous,
  depth,
  worldId,
}: {
  oldest: AncestorEntry | null
  oldestLine: Prose | null
  famous: { ancestor: AncestorEntry; line: Prose }[]
  depth: number
  worldId: number
}) => {
  const name = (a: AncestorEntry) => (a.name ? displayName(a.name) : `Figure #${a.id}`)
  return (
    <div className="flex max-w-[70ch] flex-col gap-2 text-base leading-relaxed">
      {oldest ? (
        <p>
          The record traces this line back {depth} generation{depth === 1 ? '' : 's'}, to{' '}
          <RecordLink kind="historical_figure" id={oldest.id} worldId={worldId}>
            {name(oldest)}
          </RecordLink>
          , their {ancestorLabel(oldest.generation, oldest.relation)}.
          {oldestLine?.length ? (
            <>
              {' '}
              <Fragments fragments={oldestLine} worldId={worldId} />
            </>
          ) : null}
        </p>
      ) : null}
      {famous.filter((f) => f.ancestor.id !== oldest?.id).length ? (
        <ul className="flex flex-col gap-1.5">
          {famous
            .filter((f) => f.ancestor.id !== oldest?.id)
            .map(({ ancestor, line }) => (
              <li key={ancestor.id}>
                <RecordLink kind="historical_figure" id={ancestor.id} worldId={worldId}>
                  {name(ancestor)}
                </RecordLink>
                <span className="text-muted-foreground">
                  , their {ancestorLabel(ancestor.generation, ancestor.relation)}.
                </span>
                {line.length ? (
                  <>
                    {' '}
                    <Fragments fragments={line} worldId={worldId} />
                  </>
                ) : null}
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  )
}
