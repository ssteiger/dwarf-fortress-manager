import type { FortDiplomacy } from '@fortress/db-drizzle'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@fortress/ui'
import { BookMarkedIcon } from 'lucide-react'

import { type Guide, playbookGuide } from '~/lib/fortress/advice/guides'
import { type Stance, powerName } from '~/lib/fortress/diplomacy'
import { GuideBody } from '../../-components/Guide'
import { CommandItem, type DiplomacyCommand } from './shared'

interface Topic {
  guide: Guide
  /** Shown before the steps, when there are any. */
  intro?: string
  commands: DiplomacyCommand[]
}

function topics(d: FortDiplomacy, stances: Map<number, Stance>): Topic[] {
  const civs = d.powers.filter((p) => !p.own && p.type === 'Civilization' && p.relation)
  const enemy = civs.find((p) => stances.get(p.id)?.hostile)
  const friend = civs.find((p) => stances.get(p.id)?.friendly)
  const rival = civs.find((p) => stances.get(p.id)?.key === 'peace') ?? friend
  const own = d.powers.find((p) => p.own)
  const civilWar = own ? stances.get(own.id)?.key === 'civil-war' : false
  const siege = playbookGuide('siege')
  const caravan = playbookGuide('caravan')

  return [
    {
      guide: {
        key: 'diplomacy-envoys',
        title: 'When a diplomat or the liaison arrives',
        signs:
          'A diplomat or your civilization’s outpost liaison is announced and asks to meet your leader.',
        steps: [
          'Keep someone in the expedition leader or mayor position, with an office to meet in: envoys go to them.',
          'Your civilization’s liaison comes with its autumn caravan. Tell them what to bring next year.',
          'Elven diplomats may set a limit on the trees you fell. Keep to it, or the elves may go to war.',
          'Refusing what a diplomat asks, or harming one, can turn their civilization against you.',
        ],
      },
      commands: [
        {
          command: 'diplomacy',
          what: 'Lists how your civilization stands with every other, both ways round. It changes nothing.',
        },
        ...(friend
          ? [
              {
                command: `force Diplomat ${friend.id}`,
                what: `Sends a diplomat from ${powerName(friend)} now.`,
                cheat: true,
              },
            ]
          : []),
      ],
    },
    {
      guide: {
        key: 'diplomacy-trade',
        title: 'Trading with caravans',
        signs: caravan?.signs,
        steps: [
          ...(caravan?.steps ?? []),
          'Wagons need a path three tiles wide from the map edge to the depot. Caravans that cannot reach it leave unhappy.',
          'Seizing goods or offending merchants makes their civilization less willing to trade.',
        ],
      },
      commands: [
        {
          command: 'fix/stuck-merchants -n',
          what: 'Lists merchants who were announced but never arrived. Run it without -n to send them home.',
        },
        {
          command: 'caravan unload',
          what: 'Fixes a caravan that keeps unloading at the depot and never trades.',
        },
        {
          command: 'caravan happy',
          what: 'Makes merchants willing to trade again after you seized goods or offended them.',
          cheat: true,
        },
        {
          command: 'force Caravan',
          what: 'Sends your civilization’s caravan now instead of next autumn.',
          cheat: true,
        },
      ],
    },
    {
      guide: {
        key: 'diplomacy-siege',
        title: 'Before a siege',
        signs:
          'A civilization at war with yours, a siege level reached under "What draws them", and soon an announcement that invaders have arrived.',
        steps: [
          'Only peoples at war with you lay siege, and only once your fortress reaches their siege level.',
          ...(siege?.steps ?? []),
        ],
      },
      commands: [
        {
          command: 'gui/civ-alert',
          what: 'Opens DFHack’s window for the civilian alert: pick a safe burrow once, then one button sends everyone there.',
        },
      ],
    },
    {
      guide: {
        key: 'diplomacy-sneaks',
        title: 'Thieves, snatchers and ambushes',
        signs:
          'A thief or snatcher is spotted, children or valuables go missing, or woodcutters are ambushed at the map edge.',
        steps: [
          'Line the entrance with cage traps: sneaking visitors walk into them unseen.',
          'Keep children indoors, and artifacts and valuables behind doors deep inside.',
          'Station a squad near the entrance; soldiers spot hidden visitors and fight them off.',
          'Keep woodcutters and gatherers close to home while ambushers are about.',
        ],
      },
      commands: [],
    },
    {
      guide: {
        key: 'diplomacy-missions',
        title: 'Sending squads abroad',
        signs: 'Your squads leave the map for a site elsewhere in the world.',
        steps: [
          'Open the World screen and select a site to send a squad there.',
          'Depending on the site you can raid or pillage it, demand a one-time tribute, take it over, rescue a captive or recover an artifact.',
          'Raiding a civilization you are at peace with starts a war with it.',
          'Squads are gone for weeks or months, and come back with their loot and their wounded.',
        ],
      },
      commands: [
        {
          command: 'fix/stuck-squad',
          what: 'Lets returning squads and messengers pick up a squad stuck on the world map after a mission.',
        },
      ],
    },
    {
      guide: {
        key: 'diplomacy-petitions',
        title: 'Petitions for temples and guildhalls',
        signs: 'A guild or congregation asks your leader for a hall or temple of its own.',
        steps: [
          'Petitions come once a guild or congregation has enough members in your fortress.',
          'Accepting is a promise: zone a temple or guildhall as a location and make it as grand as they asked.',
          'An accepted petition left unbuilt runs out and upsets those who asked.',
        ],
      },
      commands: [
        {
          command: 'gui/petitions',
          what: 'Shows your petitions, the accepted ones and the open ones.',
        },
        {
          command: 'list-agreements all',
          what: 'Lists every temple and guildhall agreement, met or not.',
        },
      ],
    },
    {
      guide: {
        key: 'diplomacy-cheats',
        title: 'Cheats: peace, war and visits on demand',
        steps: [],
      },
      intro:
        'These change the world in ways the game would not on its own, and there is no undo. Save first. DFHack’s diplomacy command works only on civilizations yours has met.',
      commands: [
        ...(civilWar
          ? [{ command: 'fix/civil-war', what: 'Ends your civilization’s war with itself.' }]
          : []),
        ...(enemy
          ? [
              {
                command: `diplomacy ${enemy.id} peace`,
                what: `Makes peace with ${powerName(enemy)} at once, both ways round.`,
                cheat: true,
              },
            ]
          : []),
        ...(rival
          ? [
              {
                command: `diplomacy ${rival.id} war`,
                what: `Declares war on ${powerName(rival)} at once, both ways round. Their armies come once your fortress reaches their siege level.`,
                cheat: true,
              },
            ]
          : []),
        ...(friend
          ? [
              {
                command: `force Caravan ${friend.id}`,
                what: `Sends a caravan from ${powerName(friend)} now.`,
                cheat: true,
              },
            ]
          : []),
      ],
    },
  ]
}

/** How to deal with envoys, caravans, sieges, thieves, missions and petitions. */
export function Playbook({ d, stances }: { d: FortDiplomacy; stances: Map<number, Stance> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BookMarkedIcon className="size-4 text-primary" />
          How to handle them
        </CardTitle>
        <CardDescription>
          What to do in the game, step by step, and the DFHack commands that help. Commands marked
          as cheats change the world in ways the game would not.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Accordion type="multiple">
          {topics(d, stances).map(({ guide, intro, commands }) => (
            <AccordionItem key={guide.key} value={guide.key}>
              <AccordionTrigger>{guide.title}</AccordionTrigger>
              <AccordionContent className="flex flex-col gap-4">
                {intro ? <p className="text-sm text-muted-foreground">{intro}</p> : null}
                {guide.steps.length || guide.signs ? <GuideBody guide={guide} compact /> : null}
                {commands.length ? (
                  <div className="flex flex-col gap-3">
                    <h3 className="text-sm font-medium">DFHack</h3>
                    {commands.map((c) => (
                      <CommandItem key={c.command} {...c} />
                    ))}
                  </div>
                ) : null}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  )
}
