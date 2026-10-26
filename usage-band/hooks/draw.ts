import type { SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Meter } from '../types'
import { CHART_HEIGHT } from './donut'
import { breathe, crossing, sheen } from './glow'

// Claude's palette, tuned for a dark background: a bright clay for what is
// left, amber when it runs low, a coral red at the end, oat for the labels
// and a warm charcoal for the spent track.
const CLAY = '#E8825F'
const CLAY_LIGHT = '#FBD9C9'
const KRAFT = '#F0B44C'
const KRAFT_LIGHT = '#FCE7B8'
const DANGER = '#F0625A'
const DANGER_LIGHT = '#FBC1BC'
const TRACK = '#45433E'
const LABEL = '#C9C4B5'
const NUMBER = '#FAF9F5'

const LABELS: Record<string, string> = {
  five_hour: '5H',
  seven_day: '7D',
  spend_limit: '$',
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

export function toMeters(
  context: SessionContextUsage,
  rateLimits: readonly SessionRateLimit[],
): Meter[] {
  const limits = rateLimits.map(limit => {
    const resetsAt = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt)
    return {
      // A model's own weekly window (Fable's) is named after the model.
      label: LABELS[limit.kind] ?? (/fable/i.test(limit.kind) ? 'FB' : '?'),
      remaining: clamp(100 - limit.percentUsed),
      ...(Number.isNaN(resetsAt) ? {} : { resetsAt }),
    }
  })

  return [...limits, { label: 'CTX', remaining: clamp(100 - (context.percent ?? 0)) }]
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// How long until a window resets: in days while a day or more, else in hours
// and minutes, and minutes alone under an hour. Nothing once passed.
export function resetIn(meter: Meter, now: number): string {
  if (meter.resetsAt === undefined || meter.resetsAt <= now) return ''
  const left = meter.resetsAt - now
  const minutes = Math.ceil(left / MINUTE)
  if (left >= DAY) return `${Math.floor(left / DAY)}日`
  const hours = Math.floor(minutes / 60)
  return hours === 0 ? `${minutes}分` : `${hours}時間${minutes % 60}分`
}

export function describe(meters: readonly Meter[], now = 0): string {
  return meters
    .map(m => {
      const reset = resetIn(m, now)
      return `${m.label} 残り${m.remaining}%${reset === '' ? '' : ` リセットまで${reset}`}`
    })
    .join(' / ')
}

function tone(remaining: number): { base: string; light: string; blink: number } {
  if (remaining <= 10) return { base: DANGER, light: DANGER_LIGHT, blink: 0.4 }
  if (remaining <= 25) return { base: KRAFT, light: KRAFT_LIGHT, blink: 0.8 }
  return { base: CLAY, light: CLAY_LIGHT, blink: 1.2 }
}

const filled = (remaining: number, segments: number) =>
  remaining === 0 ? 0 : Math.max(1, Math.round((remaining / 100) * segments))

// The word set before each percent, so it reads as what is left, not what is
// spent.
const LEFT_WORD = '残り'

// ---- desktop: one SVG, in the same look as the chart above it ----

// What is left, by how much: a coral gradient, amber when it runs low, red at
// the end, which pulses.
const SHADES = {
  ok: { from: '#FFB199', to: '#FF7A59' },
  low: { from: '#FFD58F', to: '#FFB547' },
  out: { from: '#FF9A94', to: '#FF5A52' },
}
const RAIL = '#2E2D2A'
const DIM = '#6F6B63'
const FACE = `'Yu Gothic UI','Meiryo','Hiragino Sans',sans-serif`
const DIGITS = `'Segoe UI','Helvetica Neue',Arial,sans-serif`

const METER_GAP = 22
const BAND_HEIGHT = 30
const BAR = 4

// Laid out in pixels for the width it is given: each meter takes an equal
// share, its name and what is left above a bar as wide as the share.
// The chart's strip sits above the meters; `svg` is handed the chart to draw in it.
export const FULL_HEIGHT = BAND_HEIGHT + CHART_HEIGHT

// The numbers and bars glow, the glow drifting while Claude is at work.
// Beside each window's name, how long until it resets.
export function svg(meters: readonly Meter[], width: number, chart = '', isMoving = false, now = 0): string {
  const count = Math.max(1, meters.length)
  const share = (width - 16 - METER_GAP * (count - 1)) / count
  let defs = crossing('ub-rail', SHADES.ok.to, RAIL, isMoving)
  // A hairline parts the chart from the meters.
  let body = `<rect x="8" y="0" width="${width - 16}" height="1" fill="url(#ub-rail)"/>`

  meters.forEach((meter, index) => {
    const shade = meter.remaining <= 10 ? SHADES.out : meter.remaining <= 25 ? SHADES.low : SHADES.ok
    const left = 8 + index * (share + METER_GAP)
    const right = left + share
    const fill = meter.remaining === 0 ? 0 : Math.max(BAR, (share * meter.remaining) / 100)
    const id = `ub-m${index}`

    defs += sheen(id, shade.to, shade.from, isMoving, index * 0.8) + sheen(`ub-n${index}`, shade.from, NUMBER, isMoving, index * 0.8)
    // At the end it pulses, so it is noticed.
    const pulse =
      shade === SHADES.out
        ? '<animate attributeName="opacity" values="1;0.35;1" dur="1.2s" repeatCount="indefinite"/>'
        : ''
    // A narrow share keeps the time and drops the words before it.
    const reset = resetIn(meter, now)
    const until = reset === '' ? '' : share >= 200 ? `リセットまで ${reset}` : `↻ ${reset}`
    body +=
      `<text x="${left}" y="17" font-family="${DIGITS}" font-size="9.5" font-weight="700" ` +
      `letter-spacing="1.4" fill="${DIM}">${meter.label}` +
      (until === '' ? '' : `<tspan dx="8" font-family="${FACE}" font-size="10" font-weight="400" letter-spacing="0" fill="${LABEL}">${until}</tspan>`) +
      `</text>` +
      `<text x="${right}" y="17" text-anchor="end" font-family="${DIGITS}" font-size="14" font-weight="700" ` +
      `fill="${NUMBER}"><tspan font-family="${FACE}" font-size="9.5" font-weight="400" fill="${DIM}">${LEFT_WORD} </tspan>` +
      `<tspan fill="url(#ub-n${index})">${meter.remaining}</tspan><tspan font-size="9" fill="${DIM}">%</tspan></text>` +
      `<rect x="${left}" y="22" width="${share.toFixed(1)}" height="${BAR}" rx="${BAR / 2}" fill="${RAIL}"/>` +
      `<rect x="${left}" y="22" width="${fill.toFixed(1)}" height="${BAR}" rx="${BAR / 2}" fill="url(#${id})" ` +
      `filter="url(#ub-meter-glow)">${pulse}</rect>`
  })

  defs += breathe('ub-meter-glow', isMoving)

  const height = FULL_HEIGHT
  const scene = `<defs>${defs}</defs><g transform="translate(0 ${CHART_HEIGHT})">${body}</g>` + chart

  // The viewBox only matters if the frame comes out narrower than asked: the
  // drawing then shrinks whole instead of being cut off. The frame keeps a
  // transparent canvas only while its color scheme matches the page around it.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" ` +
    `height="${height}" preserveAspectRatio="xMinYMid meet" ` +
    `style="color-scheme:light dark;background:transparent">` +
    `<style>:root,html,body{color-scheme:light dark;background:transparent;margin:0}</style>` +
    `${scene}</svg>`
  )
}

