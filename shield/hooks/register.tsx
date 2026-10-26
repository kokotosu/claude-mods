import type { EngineInterface, Register } from 'claude-code'

import type { ShieldEvent, ShieldTally } from '../types'
import { check, isCheckable } from './check'
import { otherChats } from './chats'
import { CHATS_HEIGHT, FRESH_MS, HEIGHT, chatButtons, describe, describeChats, kindSvg, nameOf, svg } from './draw'
import { dangerOf, isSecret } from './rules'

const last = { plugin: 'shield', key: 'last' } as const
const tally = { plugin: 'shield', key: 'tally' } as const
const others = { plugin: 'shield', key: 'others' } as const
// How often this chat looks at the shared scan of the others.
const CHATS_EVERY_MS = 5_000
const NONE: ShieldTally = { stopped: 0, allowed: 0, checked: 0, broken: 0 }

// The slot's width is known only in cells; a cell is about this wide.
const CELL_PX = 7.8

const RUN = '実行する'
const STOP = 'やめる'

// Records what happened, counts it, and redraws once it is no longer new.
async function record($: EngineInterface, event: Omit<ShieldEvent, 'at'>, counted: (keyof ShieldTally)[]) {
  const at = await $.clock.now()
  const { value: counts = NONE } = await $.state.get(tally)
  const next = { ...counts }
  for (const key of counted) next[key] += 1

  await $.state.set(tally, next)
  await $.state.set(last, { ...event, at })
  $.clock.after(FRESH_MS + 100, () => $.ui.invalidate('ui.render'))
}

// Asks the person before something that cannot be undone. Nobody there to
// ask, or the question closed, is a no.
async function permits($: EngineInterface, what: string, subject: string): Promise<boolean> {
  try {
    const answer = await $.ui.ask(`危ない操作です（${what}）。実行しますか？\n${subject.slice(0, 300)}`, {
      header: 'SHIELD',
      options: [RUN, STOP],
    })
    return answer === RUN
  } catch {
    return false
  }
}

const stopped = (what: string) =>
  `SHIELD: この操作（${what}）はユーザーが止めました。実行せずに、別のやり方にするか、どうするかユーザーに聞いてください。`

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path

// A dangerous command waits for the person's word.
async function guardCommand($: EngineInterface, command: string): Promise<string | null> {
  const danger = dangerOf(command)
  if (danger === null) return null

  const isAllowed = await permits($, danger.what, command)
  await record(
    $,
    { kind: isAllowed ? 'allowed' : 'stopped', subject: command, detail: danger.what },
    [isAllowed ? 'allowed' : 'stopped'],
  )

  return isAllowed ? null : stopped(danger.what)
}

// A file Claude writes: a secret one waits for the person's word, and any
// one it can read is checked once written. A broken one goes back to Claude.
async function guardFile($: EngineInterface, path: string): Promise<string | null> {
  if (!isSecret(path)) return null
  const what = 'パスワードや鍵が入るファイルを書き換える'
  const isAllowed = await permits($, what, path)
  await record($, { kind: isAllowed ? 'allowed' : 'stopped', subject: fileName(path), detail: what }, [
    isAllowed ? 'allowed' : 'stopped',
  ])

  return isAllowed ? null : stopped(what)
}

async function checkFile<R extends { deny?: unknown; isError?: unknown; context?: readonly string[] }>($: EngineInterface, path: string, ran: R): Promise<R> {
  if (ran.deny !== undefined || ran.isError === true || !isCheckable(path)) return ran
  const verdict = await check($, path)
  if (verdict === null) return ran

  if (verdict.isOk) {
    await record($, { kind: 'ok', subject: fileName(path), detail: '書いたファイルに構文エラーはありません' }, ['checked'])
    return ran
  }

  const where = verdict.line !== undefined ? `${fileName(path)}:${verdict.line}` : fileName(path)
  await record($, { kind: 'broken', subject: where, detail: verdict.message }, ['checked', 'broken'])

  return {
    ...ran,
    context: [
      ...(ran.context ?? []),
      `SHIELD: いま書いた ${path} に構文エラーがあります${verdict.line !== undefined ? `（${verdict.line}行目あたり）` : ''}: ${verdict.message}\n先にこれを直してください。`,
    ],
  }
}

