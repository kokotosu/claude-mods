// What the tokens went on, as an infographic above the meters: a ring cut into
// the roles that used the most over the last days, the total in its middle,
// and beside it each role's share, largest first.

import type { Chart, ChartGroup } from '../types'
import { sheen } from './glow'

// One color per place in the order, each with a lighter tint its piece fades
// from; the rest share a quiet slate.
const COLORS = ['#FF7A59', '#FFB547', '#3DD6B5', '#5AA9FF', '#A78BFA']
const TINTS = ['#FFB199', '#FFD58F', '#8CEBD6', '#A3CFFF', '#CDB9FF']
const REST = '#4B4A47'
const REST_TINT = '#6A6863'
const TRACK = '#2E2D2A'
const LABEL = '#A8A39A'
const DIM = '#6F6B63'
const NUMBER = '#FAF9F5'
const FONT = `'Yu Gothic UI','Meiryo','Hiragino Sans',sans-serif`
// Figures in a face whose digits share one width, so columns of them line up.
const DIGITS = `'Segoe UI','Helvetica Neue',Arial,sans-serif`

export const CHART_HEIGHT = 84
const RADIUS = 30
const RING = 8
const CENTER = { x: 8 + RADIUS + RING / 2, y: CHART_HEIGHT / 2 - 3 }
// The largest role, set large beside the ring, then the others in a list.
const HERO_LEFT = CENTER.x + RADIUS + RING / 2 + 20
const HERO_WIDTH = 128
const LIST_LEFT = HERO_LEFT + HERO_WIDTH + 18
// A list column's width: the narrowest that still shows a name, the widest
// before the columns drift apart.
const MIN_COLUMN = 170
const MAX_COLUMN = 230
const ROW = 24
// Ring length left blank between two pieces.
const GAP = 3.5

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// 47億, 3.2億, 8,500万: the way the total reads at a glance.
export function amount(tokens: number): string {
  if (tokens >= 1e9) return `${Math.round(tokens / 1e8)}億`
  if (tokens >= 1e8) return `${(tokens / 1e8).toFixed(1)}億`
  if (tokens >= 1e4) return `${Math.round(tokens / 1e4).toLocaleString('en-US')}万`
  return `${tokens}`
}

// The largest roles by name, at most `named` of them, and the others as one piece.
export function pieces(
  groups: readonly ChartGroup[],
  named = COLORS.length,
): { name: string; tokens: number; color: string; tint: string }[] {
  const count = Math.min(named, COLORS.length)
  const top = groups.slice(0, count).map((group, i) => ({ ...group, color: COLORS[i]!, tint: TINTS[i]! }))
  const rest = groups.slice(count).reduce((sum, group) => sum + group.tokens, 0)

  return rest > 0 ? [...top, { name: 'その他', tokens: rest, color: REST, tint: REST_TINT }] : top
}

export function describeChart(chart: Chart | null): string {
  if (chart === null || chart.groups.length === 0) return ''
  const total = chart.groups.reduce((sum, group) => sum + group.tokens, 0)

  return `${chart.days}日間のトークン ${amount(total)}: ${pieces(chart.groups)
    .map(piece => `${piece.name} ${Math.round((piece.tokens / total) * 100)}%`)
    .join('、')}`
}

// A name cut to what fits, by a rough width: full-width characters count two.
function fit(name: string, room: number): string {
  let width = 0
  let out = ''
  for (const char of name) {
    width += /[\u0000-ÿ]/.test(char) ? 1 : 2
    if (width > room) return `${out}…`
    out += char
  }
  return out
}

