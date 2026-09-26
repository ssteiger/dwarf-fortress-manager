import type { FortUnit } from '@fortress/db-drizzle/fortress-types'

export function isLivingCitizen(unit: FortUnit): boolean {
  return (
    unit.flags.includes('citizen') && !unit.flags.includes('dead') && !unit.flags.includes('ghost')
  )
}

export function livingCitizens(units: FortUnit[]): FortUnit[] {
  return units
    .filter(isLivingCitizen)
    .sort((a, b) => a.readable.localeCompare(b.readable) || a.id - b.id)
}

// ---------------------------------------------------------------------------
// Alliteration: "Bad Bargain" -> "Bob the Bad Bargain"

/** Letter -> [his names, her names]: stuffy, old-fashioned, faintly ridiculous. */
const FIRST_NAMES: Record<string, [string[], string[]]> = {
  A: [
    ['Arnold', 'Albert', 'Alfred', 'Archibald', 'Ambrose', 'Augustus', 'Alistair'],
    ['Agnes', 'Agatha', 'Alma', 'Adelaide', 'Augusta', 'Ada', 'Althea'],
  ],
  B: [
    ['Bob', 'Barnaby', 'Bertram', 'Boris', 'Basil', 'Bartholomew', 'Bruno'],
    ['Bertha', 'Beryl', 'Brunhilde', 'Betty', 'Bernadette', 'Blanche', 'Bettina'],
  ],
  C: [
    ['Clive', 'Cedric', 'Cornelius', 'Cuthbert', 'Clarence', 'Cyril', 'Conrad'],
    ['Clara', 'Constance', 'Cordelia', 'Cecily', 'Clementine', 'Cornelia', 'Colette'],
  ],
  D: [
    ['Doug', 'Desmond', 'Dudley', 'Dmitri', 'Duncan', 'Dietrich', 'Dexter'],
    ['Doris', 'Dolores', 'Dorothy', 'Dagmar', 'Delphine', 'Daphne', 'Dymphna'],
  ],
  E: [
    ['Edgar', 'Egbert', 'Ernest', 'Eugene', 'Elmer', 'Eustace', 'Elmo'],
    ['Edna', 'Ethel', 'Eunice', 'Esmeralda', 'Edith', 'Enid', 'Eudora'],
  ],
  F: [
    ['Fred', 'Ferdinand', 'Fergus', 'Felix', 'Floyd', 'Franz', 'Fitzgerald'],
    ['Frieda', 'Florence', 'Fanny', 'Fenella', 'Flora', 'Fern', 'Francesca'],
  ],
  G: [
    ['Gustaav', 'Gerald', 'Gordon', 'Godfrey', 'Gunther', 'Gilbert', 'Gideon'],
    ['Gertrude', 'Gladys', 'Greta', 'Gwendolyn', 'Gilda', 'Griselda', 'Georgina'],
  ],
  H: [
    ['Horace', 'Herbert', 'Humphrey', 'Hank', 'Hector', 'Hubert', 'Harold'],
    ['Hilda', 'Harriet', 'Hortense', 'Hazel', 'Henrietta', 'Helga', 'Hester'],
  ],
  I: [
    ['Igor', 'Ignatius', 'Ivan', 'Irving', 'Ingmar', 'Isidore'],
    ['Ingrid', 'Irma', 'Imelda', 'Isolde', 'Ida', 'Imogen'],
  ],
  J: [
    ['Jeff', 'Jasper', 'Jebediah', 'Julius', 'Jonas', 'Jethro'],
    ['Joan', 'Judith', 'Josephine', 'Jemima', 'Juno', 'Jolene'],
  ],
  K: [
    ['Kevin', 'Klaus', 'Kenneth', 'Kurt', 'Kasimir', 'Konrad'],
    ['Karen', 'Klara', 'Kitty', 'Kunigunde', 'Katja', 'Kristin'],
  ],
  L: [
    ['Lionel', 'Leopold', 'Lars', 'Lothar', 'Lloyd', 'Ludwig', 'Leland'],
    ['Lorraine', 'Lucinda', 'Lotte', 'Loretta', 'Lydia', 'Lavinia', 'Lorna'],
  ],
  M: [
    ['Mortimer', 'Marvin', 'Magnus', 'Maurice', 'Milo', 'Montgomery', 'Mervyn'],
    ['Mildred', 'Martha', 'Maude', 'Margit', 'Myrtle', 'Marjorie', 'Mathilde'],
  ],
  N: [
    ['Norbert', 'Nigel', 'Neville', 'Nils', 'Ned', 'Norman', 'Nestor'],
    ['Nora', 'Nellie', 'Norma', 'Nadia', 'Nettie', 'Nancy', 'Norberta'],
  ],
  O: [
    ['Oswald', 'Otto', 'Olaf', 'Oscar', 'Orville', 'Ogden', 'Octavius'],
    ['Olga', 'Ottilie', 'Opal', 'Odette', 'Olive', 'Ophelia', 'Oona'],
  ],
  P: [
    ['Percy', 'Percival', 'Phil', 'Pieter', 'Pip', 'Peregrine', 'Poindexter'],
    ['Prudence', 'Petunia', 'Phyllis', 'Polly', 'Pearl', 'Penelope', 'Philippa'],
  ],
  Q: [
    ['Quentin', 'Quincy', 'Quirinus'],
    ['Queenie', 'Quilla', 'Quinta'],
  ],
  R: [
    ['Rupert', 'Reginald', 'Roland', 'Rolf', 'Rudy', 'Rodney', 'Ralph'],
    ['Rosalind', 'Ruth', 'Rhoda', 'Rosie', 'Ramona', 'Rowena', 'Roberta'],
  ],
  S: [
    ['Stanley', 'Sigmund', 'Sven', 'Seymour', 'Sebastian', 'Sherman', 'Silas', 'Samson'],
    ['Sybil', 'Sally', 'Svetlana', 'Sadie', 'Sieglinde', 'Susannah', 'Selma', 'Sophronia'],
  ],
  T: [
    ['Theodore', 'Tobias', 'Terrence', 'Thaddeus', 'Torvald', 'Tarquin', 'Thurston'],
    ['Trudy', 'Tabitha', 'Tilda', 'Theodora', 'Tamsin', 'Tallulah', 'Tatiana'],
  ],
  U: [
    ['Urist', 'Ulrich', 'Ulf', 'Umberto', 'Upton'],
    ['Ursula', 'Una', 'Ulla', 'Uma', 'Ulrike'],
  ],
  V: [
    ['Vernon', 'Victor', 'Vladimir', 'Vince', 'Valentin', 'Virgil'],
    ['Vera', 'Velma', 'Violet', 'Vivian', 'Valda', 'Vesna'],
  ],
  W: [
    ['Walter', 'Wilbur', 'Wendell', 'Winston', 'Wolfgang', 'Wallace', 'Wilfred'],
    ['Wilma', 'Winifred', 'Wanda', 'Wendy', 'Wilhelmina', 'Winona', 'Willa'],
  ],
  X: [
    ['Xavier', 'Xander'],
    ['Xena', 'Xenia'],
  ],
  Y: [
    ['Yuri', 'Yannick', 'Yorick'],
    ['Yolanda', 'Yvonne', 'Yvette'],
  ],
  Z: [
    ['Zachary', 'Zebedee', 'Zoltan'],
    ['Zelda', 'Zora', 'Zsuzsa'],
  ],
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * The nickname behind a first name that starts with the same letter:
 * "Guesswork" -> "Gertrude Guesswork", "Bad Bargain" -> "Bob the Bad Bargain".
 * Several-word names take "the". Stable for a given dwarf and nickname; the
 * nickname comes back unchanged when it has no letter to match or the result
 * would not fit in `maxLength`. First names in `used` are passed over while
 * the letter has others left, and the one chosen is added to it.
 */
export function alliterate(
  nickname: string,
  unit: Pick<FortUnit, 'id' | 'sex'>,
  maxLength: number,
  used?: Set<string>,
): string {
  const trimmed = nickname.trim()
  const core = trimmed.replace(/^the\s+/i, '')
  const letter = core.normalize('NFKD').charAt(0).toUpperCase()
  const lists = FIRST_NAMES[letter]
  if (!lists) return nickname
  const pool = unit.sex === 1 ? lists[0] : unit.sex === 0 ? lists[1] : [...lists[0], ...lists[1]]
  const start = stableHash(`${unit.id}:${core.toLowerCase()}`) % pool.length
  const rotated = [...pool.slice(start), ...pool.slice(0, start)]
  const first = rotated.find((name) => !used?.has(name)) ?? rotated[0]
  used?.add(first)
  const fits = (text: string) => Array.from(text).length <= maxLength
  const withThe = `${first} the ${core}`
  const plain = `${first} ${core}`
  if ((core !== trimmed || /\s/.test(core)) && fits(withThe)) return withThe
  if (fits(plain)) return plain
  return nickname
}

/**
 * Alliterated forms for every dwarf's ideas, keyed by `alliterationKey`.
 * Every dwarf's first idea is served before anyone's second, so the names a
 * fortress sees first repeat a first name only once a letter runs out.
 */
export function alliterateAll(
  entries: { unit: Pick<FortUnit, 'id' | 'sex'>; nicknames: string[] }[],
  maxLength: number,
): Map<string, string> {
  const used = new Set<string>()
  const out = new Map<string, string>()
  const rounds = Math.max(0, ...entries.map((e) => e.nicknames.length))
  for (let round = 0; round < rounds; round++) {
    for (const { unit, nicknames } of entries) {
      const nickname = nicknames[round]
      if (!nickname) continue
      const key = alliterationKey(unit.id, nickname)
      if (!out.has(key)) out.set(key, alliterate(nickname, unit, maxLength, used))
    }
  }
  return out
}

export function alliterationKey(unitId: number, nickname: string): string {
  return `${unitId}:${nickname.toLowerCase()}`
}