// ---- terminal: one row of Raster cells, repainted by $.ui.blit ----

const DEFAULT = 0x01000000
const hex = (color: string) => parseInt(color.slice(1), 16)

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function base64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    out += B64[a >> 2]! + B64[((a & 3) << 4) | (b >> 4)]!
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)]! : '='
    out += i + 2 < bytes.length ? B64[c & 63]! : '='
  }

  return out
}

export function cells(meters: readonly Meter[], columns: number, tick: number): string {
  const words = new Uint32Array(columns * 3)
  for (let i = 0; i < columns; i++) words.set([0x20, DEFAULT, DEFAULT], i * 3)

  let x = 0
  const put = (glyph: string, fg: number, bg = DEFAULT) => {
    if (x < columns) words.set([glyph.codePointAt(0) ?? 0x20, fg, bg], x * 3)
    x += 1
  }
  const type = (text: string, fg: number) => {
    for (const glyph of text) put(glyph, fg)
  }

  // Each meter gets an equal share; a segment is one coloured cell and a gap.
  const share = Math.floor(columns / Math.max(1, meters.length))
  const segments = Math.max(0, Math.floor((share - 15) / 2))

  for (const meter of meters) {
    const { base, light, blink } = tone(meter.remaining)
    const on = filled(meter.remaining, segments)
    // The highlight sweeps the filled run, then rests for as long again.
    const sweep = tick % Math.max(1, segments * 2)
    const isTipLit = Math.floor((tick * 0.15) / (blink / 2)) % 2 === 0

    type(`${meter.label} `, hex(LABEL))
    for (let i = 0; i < segments; i++) {
      let bg = hex(TRACK)
      if (i < on) bg = hex(i === sweep ? light : base)
      if (i === on - 1 && !isTipLit) bg = hex(TRACK)
      put(' ', DEFAULT, bg)
      x += 1
    }
    type(`${meter.remaining}%`.padStart(4), hex(NUMBER))
    type(' left', hex(LABEL))
    x += 2
  }

  return base64(new Uint8Array(words.buffer))
}
