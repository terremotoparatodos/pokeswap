// What a chat line is on this side of the wire.
//
// The server owns the rules: it sanitises, it rate limits, it decides what the
// area remembers (`services/realtime/src/chat/chat.js`). Nothing here is a
// second implementation of that — this is the shape the client receives, plus
// the small amount of trimming the input box does so the player is not left
// pressing Enter on something that will be silently dropped.
//
// Rendering is Vue interpolation, always. `text` is another player's typing and
// is never handed to `innerHTML`; the repo's eslint config makes that a lint
// error rather than a habit (AGENTS §13).

/** The hard cap, mirrored from the server so the input can say so. */
export const MAX_CHAT_LENGTH = 200

/** What the log keeps on the client. The server keeps its own, per area. */
export const CLIENT_CHAT_HISTORY = 100

export interface ChatLine {
  readonly id: string
  readonly areaId: string
  /** Sender's user id, so a client can tell its own lines apart. */
  readonly from: string
  readonly username: string
  readonly text: string
  /** Server clock, in milliseconds. */
  readonly at: number
}

/**
 * What the input box will actually send, or null when there is nothing to send.
 *
 * Deliberately thinner than the server's sanitiser: it collapses whitespace and
 * caps the length so the Enter key does something predictable. Everything else
 * — invisible characters, bidi overrides, rate — is the server's to refuse,
 * because a client check is UX and a server check is the rule.
 */
export function draftToSend(draft: string): string | null {
  const trimmed = draft.replace(/\s+/g, ' ').trim()
  if (!trimmed) return null
  return [...trimmed].slice(0, MAX_CHAT_LENGTH).join('')
}

/** A line that arrived over the socket, or null if it is not one. */
export function parseChatLine(value: unknown): ChatLine | null {
  if (!value || typeof value !== 'object') return null
  const line = value as Record<string, unknown>
  if (typeof line.id !== 'string' || typeof line.text !== 'string') return null
  if (typeof line.username !== 'string' || typeof line.areaId !== 'string') return null
  return {
    id: line.id,
    areaId: line.areaId,
    from: typeof line.from === 'string' ? line.from : '',
    username: line.username,
    text: line.text,
    at: typeof line.at === 'number' ? line.at : Date.now(),
  }
}

/**
 * Appends a line, keeping the log bounded and refusing duplicates.
 *
 * Duplicates are a real case rather than a hypothetical one: a client that
 * reconnects is handed the area history again, and some of it is already on
 * screen. Keying on the server's own id makes the replay idempotent.
 */
export function appendLine(lines: readonly ChatLine[], line: ChatLine, limit = CLIENT_CHAT_HISTORY): ChatLine[] {
  if (lines.some(existing => existing.id === line.id)) return [...lines]
  const next = [...lines, line]
  return next.length > limit ? next.slice(next.length - limit) : next
}

/** Merges a server history dump into what is already on screen, in time order. */
export function mergeHistory(lines: readonly ChatLine[], history: readonly ChatLine[], limit = CLIENT_CHAT_HISTORY): ChatLine[] {
  let merged = [...lines]
  for (const line of history) merged = appendLine(merged, line, limit)
  return merged.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
}

/** `14:03` — the clock, not the date. A playtest lasts two hours. */
export function formatTime(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}
