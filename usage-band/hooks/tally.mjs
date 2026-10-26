// Adds up the tokens each chat used over the last days, from Claude Code's own
// transcripts, and prints the chats in order as JSON. Run by the mod with
// node; it keeps how far it has read each transcript in a cache, so a run
// after the first only reads what was written since.

import { createReadStream, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

const DAYS = Number(process.argv[2] ?? 7)
const HOME = homedir()
const PROJECTS = join(HOME, '.claude', 'projects')
const CACHE = join(HOME, '.claude', 'mods', 'usage-tally-cache.json')
const DAY_MS = 86_400_000
const now = Date.now()
const since = now - DAYS * DAY_MS
const day = ms => new Date(ms).toISOString().slice(0, 10)
const firstDay = day(since)

const loadCache = () => {
  try {
    return JSON.parse(readFileSync(CACHE, 'utf8'))
  } catch {
    return { files: {} }
  }
}

// Every transcript, a subagent's counted to the chat that started it.
function transcripts() {
  const found = []
  const walk = (folder, depth) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory() && depth < 3) walk(path, depth + 1)
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) found.push(path)
    }
  }
  if (existsSync(PROJECTS)) walk(PROJECTS, 0)

  return found.map(path => {
    const parent = basename(dirname(path)) === 'subagents' ? basename(dirname(dirname(path))) : null
    return { path, session: parent ?? basename(path, '.jsonl') }
  })
}

// Reads a transcript from where the last run stopped, to its last whole line.
// One reply is written as several lines that carry the same usage: it counts once.
async function readOn(path, kept, size) {
  const record = kept && kept.size <= size ? kept : { size: 0, offset: 0, lastId: '', byDay: {} }
  if (record.offset >= size) return { ...record, size }

  let rest = ''
  let offset = record.offset
  let lastId = record.lastId
  const byDay = { ...record.byDay }
  const stream = createReadStream(path, { start: record.offset, end: size - 1, encoding: 'utf8' })
  for await (const chunk of stream) {
    const text = rest + chunk
    const lines = text.split('\n')
    rest = lines.pop() ?? ''
    for (const line of lines) {
      offset += Buffer.byteLength(line, 'utf8') + 1
      if (!line.includes('"usage"')) continue
      try {
        const row = JSON.parse(line)
        const usage = row.message?.usage
        const id = row.message?.id ?? row.requestId
        if (!usage || id === lastId) continue
        lastId = id
        const tokens =
          (usage.input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.output_tokens ?? 0)
        const when = day(Date.parse(row.timestamp ?? '') || now)
        byDay[when] = (byDay[when] ?? 0) + tokens
      } catch {
        // A line being written as we read it: the next run reads it whole.
      }
    }
  }

  return { size, offset, lastId, byDay }
}

// The chats' names as the desktop app's sidebar has them, by session id.
function sidebarNames() {
  const roots = []
  if (process.env.APPDATA) roots.push(join(process.env.APPDATA, 'Claude', 'claude-code-sessions'))
  const data = process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Claude-Data')
  if (data && existsSync(data)) {
    for (const entry of readdirSync(data)) roots.push(join(data, entry, 'claude-code-sessions'))
  }
  roots.push(join(HOME, 'Library', 'Application Support', 'Claude', 'claude-code-sessions'))

  const names = {}
  const walk = (folder, depth) => {
    if (!existsSync(folder)) return
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (entry.isDirectory() && depth < 3) walk(path, depth + 1)
      else if (entry.isFile() && entry.name.startsWith('local_') && entry.name.endsWith('.json')) {
        try {
          const record = JSON.parse(readFileSync(path, 'utf8'))
          if (record.cliSessionId && typeof record.title === 'string') names[record.cliSessionId] = record.title
        } catch {
          // A record being rewritten: its name comes next run.
        }
      }
    }
  }
  for (const root of roots) walk(root, 0)

  return names
}

const cache = loadCache()
const files = {}
const bySession = {}
for (const { path, session } of transcripts()) {
  const stat = statSync(path)
  const kept = cache.files[path]
  // A transcript untouched since before the window adds nothing to it.
  if (stat.mtimeMs < since && !kept) continue
  const record = stat.mtimeMs < since ? kept : await readOn(path, kept, stat.size)
  // Days that have left the window are dropped from the cache.
  record.byDay = Object.fromEntries(Object.entries(record.byDay).filter(([d]) => d >= firstDay))
  if (stat.mtimeMs < since && Object.keys(record.byDay).length === 0) continue
  files[path] = record
  for (const tokens of Object.values(record.byDay)) bySession[session] = (bySession[session] ?? 0) + tokens
}
writeFileSync(CACHE, JSON.stringify({ files }))

const names = sidebarNames()
const chats = Object.entries(bySession)
  .filter(([, tokens]) => tokens > 0)
  .map(([id, tokens]) => ({ id, title: names[id] ?? '名前なし', tokens }))
  .sort((a, b) => b.tokens - a.tokens)

// A chat's role without its mark, its generation or its number: 「📹 編集担当3（道具箱）」
// and 「編集担当」 are both 編集担当, so what the tokens went on adds up.
const role = title =>
  title
    .replace(/^[\p{Extended_Pictographic}\p{Emoji_Component}\s]+/u, '')
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s\d０-９]+$/, '')
    .trim() || title

const byRole = new Map()
for (const chat of chats) {
  const name = role(chat.title)
  const group = byRole.get(name) ?? { name, tokens: 0, chats: 0 }
  group.tokens += chat.tokens
  group.chats += 1
  byRole.set(name, group)
}
const groups = [...byRole.values()].sort((a, b) => b.tokens - a.tokens)

process.stdout.write(JSON.stringify({ at: now, days: DAYS, groups }))
