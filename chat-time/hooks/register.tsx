import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput } from 'claude-code'

import type { Stamp } from '../types'

// Bumped when a time turns up for a message drawn without one: it redraws.
const found = atom({ plugin: 'chat-time', key: 'found' } as const, 0)

const HEAD = 120
// Within this long after a turn, a message with no time yet is taken as new.
const LIVE_MS = 15_000
// The transcript is read again at most this often while a message lacks a time.
const REREAD_MS = 3_000
// A soft blue-grey, apart from the text of either side on light and dark.
const TIME_COLOR = '#7F95B5'
const WEEK = ['日', '月', '火', '水', '木', '金', '土']

// Spacing folded, the head only: how a drawn row and a stored one are matched.
const flat = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, HEAD)

// Like a chat app: `10/22(水) 14:03`, in Japan's time whatever the host's zone.
export function when(at: number): string {
  const d = new Date(at + 9 * 3_600_000)
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEK[d.getUTCDay()]}) ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

const same = (stamp: Stamp, role: Stamp['r'], head: string) =>
  stamp.r === role && (stamp.t === head || stamp.t.startsWith(head) || head.startsWith(stamp.t))

// Module state, filled again after a reload.
let stamps: Stamp[] = []
let lastRead = 0
let liveUntil = 0

const storeKey = async ($: EngineInterface) => `stamps:${await $.session.id()}`

// The session's transcript file, found once among the projects and remembered.
async function transcriptPath($: EngineInterface): Promise<string | null> {
  const id = await $.session.id()
  const remembered = await $.store.get(`path:${id}`)
  if (typeof remembered === 'string' && (await $.fs.exists(remembered))) return remembered

  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  const root = `${home}/.claude/projects`
  for (const project of await $.fs.list(root)) {
    const file = `${root}/${project.name}/${id}.jsonl`
    if (project.kind === 'dir' && (await $.fs.exists(file))) {
      await $.store.set(`path:${id}`, file)

      return file
    }
  }

  return null
}

// Every time the transcript holds, read by a small script: the file is often
// larger than one read of `$.fs` may be. The times this mod noted itself stay.
async function reread($: EngineInterface) {
  lastRead = await $.clock.now()
  try {
    const file = await transcriptPath($)
    if (file === null) return
    const { exitCode, stdout } = await $.process.run(['node', `${$.plugin.root}/hooks/stamps.mjs`, file], {
      timeoutMs: 20_000,
    })
    if (exitCode !== 0) return
    const fromFile = JSON.parse(stdout) as Stamp[]
    const noted = await $.store.get(await storeKey($))
    const mine = Array.isArray(noted) ? (noted as Stamp[]) : []
    stamps = [...fromFile, ...mine.filter(n => !fromFile.some(f => same(f, n.r, n.t)))]
  } catch {
    // No node, no file: the rows go without times.
  }
}

async function note($: EngineInterface, role: Stamp['r'], head: string, at: number) {
  const stamp = { r: role, t: head, at }
  stamps = [...stamps, stamp]
  const key = await storeKey($)
  const noted = await $.store.get(key)
  const mine = Array.isArray(noted) ? (noted as Stamp[]) : []
  // Only the newest few are kept: the transcript has the rest by then.
  await $.store.set(key, [...mine, stamp].slice(-50))
}

// When the message was written, or null while nothing says.
async function timeOf($: EngineInterface, role: Stamp['r'], text: string): Promise<number | null> {
  const head = flat(text)
  if (head === '') return null

  // The latest match: a repeated message is most often the newest one.
  const match = stamps.findLast(stamp => same(stamp, role, head))
  if (match !== undefined) return match.at

  const now = await $.clock.now()
  if (now < liveUntil) {
    await note($, role, head, now)

    return now
  }

  if (now - lastRead > REREAD_MS) {
    $.clock.after(0, async () => {
      await reread($)
      if (stamps.some(stamp => same(stamp, role, head))) await update($, found, n => n + 1)
    })
  }

  return null
}

// The message as the engine draws it, and its time under it: smaller, and in
// a color of its own so it never reads as part of the message.
function stamped($: EngineInterface, e: RenderInput, own: RenderElement, at: number): RenderElement {
  const { Box, Text } = $.ui.resolve(e)

  return (
    <Box flexDirection="column">
      {own}
      <Text size="footnote" color={TIME_COLOR}>
        {when(at)}
      </Text>
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await reread($)
    await update($, found, n => n + 1)

    return started
  })

  on('prompt.submit', async ($, e, next) => {
    const now = await $.clock.now()
    liveUntil = Number.POSITIVE_INFINITY
    const head = flat(e.text)
    // Noting the time must never hold the prompt back.
    if (head !== '') await note($, 'user', head, now).catch(() => undefined)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) liveUntil = (await $.clock.now()) + LIVE_MS

    return next(e)
  })

  // The person's own messages: not a task's notice, not another party's.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    await read($, found)
    if (e.props.origin.kind === 'task-notification' || e.props.from !== undefined) return next(e)

    const at = await timeOf($, 'user', e.props.text)

    return at === null ? next(e) : stamped($, e, await next(e), at)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    await read($, found)
    if (e.props.isSummary === true) return next(e)

    const at = await timeOf($, 'assistant', e.props.text)

    return at === null ? next(e) : stamped($, e, await next(e), at)
  })
}
