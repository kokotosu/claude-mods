import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Figure, Pose } from '../types'
import { clawd, SCENE_HEIGHT } from './clawd'
import { FULL_HEIGHT, cells, describe, svg, toMeters } from './draw'

const meters = { plugin: 'usage-band', key: 'meters' } as const
const figure = { plugin: 'usage-band', key: 'figure' } as const
const ASLEEP: Figure = { pose: 'doze', note: '' }
const hint = { plugin: 'usage-band', key: 'hint' } as const
// How long Clawd cheers a finished turn before it sleeps.
const CHEER_MS = 1800

const RASTER_KEY = 'bar'
const FRAME_MS = 150
const CELL_PX = 7.8
// The rate-limit windows are the account's, not one session's: the newest
// reading any session had is kept here for the sessions that have none yet.
const SHARED_KEY = 'rateLimits'
const SHARED_POLL_MS = 30_000

type Shared = { at: number; limits: SessionRateLimit[] }

const isShared = (value: unknown): value is Shared =>
  typeof value === 'object' && value !== null && Array.isArray((value as Shared).limits)

// A window whose reset time has passed is full again.
const afterResets = (limits: SessionRateLimit[], now: number) =>
  limits.map(limit =>
    limit.resetsAt !== undefined && Date.parse(limit.resetsAt) <= now
      ? { ...limit, percentUsed: 0 }
      : limit,
  )

// Module state: a reload starts both over, and session.start fills them again.
let context: SessionContextUsage = { window: 0 }
let sharedAt = 0
// The pose last struck, so a stream of chunks asks the host only on a change.
let struck = ''

// Tools that only look something up; every other tool changes or runs something.
const LOOKUPS = /^(Read|Grep|Glob|WebSearch|WebFetch|ToolSearch|Agent|Task|Skill|NotebookRead)$|(search|read|get|list|fetch|find|query|view|status)/i

// A tool's name as the label shows it: an MCP tool's own name, kept short.
const named = (tool: string) => (tool.split('__').pop() ?? tool).slice(0, 28)

// Clawd's pose is the session's state, not the module's: it outlasts a reload,
// and writing it redraws the band.
async function strike($: EngineInterface, pose: Pose, note = '') {
  if (struck === `${pose} ${note}`) return
  struck = `${pose} ${note}`

  const { value = ASLEEP } = await $.state.get(figure)
  if (value.pose !== pose || value.note !== note) await $.state.set(figure, { pose, note })
}

// The cheer over, it sleeps, unless another turn has begun meanwhile.
async function rest($: EngineInterface) {
  const { value = ASLEEP } = await $.state.get(figure)
  if (value.pose === 'done') await strike($, 'doze')
}

