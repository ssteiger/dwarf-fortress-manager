import type { FortUnit } from '@fortress/db-drizzle'
import {
  Badge,
  Button,
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@fortress/ui'
import { Link } from '@tanstack/react-router'
import { Maximize2Icon, XIcon } from 'lucide-react'
import * as React from 'react'

import { UnitPortrait } from '~/lib/df-assets/components'
import { humanize, isLiving, sexLabel, unitDisplayName, unitGroup } from '~/lib/fortress/format'
import { MoodBadge } from '../../-components/FortChrome'
import { ShowInGameButton } from './ActionsTab'
import { DwarfDetails, type DwarfTab } from './DwarfDetails'
import { UnitLinks, legendsRefFor, useFortLegendsWorldId, useKnownHistFigures } from './UnitLinks'

/** A unit's details beside the list they were opened from, with the way to their full page. */
export function UnitDrawer({ unit, onClose }: { unit: FortUnit | null; onClose: () => void }) {
  const [tab, setTab] = React.useState<DwarfTab>('overview')
  const legendsWorldId = useFortLegendsWorldId()
  const knownFigures = useKnownHistFigures(legendsWorldId, [unit?.hist_figure_id ?? -1])
  const legends = unit ? legendsRefFor(unit, legendsWorldId, knownFigures) : null

  return (
    <Drawer
      direction="right"
      open={unit !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DrawerContent className="data-[vaul-drawer-direction=right]:h-full data-[vaul-drawer-direction=right]:w-full data-[vaul-drawer-direction=right]:sm:max-w-xl">
        {unit ? (
          <>
            <DrawerHeader className="border-b">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <UnitPortrait
                    unit={unit}
                    size={72}
                    fallbackToSprite
                    className="shrink-0 rounded-md border bg-muted/40"
                    title={`${unit.race} as drawn in the game`}
                  />
                  <div className="min-w-0">
                    <DrawerTitle className="flex flex-wrap items-center gap-2">
                      {unitDisplayName(unit)}
                      <UnitLinks unit={unit} legends={legends} />
                      {unitGroup(unit) === 'citizen' || unitGroup(unit) === 'resident' ? (
                        <MoodBadge
                          category={unit.stress_category}
                          className="text-sm font-normal"
                        />
                      ) : null}
                      {unit.mood ? (
                        <Badge variant="outline" className="text-sm font-normal">
                          {humanize(unit.mood)} mood
                        </Badge>
                      ) : null}
                    </DrawerTitle>
                    <DrawerDescription className="mt-1">
                      {[
                        unit.name_english && unit.name_english !== unit.name
                          ? unit.name_english
                          : null,
                        unit.caste,
                        sexLabel(unit.sex),
                        unit.profession,
                        `${Math.floor(unit.age)} years`,
                        isLiving(unit) ? null : 'dead',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </DrawerDescription>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {isLiving(unit) ? <ShowInGameButton unit={unit} size="icon" /> : null}
                  <DrawerClose asChild>
                    <Button size="icon" variant="ghost" aria-label="Close">
                      <XIcon className="size-4" />
                    </Button>
                  </DrawerClose>
                </div>
              </div>
            </DrawerHeader>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <DwarfDetails
                unitId={unit.id}
                compact
                legends={legends}
                tab={tab}
                onTabChange={setTab}
              />
            </div>
            <DrawerFooter className="border-t">
              <Button asChild>
                <Link
                  to="/fortress/dwarves/$id"
                  params={{ id: String(unit.id) }}
                  search={tab === 'overview' ? {} : { tab }}
                >
                  <Maximize2Icon className="size-4" />
                  Show full page
                </Link>
              </Button>
            </DrawerFooter>
          </>
        ) : null}
      </DrawerContent>
    </Drawer>
  )
}
