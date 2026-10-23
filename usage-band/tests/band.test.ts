import type { FsEntry } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { clawd } from '../hooks/clawd'
import { FULL_HEIGHT, cells, svg, toMeters } from '../hooks/draw'

const BAND = {
  plugin: 'usage-band',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

test('meters are what is left of each window', () => {
  const meters = toMeters({ window: 200_000, percent: 12 }, [
    { kind: 'five_hour', percentUsed: 23.5 },
    { kind: 'seven_day', percentUsed: 100 },
  ])

  expect(meters).toEqual([
    { label: '5H', remaining: 77 },
    { label: '7D', remaining: 0 },
    { label: 'CTX', remaining: 88 },
  ])
})

test('the svg animates and the raster fills its row', () => {
  const meters = toMeters({ window: 200_000 }, [{ kind: 'five_hour', percentUsed: 95 }])

  expect(svg(meters, 600)).toContain('<animate')
  // The percent says it is what is left.
  expect(svg(meters, 600)).toContain('残り')
  expect(svg(meters, 600).length < 131_072).toBe(true)
  // 80 cells of three u32s, base64.
  expect(cells(meters, 80, 3).length).toBe(Math.ceil((80 * 12) / 3) * 4)
})

test('the band follows a measurement on both surfaces', async ($, on) => {
  on('session.measure', (_, e) => ({ changed: e.changed }))
  mock.clock(on, { now: 1_000 })
  mock.store(on)

  await $.session.measure({
    context: { window: 200_000, percent: 40 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 30 }],
    changed: ['context', 'rateLimits'],
  })

  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const drawn = await desktop.find({ type: 'Svg' })
  expect(drawn?.props.alt).toBe('5H 残り70% / CTX 残り60%')
  await desktop.unmount()

  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await terminal.find({ type: 'Raster' }))?.props.columns).toBe(100)
  await terminal.unmount()
})

test('a session with no reading of its own shows the last one any session had', async ($, on) => {
  on('session.measure', (_, e) => ({ changed: e.changed }))
  mock.clock(on, { now: 1_000 })
  mock.store(on)

  await $.session.measure({
    context: { window: 200_000, percent: 10 },
    rateLimits: [{ kind: 'seven_day', percentUsed: 42 }],
    changed: ['context', 'rateLimits'],
  })
  await $.session.measure({
    context: { window: 200_000, percent: 20 },
    rateLimits: [],
    changed: ['context'],
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('7D 残り58% / CTX 残り80%')
  await ui.unmount()
})

test('before any reading, the app’s own usage sample fills the account meters', async ($, on) => {
  on('session.measure', (_, e) => ({ changed: e.changed }))
  mock.clock(on, { now: 10_000 })
  mock.store(on)
  mock.env(on, { APPDATA: 'C:/app' })
  on('fs.read', () => ({
    value: JSON.stringify({
      samples: [{ t: 1, u: { fh: 90, sd: 90 } }, { t: 9_000, u: { fh: 17, sd: 43 } }],
    }),
  }))

  await $.session.measure({
    context: { window: 200_000, percent: 26 },
    rateLimits: [],
    changed: ['context'],
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('5H 残り83% / 7D 残り57% / CTX 残り74%')
  await ui.unmount()
})

test('Clawd sleeps between turns, and its label says what it is at during one', async ($, on) => {
  on('session.measure', (_, e) => ({ changed: e.changed }))
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  await $.session.measure({
    context: { window: 200_000, percent: 40 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 30 }],
    changed: ['context', 'rateLimits'],
  })

  const idle = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const resting = await idle.find({ type: 'Svg' })
  expect(resting?.props.height).toBe(FULL_HEIGHT)
  expect(String(resting?.props.source)).toContain('待機中')
  await idle.unmount()

  const working = await $.ui.mount({
    ...BAND,
    props: { ...BAND.props, isWorking: true },
    surface: 'desktop',
  })
  const drawn = await working.find({ type: 'Svg' })
  expect(String(drawn?.props.source)).toContain('プロンプトを読んでいます')
  expect(String(drawn?.props.source).length < 131_072).toBe(true)
  await working.unmount()
})

test('each pose is labelled, a tool by its name', () => {
  expect(clawd('research', 56, 'Read')).toContain('調べています: Read')
  expect(clawd('work', 56, 'a<b')).toContain('実行中: a&lt;b')
  expect(clawd('talk', 56)).toContain('返答中')
  expect(clawd('done', 56)).toContain('完了!')
})

test('a named chat gets its mark in the sidebar, once, and keeps the same one', async ($, on) => {
  let table = JSON.stringify({ byCli: { other: '🔴' } })
  let title = 'ロゴ制作'
  const renames: string[] = []
  const clock = mock.clock(on, { now: 1_000 })
  mock.store(on)
  mock.env(on, { USERPROFILE: 'C:/me', APPDATA: 'C:/app' })
  on('session.id', () => ({ value: 'this-chat' }))
  on('fs.list', (_, e) => {
    const path = String(e.path)
    const entry = path.endsWith('space')
      ? { name: 'local_1.json', kind: 'file' as const, size: 1 }
      : { name: path.endsWith('sessions') ? 'account' : 'space', kind: 'dir' as const, size: 0 }

    return { value: [entry] as FsEntry[] }
  })
  on('fs.read', (_, e) => ({
    value: String(e.path).endsWith('chat-colors.json') ? table : JSON.stringify({ cliSessionId: 'this-chat', title }),
  }))
  on('fs.write', (_, e) => {
    table = e.text

    return { value: undefined }
  })
  on('tool.call', (_, e) => {
    renames.push(String((e as { title?: unknown }).title))
    title = renames[renames.length - 1] ?? title

    return { result: null, text: 'ok' }
  })
  on('turn.complete', () => ({ text: '' }))

  await $.turn.complete({ turnId: 't', reason: 'answer', answer: '', durationMs: 1, isAborted: false })
  await clock.advance(2_000)
  await clock.settle()

  const mark = JSON.parse(table).byCli['this-chat']
  expect(mark !== undefined && mark !== '🔴').toBe(true)
  expect(renames).toEqual([`${mark} ロゴ制作`])
})

test('the suggestion is written into the desktop box, and an empty send carries it', async ($, on) => {
  const sent: string[] = []
  const filled: string[] = []
  on('prompt.suggest', () => ({ isShown: true }))
  on('session.surface', () => ({ value: 'desktop' as const }))
  on('prompt.fill', (_, e) => {
    filled.push(`${e.mode}:${e.text}`)

    return { isFilled: true }
  })
  on('prompt.submit', (_, e) => {
    sent.push(e.text)

    return { text: e.text }
  })

  await $.prompt.suggest({ text: '進めて', origin: { kind: 'suggestion' } })
  expect(filled).toEqual(['replace:進めて'])

  const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' as const } })
  await $.prompt.submit(typed(''))
  await $.prompt.submit(typed(''))
  await $.prompt.submit(typed('別のこと'))

  expect(sent).toEqual(['進めて', '', '別のこと'])
})

test('a Fable weekly window, when one is reported, gets a meter of its own', () => {
  const meters = toMeters({ window: 200_000, percent: 10 }, [
    { kind: 'seven_day', percentUsed: 91 },
    { kind: 'seven_day_fable', percentUsed: 12 },
  ])

  expect(meters).toEqual([
    { label: '7D', remaining: 9 },
    { label: 'FB', remaining: 88 },
    { label: 'CTX', remaining: 90 },
  ])
})
