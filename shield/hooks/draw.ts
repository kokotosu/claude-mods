// The shield's strip above the prompt, in the look of usage-band's chart: a
// glowing shield that says how the last thing went, what that was, and how
// many times each has happened this session.

import type { ChatState, ShieldEvent, ShieldTally } from '../types'
import { breathe, crossing, sheen } from './glow'

export const HEIGHT = 44

const LOOKS: Record<ShieldEvent['kind'], { from: string; to: string; word: string; mark: string }> = {
  ok: { from: '#8CEBD6', to: '#3DD6B5', word: 'チェックOK', mark: 'check' },
  broken: { from: '#FFB199', to: '#FF7A59', word: '構文エラー → Claude が修正中', mark: 'bang' },
  allowed: { from: '#FFD58F', to: '#FFB547', word: '確認して実行', mark: 'check' },
  stopped: { from: '#FF9A94', to: '#FF5A52', word: '止めました', mark: 'cross' },
}

const RAIL = '#2E2D2A'
const LABEL = '#A8A39A'
const DIM = '#6F6B63'
const NUMBER = '#FAF9F5'
const FACE = `'Yu Gothic UI','Meiryo','Hiragino Sans',sans-serif`
const DIGITS = `'Segoe UI','Helvetica Neue',Arial,sans-serif`
const MONO = `'Cascadia Code','Consolas','Menlo',monospace`

// How long an event counts as new: its shield pulses meanwhile.
export const FRESH_MS = 10_000

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// A text cut to about `room` half-width characters; full-width ones count two.
function fit(text: string, room: number): string {
  let width = 0
  let out = ''
  for (const char of text.replace(/\s+/g, ' ')) {
    width += /[\u0000-ÿ]/.test(char) ? 1 : 2
    if (width > room) return `${out}…`
    out += char
  }
  return out
}

// About how wide a text is drawn at `size`: full-width characters are square,
// the others a little over half as wide.
const measure = (text: string, size: number) =>
  [...text].reduce((width, char) => width + (char.charCodeAt(0) < 0x100 ? size * 0.56 : size), 0)

// The shield, 24 wide and 28 tall, its mark drawn inside it.
function shield(x: number, y: number, mark: string, fill: string, isFresh: boolean): string {
  const outline = `M${x + 12} ${y} L${x + 24} ${y + 4.5} V${y + 13} C${x + 24} ${y + 20.5} ${x + 18.8} ${y + 25.6} ${x + 12} ${y + 28} C${x + 5.2} ${y + 25.6} ${x} ${y + 20.5} ${x} ${y + 13} V${y + 4.5} Z`
  const inner =
    mark === 'check'
      ? `<path d="M${x + 7} ${y + 13.5} l3.6 3.6 l6.6 -7" fill="none" stroke="#1F1E1D" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`
      : mark === 'cross'
        ? `<path d="M${x + 8} ${y + 8.5} l8 8 M${x + 16} ${y + 8.5} l-8 8" stroke="#1F1E1D" stroke-width="2.6" stroke-linecap="round"/>`
        : `<path d="M${x + 12} ${y + 7} v7" stroke="#1F1E1D" stroke-width="2.8" stroke-linecap="round"/><circle cx="${x + 12}" cy="${y + 19}" r="1.7" fill="#1F1E1D"/>`
  // A new event sends three rings out from the shield.
  const ripple = isFresh
    ? `<circle cx="${x + 12}" cy="${y + 14}" r="14" fill="none" stroke="${fill}" stroke-width="1.5" opacity="0">` +
      `<animate attributeName="r" values="14;24" dur="1.4s" repeatCount="3"/>` +
      `<animate attributeName="opacity" values="0.8;0" dur="1.4s" repeatCount="3"/></circle>`
    : ''

  return `${ripple}<path d="${outline}" fill="url(#sh-grad-${mark})" filter="url(#sh-glow)"/>${inner}`
}

export function describe(last: ShieldEvent | null, tally: ShieldTally): string {
  const counts = `止めた${tally.stopped} 確認して実行${tally.allowed} チェック${tally.checked} エラー${tally.broken}`
  return last === null ? `SHIELD ${counts}` : `SHIELD ${LOOKS[last.kind].word}: ${last.subject} / ${counts}`
}

