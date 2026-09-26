import type { FortUnit, UnitSheet } from '@fortress/db-drizzle'
import { Badge, cn } from '@fortress/ui'

import {
  SKILL_GROUP_ORDER,
  attributeLabel,
  attributeStanding,
  attributeTier,
  injuries,
  skillGroup,
  skillName,
  syndromeNames,
  wordsForWound,
  xpForNextLevel,
} from '~/lib/fortress/character'
import { SKILL_RANKS, humanize, skillRank, splitPascal } from '~/lib/fortress/format'
import { Meter, Muted, Section, SheetMissing, capitalize } from './SheetParts'

export function BodyTab({ unit, compact }: { unit: FortUnit; compact?: boolean }) {
  const sheet = unit.sheet && !unit.sheet.error ? unit.sheet : null
  return (
    <div className={cn('grid gap-4', compact ? 'grid-cols-1' : 'lg:grid-cols-2')}>
      <SkillsSection unit={unit} sheet={sheet} />
      {sheet?.attributes.length ? <AttributesSection unit={unit} sheet={sheet} /> : null}
      <HealthSection unit={unit} sheet={sheet} />
      {sheet ? <WorkSection unit={unit} sheet={sheet} /> : null}
      {!sheet ? (
        <div className={compact ? undefined : 'lg:col-span-2'}>
          <SheetMissing what="All skills with progress, attributes and injury details" />
        </div>
      ) : null}
    </div>
  )
}

