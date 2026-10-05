/*
 * Shapes shared across the legends modules, server and client alike: a
 * named reference, the names of the ids a payload points at, and one hit in
 * a list of records.
 */

/** A record named by id: a civilization, a site, a figure. */
export interface LegendsRef {
  id: number
  name: string | null
}

export type NameIndex = Record<string, Record<number, string>>

export interface LegendsHit {
  kind: string
  id: number
  name: string | null
  type: string | null
  year: number | null
  endYear?: number | null
  /** One line of context: race and lifespan, owner, author, outcome. */
  detail?: string
  /** Raw creature token (DWARF, BEAR_BLACK) for figures, groups, and creatures, so the game's sprite can be drawn. */
  race?: string | null
  /** Caste token (MALE, FEMALE, DEFAULT) for figures. */
  caste?: string | null
  /** Artifact item type and subtype names from legends_plus ("weapon", "war hammer"). */
  item?: { type: string | null; subtype: string | null } | null
  /**
   * Historical events that mention this record. Null when this kind has no
   * event link. The same link the record page uses for its history.
   */
  events?: number | null
}

export interface HeldPosition {
  entity: LegendsRef
  title: string
  startYear: number | null
  endYear: number | null
}
