import type { TOGGLEABLE_PLUGINS } from '@fortress/db-drizzle/fortress-types'

export type ToggleablePlugin = (typeof TOGGLEABLE_PLUGINS)[number]

/** What each plugin the app may switch does, in a line. */
export const PLUGIN_WHAT: Record<ToggleablePlugin, string> = {
  autobutcher: 'Culls surplus animals and keeps breeding pairs, up to the targets you set.',
  autochop: 'Marks trees for felling when wood runs low.',
  autoclothing: 'Keeps work orders going for the clothing you ask each citizen to have.',
  autofarm: 'Plants whatever crop runs lowest, as long as there are seeds.',
  autonestbox: 'Puts egg-laying animals in pastures with a nest box.',
  autoslab: 'Engraves a memorial slab for each ghost, once a blank slab is in store.',
  dwarfvet: 'Lets your doctors treat hurt animals in the hospital.',
  logistics: 'Marks items in chosen stockpiles for melting, trading, dumping or training.',
  nestboxes: 'Forbids fertile eggs in nest boxes so they hatch.',
  'preserve-rooms': 'Keeps rooms for dwarves who are away, and for nobles when the holder changes.',
  'preserve-tombs': 'Keeps a tomb assigned to its dwarf after death.',
  seedwatch: 'Keeps seeds and their plants out of the kitchen while stocks are low.',
  suspendmanager: 'Suspends construction that cannot go on yet, and resumes it when it can.',
  tailor: 'Orders new clothing when what dwarves wear wears out.',
}

/** The plugin a command turns on, when it is `enable <plugin>` and nothing more. */
export function pluginEnabledBy(command: string): string | null {
  const [verb, plugin, ...rest] = command.trim().split(/\s+/)
  return verb === 'enable' && plugin && !rest.length ? plugin : null
}
