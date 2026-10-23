import type { EngineInterface, Register } from 'claude-code'

// The key is watched by helper/ptt.ps1, which drives the app's own voice
// input; this module starts it and shows where it stands.
// One helper runs for every session: it writes the time to
// %TEMP%\push-to-talk.alive every 3 seconds, and each session looks at that
// file every 15 and starts a helper only once it goes stale. A helper that
// finds another one running answers BUSY and exits.
// A reload of this module restarts the helper, so an edit to ptt.ps1 alone
// takes effect only with a real change here too: a reload follows content,
// and an edit undone before the turn ends reloads nothing.
// The helper writes what it saw to %TEMP%\push-to-talk-diag.txt when it
// cannot find the button.
const CHECK_MS = 15_000
const STALE_MS = 10_000

let isRunning = false

async function isAnotherAlive($: EngineInterface, heartbeat: string) {
  try {
    const at = Number(await $.fs.read(heartbeat))
    return (await $.clock.now()) - at < STALE_MS
  } catch {
    return false
  }
}

// Resolves once the helper exits: true when it ran here, false on BUSY.
async function runHelper($: EngineInterface, key: string, idle: string) {
  const helper = $.process.spawn({
    argv: [
      'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', `${$.plugin.root}/helper/ptt.ps1`, '-Key', key,
    ],
  })

  let hasRun = false
  let pending = ''
  for await (const { stream, text } of helper) {
    if (stream === 'stderr') {
      $.ui.log(text, { to: 'debug' })
      continue
    }
    pending += text
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ''

    for (const line of lines) {
      if (line === 'READY') hasRun = true
      if (line === 'REC') $.ui.status('🎙 録音中')
      else if (line === 'READY' || line === 'DONE') $.ui.status(idle)
      else if (line === 'NOBUTTON') $.ui.toast('録音ボタンが見つかりませんでした　Claudeの入力欄を表示してから押してください')
      else if (line.startsWith('ERR ')) {
        $.ui.status(idle)
        $.ui.toast(`音声入力のエラー：${line.slice(4)}`)
      }
    }
  }
  return hasRun
}

async function ensureHelper($: EngineInterface, heartbeat: string, key: string, idle: string) {
  if (isRunning) return
  if (await isAnotherAlive($, heartbeat)) {
    $.ui.status(idle)
    return
  }
  isRunning = true
  try {
    const hasRun = await runHelper($, key, idle)
    if (hasRun) $.ui.toast('音声入力の補助プログラムが止まりました　15秒以内に起動し直します')
  } finally {
    isRunning = false
  }
}

export const register: Register = (on, options) => {
  const key = typeof options.key === 'string' ? options.key : 'RightCtrl'
  const idle = `${key} 長押しで音声入力`

  on('session.start', async ($, e, next) => {
    const started = await next(e)

    const temp = await $.env.get('TEMP')
    if (temp === undefined) return started
    const heartbeat = `${temp}/push-to-talk.alive`

    void ensureHelper($, heartbeat, key, idle)
    $.clock.every(CHECK_MS, () => void ensureHelper($, heartbeat, key, idle))

    return started
  })
}
