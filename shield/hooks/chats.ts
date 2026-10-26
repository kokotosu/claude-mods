// Which other chats are working and which have an answer you have not read,
// from the desktop app's own records of its sessions on disk. Nothing is
// asked of the app: one chat reads the records for all, every few seconds at
// most, and leaves what it found in the store for the others.

import type { EngineInterface } from 'claude-code'

import type { ChatState } from '../types'

const SCAN_KEY = 'chatScan'
// How old a scan may be before some chat makes a new one.
export const SCAN_EVERY_MS = 10_000
// Only records written this recently are read.
const RECENT_MS = 24 * 3_600_000
// A turn with no activity for this long was cut off (the app closed mid-turn).
const STALE_MS = 15 * 60_000

type Scan = { at: number; chats: (ChatState & { cli: string })[] }

const isScan = (value: unknown): value is Scan =>
  typeof value === 'object' && value !== null && Array.isArray((value as Scan).chats)

type Record = {
  cliSessionId?: unknown
  title?: unknown
  isArchived?: unknown
  lastActivityAt?: unknown
  lastTurnEdgeAt?: unknown
  latestUserFrameAt?: unknown
  lastFocusedAt?: unknown
  completedTurns?: unknown
  interruptedAwaitingPerson?: unknown
}

const time = (value: unknown) => (typeof value === 'number' ? value : 0)

// What a record says of its chat: working, waiting on you, or neither.
export function stateOf(record: Record, now: number): ChatState['state'] | null {
  if (record.isArchived === true) return null
  const activity = time(record.lastActivityAt)
  const edge = time(record.lastTurnEdgeAt)
  const sent = time(record.latestUserFrameAt)
  const seen = time(record.lastFocusedAt)

  // A turn begins at your message and its edge marks it; its end moves the
  // edge on past the message.
  const isTurnOpen = sent > 0 && sent >= edge - 2_000 && activity >= edge - 2_000
  if (isTurnOpen && now - activity < STALE_MS) return 'working'
  if (record.interruptedAwaitingPerson !== null && record.interruptedAwaitingPerson !== undefined && record.interruptedAwaitingPerson !== false) return 'waiting'
  if (time(record.completedTurns) > 0 && activity > seen + 3_000 && now - activity < RECENT_MS) return 'waiting'
  return null
}

async function roots($: EngineInterface): Promise<string[]> {
  const found: string[] = []
  const appData = await $.env.get('APPDATA')
  const localAppData = await $.env.get('LOCALAPPDATA')
  if (appData !== undefined) found.push(`${appData}/Claude/claude-code-sessions`)
  if (localAppData !== undefined) {
    try {
      for (const entry of await $.fs.list(`${localAppData}/Claude-Data`)) {
        if (entry.kind === 'dir') found.push(`${localAppData}/Claude-Data/${entry.name}/claude-code-sessions`)
      }
    } catch {
      // The app keeps its records under APPDATA only.
    }
  }
  return found
}

async function scan($: EngineInterface, now: number): Promise<Scan> {
  const chats: Scan['chats'] = []
  for (const root of await roots($)) {
    try {
      for (const account of await $.fs.list(root)) {
        if (account.kind !== 'dir') continue
        for (const space of await $.fs.list(`${root}/${account.name}`)) {
          if (space.kind !== 'dir') continue
          const folder = `${root}/${account.name}/${space.name}`
          for (const entry of await $.fs.list(folder)) {
            if (entry.kind !== 'file' || !entry.name.startsWith('local_') || now - entry.mtimeMs > RECENT_MS) continue
            try {
              const record = JSON.parse(String(await $.fs.read(`${folder}/${entry.name}`))) as Record
              const state = stateOf(record, now)
              if (state === null || typeof record.cliSessionId !== 'string') continue
              const title = typeof record.title === 'string' && record.title.trim() !== '' ? record.title.trim() : '名前なし'
              const id = entry.name.replace(/.json$/, '')
              chats.push({ cli: record.cliSessionId, id, title, state, at: time(record.lastActivityAt) })
            } catch {
              // A record being rewritten: it is read next time.
            }
          }
        }
      }
    } catch {
      // A root that is not there.
    }
  }
  return { at: now, chats: chats.sort((a, b) => b.at - a.at) }
}

// The other chats' states: the store's scan while fresh, else a new one.
export async function otherChats($: EngineInterface): Promise<ChatState[]> {
  const now = await $.clock.now()
  const stored = await $.store.get(SCAN_KEY)
  let found = isScan(stored) && now - stored.at < SCAN_EVERY_MS ? stored : null
  if (found === null) {
    // Claimed before scanning, so chats waking together do not all scan.
    await $.store.set(SCAN_KEY, { at: now, chats: isScan(stored) ? stored.chats : [] })
    found = await scan($, now)
    await $.store.set(SCAN_KEY, found)
  }

  const self = await $.session.id()
  // Only the chats at work are shown; the ones waiting on you are left out.
  return found.chats
    .filter(chat => chat.cli !== self && chat.state === 'working')
    .map(({ id, title, state, at }) => ({ ...(id === undefined ? {} : { id }), title, state, at }))
}
