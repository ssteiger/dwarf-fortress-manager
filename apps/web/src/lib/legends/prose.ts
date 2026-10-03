import type { SpanDigest } from './chronicle'
import { type Fragment, describeEvent } from './events'
import { cleanName, racePlural, titleCase } from './model'
import type { NameIndex } from './server'

/** Client-safe sentences about a span of years, from its digest alone. */

function count(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

export function sentence(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function list(items: string[]): string {
  if (items.length <= 1) return items.join('')
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

export function spanLabel(from: number, to: number): string {
  return from === to ? `the year ${from}` : `the years ${from} to ${to}`
}

/** A paragraph a chronicler might open with, for what the digest counted. */
export function summarizeSpan(digest: SpanDigest): string {
  const { from, to, counts, tally, wars, battles, people } = digest
  const sentences: string[] = []
  const total = counts.total ?? 0
  if (total === 0) return `Nothing is recorded for ${spanLabel(from, to)}.`
  sentences.push(`The chronicles record ${count(total, 'event')} for ${spanLabel(from, to)}.`)
  if (wars.length) {
    const began = wars.filter(
      (w) => w.startYear !== null && w.startYear >= from && w.startYear <= to,
    )
    const ended = wars.filter(
      (w) =>
        w.endYear !== null &&
        w.endYear >= 0 &&
        w.endYear >= from &&
        w.endYear <= to &&
        !began.includes(w),
    )
    const smouldered = wars.length - began.length - ended.length
    const named = began
      .filter((w) => w.name)
      .slice(0, 2)
      .map((w) => titleCase(w.name ?? ''))
    const casualties = battles.reduce((sum, b) => sum + b.casualties, 0)
    const parts: string[] = []
    if (began.length)
      parts.push(
        `${count(began.length, 'war')} began${named.length ? `, among them ${list(named)}` : ''}`,
      )
    if (ended.length) parts.push(`${count(ended.length, 'war')} came to an end`)
    if (smouldered > 0)
      parts.push(
        `${began.length || ended.length ? `${smouldered.toLocaleString()} other${smouldered === 1 ? '' : 's'}` : count(smouldered, 'war')} smouldered on`,
      )
    sentences.push(
      `${sentence(list(parts))}${
        tally.battles
          ? `; ${count(tally.battles, 'battle')} ${casualties ? `cost ${count(casualties, 'life', 'lives')}` : 'were joined'}`
          : ''
      }.`,
    )
  } else if (tally.battles) {
    sentences.push(
      `${count(tally.battles, 'battle was', 'battles were')} fought without a declared war.`,
    )
  }
  const sites: string[] = []
  if (tally.founded) sites.push(`${count(tally.founded, 'site was', 'sites were')} founded`)
  if (tally.conquered) sites.push(`${tally.conquered.toLocaleString()} changed hands`)
  if (tally.ruined) sites.push(`${tally.ruined.toLocaleString()} fell to ruin`)
  if (sites.length) sentences.push(`${sentence(list(sites))}.`)
  if (tally.deaths) {
    sentences.push(
      `${count(tally.deaths, 'figure', 'figures')} died${counts.death && counts.death > tally.deaths ? `, and ${count(counts.death - tally.deaths, 'other creature was', 'other creatures were')} devoured or defiled` : ''}.`,
    )
  }
  const made: string[] = []
  if (tally.artifacts) made.push(`${count(tally.artifacts, 'artifact was', 'artifacts were')} made`)
  if (tally.works) made.push(`${count(tally.works, 'work was', 'works were')} written`)
  if (counts.culture)
    made.push(
      `${count(counts.culture, 'ceremony, performance or feast', 'ceremonies, performances and feasts')} held`,
    )
  if (made.length) sentences.push(`${sentence(list(made))}.`)
  if (counts.intrigue)
    sentences.push(
      `Thieves, schemers and the cursed account for ${count(counts.intrigue, 'entry', 'entries')}.`,
    )
  if (people.length) {
    const names = people
      .filter((p) => p.name)
      .slice(0, 3)
      .map((p) => titleCase(p.name ?? ''))
    if (names.length) sentences.push(`The age belonged to ${list(names)}.`)
  }
  return sentences.join(' ')
}

// ---------------------------------------------------------------------------
// Prose with links: sentences as fragments, so every name stays a way in.

/** A paragraph, or a sentence: text and named records in reading order. */
export type Prose = Fragment[]

export type Part = Fragment | string | null | undefined | false | readonly Part[]

/** How a record's name reads mid-sentence: proper names capitalised, "an unnamed dwarf" left alone. */
export function displayName(name: string): string {
  const clean = cleanName(name)
  return /^an? unnamed /i.test(clean) || /^\w+ #\d+$/.test(clean) ? clean : titleCase(clean)
}

/** A link when the export names the record; the fallback words when it does not. */
export function named(
  names: NameIndex,
  kind: string,
  id: number | null | undefined,
  fallback: string,
): Fragment {
  if (id === null || id === undefined || id < 0) return { text: fallback }
  const name = names[kind]?.[id]
  if (!name) return { text: fallback }
  // "entity #353" stands in for a record without a name; the fallback reads better.
  if (/^\w+ #\d+$/.test(cleanName(name))) return { link: { kind, id }, text: fallback }
  return { link: { kind, id }, text: displayName(name) }
}

export function flat(...parts: Part[]): Prose {
  const out: Prose = []
  const add = (part: Part) => {
    if (!part) return
    if (typeof part === 'string') out.push({ text: part })
    else if (Array.isArray(part)) for (const p of part as readonly Part[]) add(p)
    else out.push(part as Fragment)
  }
  for (const part of parts) add(part)
  return out
}

/** "A", "A and B", "A, B and C", for fragments. */
export function andList(items: Prose[], conjunction = 'and', separator = ', '): Prose {
  // Items that hold commas of their own need "; and" before the last one to stay readable.
  const last = separator === ', ' ? ` ${conjunction} ` : `${separator}${conjunction} `
  const out: Prose = []
  items.forEach((item, i) => {
    if (i > 0) out.push({ text: i === items.length - 1 ? last : separator })
    out.push(...item)
  })
  return out
}

/** One sentence: the first letter raised, a full stop at the end. */
export function said(...parts: Part[]): Prose {
  const out = flat(...parts)
  if (!out.length) return out
  out[0] = { ...out[0], text: sentence(out[0].text) }
  const last = out[out.length - 1]
  if ('link' in last || !/[.!?]$/.test(last.text.trimEnd())) out.push({ text: '.' })
  return out
}

/** Sentences joined into a paragraph; empty ones are skipped. */
export function paragraph(sentences: (Prose | null | undefined)[]): Prose {
  const out: Prose = []
  for (const s of sentences) {
    if (!s?.length) continue
    if (out.length) out.push({ text: ' ' })
    out.push(...s)
  }
  return out
}

/** "a mason", "an axe lord". */
export function withArticle(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`
}

export function counted(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

/** "Name, a goblin clerk of …": a one-line telling set after a name. */
export function appositive(name: Fragment, line: Prose): Prose {
  const rest = line.map((f, i) => {
    let text = f.text
    if (i === 0 && !('link' in f)) text = text.charAt(0).toLowerCase() + text.slice(1)
    if (i === line.length - 1) text = text.replace(/\.\s*$/, '')
    return { ...f, text }
  })
  return flat(name, rest.length ? ', ' : '', rest)
}

/** The same fragments as plain text, for the narrator and the journal. */
export function plainText(prose: Prose): string {
  return prose
    .map((f) => f.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// A span of years, told

const OUTCOMES: Record<string, string> = {
  'attacker won': 'the attackers won',
  'defender won': 'the defenders held',
}

/** A span of years as a chronicler would tell it: power, war, death, building, and whose age it was. */
export function tellSpan(digest: SpanDigest): Prose[] {
  const { from, to, counts, tally, wars, battles, people, powers, deaths, names } = digest
  const total = counts.total ?? 0
  if (total === 0) return [said(`Nothing is recorded for ${spanLabel(from, to)}`)]

  const era = paragraph([
    said(`The chronicles record ${count(total, 'event')} for ${spanLabel(from, to)}`),
    powers.length
      ? said(
          'They speak most of ',
          andList(
            peoplesOf(powers, names),
            new Set(powers.map((p) => p.race)).size < powers.length ? 'as well as' : 'and',
          ),
        )
      : null,
  ])

  const began = wars.filter((w) => w.startYear !== null && w.startYear >= from && w.startYear <= to)
  const ended = wars.filter(
    (w) =>
      w.endYear !== null &&
      w.endYear >= 0 &&
      w.endYear >= from &&
      w.endYear <= to &&
      !began.includes(w),
  )
  const smouldered = wars.length - began.length - ended.length
  const warNames = began.filter((w) => w.name).slice(0, 2)
  const warParts: Prose[] = []
  if (began.length)
    warParts.push(
      flat(
        `${count(began.length, 'war')} began`,
        warNames.length
          ? flat(
              ', among them ',
              andList(
                warNames.map((w) =>
                  flat(named(names, 'historical_event_collection', w.id, 'a war')),
                ),
              ),
            )
          : '',
      ),
    )
  if (ended.length) warParts.push(flat(`${count(ended.length, 'war')} came to an end`))
  if (smouldered > 0)
    warParts.push(
      flat(
        began.length || ended.length
          ? `${smouldered.toLocaleString()} other${smouldered === 1 ? '' : 's'} smouldered on`
          : `${count(smouldered, 'war')} smouldered on`,
      ),
    )
  const bloodiest = battles.find((b) => b.casualties > 0)
  const casualties = battles.reduce((sum, b) => sum + b.casualties, 0)
  const war = paragraph([
    warParts.length
      ? said(warParts.flatMap((part, i) => (i ? [{ text: '; ' }, ...part] : part)))
      : null,
    bloodiest
      ? said(
          'The bloodiest battle was ',
          named(names, 'historical_event_collection', bloodiest.id, 'one the records do not name'),
          bloodiest.year !== null ? ` in ${bloodiest.year}` : '',
          bloodiest.attacker || bloodiest.defender
            ? flat(
                ', where ',
                named(names, 'entity', bloodiest.attacker?.id, 'unknown forces'),
                ' fell upon ',
                named(names, 'entity', bloodiest.defender?.id, 'unknown defenders'),
              )
            : '',
          bloodiest.site
            ? flat(' at ', named(names, 'site', bloodiest.site.id, 'a nameless place'))
            : '',
          `; ${count(bloodiest.casualties, 'soldier')} fell`,
          bloodiest.outcome ? ` and ${OUTCOMES[bloodiest.outcome] ?? bloodiest.outcome}` : '',
        )
      : null,
    tally.battles > 1 && casualties
      ? said(`In all, ${count(tally.battles, 'battle')} cost ${count(casualties, 'life', 'lives')}`)
      : !warParts.length && tally.battles
        ? said(
            `${count(tally.battles, 'battle was', 'battles were')} fought without a declared war`,
          )
        : null,
  ])

  const dead = paragraph([
    tally.deaths ? said(`${count(tally.deaths, 'figure')} died`) : null,
    ...deaths
      .slice(0, 2)
      .map((event) =>
        said(
          typeof event.year === 'number' && event.year >= 0 ? `In ${event.year}, ` : '',
          describeEvent(event, names).fragments,
        ),
      ),
  ])

  const sites: string[] = []
  if (tally.founded) sites.push(`${count(tally.founded, 'site was', 'sites were')} founded`)
  if (tally.conquered) sites.push(`${tally.conquered.toLocaleString()} changed hands`)
  if (tally.ruined) sites.push(`${tally.ruined.toLocaleString()} fell to ruin`)
  const made: string[] = []
  if (tally.artifacts) made.push(`${count(tally.artifacts, 'artifact was', 'artifacts were')} made`)
  if (tally.works) made.push(`${count(tally.works, 'work was', 'works were')} written`)
  const building = paragraph([
    sites.length ? said(list(sites)) : null,
    made.length ? said(list(made)) : null,
  ])

  const named3 = people.filter((p) => p.name).slice(0, 3)
  const age = named3.length
    ? said(
        'The age belonged to ',
        andList(
          named3.map((p) => flat(named(names, 'historical_figure', p.id, 'one without a name'))),
        ),
      )
    : []

  return [era, war, dead, building, age].filter((p) => p.length)
}

/** "the dwarves of A and B" and "the goblins of C", grouped by race in the order given. */
function peoplesOf(powers: SpanDigest['powers'], names: NameIndex): Prose[] {
  const byRace = new Map<string, number[]>()
  for (const power of powers) {
    const race = power.race ?? ''
    byRace.set(race, [...(byRace.get(race) ?? []), power.id])
  }
  return [...byRace.entries()].map(([race, ids]) =>
    flat(
      race ? `the ${racePlural(race)} of ` : '',
      andList(
        ids.map((id) => flat(named(names, 'entity', id, 'a people the records do not name'))),
      ),
    ),
  )
}
