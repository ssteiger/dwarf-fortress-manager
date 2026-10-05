import type { FortHealth } from '@fortress/db-drizzle'

/*
 * Shapes the fortress server functions return that the client-safe readers
 * also take as input: the advice, the notices and the stores read them
 * straight from the queries. Kept out of server/ so those readers never
 * import a server module, not even for a type.
 */

export interface UnburiedBody {
  unitId: number
  name: string
  description: string
  x: number | null
  y: number | null
  z: number | null
}

/** What the overview checks beyond units and stocks: burials, rooms and cups. */
export interface FortConcerns {
  capturedAt: string | null
  /** Civzone subtype (Hospital, Tomb, DiningHall, Bedroom, ...) -> count. */
  zones: Record<string, number>
  coffins: number
  /** Mugs, cups and goblets: dwarves drinking without one grumble. */
  cups: number
  /** Remains of the fortress's own dead lying anywhere but a coffin. */
  unburied: UnburiedBody[]
  /** Null until a dump from version 12 on. */
  health: FortHealth | null
}

export interface OreStock {
  metal: string
  boulders: number
  /** Stone names, most plentiful first. */
  sources: string[]
}

/** What the stores hold beyond the headline counts: tools, fuel, ores, supplies, clutter. */
export interface FortSupplies {
  capturedAt: string | null
  /** Forbidden items by type, remains aside (vermin remains are forbidden by the game). */
  forbidden: Record<string, number>
  /** Corpses, body parts and remains lying outside stockpiles. */
  looseRefuse: number
  /** Cave spider webs not yet collected: thread no one can use yet. */
  webs: number
  cups: number
  buckets: number
  splints: number
  crutches: number
  soap: number
  bins: number
  bags: number
  emptyBarrels: number
  wheelbarrows: number
  /** Picks and axes nobody is carrying. */
  picks: number
  axes: number
  /** Unclaimed weapons, and metal armor pieces, for a squad. */
  weapons: number
  metalArmor: number
  ores: OreStock[]
  coalBoulders: number
  /** Limestone, dolomite and the other stones steel needs. */
  fluxBoulders: number
  /** Charcoal and coke. */
  fuelBars: number
  /** Metal bars by metal. */
  bars: Record<string, number>
  /** Bars that are neither metal, fuel nor soap (potash, pearlash, ash), by material. */
  otherBars: Record<string, number>
  roughGems: number
  tradeGoods: number
  /** Clothing worn by someone that is threadbare or tattered. */
  wornClothes: number
  /** Goods on the floor outside any stockpile, by item type; refuse, webs and forbidden items aside. */
  loose: Record<string, number>
  /** Weapons and armor made abroad that nobody wears: loot. */
  enemyGear: { items: number; metal: number; value: number }
  /** The fortress's artifacts on the map; `loose` ones lie on the floor rather than on display. */
  artifacts: { items: number; loose: number; value: number }
  /** Large pots holding nothing: they take drink and food like barrels. */
  emptyPots: number
  /** Thread that is not an uncollected web. */
  thread: number
  bones: number
  shells: number
  /** Mechanisms not yet built into anything. */
  mechanisms: number
  /** Food, plants and bodies gone rotten, vermin remains aside. */
  rotting: number
  /** What a caravan at the depot has for sale. */
  merchantGoods: { items: number; value: number }
}