// Opens another chat in the app, as its sidebar row does: the app answers
// its own claude:// link, which the system is handed to open.
async function openChat($: EngineInterface, id: string) {
  if (!/^local_[0-9a-f-]+$/i.test(id)) return
  const link = `claude://claude.ai/epitaxy/${id}`
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  try {
    const { exitCode } = await $.process.run(
      isWindows ? ['rundll32.exe', 'url.dll,FileProtocolHandler', link] : ['open', link],
      { timeoutMs: 10_000 },
    )
    if (exitCode !== 0) $.ui.toast('チャットを開けませんでした')
  } catch {
    $.ui.toast('チャットを開けませんでした')
  }
}

// Takes the latest states of the other chats, redrawing only on a change.
async function watchChats($: EngineInterface) {
  try {
    const found = await otherChats($)
    const { value: shown = [] } = await $.state.get(others)
    const key = (list: readonly { id?: string; title: string; state: string }[]) =>
      list.map(chat => `${chat.state}:${chat.id ?? ''}:${chat.title}`).join('|')
    if (key(found) !== key(shown)) await $.state.set(others, found)
  } catch {
    // The records cannot be read here: the strip stays as it was.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.state.set(last, null)
    await $.state.set(tally, NONE)
    await $.state.set(others, [])

    $.clock.after(0, () => void watchChats($))
    $.clock.every(CHATS_EVERY_MS, () => watchChats($))

    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const refused = await guardCommand($, e.command)
    return refused === null ? next(e) : { deny: refused }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'SHIELD: 見張りが動かなかったので止めました。' }))

  on('tool.call', { tool: 'PowerShell' }, async ($, e, next) => {
    const refused = await guardCommand($, e.command)
    return refused === null ? next(e) : { deny: refused }
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'SHIELD: 見張りが動かなかったので止めました。' }))

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const refused = await guardFile($, e.file_path)
    if (refused !== null) return { deny: refused }

    return checkFile($, e.file_path, await next(e))
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'SHIELD: 見張りが動かなかったので止めました。' }))

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const refused = await guardFile($, e.file_path)
    if (refused !== null) return { deny: refused }

    return checkFile($, e.file_path, await next(e))
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'SHIELD: 見張りが動かなかったので止めました。' }))

  // The strip sits on top of whatever else is drawn above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { value: event = null } = await $.state.get(last)
    const { value: counts = NONE } = await $.state.get(tally)
    const { value: chats = [] } = await $.state.get(others)
    const below = await next(e)

    if (e.surface === 'desktop') {
      const { Box, Button, Svg, Text } = $.ui.resolve(e)
      const width = Math.max(240, Math.round(e.props.bodyColumns * CELL_PX))
      // The other chats go first: this strip always ends on top. Each name
      // is a button that opens its chat.
      const groups = chatButtons(chats, width)
      const row = groups.length === 0 ? null : (
        <Box flexDirection="row" alignItems="center" gap="sm">
          {groups.map(({ kind, shown, rest }) => {
            const label = kindSvg(kind, e.props.isWorking)
            return (
              <Box key={kind} flexDirection="row" alignItems="center" gap="xs">
                <Svg source={label.svg} alt={describeChats(chats.filter(chat => chat.state === kind))} width={label.width} height={CHATS_HEIGHT} />
                {shown.map(chat => (
                  <Button key={chat.id!} label={nameOf(chat)} onPress={() => void openChat($, chat.id!)} />
                ))}
                {rest > 0 && <Text dimColor>+{rest}</Text>}
              </Box>
            )
          })}
        </Box>
      )

      return (
        <Box flexDirection="column">
          {row}
          <Svg source={svg(event, counts, width, await $.clock.now(), e.props.isWorking)} alt={describe(event, counts)} width={width} height={HEIGHT} />
          {below}
        </Box>
      )
    }

    if (e.surface === 'terminal') {
      const { Box, Text } = $.ui.resolve(e)

      return (
        <Box flexDirection="column">
          {chats.length > 0 && <Text dimColor>{describeChats(chats)}</Text>}
          <Text dimColor>{describe(event, counts)}</Text>
          {below}
        </Box>
      )
    }

    return below
  })
}
