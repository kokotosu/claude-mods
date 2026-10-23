import type { Register } from 'claude-code'

const JAPANESE = /[぀-ヿ一-鿿]/
const HEADER_MAX = 12

const LANGUAGE = {
  id: 'ja-questions:language',
  text: 'ユーザーへの質問は必ず日本語で書くこと。AskUserQuestion の question・header・選択肢の label と description も日本語にする(header は12文字以内)。コード、コマンド、ファイル名、固有名詞はそのままでよい。',
  scope: 'session',
} as const

const TRANSLATOR =
  'あなたは翻訳者です。入力は文字列の JSON 配列です。各要素を自然な日本語に訳し、同じ長さ・同じ順序の JSON 配列だけを返してください。コード、コマンド、ファイル名、製品名は訳さずそのまま残します。説明や前置きは書かないでください。'

const NOTE =
  'ja-questions: この質問は日本語に翻訳して表示した。回答の質問文と選択肢は翻訳後の文言になっている。'

const needsTranslation = (text: string) =>
  text.trim() !== '' && !JAPANESE.test(text)

const parseArray = (reply: string, length: number): string[] | undefined => {
  const start = reply.indexOf('[')
  const end = reply.lastIndexOf(']')

  if (start === -1 || end <= start) {
    return undefined
  }

  try {
    const parsed: unknown = JSON.parse(reply.slice(start, end + 1))
    const isValid =
      Array.isArray(parsed) &&
      parsed.length === length &&
      parsed.every(item => typeof item === 'string' && item.trim() !== '')

    return isValid ? (parsed as string[]) : undefined
  } catch {
    return undefined
  }
}

export const register: Register = on => {
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return { sections: [...composed.sections, LANGUAGE] }
  })

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const sources: string[] = []
    const collect = (text: string) => {
      if (needsTranslation(text) && !sources.includes(text)) {
        sources.push(text)
      }
    }

    for (const q of e.questions) {
      collect(q.question)
      collect(q.header)

      for (const option of q.options) {
        collect(option.label)
        collect(option.description)
      }
    }

    if (sources.length === 0) {
      return next(e)
    }

    $.ui.status('質問を日本語に翻訳中…')
    const reply = await $.model.complete({
      model: 'haiku',
      system: TRANSLATOR,
      prompt: JSON.stringify(sources),
      maxTokens: 4096,
      effort: 'low',
      timeoutMs: 20000,
    })
    $.ui.status(undefined)

    const translated = reply.isAnswered
      ? parseArray(reply.text, sources.length)
      : undefined

    if (translated === undefined) {
      $.ui.toast('ja-questions: 翻訳できなかったので原文のまま表示します')

      return next(e)
    }

    const ja = (text: string) => {
      const at = sources.indexOf(text)

      return at === -1 ? text : (translated[at] ?? text)
    }

    const questions = e.questions.map(q => {
      const labels = q.options.map(option => ja(option.label))
      const isDistinct = new Set(labels).size === labels.length

      return {
        ...q,
        question: ja(q.question),
        header: [...ja(q.header)].slice(0, HEADER_MAX).join(''),
        options: q.options.map((option, i) => ({
          ...option,
          label: isDistinct ? (labels[i] ?? option.label) : option.label,
          description: ja(option.description),
        })),
      }
    })

    const answered = await next({ ...e, questions })

    if (answered.deny !== undefined) {
      return answered
    }

    return { ...answered, context: [...(answered.context ?? []), NOTE] }
  })
}
