// The slow glow kokot's mods share: a light drifting sideways through a
// gradient, and a soft halo that swells and fades.
//
// They move only while `isMoving`. A page with anything moving on it is drawn
// again every frame, which measured about a quarter of a core however small
// the motion, and about the same for four strips as for one. So they move
// while the app is moving anyway (Claude at work, a render running) and rest,
// still lit, otherwise.

// What it fills seems to glow: `base` at its ends, `bright` in its middle.
// `shift` starts each at its own point of the drift.
export function sheen(id: string, base: string, bright: string, isMoving: boolean, shift = 0): string {
  const drift = isMoving
    ? `<animateTransform attributeName="gradientTransform" type="translate" from="-1 0" to="1 0" dur="6s" begin="-${shift}s" repeatCount="indefinite"/>`
    : ''
  return (
    `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0" spreadMethod="reflect">` +
    `<stop offset="0" stop-color="${base}"/><stop offset="0.5" stop-color="${bright}"/><stop offset="1" stop-color="${base}"/>` +
    `${drift}</linearGradient>`
  )
}

// A soft halo around what it is put on, swelling and fading while moving.
export function breathe(id: string, isMoving: boolean): string {
  const swell = isMoving ? `<animate attributeName="stdDeviation" values="0.6;2.4;0.6" dur="4s" repeatCount="indefinite"/>` : ''
  return (
    `<filter id="${id}" x="-50%" y="-80%" width="200%" height="260%">` +
    `<feGaussianBlur stdDeviation="1.2" result="b">${swell}</feGaussianBlur>` +
    `<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
  )
}

// A line with one patch of light crossing it slowly, left to right; at rest,
// the plain line.
export function crossing(id: string, color: string, track: string, isMoving: boolean): string {
  if (!isMoving) return `<linearGradient id="${id}"><stop offset="0" stop-color="${track}"/></linearGradient>`
  return (
    `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0.3" stop-color="${track}"/><stop offset="0.5" stop-color="${color}"/><stop offset="0.7" stop-color="${track}"/>` +
    `<animateTransform attributeName="gradientTransform" type="translate" from="-0.7 0" to="0.7 0" dur="9s" repeatCount="indefinite"/>` +
    `</linearGradient>`
  )
}
