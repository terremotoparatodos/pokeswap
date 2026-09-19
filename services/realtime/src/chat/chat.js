// Area chat — Community Playtest 0.1.
//
// Pure rules, no Colyseus: what counts as a message, how often one may be
// sent, and what the room remembers. The room wires them up.
//
// SCOPE: **area**. Players in `ciudad-corazon` talk to players in
// `ciudad-corazon`, players in `pradera` to players in `pradera`. The actor
// already carries `areaId` for presence, so area scope costs nothing extra and
// is the one we want to watch — a city that sounds busy and a wilderness that
// sounds empty is information.
//
// WHO MAY SPEAK: authenticated players only. A guest connects as an observer
// with no username, and a chat line with no name behind it is not something a
// two-hour playtest should have to moderate. Guests read.
//
// HISTORY: the last `CHAT_HISTORY` lines per area, in memory, so somebody who
// joins mid-conversation sees what is going on. It dies with the process on
// purpose: chat is not something this playtest should persist.
//
// RENDERING: the text stays text. The server strips control characters and
// collapses runs of whitespace, and it deliberately does **not** strip `<`, so
// "3 < 5" survives. Escaping belongs to the renderer, which uses Vue's `{{ }}`
// and is held to it by the repo's own ban on `v-html` and `innerHTML`.

/** Long enough for a sentence, short enough that nobody pastes a wall. */
export const MAX_CHAT_LENGTH = 200

/** Lines remembered per area. */
export const CHAT_HISTORY = 60

/** Floor between two messages from the same player. */
export const CHAT_MIN_INTERVAL_MS = 700

/** And a burst ceiling on top of it, so a script cannot ride the floor. */
export const CHAT_BURST_LIMIT = 6
export const CHAT_BURST_WINDOW_MS = 10_000

/**
 * Characters classified by code point rather than by a regular expression.
 *
 * A regex literal cannot hold U+2028 or U+2029 — they *are* line terminators,
 * so they end the literal — and writing them as escapes in source is a trap
 * waiting for the next person to reformat the file. Comparing numbers has
 * neither problem and reads as what it is.
 */
const isControl = (code) => code <= 0x08 || (code >= 0x0b && code <= 0x1f) || (code >= 0x7f && code <= 0x9f)

/** Zero-width marks, bidi overrides and separators: invisible, and used to fake names. */
const isInvisible = (code) =>
  (code >= 0x200b && code <= 0x200f) // zero-width space … right-to-left mark
  || code === 0x2028 || code === 0x2029 // line and paragraph separators
  || (code >= 0x202a && code <= 0x202e) // bidi embedding and override
  || (code >= 0x2066 && code <= 0x2069) // bidi isolates
  || code === 0xfeff // byte order mark

/**
 * The text of a message, or null when there is nothing to send.
 *
 * Trims, flattens newlines and tabs into spaces, collapses runs, removes
 * characters that cannot be seen, and caps the length. Unicode that is
 * actually text — accents, emoji, other scripts — passes through untouched.
 *
 * Iterated by code point, so a cap never lands in the middle of an emoji and
 * leaves a broken half behind.
 */
export function sanitizeChat(raw) {
  if (typeof raw !== 'string') return null
  const kept = []
  for (const character of raw) {
    const code = character.codePointAt(0)
    if (isInvisible(code)) continue
    kept.push(isControl(code) ? ' ' : character)
  }
  const cleaned = kept.join('').replace(/\s+/g, ' ').trim()
  return cleaned ? [...cleaned].slice(0, MAX_CHAT_LENGTH).join('') : null
}

/** The wire shape of an incoming message. */
export function chatIntent(value) {
  if (!value || typeof value !== 'object') return null
  const text = sanitizeChat(value.text)
  return text ? { text } : null
}

/**
 * Whether this actor may speak now, and remembers that they did.
 *
 * Mutates the actor the way `acceptMove` does, and for the same reason: the
 * actor is where per-player transport state already lives.
 */
export function acceptChat(actor, now) {
  if (!actor) return false
  const lastAt = typeof actor.lastChatAt === 'number' ? actor.lastChatAt : 0
  if (now - lastAt < CHAT_MIN_INTERVAL_MS) return false
  const recent = (actor.chats ?? []).filter(at => now - at < CHAT_BURST_WINDOW_MS)
  if (recent.length >= CHAT_BURST_LIMIT) {
    actor.chats = recent
    return false
  }
  recent.push(now)
  actor.chats = recent
  actor.lastChatAt = now
  return true
}

/** One line, as every client receives it. */
export function chatMessage(actor, text, now, sequence) {
  return {
    id: `${actor.id}:${sequence}`,
    areaId: actor.areaId,
    from: actor.id,
    username: actor.username,
    text,
    at: now,
  }
}

/**
 * The last lines of each area.
 *
 * A plain Map of arrays, trimmed on append. Areas are independent so one busy
 * area cannot push another area's history out.
 */
export class ChatLog {
  constructor(limit = CHAT_HISTORY) {
    this.limit = limit
    this.byArea = new Map()
  }

  append(message) {
    const lines = this.byArea.get(message.areaId) ?? []
    lines.push(message)
    if (lines.length > this.limit) lines.splice(0, lines.length - this.limit)
    this.byArea.set(message.areaId, lines)
    return lines
  }

  /** What a client joining this area should see. A copy: callers may not edit it. */
  recent(areaId) {
    return [...(this.byArea.get(areaId) ?? [])]
  }

  clear() {
    this.byArea.clear()
  }
}
