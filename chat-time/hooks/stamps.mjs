// Reads a session's transcript file and prints, as JSON, when each message of
// the main conversation was written: [{ r, t, at }], `r` the role, `t` the
// head of its text with the spacing folded, `at` milliseconds since the epoch.
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

const HEAD = 120
const flat = text => text.replace(/\s+/g, ' ').trim().slice(0, HEAD)

const textOf = content =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter(block => block?.type === 'text').map(block => block.text ?? '').join('\n')
      : ''

const out = []
const lines = createInterface({ input: createReadStream(process.argv[2], 'utf8'), crlfDelay: Infinity })
for await (const line of lines) {
  if (line === '') continue
  let row
  try {
    row = JSON.parse(line)
  } catch {
    continue
  }
  if ((row.type !== 'user' && row.type !== 'assistant') || row.isSidechain || row.isMeta) continue
  const text = flat(textOf(row.message?.content))
  const at = Date.parse(row.timestamp)
  if (text !== '' && !Number.isNaN(at)) out.push({ r: row.type, t: text, at })
}
process.stdout.write(JSON.stringify(out))
