// Checks a file Claude just wrote for mistakes that break it outright: a
// syntax error in JSON, JavaScript, Python, PowerShell, a shell script or CSS.
// Only reads; it never changes the file.

import type { EngineInterface } from 'claude-code'

export type Verdict = { isOk: true } | { isOk: false; line?: number; message: string }

const extension = (path: string) => /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? ''

// The kinds of file this can check, by extension.
const CHECKABLE = new Set(['json', 'js', 'mjs', 'cjs', 'py', 'ps1', 'sh', 'css'])

export const isCheckable = (path: string) => CHECKABLE.has(extension(path))

// The line a byte offset falls on.
const lineAt = (text: string, offset: number) => text.slice(0, offset).split('\n').length

// The first line of a checker's complaint that says what is wrong, and the
// line number in it, if any.
function complaint(output: string, path: string): Verdict {
  const lines = output.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '')
  const said = lines.find(line => /error/i.test(line)) ?? lines[lines.length - 1] ?? '構文エラー'
  const at = new RegExp(`${path.split(/[\\/]/).pop()?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?[:,]\\s*(?:line\\s*)?(\\d+)`, 'i').exec(output)
  const line = Number(at?.[1] ?? /line (\d+)/i.exec(output)?.[1] ?? NaN)

  return { isOk: false, message: said.slice(0, 160), ...(Number.isFinite(line) ? { line } : {}) }
}

// Reads JSON by its grammar, to say where it breaks: the runtime's own parser
// does not always tell the position.
export function json(source: string): Verdict {
  const text = source.replace(/^﻿/, '')
  let i = 0
  const fail = (message: string): Verdict => ({ isOk: false, line: lineAt(text, i), message })
  const space = () => {
    while (i < text.length && ' \t\r\n'.includes(text[i]!)) i += 1
  }
  const literal = (word: string) => text.startsWith(word, i) && ((i += word.length), true)
  const string = (): boolean => {
    if (text[i] !== '"') return false
    i += 1
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\n') return false
      i += text[i] === '\\' ? 2 : 1
    }
    i += 1
    return i <= text.length
  }
  const value = (): Verdict | null => {
    space()
    const c = text[i]
    if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']'
      i += 1
      space()
      if (text[i] === close) return (i += 1), null
      for (;;) {
        if (c === '{') {
          space()
          if (!string()) return fail('キーは "..." で囲む必要があります')
          space()
          if (text[i] !== ':') return fail(': がありません')
          i += 1
        }
        const inner = value()
        if (inner !== null) return inner
        space()
        if (text[i] === ',') {
          i += 1
          space()
          if (text[i] === close) return fail('最後の , が余分です')
          continue
        }
        if (text[i] === close) return (i += 1), null
        return fail(`, か ${close} がありません`)
      }
    }
    if (c === '"') return string() ? null : fail('文字列が閉じていません')
    if (/[-0-9]/.test(c ?? '')) {
      const number = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i))
      return number === null ? fail('数字の書き方が違います') : ((i += number[0].length), null)
    }
    if (literal('true') || literal('false') || literal('null')) return null
    return fail(i >= text.length ? 'ファイルが途中で終わっています' : `ここに値がありません: ${c}`)
  }

  const broken = value()
  if (broken !== null) return broken
  space()
  return i < text.length ? fail('値のあとに余分な文字があります') : { isOk: true }
}

// Braces must pair up outside comments and strings.
function css(text: string): Verdict {
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, m => ' '.repeat(m.length))
  let depth = 0
  for (let i = 0; i < bare.length; i++) {
    if (bare[i] === '{') depth += 1
    if (bare[i] === '}') depth -= 1
    if (depth < 0) return { isOk: false, line: lineAt(bare, i), message: '閉じ括弧 } が多すぎます' }
  }
  return depth === 0 ? { isOk: true } : { isOk: false, message: `閉じ括弧 } が ${depth} 個足りません` }
}

async function run($: EngineInterface, argv: string[], path: string): Promise<Verdict | null> {
  const { exitCode, stdout, stderr } = await $.process.run(argv, { timeoutMs: 20_000 })

  if (exitCode === 0) return { isOk: true }
  // Only a syntax error counts: a checker that could not run says nothing.
  const output = `${stderr}\n${stdout}`
  return /syntax ?error|error line \d/i.test(output) ? complaint(output, path) : null
}

// The verdict on the file, or null where it cannot be checked here (no
// checker installed, a file too large): saying nothing beats a false alarm.
export async function check($: EngineInterface, path: string): Promise<Verdict | null> {
  try {
    switch (extension(path)) {
      case 'json':
        return json(String(await $.fs.read(path)))
      case 'css':
        return css(String(await $.fs.read(path)))
      case 'js':
      case 'mjs':
      case 'cjs':
        return await run($, ['node', '--check', path], path)
      case 'py':
        return await run($, ['python', '-c', 'import ast,sys; ast.parse(open(sys.argv[1], encoding="utf-8").read(), sys.argv[1])', path], path)
      case 'ps1':
        return await run(
          $,
          [
            'powershell',
            '-NoProfile',
            '-Command',
            // The path goes in quoted, as -Command passes no arguments on.
            `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('${path.replace(/'/g, "''")}',[ref]$null,[ref]$e); ` +
              'if ($e) { $e | ForEach-Object { "error line $($_.Extent.StartLineNumber): $($_.Message)" }; exit 1 }',
          ],
          path,
        )
      case 'sh':
        return await run($, ['bash', '-n', path], path)
      default:
        return null
    }
  } catch {
    return null
  }
}
