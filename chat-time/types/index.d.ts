// When one message was written: its role, the head of its text, the time.
export type Stamp = { r: 'user' | 'assistant'; t: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'chat-time': { found: number }
  }
}