function SkillsSection({ unit, sheet }: { unit: FortUnit; sheet: UnitSheet | null }) {
  if (!sheet) {
    return (
      <Section title="Skills" count={unit.skills.length}>
        {unit.skills.length ? (
          <ul className="flex flex-col gap-1.5 text-sm">
            {unit.skills.map(([skill, rating]) => (
              <li key={skill} className="flex items-baseline justify-between gap-3">
                <span>{skillName(skill, unit)}</span>
                <span className="text-muted-foreground tabular-nums">{skillRank(rating)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Muted>No skills recorded.</Muted>
        )}
      </Section>
    )
  }
  const groups = new Map<string, UnitSheet['skills']>()
  for (const skill of sheet.skills) {
    const group = skillGroup(skill[4])
    groups.set(group, [...(groups.get(group) ?? []), skill])
  }
  const off = sheet.skills.filter(([, rating, , , , on]) => on === false && rating >= 5).length
  return (
    <Section
      title="Skills"
      count={sheet.skills.length}
      description={
        off
          ? `${off} skill${off === 1 ? '' : 's'} they are good at but not allowed to use. The bar shows the way to the next level.`
          : 'The bar shows the way to the next level.'
      }
    >
      {sheet.skills.length ? (
        <div className="flex flex-col gap-4">
          {SKILL_GROUP_ORDER.filter((g) => groups.has(g)).map((group) => (
            <div key={group}>
              <div className="mb-1.5 text-sm font-medium text-muted-foreground">{group}</div>
              <ul className="flex flex-col gap-2">
                {(groups.get(group) ?? []).map(([token, rating, xp, rust, , enabled]) => {
                  const next = xpForNextLevel(rating)
                  const nextRank = SKILL_RANKS[rating + 1]
                  return (
                    <li key={token} className="flex flex-col gap-1">
                      <div className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span className={cn(rating === 0 && 'text-muted-foreground')}>
                            {skillName(token, unit)}
                          </span>
                          {enabled === false && rating >= 5 ? (
                            <Badge
                              variant="outline"
                              className="border-amber-500/50 px-1.5 py-0 text-xs font-normal text-amber-700 dark:text-amber-300"
                              title="Their labor for this is turned off"
                            >
                              labor off
                            </Badge>
                          ) : null}
                          {rust > 0 ? (
                            <Badge
                              variant="outline"
                              className="px-1.5 py-0 text-xs font-normal"
                              title="Unused for a while; they have lost some of their edge"
                            >
                              rusty
                            </Badge>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-muted-foreground tabular-nums">
                          {skillRank(rating)}
                        </span>
                      </div>
                      <Meter
                        pct={(xp / next) * 100}
                        className="h-1"
                        barClassName={rating >= 15 ? 'bg-sky-500' : undefined}
                        label={`${xp} of ${next} experience${nextRank ? ` to ${nextRank}` : ''}`}
                      />
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <Muted>No skills yet.</Muted>
      )}
    </Section>
  )
}

function AttributesSection({ unit, sheet }: { unit: FortUnit; sheet: UnitSheet }) {
  const physical = sheet.attributes.filter((a) => a[1] === 'P')
  const mental = sheet.attributes.filter((a) => a[1] === 'M')
  return (
    <Section
      title="Attributes"
      description={`Compared with other ${unit.race === 'dwarf' ? 'dwarves' : `${unit.race}s`}: the tick marks a typical one.`}
    >
      <div className="flex flex-col gap-4">
        <AttributeList label="Body" attributes={physical} />
        <AttributeList label="Mind" attributes={mental} />
      </div>
    </Section>
  )
}

function AttributeList({
  label,
  attributes,
}: {
  label: string
  attributes: UnitSheet['attributes']
}) {
  if (!attributes.length) return null
  return (
    <div>
      <div className="mb-1.5 text-sm font-medium text-muted-foreground">{label}</div>
      <ul className="flex flex-col gap-2">
        {attributes.map((attr) => (
          <AttributeRow key={attr[0]} attr={attr} />
        ))}
      </ul>
    </div>
  )
}

function AttributeRow({ attr }: { attr: UnitSheet['attributes'][number] }) {
  const [token, , value, max, ranges] = attr
  const median = ranges[3] || 1000
  const tier = attributeTier(value, ranges)
  return (
    <li
      className="flex flex-col gap-1"
      title={`${value.toLocaleString()} now, up to ${max.toLocaleString()} with use. A typical one has ${median.toLocaleString()}.`}
    >
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span>{attributeLabel(token)}</span>
        <span
          className={cn(
            tier >= 2 && 'text-emerald-700 dark:text-emerald-400',
            tier <= -2 && 'text-amber-700 dark:text-amber-300',
            Math.abs(tier) < 2 && 'text-muted-foreground',
          )}
        >
          {attributeStanding(value, ranges)}
        </span>
      </div>
      <Meter
        pct={(value / (median * 2)) * 100}
        marker={50}
        barClassName={tier >= 2 ? 'bg-emerald-500' : tier <= -2 ? 'bg-amber-400' : undefined}
        label={attributeLabel(token)}
      />
    </li>
  )
}

function HealthSection({ unit, sheet }: { unit: FortUnit; sheet: UnitSheet | null }) {
  const hurt = sheet ? injuries(sheet) : []
  const syndromes = sheet ? syndromeNames(sheet) : []
  const bloodPct =
    unit.blood !== null && unit.blood_max ? Math.round((unit.blood / unit.blood_max) * 100) : null
  const nothing =
    !hurt.length && !syndromes.length && !sheet?.pregnant && (bloodPct === null || bloodPct >= 100)
  return (
    <Section title="Health" count={hurt.length || undefined}>
      <div className="flex flex-col gap-3 text-sm">
        {hurt.length ? (
          <ul className="flex flex-col gap-2">
            {hurt.map((wound, i) => (
              <li
                // Wounds carry no id in the dump; their order is stable between dumps.
                // biome-ignore lint/suspicious/noArrayIndexKey: see above
                key={i}
                className={cn(
                  'rounded-md border px-2.5 py-1.5',
                  (wound.bleeding > 0 || wound.flags.includes('infected')) &&
                    'border-red-500/40 bg-red-500/5',
                )}
              >
                <div>{wordsForWound(wound)}</div>
                {wound.pain > 0 || wound.bleeding > 0 ? (
                  <div className="text-xs text-muted-foreground">
                    {[wound.bleeding > 0 ? 'bleeding' : null, wound.pain > 0 ? 'painful' : null]
                      .filter(Boolean)
                      .join(', ')}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : unit.wounds > 0 && !sheet ? (
          <p>
            {unit.wounds} wound{unit.wounds === 1 ? '' : 's'}
          </p>
        ) : null}
        {syndromes.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">Affected by</span>
            {syndromes.map((name) => (
              <Badge key={name} variant="outline" className="font-normal">
                {name === 'inebriation' ? 'drink (inebriated)' : name}
              </Badge>
            ))}
          </div>
        ) : null}
        {bloodPct !== null && bloodPct < 100 ? <p>Blood at {bloodPct}%</p> : null}
        {sheet?.pregnant ? <p>Expecting a child.</p> : null}
        {nothing ? <Muted>Hale and whole.</Muted> : null}
      </div>
    </Section>
  )
}

function WorkSection({ unit, sheet }: { unit: FortUnit; sheet: UnitSheet }) {
  const groups = sheet.groups.filter(
    ([, type, link]) => type !== 'Religion' && !/^FORMER/.test(link) && link !== 'POSITION',
  )
  return (
    <Section title="Work and standing">
      <div className="flex flex-col gap-3 text-sm">
        {sheet.work_details.length ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">Work details</span>
            {sheet.work_details.map((name) => (
              <Badge key={name} variant="secondary" className="font-normal">
                {name}
              </Badge>
            ))}
          </div>
        ) : unit.flags.includes('citizen') ? (
          <Muted>In no special work detail: they take any job everyone does.</Muted>
        ) : null}
        {unit.squad ? (
          <p>
            Serves in {unit.squad}
            {sheet.squad_position !== null && sheet.squad_position !== undefined
              ? `, position ${sheet.squad_position + 1}`
              : ''}
            .
          </p>
        ) : null}
        {unit.positions.length ? <p>Holds the office of {unit.positions.join(' and ')}.</p> : null}
        {sheet.kills ? (
          <p>
            Has killed {sheet.kills} creature{sheet.kills === 1 ? '' : 's'}.
          </p>
        ) : null}
        {sheet.combat_hardened ? (
          <p>
            {sheet.combat_hardened >= 100
              ? 'Hardened to combat: the sight of death no longer shakes them.'
              : `Somewhat used to violence (${sheet.combat_hardened}% hardened).`}
          </p>
        ) : null}
        {groups.length ? (
          <ul className="flex flex-col gap-1">
            {groups.map(([name, type, link]) => (
              <li key={`${name}-${link}`}>
                {capitalize(humanize(link).toLowerCase())} of {name}{' '}
                <span className="text-muted-foreground">({splitPascal(type).toLowerCase()})</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Section>
  )
}
