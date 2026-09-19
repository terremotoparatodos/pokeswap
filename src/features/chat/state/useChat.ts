// The chat log the panel reads and the socket writes.
//
// Singleton, like `usePlaytestGate`: the panel, the unread badge and the socket
// adapter must not be able to disagree about what was said.
//
// It holds no authority and no persistence. Lines arrive from the server and
// die with the tab; `send` is an intent the server may refuse (rate limit,
// guest, empty), and the client never fakes a line it has not been told about
// — which is why your own message appears when it comes back from the room and
// not the moment you press Enter.

import { computed, readonly, ref, type ComputedRef, type Ref } from 'vue'
import { appendLine, draftToSend, mergeHistory, parseChatLine, type ChatLine } from '../domain/chatLine'

export type ChatAccess = 'connecting' | 'player' | 'guest'

const lines = ref<ChatLine[]>([])
const areaId = ref<string | null>(null)
const access = ref<ChatAccess>('connecting')
const unread = ref(0)
const open = ref(false)
let sender: ((text: string) => void) | null = null
const lineListeners = new Set<(line: ChatLine) => void>()

/** What the socket adapter calls. Kept apart from what the UI calls. */
export interface ChatSink {
  /** One new line from the room. */
  line(raw: unknown): void
  /** The area's recent history, on join and on every area change. */
  history(nextAreaId: string, raw: unknown): void
  /** Whether this client may speak; guests read. */
  setAccess(next: ChatAccess): void
  /** The socket dropped: the log stays, but nothing can be sent. */
  detach(): void
}

export interface Chat {
  readonly lines: Readonly<Ref<ChatLine[]>>
  readonly areaId: Readonly<Ref<string | null>>
  readonly access: Readonly<Ref<ChatAccess>>
  readonly unread: Readonly<Ref<number>>
  readonly open: Ref<boolean>
  readonly canSend: ComputedRef<boolean>
  /** Registers the socket's send function. Null when there is no socket. */
  attach(send: ((text: string) => void) | null): void
  /** Returns false when the draft was empty and nothing was sent. */
  send(draft: string): boolean
  /** Observes server-accepted live lines (history replays do not speak again). */
  subscribe(listener: (line: ChatLine) => void): () => void
  markRead(): void
  readonly sink: ChatSink
}

const sink: ChatSink = {
  line(raw) {
    const line = parseChatLine(raw)
    if (!line) return
    const before = lines.value.length
    lines.value = appendLine(lines.value, line)
    if (lines.value.length > before) {
      if (!open.value) unread.value++
      for (const listener of lineListeners) listener(line)
    }
  },
  history(nextAreaId, raw) {
    areaId.value = nextAreaId
    const parsed = Array.isArray(raw) ? raw.map(parseChatLine).filter((line): line is ChatLine => !!line) : []
    // Leaving an area leaves its conversation behind: the log shows where you
    // are, not everywhere you have been.
    lines.value = mergeHistory(parsed.filter(line => line.areaId === nextAreaId), [])
    unread.value = 0
  },
  setAccess(next) {
    access.value = next
  },
  detach() {
    sender = null
    access.value = 'connecting'
  },
}

export function useChat(): Chat {
  return {
    lines: readonly(lines) as Readonly<Ref<ChatLine[]>>,
    areaId: readonly(areaId) as Readonly<Ref<string | null>>,
    access: readonly(access) as Readonly<Ref<ChatAccess>>,
    unread: readonly(unread) as Readonly<Ref<number>>,
    open,
    canSend: computed(() => access.value === 'player' && sender !== null),
    attach(send) {
      sender = send
      if (!send) access.value = 'connecting'
    },
    send(draft) {
      const text = draftToSend(draft)
      if (!text || !sender) return false
      sender(text)
      return true
    },
    subscribe(listener) {
      lineListeners.add(listener)
      return () => { lineListeners.delete(listener) }
    },
    markRead() {
      unread.value = 0
    },
    sink,
  }
}