// The glow drifts while Claude is at work or something has just happened.
export function svg(last: ShieldEvent | null, tally: ShieldTally, width: number, now: number, isWorking = false): string {
  const look = LOOKS[last?.kind ?? 'ok']
  const isFresh = last !== null && now - last.at < FRESH_MS
  const isMoving = isWorking || isFresh

  // The counts, right-aligned, each a number over its name. A count above
  // zero glows in its color; a zero glows faintly in grey.
  const stats: [string, number, ShieldEvent['kind']][] = [
    ['止めた', tally.stopped, 'stopped'],
    ['確認', tally.allowed, 'allowed'],
    ['チェック', tally.checked, 'ok'],
    ['エラー', tally.broken, 'broken'],
  ]
  const STAT = 58
  const statsLeft = width - 8 - stats.length * STAT
  let glows = ''
  let counts = `<line x1="${statsLeft - 14}" y1="10" x2="${statsLeft - 14}" y2="${HEIGHT - 10}" stroke="${RAIL}"/>`
  stats.forEach(([name, count, kind], i) => {
    const cx = statsLeft + i * STAT + STAT / 2
    const { from, to } = LOOKS[kind]
    const isLit = count > 0
    glows +=
      sheen(`sh-num-${i}`, isLit ? from : DIM, isLit ? NUMBER : LABEL, isMoving, i * 0.8) +
      (isLit ? sheen(`sh-bar-${i}`, to, from, isMoving, i * 0.8) : '')
    counts +=
      `<text x="${cx}" y="21" text-anchor="middle" font-family="${DIGITS}" font-size="16" font-weight="700" ` +
      `fill="url(#sh-num-${i})"${isLit ? ' filter="url(#sh-breathe)"' : ''}>${count}</text>` +
      `<rect x="${cx - 7}" y="25" width="14" height="2" rx="1" fill="${isLit ? `url(#sh-bar-${i})` : RAIL}"${isLit ? ' filter="url(#sh-breathe)"' : ''}/>` +
      `<text x="${cx}" y="37" text-anchor="middle" font-family="${FACE}" font-size="9.5" fill="${DIM}">${name}</text>`
  })

  // The last event: what happened, in its color, then what it was about.
  const textLeft = 48
  const room = Math.max(10, Math.floor((statsLeft - 28 - textLeft) / 6.6))
  const headline =
    last === null
      ? `<text x="${textLeft}" y="32" font-family="${FACE}" font-size="12.5" font-weight="700" fill="url(#sh-word)" filter="url(#sh-breathe)">見張り中</text>` +
        `<text x="${textLeft + measure('見張り中', 12.5)}" y="32" font-family="${FACE}" font-size="12.5" fill="${DIM}">  危ない操作は止めて確認、書いたファイルは自動でチェック</text>`
      : `<text x="${textLeft}" y="32" font-family="${FACE}" font-size="12.5" font-weight="700" fill="url(#sh-word)" filter="url(#sh-breathe)">${look.word}</text>` +
        `<text x="${textLeft + measure(look.word, 12.5) + 12}" y="32" font-family="${MONO}" font-size="11.5" fill="${LABEL}">` +
        `${escape(fit(last.subject, Math.max(6, room - look.word.length * 2 - 2)))}</text>`
  const caption =
    `<text x="${textLeft}" y="15" font-family="${DIGITS}" font-size="9" font-weight="700" letter-spacing="2" fill="${DIM}">SHIELD` +
    (last !== null ? `<tspan font-family="${FACE}" letter-spacing="0.4" font-weight="400" dx="8">${escape(fit(last.detail, room - 8))}</tspan>` : '') +
    `</text>`

  const defs =
    `<defs><linearGradient id="sh-grad-${look.mark}" x1="0" y1="0" x2="0.4" y2="1">` +
    `<stop offset="0" stop-color="${look.from}"/><stop offset="1" stop-color="${look.to}"/></linearGradient>` +
    `<filter id="sh-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${isFresh ? 3 : 1.8}" result="b"/>` +
    `<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    `${breathe('sh-breathe', isMoving)}${glows}` +
    `${last === null ? sheen('sh-word', NUMBER, '#8CEBD6', isMoving) : sheen('sh-word', look.to, look.from, isMoving)}` +
    `${crossing('sh-rail', look.to, RAIL, isMoving)}</defs>`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${HEIGHT}" width="100%" height="${HEIGHT}" ` +
    `preserveAspectRatio="xMinYMid meet" style="color-scheme:light dark;background:transparent">` +
    `<style>:root,html,body{color-scheme:light dark;background:transparent;margin:0}</style>` +
    `${defs}${shield(12, 8, look.mark, look.to, isFresh)}${caption}${headline}${counts}` +
    `<rect x="8" y="${HEIGHT - 1.5}" width="${width - 16}" height="1.5" fill="url(#sh-rail)"/></svg>`
  )
}

