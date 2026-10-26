import type { FsEntry } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { amount, donut, pieces } from '../hooks/donut'
import { FULL_HEIGHT, cells, describe, resetIn, svg, toMeters } from '../hooks/draw'

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

test('each window says how long until it resets', () => {
  const NOW = Date.parse('2026-10-26T03:00:00Z')
  const at = (ms: number) => new Date(NOW + ms).toISOString()
  const M = 60_000
  const [five, week, ctx] = toMeters({ window: 200_000 }, [
    { kind: 'five_hour', percentUsed: 30, resetsAt: at(135 * M) },
    { kind: 'seven_day', percentUsed: 80, resetsAt: at((3 * 24 * 60 + 300) * M) },
  ])

  // The five-hour window in hours and minutes.
  expect(resetIn(five!, NOW)).toBe('2時間15分')
  // The week in days, then hours and minutes under a day, then minutes.
  expect(resetIn(week!, NOW)).toBe('3日')
  expect(resetIn({ ...week!, resetsAt: NOW + (23 * 60 + 59) * M }, NOW)).toBe('23時間59分')
  expect(resetIn({ ...week!, resetsAt: NOW + 5 * 60 * M }, NOW)).toBe('5時間0分')
  expect(resetIn({ ...week!, resetsAt: NOW + 42 * M }, NOW)).toBe('42分')
  // No time for the context, nor once the reset has passed.
  expect(resetIn(ctx!, NOW)).toBe('')
  expect(resetIn(five!, NOW + 200 * M)).toBe('')

  expect(describe([five!], NOW)).toBe('5H 残り70% リセットまで2時間15分')
  expect(svg([five!, week!, ctx!], 780, '', false, NOW)).toContain('リセットまで 2時間15分')
  // A narrow share keeps only the time.
  expect(svg([five!, week!, ctx!], 400, '', false, NOW)).toContain('↻ 3日')
})

test('the svg animates and the raster fills its row', () => {
  const meters = toMeters({ window: 200_000 }, [{ kind: 'five_hour', percentUsed: 95 }])

  expect(svg(meters, 600)).toContain('<animate')
  // The percent says it is what is left.
  expect(svg(meters, 600)).toContain('残り')
  expect(svg(meters, 600).length < 131_072).toBe(true)
  // The numbers and bars glow; the glow drifts only while Claude is at work.
  const calm = svg(toMeters({ window: 200_000 }, [{ kind: 'five_hour', percentUsed: 40 }]), 600)
  expect(calm).toContain('fill="url(#ub-n0)"')
  expect(calm).not.toContain('<animate')
  expect(svg(meters, 600, '', true)).toContain('<animateTransform attributeName="gradientTransform"')
  // 80 cells of three u32s, base64.
  expect(cells(meters, 80, 3).length).toBe(Math.ceil((80 * 12) / 3) * 4)
})

test('the band follows a measurement on both surfaces', async ($, on) => {
  on('session.measure', (_, e) => ({ changed: e.changed }))
  mock.clock(on, { now: 1_000 })
  mock.store(on)
  // The engine's own band, which this one sits on.
  on('ui.render', () => ({ type: 'engine', ref: 1 }) as never)

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
  // The engine's own band, which this one sits on.
  on('ui.render', () => ({ type: 'engine', ref: 1 }) as never)

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
  // The engine's own band, which this one sits on.
  on('ui.render', () => ({ type: 'engine', ref: 1 }) as never)
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

test('the ring shows the largest roles and sums the rest', () => {
  const groups = ['編集担当', 'OG 統括', 'インスタ 統括', '参考動画リサーチ', 'IG統括', '料金統括', '音担当'].map(
    (name, i) => ({ name, tokens: (7 - i) * 1e8 }),
  )
  const sum = { at: 1, days: 7, groups }

  // Wide: five named and the rest; narrow: three named and the rest.
  expect(pieces(groups, 5).map(piece => piece.name)).toEqual([...groups.slice(0, 5).map(g => g.name), 'その他'])
  expect(pieces(groups, 3)[3]).toMatchObject({ name: 'その他', tokens: 10e8 })
  expect(amount(28e8)).toBe('28億')
  expect(amount(1.25e8)).toBe('1.3億')
  expect(amount(85_000_000)).toBe('8,500万')

  const wide = donut(sum, 900)
  expect(wide).toContain('28億')
  expect(wide).toContain('編集担当')
  expect(wide).toContain('その他')
  expect(donut(sum, 300)).not.toContain('IG統括')
  expect(donut({ ...sum, groups: [{ name: 'a<b', tokens: 5 }] }, 600)).toContain('a&lt;b')
  expect(donut(null, 600)).toBe('')
})

test('the band adds up the transcripts once, and draws the sum above the meters', async ($, on) => {
  const runs: string[][] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.usage', () => ({ value: { context: { window: 200_000, percent: 40 }, rateLimits: [] } as never }))
  const clock = mock.clock(on, { now: 1_000 })
  mock.store(on)
  // The engine's own band, which this one sits on.
  on('ui.render', () => ({ type: 'engine', ref: 1 }) as never)
  on('process.run', (_, e) => {
    runs.push([...e.argv])
    const groups = [{ name: '編集担当', tokens: 3e8 }, { name: '料金統括', tokens: 1e8 }]

    return { value: { exitCode: 0, stdout: JSON.stringify({ at: 1_000, days: 7, groups }), stderr: '' } as never }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.advance(10)
  await clock.settle()
  await $.session.measure({
    context: { window: 200_000, percent: 40 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 30 }],
    changed: ['context', 'rateLimits'],
  })

  expect(runs.length).toBe(1)
  expect(runs[0]?.[0]).toBe('node')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const drawn = await ui.find({ type: 'Svg' })
  expect(drawn?.props.height).toBe(FULL_HEIGHT)
  expect(drawn?.props.alt).toBe('7日間のトークン 4.0億: 編集担当 75%、料金統括 25% / 5H 残り70% / CTX 残り60%')
  expect(String(drawn?.props.source)).toContain('stroke-dasharray')
  expect(String(drawn?.props.source).length < 131_072).toBe(true)
  await ui.unmount()
})

test('a named chat gets its mark in the sidebar, once, and keeps the same one', async ($, on) => {
  let table = JSON.stringify({ byCli: { other: '🔴' } })
  let title = 'ロゴ制作'
  const renames: string[] = []
  const clock = mock.clock(on, { now: 1_000 })
  mock.store(on)
  // The engine's own band, which this one sits on.
  on('ui.render', () => ({ type: 'engine', ref: 1 }) as never)
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
