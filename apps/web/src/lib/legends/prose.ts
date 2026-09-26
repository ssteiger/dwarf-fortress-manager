import type { SpanDigest } from './chronicle'
import { titleCase } from './model'

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
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
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
