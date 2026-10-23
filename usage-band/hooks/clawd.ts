// Clawd, the orange pixel creature, on top of the bars. What it is doing shows
// in the thing it holds, as large as itself, and in a label beside it: asleep
// between turns, reading a sheet of paper while the model works out the
// prompt, leafing through a book while a tool looks something up, typing on a
// laptop while a tool runs or changes something, talking into a big speech
// bubble while the answer streams, and jumping under a tick as the turn ends.
// One SVG group, animated by SMIL in discrete steps so every move lands on a
// pixel.

import type { Pose } from '../types'

const BODY = '#D97757'
const EYE = '#1F1E1D'
const IVORY = '#FAF9F5'
const AMBER = '#F0B44C'
const KRAFT = '#B98A5E'
const STEEL = '#8C8A82'
const SCREEN = '#2B2A27'
const GREEN = '#7BC47F'
const LABEL = '#C9C4B5'

// One sprite pixel is this many CSS pixels.
const UNIT = 4
// In sprite pixels: Clawd is 12 wide and stands on y = 14; the 7 rows above
// its head are for what it holds up.
const GROUND = 14
export const SCENE_HEIGHT = GROUND * UNIT

// Where Clawd stands, and where its label begins, in CSS pixels from the left.
const LEFT = 4
const LABEL_LEFT = LEFT + 36 * UNIT

const LABELS: Record<Pose, string> = {
  doze: '待機中',
  think: 'プロンプトを読んでいます',
  research: '調べています',
  work: '実行中',
  talk: '返答中',
  done: '完了!',
}

function sprite(rows: string[], x: number, y: number, fill: string, inner = ''): string {
  let d = ''
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] === 'X') d += `M${x + c} ${y + r}h1v1h-1z`
    }
  })
  return `<path d="${d}" fill="${fill}">${inner}</path>`
}

// An animation of `attribute` that loops on its own clock.
function loop(attribute: string, values: string[], seconds: number): string {
  const keyTimes = values.map((_, i) => (i / values.length).toFixed(3)).join(';')
  return (
    `<animate attributeName="${attribute}" values="${values.join(';')}" keyTimes="${keyTimes}" ` +
    `dur="${seconds}s" calcMode="discrete" repeatCount="indefinite"/>`
  )
}

// Shows a sprite only in the slots of a loop that `shown` names.
const slots = (count: number, shown: number[], seconds: number) =>
  loop(
    'visibility',
    Array.from({ length: count }, (_, slot) => (shown.includes(slot) ? 'visible' : 'hidden')),
    seconds,
  )

// A group that steps through `offsets` (sprite pixels), one per slot.
const stepping = (offsets: string[], seconds: number, body: string) =>
  `<g><animateTransform attributeName="transform" type="translate" values="${offsets.join(';')}" ` +
  `keyTimes="${offsets.map((_, i) => (i / offsets.length).toFixed(3)).join(';')}" dur="${seconds}s" ` +
  `calcMode="discrete" repeatCount="indefinite"/>${body}</g>`

const BODY_ROWS = ['..XXXXXXXX..', '..XXXXXXXX..', 'XXXXXXXXXXXX', '..XXXXXXXX..', '..XXXXXXXX..']
const LEGS = ['..X.X..X.X..', '..X.X..X.X..']

const body = () => sprite(BODY_ROWS, 0, 7, BODY)
const legs = () => sprite(LEGS, 0, 12, BODY)
const eyes = (left: number, y: number, inner = '') => sprite(['X..X', 'X..X'], left, y, EYE, inner)

// Between turns: eyes shut, breathing, `z`s rising.
function dozing(): string {
  const z = ['XXXX', '..X.', '.X..', 'XXXX']

  return (
    stepping(['0 0', '0 1'], 2.4, body() + sprite(['X..X'], 4, 9, EYE)) +
    legs() +
    sprite(z, 13, 3, IVORY, slots(4, [1, 2], 2.4)) +
    sprite(z, 18, 0, IVORY, slots(4, [2], 2.4))
  )
}

// Working out the prompt: a sheet of paper held up, the eyes going along its
// lines, each line marked as it is read.
function reading(): string {
  const sheet = Array.from({ length: 10 }, () => 'XXXXXXXXX')
  const lines = [0, 1, 2, 3].map(
    line =>
      sprite(['XXXXXX'], 15, 5 + line * 2, STEEL) +
      sprite(['XXXXXX'], 15, 5 + line * 2, AMBER, slots(5, [1, 2, 3, 4].filter(slot => slot > line), 2.5)),
  )

  return (
    body() +
    legs() +
    eyes(5, 8, slots(2, [0], 0.8)) +
    eyes(6, 8, slots(2, [1], 0.8)) +
    sprite(['XX'], 11, 9, BODY) +
    sprite(sheet, 13, 3, IVORY) +
    lines.join('')
  )
}

