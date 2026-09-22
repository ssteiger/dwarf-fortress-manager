import fs from 'node:fs'
import { decoderFor } from './cp437'

/**
 * Streaming reader for Dwarf Fortress legends exports.
 *
 * The files are simple element-only XML (no attributes, no CDATA):
 *
 *   <df_world>
 *     <name>...</name>                      depth-1 scalars (legends_plus only)
 *     <historical_figures>                  depth-1 section
 *       <historical_figure> ... </historical_figure>   depth-2 record
 *     </historical_figures>
 *   </df_world>
 *
 * Each depth-2 record is converted to a plain object and yielded as soon as
 * its closing tag is seen, so a 166MB file never has to fit in memory.
 */

export interface LegendsRecord {
  /** Singular element name, e.g. "historical_figure". */
  kind: string
  value: Record<string, unknown>
}

export interface LegendsHeader {
  key: string
  value: string
}

export type LegendsEvent =
  | { type: 'header'; header: LegendsHeader }
  | { type: 'record'; record: LegendsRecord }

/**
 * Child tags that repeat inside one parent. These always become arrays so a
 * figure with a single spouse link has the same shape as one with ten. Any
 * other tag that shows up twice is turned into an array on the fly.
 */
const REPEATED = new Set([
  // historical figures
  'entity_link',
  'hf_link',
  'site_link',
  'entity_position_link',
  'entity_reputation',
  'entity_squad_link',
  'hf_skill',
  'sphere',
  'journey_pet',
  'interaction_knowledge',
  'goal',
  'vague_relationship',
  'honor_entity',
  'intrigue_actor',
  'intrigue_plot',
  'relationship_profile_hf_visual',
  'relationship_profile_hf_historical',
  'relationship_profile_hf_identity',
  'used_identity_id',
  'active_interaction',
  'holds_artifact',
  // entities (legends_plus)
  'entity_position',
  'entity_position_assignment',
  'child',
  'histfig_id',
  'occasion',
  'worship_id',
  'weapon',
  'profession',
  'honor',
  'claim',
  'schedule',
  'feature',
  // sites
  'structure',
  'site_property',
  // event collections
  'event',
  'eventcol',
  'attacking_hfid',
  'defending_hfid',
  'noncom_hfid',
  'attacking_squad_race',
  'attacking_squad_entity_pop',
  'attacking_squad_number',
  'attacking_squad_deaths',
  'attacking_squad_site',
  'defending_squad_race',
  'defending_squad_entity_pop',
  'defending_squad_number',
  'defending_squad_deaths',
  'defending_squad_site',
  'attacking_merc_enid',
  'defending_merc_enid',
  'a_support_merc_enid',
  'd_support_merc_enid',
  'a_support_merc_hfid',
  'd_support_merc_hfid',
  'competitor_hfid',
  'individual_merc',
  // written content
  'style',
  'reference',
])

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

function decodeEntities(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    return ENTITIES[body] ?? whole
  })
}

const INT_RE = /^-?\d{1,15}$/

function scalar(text: string): unknown {
  const trimmed = text.trim()
  if (INT_RE.test(trimmed)) return Number.parseInt(trimmed, 10)
  return decodeEntities(trimmed)
}

interface Node {
  name: string
  text: string
  children: Record<string, unknown> | null
}

function assignChild(parent: Node, name: string, value: unknown) {
  if (!parent.children) parent.children = {}
  const existing = parent.children[name]
  if (REPEATED.has(name)) {
    if (Array.isArray(existing)) existing.push(value)
    else parent.children[name] = [value]
    return
  }
  if (existing === undefined) parent.children[name] = value
  else if (Array.isArray(existing)) existing.push(value)
  else parent.children[name] = [existing, value]
}

/** Read the encoding declared in the XML prolog from the first bytes of a file. */
export async function sniffEncoding(filePath: string): Promise<string | null> {
  const handle = await fs.promises.open(filePath, 'r')
  try {
    const buf = Buffer.alloc(200)
    const { bytesRead } = await handle.read(buf, 0, 200, 0)
    const head = buf.subarray(0, bytesRead).toString('latin1')
    const match = /encoding=['"]([^'"]+)['"]/i.exec(head)
    return match ? match[1] : null
  } finally {
    await handle.close()
  }
}

/**
 * Walk a legends file and yield headers (depth-1 scalars such as the world
 * name) and records (depth-2 elements) in document order.
 */
export async function* readLegendsFile(filePath: string): AsyncGenerator<LegendsEvent> {
  const encoding = await sniffEncoding(filePath)
  const decoder = decoderFor(encoding)
  const stream = fs.createReadStream(filePath, { highWaterMark: 1 << 20 })

  /** Open elements below <df_world>; stack.length is the current depth. */
  const stack: Node[] = []
  let tagBuffer: string | null = null

  const handleTag = (tag: string): LegendsEvent | null => {
    if (tag.startsWith('?') || tag.startsWith('!')) return null

    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim()
      const node = stack.pop()
      if (!node) return null
      const depthAfter = stack.length
      if (depthAfter === 0) {
        // A depth-1 element closed: either a header scalar or a section end.
        if (node.children === null && node.text.trim() !== '') {
          return { type: 'header', header: { key: name, value: decodeEntities(node.text.trim()) } }
        }
        return null
      }
      if (depthAfter === 1) {
        // A record closed inside a section.
        if (node.children) return { type: 'record', record: { kind: name, value: node.children } }
        return null
      }
      const parent = stack[depthAfter - 1]
      assignChild(parent, name, node.children ?? scalar(node.text))
      return null
    }

    const selfClosing = tag.endsWith('/')
    const name = (selfClosing ? tag.slice(0, -1) : tag).trim().split(/\s/)[0]
    if (name === 'df_world') return null
    if (selfClosing) {
      const parent = stack[stack.length - 1]
      if (parent) assignChild(parent, name, true)
      return null
    }
    stack.push({ name, text: '', children: null })
    return null
  }

  for await (const chunk of stream as AsyncIterable<Buffer>) {
    const str = decoder.decode(chunk)
    let i = 0
    const len = str.length
    while (i < len) {
      if (tagBuffer !== null) {
        const close = str.indexOf('>', i)
        if (close === -1) {
          tagBuffer += str.slice(i)
          break
        }
        tagBuffer += str.slice(i, close)
        i = close + 1
        const tag = tagBuffer
        tagBuffer = null
        const event = handleTag(tag)
        if (event) yield event
        continue
      }

      const open = str.indexOf('<', i)
      const textEnd = open === -1 ? len : open
      if (textEnd > i && stack.length) {
        stack[stack.length - 1].text += str.slice(i, textEnd)
      }
      if (open === -1) break
      tagBuffer = ''
      i = open + 1
    }
  }
}
