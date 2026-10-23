import type { SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Meter } from '../types'
import { SCENE_HEIGHT } from './clawd'

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
  const limits = rateLimits.map(limit => ({
    // A model's own weekly window (Fable's) is named after the model.
    label: LABELS[limit.kind] ?? (/fable/i.test(limit.kind) ? 'FB' : '?'),
    remaining: clamp(100 - limit.percentUsed),
  }))

  return [...limits, { label: 'CTX', remaining: clamp(100 - (context.percent ?? 0)) }]
}

export function describe(meters: readonly Meter[]): string {
  return meters.map(m => `${m.label} 残り${m.remaining}%`).join(' / ')
}

function tone(remaining: number): { base: string; light: string; blink: number } {
  if (remaining <= 10) return { base: DANGER, light: DANGER_LIGHT, blink: 0.4 }
  if (remaining <= 25) return { base: KRAFT, light: KRAFT_LIGHT, blink: 0.8 }
  return { base: CLAY, light: CLAY_LIGHT, blink: 1.2 }
}

const filled = (remaining: number, segments: number) =>
  remaining === 0 ? 0 : Math.max(1, Math.round((remaining / 100) * segments))

// ---- desktop: one SVG, animated by SMIL in discrete steps ----

// 5x7 pixel font, one string of seven 5-bit rows per glyph.
const FONT: Record<string, string> = {
  '0': '01110 10001 10011 10101 11001 10001 01110',
  '1': '00100 01100 00100 00100 00100 00100 01110',
  '2': '01110 10001 00001 00010 00100 01000 11111',
  '3': '11110 00001 00001 01110 00001 00001 11110',
  '4': '00010 00110 01010 10010 11111 00010 00010',
  '5': '11111 10000 11110 00001 00001 10001 01110',
  '6': '00110 01000 10000 11110 10001 10001 01110',
  '7': '11111 00001 00010 00100 01000 01000 01000',
  '8': '01110 10001 10001 01110 10001 10001 01110',
  '9': '01110 10001 10001 01111 00001 00010 01100',
  '%': '11001 11010 00010 00100 01000 01011 10011',
  H: '10001 10001 10001 11111 10001 10001 10001',
  F: '11111 10000 10000 11110 10000 10000 10000',
  B: '11110 10001 10001 11110 10001 10001 11110',
  D: '11110 10001 10001 10001 10001 10001 11110',
  C: '01110 10001 10000 10000 10000 10001 01110',
  T: '11111 00100 00100 00100 00100 00100 00100',
  X: '10001 10001 01010 00100 01010 10001 10001',
  $: '00100 01111 10100 01110 00101 11110 00100',
  '?': '01110 10001 00001 00010 00100 00000 00100',
}
const ADVANCE = 6

function pixels(rows: string, x: number, y: number): string {
  let d = ''
  rows.split(' ').forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] === '1') d += `M${x + c} ${y + r}h1v1h-1z`
    }
  })
  return d
}

function word(text: string, x: number, y: number): string {
  let d = ''
  for (let i = 0; i < text.length; i++) {
    d += pixels(FONT[text[i] ?? ''] ?? '', x + i * ADVANCE, y)
  }
  return d
}

const FONT_SCALE = 2
const SEGMENT = 6
const SEGMENT_GAP = 2
const METER_GAP = 14
const BAND_HEIGHT = 16

const textWidth = (text: string) => (text.length * ADVANCE - 1) * FONT_SCALE

// The word set before each percent, so it reads as what is left, not what is
// spent. The pixel font has no kana, so it is drawn as ordinary text.
const LEFT_WORD = '残り'
const LEFT_SIZE = 12
const LEFT_WIDTH = LEFT_WORD.length * LEFT_SIZE

// Laid out in pixels for the width it is given: each meter takes an equal
// share, its label and percent their own widths, and the bar every pixel
// between them, so nothing overlaps at any width.
// Clawd's strip sits above the bars; `svg` is handed the character to draw in it.
export const FULL_HEIGHT = BAND_HEIGHT + SCENE_HEIGHT

export function svg(meters: readonly Meter[], width: number, character = ''): string {
  const count = Math.max(1, meters.length)
  const share = (width - METER_GAP * (count - 1)) / count
  const glyphs = (text: string, x: number, fill: string) =>
    `<path transform="translate(${x} 1) scale(${FONT_SCALE})" d="${word(text, 0, 0)}" fill="${fill}"/>`
  let body = ''

  meters.forEach((meter, index) => {
    const { base, light, blink } = tone(meter.remaining)
    const left = Math.round(index * (share + METER_GAP))
    const right = Math.round(left + share)
    const percent = `${meter.remaining}%`
    const barLeft = left + textWidth(meter.label) + 6
    // The percent column is as wide as `100%`, so the bars end in line.
    const barRight = right - textWidth('100%') - 4 - LEFT_WIDTH - 6
    const segments = Math.max(0, Math.floor((barRight - barLeft + SEGMENT_GAP) / (SEGMENT + SEGMENT_GAP)))
    const on = filled(meter.remaining, segments)

    const percentLeft = right - textWidth(percent)
    body +=
      glyphs(meter.label, left, LABEL) +
      `<text x="${percentLeft - 4}" y="13" text-anchor="end" font-size="${LEFT_SIZE}" font-weight="700" ` +
      `font-family="'Yu Gothic UI','Meiryo','Hiragino Sans',sans-serif" fill="${LABEL}">${LEFT_WORD}</text>` +
      glyphs(percent, percentLeft, NUMBER)

    for (let i = 0; i < segments; i++) {
      const rect = `<rect x="${barLeft + i * (SEGMENT + SEGMENT_GAP)}" y="4" width="${SEGMENT}" height="8"`
      if (i >= on) {
        body += `${rect} fill="${TRACK}"/>`
      } else if (i === on - 1) {
        // The tip blinks, faster the less is left.
        body +=
          `${rect} fill="${base}"><animate attributeName="opacity" values="1;0.3" ` +
          `keyTimes="0;0.5" dur="${blink}s" calcMode="discrete" repeatCount="indefinite"/></rect>`
      } else {
        // A highlight steps along the filled segments, one at a time.
        body +=
          `${rect} fill="${base}"><animate attributeName="fill" values="${light};${base}" ` +
          `keyTimes="0;0.04" dur="3s" begin="${(i * 0.06).toFixed(2)}s" calcMode="discrete" ` +
          `repeatCount="indefinite"/></rect>`
      }
    }
  })

  const height = FULL_HEIGHT
  const scene =
    `<g transform="translate(0 ${SCENE_HEIGHT})">${body}</g>` + character

  // The viewBox only matters if the frame comes out narrower than asked: the
  // drawing then shrinks whole instead of being cut off. The frame keeps a
  // transparent canvas only while its color scheme matches the page around it.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" ` +
    `height="${height}" preserveAspectRatio="xMinYMid meet" shape-rendering="crispEdges" ` +
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