// The total, the largest share and the bars glow, the glow drifting while
// Claude is at work.
export function donut(chart: Chart | null, width: number, isMoving = false): string {
  if (chart === null || chart.groups.length === 0) return ''
  const total = chart.groups.reduce((sum, group) => sum + group.tokens, 0)
  if (total <= 0) return ''

  // Beside the largest role, a list of two columns when there is room, else
  // one; three rows each, the last place the rest's.
  const room = width - LIST_LEFT
  const columns = room >= 2 * MIN_COLUMN ? 2 : 1
  const parts = pieces(chart.groups, columns * 3)
  const share = (tokens: number) => Math.round((tokens / total) * 100)
  const { x: cx, y: cy } = CENTER
  // Ids named after the layout, so two drawings on one page never share them.
  const id = (name: string) => `ub${columns}-${name}`

  // Each piece fades from its tint at its start to its color at its end, and
  // the whole ring glows faintly.
  let defs = `<filter id="${id('glow')}" x="-30%" y="-30%" width="160%" height="160%">` +
    `<feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
  parts.forEach((part, i) => {
    defs += `<linearGradient id="${id(`p${i}`)}" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="${part.tint}"/><stop offset="1" stop-color="${part.color}"/></linearGradient>` +
      sheen(id(`s${i}`), part.color, part.tint, isMoving, i * 0.8)
  })
  defs += sheen(id('total'), LABEL, NUMBER, isMoving, 2)

  const circumference = 2 * Math.PI * RADIUS
  let ring =
    `<circle cx="${cx}" cy="${cy}" r="${RADIUS + RING / 2 + 3.5}" fill="none" stroke="${TRACK}" stroke-width="1"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${RADIUS}" fill="none" stroke="${TRACK}" stroke-width="${RING}"/>`
  let start = 0
  for (const [i, part] of parts.entries()) {
    const length = (part.tokens / total) * circumference
    const drawn = Math.max(0.5, length - GAP)
    // Pieces start at twelve o'clock and run clockwise.
    ring +=
      `<circle cx="${cx}" cy="${cy}" r="${RADIUS}" fill="none" stroke="url(#${id(`p${i}`)})" ` +
      `stroke-width="${RING}" stroke-dasharray="${drawn.toFixed(2)} ${circumference.toFixed(2)}" ` +
      `stroke-dashoffset="${(-start).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`
    start += length
  }

  const middle =
    `<text x="${cx}" y="${cy + 4}" text-anchor="middle" font-family="${FONT}" font-size="15" ` +
    `font-weight="700" fill="url(#${id('total')})">${amount(total)}</text>` +
    `<text x="${cx}" y="${cy + 16}" text-anchor="middle" font-family="${DIGITS}" font-size="7.5" ` +
    `letter-spacing="1" font-weight="600" fill="${DIM}">TOKENS</text>`

  // The largest role: its share large in its own color, its name under it.
  const [lead, ...others] = parts
  const hero = lead === undefined ? '' :
    `<text x="${HERO_LEFT}" y="18" font-family="${DIGITS}" font-size="9" letter-spacing="1.6" ` +
    `font-weight="600" fill="${DIM}">TOP · ${chart.days}D</text>` +
    `<text x="${HERO_LEFT - 1}" y="52" font-family="${DIGITS}" font-size="36" font-weight="700" ` +
    `fill="url(#${id('s0')})">${share(lead.tokens)}<tspan font-size="16" dx="2" fill="${lead.color}">%</tspan></text>` +
    `<text x="${HERO_LEFT}" y="70" font-family="${FONT}" font-size="12.5" font-weight="700" ` +
    `fill="${NUMBER}">${escape(fit(lead.name, 19))}</text>`

  // The others, ranked: a number, the name, the share, and a hairline bar
  // as long as the share is of the largest's.
  const column = Math.min(room / columns, MAX_COLUMN)
  const top = (CHART_HEIGHT - 3 * ROW) / 2 + 2
  const largest = lead?.tokens ?? 1
  let list = `<line x1="${LIST_LEFT - 12}" y1="${top + 2}" x2="${LIST_LEFT - 12}" y2="${top + 3 * ROW - 4}" stroke="${TRACK}"/>`
  others.forEach((part, i) => {
    const x = LIST_LEFT + Math.floor(i / 3) * column
    const y = top + (i % 3) * ROW
    const end = x + column - 16
    const bar = Math.max(2, (end - x - 22) * Math.min(1, part.tokens / largest))
    const rank = part.name === 'その他' ? '··' : String(i + 2).padStart(2, '0')
    list +=
      `<text x="${x}" y="${y + 12}" font-family="${DIGITS}" font-size="9.5" font-weight="700" ` +
      `fill="${part.color}">${rank}</text>` +
      `<text x="${x + 22}" y="${y + 12}" font-family="${FONT}" font-size="12" ` +
      `fill="${LABEL}">${escape(fit(part.name, Math.max(4, Math.floor((column - 84) / 6.2))))}</text>` +
      `<text x="${end}" y="${y + 12}" text-anchor="end" font-family="${DIGITS}" font-size="12.5" ` +
      `font-weight="700" fill="${NUMBER}">${share(part.tokens)}<tspan font-size="9" fill="${DIM}">%</tspan></text>` +
      `<rect x="${x + 22}" y="${y + 18}" width="${(end - x - 22).toFixed(1)}" height="2" rx="1" fill="${TRACK}"/>` +
      `<rect x="${x + 22}" y="${y + 18}" width="${bar.toFixed(1)}" height="2" rx="1" fill="url(#${id(`s${i + 1}`)})"/>`
  })

  return `<defs>${defs}</defs><g filter="url(#${id('glow')})">${ring}</g>${middle}${hero}${list}`
}
