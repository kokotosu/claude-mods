import { expect, mock, test } from 'claude-code/testing'

import { when } from '../hooks/register'

const VIEW = { maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} }

test('a time reads like a chat app, in Japan time', () => {
  // 2026-10-21 08:31 UTC is 17:31 in Japan, a Wednesday.
  expect(when(Date.parse('2026-10-21T08:31:51Z'))).toBe('10/21(水) 17:31')
})

test('a message sent in this session shows when it was sent', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-22T05:03:00Z') })
  mock.store(on)
  on('session.id', () => ({ value: 'abc' }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', () => ({}))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>{String((e.props as { text: string }).text)}</Text>
  })

  await $.prompt.submit({ text: 'こんにちは' })

  const user = await $.ui.mount({
    plugin: 'chat-time',
    component: 'UserMessage',
    surface: 'desktop',
    props: { ...VIEW, text: 'こんにちは', origin: { kind: 'composer' }, isExpanded: true },
  })
  expect((await user.find({ type: 'Text', text: /こんにちは/ }))?.text).toBe('こんにちは')
  // The time is a text of its own, smaller and in its own color.
  const time = await user.find({ type: 'Text', text: /14:03/ })
  expect(time?.text).toBe('10/22(木) 14:03')
  expect(time?.props.size).toBe('footnote')
  expect(time?.props.color).toBe('#7F95B5')
  await user.unmount()

  const reply = await $.ui.mount({
    plugin: 'chat-time',
    component: 'AssistantMessage',
    surface: 'desktop',
    props: { ...VIEW, text: 'どうも', isFirstOfReply: true },
  })
  expect((await reply.find({ type: 'Text', text: /どうも/ }))?.text).toBe('どうも')
  expect((await reply.find({ type: 'Text', text: /14:03/ }))?.text).toBe('10/22(木) 14:03')
  await reply.unmount()
})
