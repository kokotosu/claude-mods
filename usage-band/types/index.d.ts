export type Meter = {
  /** The pixel-font label: `5H`, `7D`, `$`, `CTX`. */
  label: string
  /** What is left of the window, 0 to 100. */
  remaining: number
}

/** What Clawd is doing. */
export type Pose = 'doze' | 'think' | 'talk' | 'research' | 'work' | 'done'

export type Figure = {
  pose: Pose
  /** What it is at, for its label: a tool's name, or nothing. */
  note: string
}

declare module 'claude-code' {
  interface PluginState {
    'usage-band': {
      meters: Meter[]
      figure: Figure
      /** The dim suggestion the prompt box is showing, or empty. */
      hint: string
    }
  }
}