// ---- the other chats, above the shield ----

export const CHATS_HEIGHT = 32
// A name is cut to about this many half-width characters.
const NAME_ROOM = 26

const KINDS = {
  working: { word: '作業中', color: '#3DD6B5', tint: 'rgba(61,214,181,0.14)' },
  waiting: { word: '回答待ち', color: '#FFB547', tint: 'rgba(255,181,71,0.14)' },
} as const

export function describeChats(others: readonly ChatState[]): string {
  return (['working', 'waiting'] as const)
    .map(kind => {
      const names = others.filter(chat => chat.state === kind).map(chat => chat.title)
      return names.length === 0 ? '' : `${KINDS[kind].word}: ${names.join('、')}`
    })
    .filter(part => part !== '')
    .join(' / ')
}

// ---- the same row on a desktop, each name a button that opens its chat ----

const kindOf = (chats: readonly ChatState[], kind: keyof typeof KINDS) => chats.filter(chat => chat.state === kind)

export const nameOf = (chat: ChatState) => fit(chat.title, NAME_ROOM)

// About how wide a desktop draws a name's button.
const buttonWidth = (chat: ChatState) => measure(nameOf(chat), 12) + 26

// The kind before its names: a lit dot and its word. The dot's ring spreads
// only while moving (see glow.ts).
export function kindSvg(kind: keyof typeof KINDS, isMoving: boolean): { svg: string; width: number } {
  const look = KINDS[kind]
  const width = Math.ceil(13 + measure(look.word, 11) + 4)
  const pulse = isMoving
    ? `<circle cx="7" cy="16" r="3.5" fill="none" stroke="${look.color}" stroke-width="1.3">` +
      `<animate attributeName="r" values="3.5;7" dur="1.6s" repeatCount="indefinite"/>` +
      `<animate attributeName="opacity" values="0.9;0" dur="1.6s" repeatCount="indefinite"/></circle>`
    : ''
  return {
    width,
    svg:
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${CHATS_HEIGHT}" width="${width}" height="${CHATS_HEIGHT}" ` +
      `style="color-scheme:light dark;background:transparent">` +
      `<style>:root,html,body{color-scheme:light dark;background:transparent;margin:0}</style>` +
      `<defs><filter id="ck-glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="1.6" result="b"/>` +
      `<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>` +
      `${pulse}<circle cx="7" cy="16" r="3.5" fill="${look.color}" filter="url(#ck-glow)"/>` +
      `<text x="16" y="20" font-family="${FACE}" font-size="11" font-weight="700" fill="${look.color}">${look.word}</text></svg>`,
  }
}

// The kinds with chats, each with the names that fit as buttons in `width`
// and how many more there are. A chat with no id has no button.
export function chatButtons(chats: readonly ChatState[], width: number): { kind: keyof typeof KINDS; shown: ChatState[]; rest: number }[] {
  const groups = (['working', 'waiting'] as const)
    .map(kind => ({ kind, list: kindOf(chats, kind).filter(chat => chat.id !== undefined) }))
    .filter(group => group.list.length > 0)
  // Each kind gets an equal share of the row; what does not fit is counted.
  const share = (width - 24) / Math.max(1, groups.length)
  return groups.map(({ kind, list }) => {
    let room = share - kindSvg(kind, false).width - 36
    const shown: ChatState[] = []
    for (const chat of list) {
      if (buttonWidth(chat) > room) break
      shown.push(chat)
      room -= buttonWidth(chat) + 6
    }
    return { kind, shown, rest: list.length - shown.length }
  })
}