// Looking something up: an open book whose page turns, and a pile of books
// read that grows beside it.
function leafing(): string {
  const pages = ['XXXXXX.XXXXXX', 'XXXXXX.XXXXXX', 'XXXXXX.XXXXXX', 'XXXXXX.XXXXXX']
  const print = ['.XXXX...XXXX.', '.............', '.XXX....XXXX.']

  return (
    body() +
    legs() +
    eyes(5, 9) +
    sprite(pages, 13, 9, IVORY) +
    sprite(['XXXXXXXXXXXXX'], 13, 13, KRAFT) +
    sprite(print, 13, 10, STEEL) +
    // The turning page: upright at the spine, then leaning over.
    sprite(['X', 'X', 'X', 'X'], 19, 5, IVORY, slots(3, [1], 0.9)) +
    sprite(['...X', '..X.', '.X..', 'X...'], 20, 6, IVORY, slots(3, [2], 0.9)) +
    sprite(['XXXXXX', 'XXXXXX'], 28, 12, AMBER, slots(4, [1, 2, 3], 3.6)) +
    sprite(['XXXXXX', 'XXXXXX'], 28, 10, BODY, slots(4, [2, 3], 3.6)) +
    sprite(['XXXXXX', 'XXXXXX'], 28, 8, GREEN, slots(4, [3], 3.6))
  )
}

// Running a command or changing a file: a laptop, an arm tapping at its keys,
// lines of output running up its screen.
function typing(): string {
  const lid = Array.from({ length: 7 }, () => 'XXXXXXXXXXX')
  const glass = Array.from({ length: 5 }, () => 'XXXXXXXXX')

  return (
    body() +
    legs() +
    eyes(5, 8) +
    // The arm reaches the keys, up and down.
    sprite(['XX'], 11, 10, BODY, slots(2, [0], 0.24)) +
    sprite(['XX'], 11, 11, BODY, slots(2, [1], 0.24)) +
    sprite(lid, 14, 4, STEEL) +
    sprite(glass, 15, 5, SCREEN) +
    sprite(['XXXXXXXXXXXXX', 'XXXXXXXXXXXXX'], 13, 11, STEEL) +
    sprite(['X.X.X.X.X.X'], 14, 11, SCREEN) +
    sprite(['X'], 14, 11, AMBER, slots(3, [0], 0.36)) +
    sprite(['X'], 18, 11, AMBER, slots(3, [1], 0.36)) +
    sprite(['X'], 22, 11, AMBER, slots(3, [2], 0.36)) +
    sprite(['XXXXX'], 16, 6, GREEN, slots(4, [1, 2, 3], 1.2)) +
    sprite(['XXXXXXX'], 16, 7, GREEN, slots(4, [2, 3], 1.2)) +
    sprite(['XXX'], 16, 8, GREEN, slots(4, [3], 1.2)) +
    sprite(['X'], 20, 8, IVORY, slots(2, [0], 0.5))
  )
}

// Answering: a mouth that opens and shuts, and a big speech bubble whose
// lines fill in, clear and fill in again.
function talking(): string {
  const bubble = ['.XXXXXXXXXXXXXXX.', ...Array.from({ length: 6 }, () => 'XXXXXXXXXXXXXXXXX'), '.XXXXXXXXXXXXXXX.']
  const line = (row: string, y: number, from: number) =>
    sprite([row], 15, y, EYE, slots(6, [1, 2, 3, 4, 5].filter(slot => slot >= from), 2.4))

  return (
    stepping(
      ['0 0', '0 1'],
      0.6,
      body() + eyes(4, 8) + sprite(['XX'], 5, 10, EYE) + sprite(['XX'], 5, 11, EYE, slots(2, [0], 0.3)),
    ) +
    legs() +
    sprite(['.X', 'X.'], 11, 5, IVORY) +
    sprite(bubble, 13, 0, IVORY) +
    line('XXXXXXXXXXXXX', 1, 1) +
    line('XXXXXXXXXX', 3, 2) +
    line('XXXXXXXXXXXX', 5, 3) +
    line('XXXXXX', 6, 4)
  )
}

// As the turn ends: a jump, happy eyes, a big tick.
function cheering(): string {
  const tick = ['........XX', '.......XX.', '......XX..', 'XX...XX...', '.XX.XX....', '..XXX.....', '...X......']

  return (
    stepping(
      ['0 0', '0 -2', '0 -3', '0 -2'],
      0.5,
      body() + legs() + sprite(['.X..X.', 'X.XX.X'], 3, 8, EYE),
    ) + sprite(tick, 14, 2, GREEN)
  )
}

const escaped = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Clawd in `pose`, standing on `ground` (CSS pixels from the top), with its
 * label; `note` names what it is at (a tool), where there is something to name.
 */
export function clawd(pose: Pose, ground: number, note = ''): string {
  const figure = {
    doze: dozing,
    think: reading,
    research: leafing,
    work: typing,
    talk: talking,
    done: cheering,
  }[pose]()
  const label = note === '' ? LABELS[pose] : `${LABELS[pose]}: ${note}`

  return (
    `<g transform="translate(${LEFT} ${ground - SCENE_HEIGHT}) scale(${UNIT})">${figure}</g>` +
    `<text x="${LABEL_LEFT}" y="${ground - 16}" fill="${pose === 'doze' ? STEEL : LABEL}" font-size="13" ` +
    `font-family="system-ui, 'Yu Gothic UI', Meiryo, sans-serif">${escaped(label)}</text>`
  )
}