// The marks a chat's name may begin with, one color each, and the table that
// says which chat has which: a chat keeps the color it was first given.
const MARKS = ['🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '🟤', '⚫', '⚪']

type ColorTable = { byCli?: Record<string, string> } & Record<string, unknown>

// This chat's mark: the one the table has for it, else one drawn at random
// from the marks fewest chats have, and written to the table for good.
async function markOf($: EngineInterface): Promise<string> {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  const file = `${home}/.claude/mods/chat-colors.json`
  const id = await $.session.id()
  const table = JSON.parse(String(await $.fs.read(file))) as ColorTable
  const byCli = table.byCli ?? {}
  const known = byCli[id]
  if (known !== undefined) return known

  const used = MARKS.map(mark => Object.values(byCli).filter(given => given === mark).length)
  const least = MARKS.filter((_, i) => used[i] === Math.min(...used))
  const drawn = least[crypto.getRandomValues(new Uint32Array(1))[0]! % least.length] ?? MARKS[0]!
  await $.fs.write(file, `${JSON.stringify({ ...table, byCli: { ...byCli, [id]: drawn } }, null, 2)}\n`)

  return drawn
}

// The app's tool that renames a chat in the sidebar.
const RENAME = 'mcp__ccd_session_mgmt__set_session_title'

// The app's record of one session, when it is this session's.
async function titleIn($: EngineInterface, file: string, id: string): Promise<string | null> {
  try {
    const record = JSON.parse(String(await $.fs.read(file))) as { cliSessionId?: unknown; title?: unknown }

    return record.cliSessionId === id && typeof record.title === 'string' ? record.title : null
  } catch {
    return null
  }
}

// The chat's name as the sidebar has it: the desktop app keeps it in its own
// record of the session, found once among its records and remembered.
async function sidebarName($: EngineInterface): Promise<string | null> {
  const id = await $.session.id()
  const remembered = await $.store.get(`record:${id}`)
  if (typeof remembered === 'string') {
    const title = await titleIn($, remembered, id)
    if (title !== null) return title
  }

  const appData = await $.env.get('APPDATA')
  const home = await $.env.get('HOME')
  const root = `${appData !== undefined ? `${appData}/Claude` : `${home}/Library/Application Support/Claude`}/claude-code-sessions`
  for (const account of await $.fs.list(root)) {
    for (const space of await $.fs.list(`${root}/${account.name}`)) {
      const folder = `${root}/${account.name}/${space.name}`
      for (const entry of await $.fs.list(folder)) {
        if (entry.kind !== 'file' || !entry.name.startsWith('local_')) continue
        const title = await titleIn($, `${folder}/${entry.name}`, id)
        if (title !== null) {
          await $.store.set(`record:${id}`, `${folder}/${entry.name}`)

          return title
        }
      }
    }
  }

  return null
}

// Puts the chat's mark in front of its name in the sidebar, once it has a
// name and whenever a rename has dropped the mark. Failing changes nothing.
async function colorName($: EngineInterface) {
  try {
    const title = (await sidebarName($))?.trim() ?? ''
    if (title === '') return

    const mark = await markOf($)
    if (title.startsWith(`${mark} `)) return

    const bare = MARKS.reduce((name, other) => (name.startsWith(other) ? name.slice(other.length) : name), title).trim()
    if (bare !== '') await $.tool.call({ tool: RENAME, session_id: 'self', title: `${mark} ${bare}` })
  } catch {
    // No record, no table or no such tool here: the name stays as it is.
  }
}

// The desktop app samples the account's usage itself, every few minutes, into
// a file of its own: what a session reads before its first response.
async function appSample($: EngineInterface): Promise<Shared | null> {
  try {
    const appData = await $.env.get('APPDATA')
    const home = await $.env.get('HOME')
    const folder =
      appData !== undefined ? `${appData}/Claude` : `${home}/Library/Application Support/Claude`
    const text = await $.fs.read(`${folder}/plan-usage-history.json`)
    const samples: unknown = JSON.parse(String(text)).samples
    const last = Array.isArray(samples) ? samples[samples.length - 1] : undefined
    if (typeof last?.t !== 'number') return null

    const now = await $.clock.now()
    const limits: SessionRateLimit[] = []
    // A five-hour reading older than its window says nothing any more.
    if (typeof last.u?.fh === 'number' && now - last.t < 5 * 3_600_000) {
      limits.push({ kind: 'five_hour', percentUsed: last.u.fh })
    }
    if (typeof last.u?.sd === 'number') limits.push({ kind: 'seven_day', percentUsed: last.u.sd })

    return limits.length > 0 ? { at: last.t, limits } : null
  } catch {
    return null
  }
}

// The newest reading from outside this session: another session's, or the app's.
async function latestShared($: EngineInterface): Promise<Shared | null> {
  const stored = await $.store.get(SHARED_KEY)
  const fromStore = isShared(stored) ? stored : null
  const fromApp = await appSample($)

  if (fromStore === null || fromApp === null) return fromStore ?? fromApp
  return fromApp.at > fromStore.at ? fromApp : fromStore
}

async function show($: EngineInterface, reported: SessionRateLimit[]) {
  const now = await $.clock.now()
  let limits = reported

  // Sharing the reading is a nicety: the meters are drawn whether or not it works.
  try {
    if (reported.length > 0) {
      // A window this reading leaves out (Fable's, which only a session on
      // Fable hears of) is kept from the last reading that had it.
      const stored = await $.store.get(SHARED_KEY)
      const kept = isShared(stored)
        ? stored.limits.filter(old => !reported.some(fresh => fresh.kind === old.kind))
        : []
      limits = [...reported, ...kept]
      sharedAt = now
      await $.store.set(SHARED_KEY, { at: now, limits })
    } else {
      const shared = await latestShared($)
      if (shared !== null) {
        sharedAt = shared.at
        limits = shared.limits
      }
    }
  } catch {
    limits = reported
  }

  await $.state.set(meters, toMeters(context, afterResets(limits, now)))
}

export const register: Register = on => {
  // The terminal's mounted Raster, for the frame timer to repaint; the
  // desktop's SVG animates itself.
  let mounted: { requestId: string; columns: number } | null = null
  let tick = 0

  on('session.start', async ($, e, next) => {
    // A failure here must not cost the session its band: the first
    // measurement fills the meters in if this cannot.
    try {
      const usage = await $.session.usage()
      context = usage.context
      await show($, usage.rateLimits)
    } catch {
      await $.state.set(meters, toMeters(context, []))
    }

    // Another session's newer reading moves this one's bars too.
    $.clock.every(SHARED_POLL_MS, async () => {
      const shared = await latestShared($)
      if (shared !== null && shared.at > sharedAt) await show($, [])
    })

    // A chat reopened under a name with no mark gets it back.
    $.clock.after(0, () => {
      void colorName($)
    })

    $.clock.every(FRAME_MS, async () => {
      if (mounted === null) return

      tick += 1
      const { requestId, columns } = mounted
      const { value = [] } = await $.state.get(meters)
      const result = await $.ui.blit({
        requestId,
        key: RASTER_KEY,
        cells: cells(value, columns, tick),
      })

      if ('deny' in result) mounted = null
    })

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    context = e.context
    await show($, e.rateLimits)

    return next(e)
  })

  // A turn begins with the prompt and ends at `turn.complete`.
  // The desktop box will not send while it is empty, so the suggestion it
  // would show dim is written into it instead: Enter then sends it as it
  // stands. It is remembered too, for a surface that does send an empty box.
  on('prompt.suggest', async ($, e, next) => {
    const shown = await next(e)
    await $.state.set(hint, shown.isShown ? e.text : '')
    if (shown.isShown && (await $.session.surface()) === 'desktop') {
      await $.prompt.fill({ text: e.text, mode: 'replace' })
    }

    return shown
  })

  on('prompt.submit', async ($, e, next) => {
    await strike($, 'think')

    const { value: suggested = '' } = await $.state.get(hint)
    if (suggested !== '') await $.state.set(hint, '')

    return next(e.text.trim() === '' && suggested !== '' ? { ...e, text: suggested } : e)
  })

  on('turn.complete', async ($, e, next) => {
    // A subagent's turn ending is not the chat's.
    if (e.agentId !== undefined) return next(e)

    await strike($, e.reason === 'answer' ? 'done' : 'doze')
    // The app names a chat during its first turns: the mark follows the name.
    $.clock.after(CHEER_MS, () => {
      void rest($)
      void colorName($)
    })

    return next(e)
  })

  // What the main conversation's model is doing picks the pose.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)

    await strike($, 'think')
    const stream = next(e)
    for await (const chunk of stream) {
      if (chunk.kind === 'text') await strike($, 'talk')
      if (chunk.kind === 'thinking') await strike($, 'think')
      yield chunk
    }

    return await stream.result
  })

  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    // The mod's own rename is not the model at work.
    if (tool === RENAME) return next(e)

    await strike($, LOOKUPS.test(tool) ? 'research' : 'work', named(tool))
    try {
      return await next(e)
    } finally {
      await strike($, 'think')
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { value: current = [] } = await $.state.get(meters)

    if (e.props.hasSurvey) {
      return next(e)
    }

    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      const columns = Math.max(1, Math.min(512, e.props.bodyColumns))
      mounted = { requestId: e.requestId, columns }

      return (
        <Raster key={RASTER_KEY} columns={columns} rows={1} cells={cells(current, columns, tick)} />
      )
    }

    if (e.surface === 'desktop') {
      const { Svg } = $.ui.resolve(e)

      // The slot's width is known only in cells; a cell is about this wide.
      const width = Math.max(240, Math.round(e.props.bodyColumns * CELL_PX))
      const { value: standing = ASLEEP } = await $.state.get(figure)
      // While a turn runs it is never asleep; between turns it only cheers or sleeps.
      const resting = standing.pose === 'doze' || standing.pose === 'done'
      const pose = e.props.isWorking ? (resting ? 'think' : standing.pose) : resting ? standing.pose : 'doze'
      const character = clawd(pose, SCENE_HEIGHT, pose === standing.pose ? standing.note : '')

      return (
        <Svg
          source={svg(current, width, character)}
          alt={describe(current)}
          width={width}
          height={FULL_HEIGHT}
          isInteractive
        />
      )
    }

    return next(e)
  })
}
