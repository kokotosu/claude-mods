export type Meter = {
  /** The pixel-font label: `5H`, `7D`, `$`, `CTX`. */
  label: string
  /** What is left of the window, 0 to 100. */
  remaining: number
  /** When the window resets, in ms; none for the context. */
  resetsAt?: number
}

/** One role's tokens: chats of the same name, without mark or number, added up. */
export type ChartGroup = {
  name: string
  tokens: number
}

/** What the tokens went on over the last days, largest first. */
export type Chart = {
  /** When it was added up, in ms. */
  at: number
  days: number
  groups: ChartGroup[]
}

declare module 'claude-code' {
  interface PluginState {
    'usage-band': {
      meters: Meter[]
      chart: Chart
      /** The dim suggestion the prompt box is showing, or empty. */
      hint: string
    }
  }
}
