/**
 * Dwarf Fortress writes its own legends.xml in code page 437 (the old IBM PC
 * character set) even though the file is XML. Node's TextDecoder does not
 * ship that code page, so this is the upper half of the table.
 */
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0'

if (CP437_HIGH.length !== 128) {
  throw new Error(`CP437 table has ${CP437_HIGH.length} entries, expected 128`)
}

export class Cp437Decoder {
  decode(chunk: Uint8Array): string {
    let out = ''
    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i]
      out += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80]
    }
    return out
  }
}

export interface StreamingDecoder {
  decode(chunk: Uint8Array): string
}

/** Pick a decoder from the encoding named in the XML declaration. */
export function decoderFor(encoding: string | null): StreamingDecoder {
  const name = (encoding ?? 'utf-8').toLowerCase()
  if (name === 'cp437' || name === 'ibm437' || name === '437') return new Cp437Decoder()
  const decoder = new TextDecoder('utf-8', { fatal: false })
  return { decode: (chunk) => decoder.decode(chunk, { stream: true }) }
}
