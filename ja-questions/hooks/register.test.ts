import { expect, test } from 'claude-code/testing'

const USAGE = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

const ENGLISH = {
  question: 'Which library should we use?',
  header: 'Library',
  multiSelect: false,
  options: [
    { label: 'Day.js', description: 'Small and fast.' },
    { label: 'Keep current', description: 'Change nothing.' },
  ],
}

test('an English question is shown in Japanese', async ($, on) => {
  let shown: unknown
  on('model.complete', (_$, e) => {
    const sources = JSON.parse(e.prompt) as string[]

    return {
      value: {
        isAnswered: true,
        text: JSON.stringify(sources.map(text => `訳:${text}`)),
        usage: USAGE,
      },
    }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    shown = e.questions

    return { result: { questions: e.questions, answers: {} } }
  })

  const answered = await $.tool.call({
    tool: 'AskUserQuestion',
    questions: [ENGLISH],
  })

  expect(shown).toEqual([
    {
      question: '訳:Which library should we use?',
      header: '訳:Library',
      multiSelect: false,
      options: [
        { label: '訳:Day.js', description: '訳:Small and fast.' },
        { label: '訳:Keep current', description: '訳:Change nothing.' },
      ],
    },
  ])
  expect(answered.context?.[0]).toContain('ja-questions')
})

test('a Japanese question is left alone and costs no model call', async ($, on) => {
  let calls = 0
  let shown: unknown
  const japanese = {
    question: 'どのライブラリを使いますか?',
    header: 'ライブラリ',
    multiSelect: false,
    options: [
      { label: '現状維持', description: '何も変えません。' },
      { label: '入れ替える', description: '新しいものにします。' },
    ],
  }
  on('model.complete', () => {
    calls += 1

    return { value: { isAnswered: true, text: '[]', usage: USAGE } }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    shown = e.questions

    return { result: { questions: e.questions, answers: {} } }
  })

  await $.tool.call({ tool: 'AskUserQuestion', questions: [japanese] })

  expect(calls).toBe(0)
  expect(shown).toEqual([japanese])
})

test('a failed translation shows the original question', async ($, on) => {
  let shown: unknown
  on('model.complete', () => ({
    value: { isAnswered: true, text: 'sorry, no JSON here', usage: USAGE },
  }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_$, e) => {
    shown = e.questions

    return { result: { questions: e.questions, answers: {} } }
  })

  await $.tool.call({ tool: 'AskUserQuestion', questions: [ENGLISH] })

  expect(shown).toEqual([ENGLISH])
})

test('the system prompt asks for questions in Japanese', async ($, on) => {
  on('prompt.compose', () => ({
    sections: [{ id: 'intro', text: 'intro', scope: 'shared' }],
  }))

  const composed = await $.prompt.compose({
    model: 'claude-opus-5-5',
    promptModel: 'claude-opus-5-5',
    surfaces: ['terminal'],
    tools: [],
    outputStyle: null,
    traits: [],
  })

  expect(composed.sections.at(-1)?.id).toBe('ja-questions:language')
})
