import type {
  DiplomacyRelation,
  FortCaravan,
  FortDiplomacy,
  FortPower,
  FortUnit,
} from '@fortress/db-drizzle'
import {
  Button,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@fortress/ui'
import { XIcon } from 'lucide-react'
import * as React from 'react'

import {
  BEHAVIOUR,
  type FortProgressValues,
  type Stance,
  entityName,
  forecastOf,
  isOngoing,
  mismatchOf,
  peopleLabel,
  powerById,
  powerName,
  presenceText,
  relationWord,
  siteText,
  warSides,
  warSpan,
  warsOf,
} from '~/lib/fortress/diplomacy'
import { humanize } from '~/lib/fortress/format'
import { type OpenUnit, UnitChips } from '../../-components/Insights'
import { useKnownHistFigures } from '../../dwarves/-components/UnitLinks'
import { noticeText, siegeText } from './Forecast'
import { caravanText } from './RightNow'
import {
  CommandItem,
  type DiplomacyCommand,
  LegendsLink,
  type OpenPower,
  SectionLabel,
  StanceBadge,
} from './shared'

const WARS_SHOWN = 4

/** What to do about a power, in the order a player would do it. */
export function handlingSteps(power: FortPower, stance: Stance): string[] {
  const has = (flag: string) => power.behaviour.includes(flag)
  switch (stance.key) {
    case 'own':
      return [
        'Its caravan comes each autumn with the outpost liaison. Trade at the depot, and tell the liaison what to bring next year.',
        'Its nobles arrive as your fortress grows, each with demands and mandates of their own.',
        'Its wars are yours: its enemies can raid and besiege your fortress.',
      ]
    case 'civil-war':
      return [
        'No caravans or migrants come while your civilization fights itself.',
        'DFHack’s fix/civil-war ends it, below.',
      ]
    case 'ally':
    case 'peace':
    case 'tribute-to-you':
      return [
        'Trade with their caravans at the depot; gifts in the trade screen improve relations.',
        'Keep their merchants, diplomats and animals safe: harming them can start a war.',
        ...(has('AT_PEACE_WITH_WILDLIFE')
          ? [
              'Offer them nothing made of wood, and keep to any limit their diplomat sets on felling trees, or they may go to war.',
            ]
          : []),
        'A squad sent to raid one of their sites starts a war with them.',
      ]
    case 'tribute-from-you':
      return [
        'Your civilization pays them tribute, which keeps their armies away.',
        'Their caravans and diplomats are guests like any other: harming them can bring the war back.',
      ]
    case 'war':
    case 'skirmishing':
      return [
        ...(has('SIEGER')
          ? [
              'Expect sieges once your fortress is big enough; "When they come" says how close that is.',
            ]
          : ['Expect raids and ambushes rather than sieges.']),
        'Train squads, and keep a way to shut your entrance: a raised drawbridge or locked doors.',
        ...(has('AMBUSHER')
          ? [
              'Their war parties come hidden: keep woodcutters, hunters and gatherers close to home.',
            ]
          : []),
        ...(has('SIEGE_SKILLED_MINERS')
          ? ['Their besiegers bring miners, so walls alone will not keep them out.']
          : []),
        'To strike back, send a squad from the World screen to raid one of their sites, or to demand tribute.',
      ]
    case 'hostile':
      return [
        ...(has('BABYSNATCHER')
          ? ['Keep children indoors and away from the map edge; snatchers carry them off unseen.']
          : []),
        ...(has('ITEM_THIEF')
          ? ['Keep artifacts and valuables behind doors deep inside; thieves go for them.']
          : []),
        'Cage traps along the entrance catch sneaking thieves and snatchers before they reach anyone.',
        'A squad stationed near the entrance spots and fights off the hidden ones.',
      ]
    default:
      return [
        'Nothing to do yet. If they ever send caravans, diplomats or thieves, they show up here.',
      ]
  }
}

/** DFHack commands for a power, cheats marked. */
export function powerCommands(
  d: FortDiplomacy,
  power: FortPower,
  stance: Stance,
): DiplomacyCommand[] {
  const out: DiplomacyCommand[] = []
  if (power.own) {
    if (stance.key === 'civil-war')
      out.push({
        command: 'fix/civil-war',
        what: 'Ends the civil war, so caravans and migrants come again.',
      })
    out.push({
      command: 'force Caravan',
      what: 'Sends your civilization’s caravan now instead of next autumn.',
      cheat: true,
    })
    return out
  }
  if (power.type !== 'Civilization' || !power.relation) return out
  if (stance.hostile)
    out.push({
      command: `diplomacy ${power.id} peace`,
      what: `Makes peace between your civilization and ${powerName(power)}, both ways, at once.`,
      cheat: true,
    })
  else {
    out.push({
      command: `force Caravan ${power.id}`,
      what: `Sends a caravan from ${powerName(power)} now.`,
      cheat: true,
    })
    out.push({
      command: `force Diplomat ${power.id}`,
      what: `Sends a diplomat from ${powerName(power)} now.`,
      cheat: true,
    })
  }
  return out
}

/** One power in full: where it lives, who leads it, its wars and how to deal with it. */
export function PowerDrawer({
  d,
  power,
  stance,
  here,
  caravans,
  values,
  worldId,
  onClose,
  onOpenPower,
  onOpenUnit,
}: {
  d: FortDiplomacy
  power: FortPower | null
  stance: Stance | null
  here: FortUnit[]
  caravans: FortCaravan[]
  values: FortProgressValues
  worldId: number | null
  onClose: () => void
  onOpenPower: OpenPower
  onOpenUnit: OpenUnit
}) {
  return (
    <Drawer
      direction="right"
      open={power !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DrawerContent className="data-[vaul-drawer-direction=right]:h-full data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:sm:max-w-xl">
        {power && stance ? (
          <PowerDetails
            d={d}
            power={power}
            stance={stance}
            here={here}
            caravans={caravans}
            values={values}
            worldId={worldId}
            onOpenPower={onOpenPower}
            onOpenUnit={onOpenUnit}
          />
        ) : null}
      </DrawerContent>
    </Drawer>
  )
}

function PowerDetails({
  d,
  power,
  stance,
  here,
  caravans,
  values,
  worldId,
  onOpenPower,
  onOpenUnit,
}: {
  d: FortDiplomacy
  power: FortPower
  stance: Stance
  here: FortUnit[]
  caravans: FortCaravan[]
  values: FortProgressValues
  worldId: number | null
  onOpenPower: OpenPower
  onOpenUnit: OpenUnit
}) {
  const knownLeaders = useKnownHistFigures(
    worldId,
    power.leaders.map((l) => l.hf),
  )
  const mismatch = mismatchOf(power)
  const forecast = forecastOf(d, power, values)
  const wars = warsOf(d, power.id).sort(
    (a, b) =>
      Number(b.ours) - Number(a.ours) ||
      Number(isOngoing(b)) - Number(isOngoing(a)) ||
      b.start_year - a.start_year,
  )
  const [allWars, setAllWars] = React.useState(false)
  const shownWars = allWars ? wars : wars.slice(0, WARS_SHOWN)
  const trading = caravans.filter((c) => c.state !== 'None')
  const commands = powerCommands(d, power, stance)
  const behaviour = power.behaviour.filter((flag) => BEHAVIOUR[flag])

  const byRelation = new Map<DiplomacyRelation, FortPower[]>()
  for (const [id, relation] of power.relations) {
    const other = powerById(d, id)
    if (!other || !relation || relation === 'NoContact') continue
    const group = byRelation.get(relation)
    if (group) group.push(other)
    else byRelation.set(relation, [other])
  }
  const relationOrder: DiplomacyRelation[] = [
    'TotalWar',
    'Skirmishing',
    'AcceptingTribute',
    'OfferingTribute',
    'Peace',
  ]

  return (
    <>
      <DrawerHeader className="border-b">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <DrawerTitle className="flex flex-wrap items-center gap-2">
              {powerName(power)}
              <StanceBadge stance={stance} className="text-sm" />
            </DrawerTitle>
            <DrawerDescription className="mt-1">
              {[
                peopleLabel(power),
                power.name_native && power.name_native !== power.name ? power.name_native : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </DrawerDescription>
            <div className="mt-1.5">
              <LegendsLink worldId={worldId} kind="entity" id={power.id} label="Their legends" />
            </div>
          </div>
          <DrawerClose asChild>
            <Button size="icon" variant="ghost" aria-label="Close">
              <XIcon className="size-4" />
            </Button>
          </DrawerClose>
        </div>
      </DrawerHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4">
        <section className="flex flex-col gap-1.5 text-sm">
          <p>{stance.detail}</p>
          {mismatch ? <p className="text-muted-foreground">{mismatch}</p> : null}
          {power.groups.length ? (
            <p className="text-muted-foreground">
              Your civilization also deals with{' '}
              {power.groups
                .map((g) => `${g.name ?? `group ${g.id}`} (${relationWord(g.relation)})`)
                .join(', ')}
              , which answer to them.
            </p>
          ) : null}
        </section>

        {here.length || trading.length ? (
          <section className="flex flex-col gap-2">
            <SectionLabel>On your map now</SectionLabel>
            {here.length ? (
              <>
                <p className="text-sm">{presenceText(here)}.</p>
                <UnitChips units={here} onOpen={onOpenUnit} />
              </>
            ) : null}
            {trading.map((c) => (
              <p key={c.index} className="text-sm">
                Their caravan {caravanText(c)}.
              </p>
            ))}
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <SectionLabel>Dealing with them</SectionLabel>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
            {handlingSteps(power, stance).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        {forecast && !power.own ? (
          <section className="flex flex-col gap-2">
            <SectionLabel>When they come</SectionLabel>
            <p className="text-sm">
              {noticeText(forecast)}{' '}
              {siegeText(forecast, stance.hostile && Boolean(power.relation))}
            </p>
          </section>
        ) : null}

        <section className="flex flex-col gap-2">
          <SectionLabel>Where they live</SectionLabel>
          {power.sites.length ? (
            <ul className="flex flex-col gap-1 text-sm">
              {power.sites.map((site) => (
                <li key={site.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span>{siteText(site)}</span>
                  {site.owner_id !== power.id && d.entities[String(site.owner_id)]?.name ? (
                    <span className="text-muted-foreground">
                      held by {entityName(d, site.owner_id)}
                    </span>
                  ) : null}
                  <LegendsLink worldId={worldId} kind="site" id={site.id} label="" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">They hold no sites anywhere.</p>
          )}
          {power.site_count > power.sites.filter((s) => s.settlement).length ? (
            <p className="text-sm text-muted-foreground">
              The nearest of {power.site_count} settlements.
            </p>
          ) : null}
        </section>

        {power.leaders.length ? (
          <section className="flex flex-col gap-2">
            <SectionLabel>Leaders</SectionLabel>
            <ul className="flex flex-col gap-1 text-sm">
              {power.leaders.map((leader) => (
                <li
                  key={`${leader.position}-${leader.hf}`}
                  className="flex flex-wrap items-baseline gap-x-2"
                >
                  <span className="text-muted-foreground">{humanize(leader.position)}:</span>
                  <span>{leader.name ?? leader.name_native ?? 'unnamed'}</span>
                  {!leader.alive ? <span className="text-muted-foreground">(dead)</span> : null}
                  {knownLeaders.has(leader.hf) ? (
                    <LegendsLink
                      worldId={worldId}
                      kind="historical_figure"
                      id={leader.hf}
                      label=""
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {behaviour.length ? (
          <section className="flex flex-col gap-2">
            <SectionLabel>Their ways</SectionLabel>
            <ul className="flex flex-col gap-1 text-sm">
              {behaviour.map((flag) => (
                <li key={flag}>
                  <span className="font-medium">{BEHAVIOUR[flag].label}.</span>{' '}
                  <span className="text-muted-foreground">{BEHAVIOUR[flag].detail}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {wars.length ? (
          <section className="flex flex-col gap-2">
            <SectionLabel>Wars</SectionLabel>
            <ul className="flex flex-col gap-2 text-sm">
              {shownWars.map((war) => (
                <li key={war.id} className="flex flex-col">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{war.name ?? 'An unnamed war'}</span>
                    {war.ours ? (
                      <span className="text-xs text-red-700 dark:text-red-300">
                        against your civilization
                      </span>
                    ) : null}
                    <LegendsLink
                      worldId={worldId}
                      kind="historical_event_collection"
                      id={war.id}
                      label=""
                    />
                  </span>
                  <span className="text-muted-foreground">
                    {warSides(d, war)}. {warSpan(war, d.year)}.
                  </span>
                </li>
              ))}
            </ul>
            {wars.length > WARS_SHOWN ? (
              <button
                type="button"
                className="self-start text-sm text-muted-foreground hover:text-foreground hover:underline"
                onClick={() => setAllWars(!allWars)}
              >
                {allWars ? 'Fewer wars' : `All ${wars.length} wars`}
              </button>
            ) : null}
          </section>
        ) : null}

        {byRelation.size ? (
          <section className="flex flex-col gap-2">
            <SectionLabel>With your other neighbours</SectionLabel>
            <ul className="flex flex-col gap-1 text-sm">
              {relationOrder
                .filter((relation) => byRelation.has(relation))
                .map((relation) => (
                  <li key={relation}>
                    <span className="text-muted-foreground">
                      {relation === 'TotalWar' || relation === 'Skirmishing'
                        ? `${relation === 'TotalWar' ? 'At war' : 'Skirmishing'} with`
                        : relation === 'Peace'
                          ? 'At peace with'
                          : relation === 'AcceptingTribute'
                            ? 'Takes tribute from'
                            : 'Pays tribute to'}
                      :{' '}
                    </span>
                    {(byRelation.get(relation) ?? []).map((other, i) => (
                      <React.Fragment key={other.id}>
                        {i > 0 ? ', ' : null}
                        <button
                          type="button"
                          className="hover:underline"
                          onClick={() => onOpenPower(other.id)}
                        >
                          {other.own ? 'your civilization' : powerName(other)}
                        </button>
                      </React.Fragment>
                    ))}
                  </li>
                ))}
            </ul>
          </section>
        ) : null}

        <section className="flex flex-col gap-3">
          <SectionLabel>DFHack</SectionLabel>
          {commands.length ? (
            commands.map((c) => <CommandItem key={c.command} {...c} />)
          ) : (
            <p className="text-sm text-muted-foreground">
              {power.type !== 'Civilization'
                ? 'DFHack’s diplomacy and force commands work only on whole civilizations, not on a group like this one.'
                : 'DFHack’s diplomacy command changes only civilizations yours has met; there is nothing to change with them yet.'}
            </p>
          )}
        </section>
      </div>
    </>
  )
}
