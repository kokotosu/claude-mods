/** One thing the shield did, newest last in the log. */
export type ShieldEvent = {
  /**
   * `stopped`: a dangerous operation the person said no to (or nobody could
   * be asked); `allowed`: one they let through; `ok`: a file checked clean;
   * `broken`: a file with a syntax error, handed back to Claude to fix.
   */
  kind: 'stopped' | 'allowed' | 'ok' | 'broken'
  /** What it was about: the command, or the file's name and line. */
  subject: string
  /** What would have happened, or what is wrong, in plain words. */
  detail: string
  /** When, in ms. */
  at: number
}

export type ShieldTally = {
  stopped: number
  allowed: number
  checked: number
  broken: number
}

/** Another chat that is working, or has an answer you have not read. */
export type ChatState = {
  /** The app's id for the chat, `local_…`: what opens it. Absent in a scan older than it. */
  id?: string
  title: string
  state: 'working' | 'waiting'
  /** Its last activity, in ms. */
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    shield: {
      /** The latest event, or none yet this session. */
      last: ShieldEvent | null
      tally: ShieldTally
      /** The other chats at work. */
      others: ChatState[]
    }
  }
}
