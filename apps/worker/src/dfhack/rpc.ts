import net from 'node:net'

/**
 * Minimal client for the DFHack remote console.
 *
 * Protocol (see hack/docs/docs/dev/Remote.txt in the DFHack install):
 *   client -> "DFHack?\n" + int32 version(1)
 *   server -> "DFHack!\n" + int32 version
 *   client -> header{int16 id=1 (RunCommand), int16 pad, int32 size} + protobuf CoreRunCommandRequest
 *   server -> zero or more header{id=-3 (TEXT)} + CoreTextNotification, then header{id=-1 (RESULT)} or header{id=-2 (FAIL), size=code}
 *   client -> header{id=-4 (QUIT)}
 *
 * CoreRunCommandRequest: field 1 = command (string), field 2 = arguments (repeated string).
 * CoreTextNotification: field 1 = fragments (repeated CoreTextFragment{ field 1 = text, field 2 = color }).
 */

const RPC_REPLY_RESULT = -1
const RPC_REPLY_FAIL = -2
const RPC_REPLY_TEXT = -3
const RPC_REQUEST_QUIT = -4
const RUN_COMMAND_ID = 1

export class DfhackError extends Error {
  constructor(
    message: string,
    readonly code: 'unreachable' | 'handshake' | 'failed' | 'timeout' | 'protocol',
    readonly commandResult?: number,
  ) {
    super(message)
    this.name = 'DfhackError'
  }
}

export interface RunCommandOptions {
  host: string
  port: number
  timeoutMs?: number
}

function encodeVarint(value: number): Buffer {
  const bytes: number[] = []
  let n = value
  while (true) {
    const b = n & 0x7f
    n >>>= 7
    if (n) bytes.push(b | 0x80)
    else {
      bytes.push(b)
      return Buffer.from(bytes)
    }
  }
}

function encodeStringField(fieldNumber: number, text: string): Buffer {
  const data = Buffer.from(text, 'utf8')
  return Buffer.concat([encodeVarint((fieldNumber << 3) | 2), encodeVarint(data.length), data])
}

function readVarint(buf: Buffer, offset: number): [value: number, next: number] {
  let result = 0
  let shift = 0
  let i = offset
  while (i < buf.length) {
    const b = buf[i++]
    result += (b & 0x7f) * 2 ** shift
    if (!(b & 0x80)) return [result, i]
    shift += 7
    if (shift > 49) break
  }
  throw new DfhackError('bad varint in reply', 'protocol')
}

/** Walk a CoreTextNotification and return the text of every fragment. */
function decodeTextNotification(buf: Buffer): string[] {
  const out: string[] = []
  let i = 0
  while (i < buf.length) {
    const [tag, afterTag] = readVarint(buf, i)
    i = afterTag
    const wire = tag & 7
    const field = tag >>> 3
    if (wire === 2) {
      const [len, afterLen] = readVarint(buf, i)
      i = afterLen
      const chunk = buf.subarray(i, i + len)
      i += len
      if (field === 1) out.push(decodeFragment(chunk))
    } else if (wire === 0) {
      i = readVarint(buf, i)[1]
    } else if (wire === 1) i += 8
    else if (wire === 5) i += 4
    else throw new DfhackError(`unexpected wire type ${wire}`, 'protocol')
  }
  return out
}

function decodeFragment(buf: Buffer): string {
  let text = ''
  let i = 0
  while (i < buf.length) {
    const [tag, afterTag] = readVarint(buf, i)
    i = afterTag
    const wire = tag & 7
    const field = tag >>> 3
    if (wire === 2) {
      const [len, afterLen] = readVarint(buf, i)
      i = afterLen
      if (field === 1) text += buf.subarray(i, i + len).toString('utf8')
      i += len
    } else if (wire === 0) i = readVarint(buf, i)[1]
    else if (wire === 1) i += 8
    else if (wire === 5) i += 4
    else break
  }
  return text
}

function header(id: number, size: number): Buffer {
  const buf = Buffer.alloc(8)
  buf.writeInt16LE(id, 0)
  buf.writeInt16LE(0, 2)
  buf.writeInt32LE(size, 4)
  return buf
}

/**
 * Run one DFHack console command and resolve with everything it printed.
 * Rejects with DfhackError when the game is unreachable or the command fails.
 */
export function runDfhackCommand(
  command: string,
  args: string[],
  { host, port, timeoutMs = 120_000 }: RunCommandOptions,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    const textLines: string[] = []
    let buffer = Buffer.alloc(0)
    let stage: 'handshake' | 'reply' | 'done' = 'handshake'
    let settled = false

    const finish = (err?: DfhackError) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (err) reject(err)
      else resolve(textLines)
    }

    const timer = setTimeout(() => {
      finish(new DfhackError(`DFHack did not answer within ${timeoutMs}ms`, 'timeout'))
    }, timeoutMs)

    socket.setNoDelay(true)
    socket.once('error', (err: NodeJS.ErrnoException) => {
      const code =
        err.code === 'ECONNREFUSED' || err.code === 'EHOSTUNREACH' ? 'unreachable' : 'protocol'
      finish(new DfhackError(`DFHack connection error: ${err.message}`, code))
    })
    socket.once('close', () => {
      if (stage !== 'done')
        finish(new DfhackError('DFHack closed the connection early', 'protocol'))
    })

    socket.connect(port, host, () => {
      const hello = Buffer.alloc(12)
      hello.write('DFHack?\n', 0, 'ascii')
      hello.writeInt32LE(1, 8)
      socket.write(hello)
    })

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      try {
        while (true) {
          if (stage === 'handshake') {
            if (buffer.length < 12) return
            const magic = buffer.subarray(0, 8).toString('ascii')
            if (magic !== 'DFHack!\n') {
              finish(new DfhackError(`unexpected handshake ${JSON.stringify(magic)}`, 'handshake'))
              return
            }
            buffer = buffer.subarray(12)
            stage = 'reply'
            const payload = Buffer.concat([
              encodeStringField(1, command),
              ...args.map((arg) => encodeStringField(2, arg)),
            ])
            socket.write(Buffer.concat([header(RUN_COMMAND_ID, payload.length), payload]))
          } else if (stage === 'reply') {
            if (buffer.length < 8) return
            const id = buffer.readInt16LE(0)
            const size = buffer.readInt32LE(4)
            if (id === RPC_REPLY_FAIL) {
              buffer = buffer.subarray(8)
              stage = 'done'
              socket.write(header(RPC_REQUEST_QUIT, 0))
              finish(
                new DfhackError(
                  `DFHack command failed (code ${size})${textLines.length ? `: ${textLines.join(' ').trim()}` : ''}`,
                  'failed',
                  size,
                ),
              )
              return
            }
            if (buffer.length < 8 + size) return
            const body = buffer.subarray(8, 8 + size)
            buffer = buffer.subarray(8 + size)
            if (id === RPC_REPLY_TEXT) {
              textLines.push(...decodeTextNotification(body))
            } else if (id === RPC_REPLY_RESULT) {
              stage = 'done'
              socket.write(header(RPC_REQUEST_QUIT, 0))
              finish()
              return
            }
          } else return
        }
      } catch (err) {
        finish(err instanceof DfhackError ? err : new DfhackError(String(err), 'protocol'))
      }
    })
  })
}
