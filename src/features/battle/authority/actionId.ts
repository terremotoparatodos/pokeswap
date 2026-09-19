// The identifier every client intention carries (R32.4).
//
//     actionId = "<controllerId>:<sequence>"
//
// One string, two jobs, and choosing this shape is the reason §9 and §10 cost
// so little further down:
//
//   **dedupe** — the same id twice is the same action twice. A retry after a
//   dropped acknowledgement must not spend the PP again.
//   **ordering** — the sequence is a per-controller counter, so the authority
//   can tell "I have not seen this" from "I saw a later one already" without
//   timestamps, vector clocks or a distributed anything.
//
// Scope is **battle × controller**. Not global, not per socket: a reconnecting
// client keeps its controller identity and keeps counting, so the actions it
// sent before the drop are still recognisable as the same ones.
//
// The prefix is not decoration. The authority checks it against the
// *authenticated* controller, so a client cannot mint ids in someone else's
// namespace and poison their dedupe window.
//
// Why not a UUID: a UUID dedupes and says nothing about order, so stale
// detection would need a second field and a bounded cache would have no safe
// backstop once it evicts. Why not a timestamp: §11 — nothing here may depend
// on a wall clock for its meaning.

/** How a client builds one. `sequence` starts at 1 and only ever grows. */
export const formatActionId = (controllerId: string, sequence: number): string =>
  `${controllerId}:${sequence}`

export interface ParsedActionId {
  readonly controllerId: string
  readonly sequence: number
}

const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER

/**
 * Reads one, or returns `null`.
 *
 * Strict on purpose: the last colon separates, the sequence is decimal digits
 * only, and `01` is not `1`. Anything that round-trips through
 * `formatActionId` is accepted and anything else is refused, so two clients
 * cannot spell the same action differently and get it executed twice.
 */
export function parseActionId(value: unknown): ParsedActionId | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) return null
  const split = value.lastIndexOf(':')
  if (split <= 0 || split === value.length - 1) return null
  const controllerId = value.slice(0, split)
  const digits = value.slice(split + 1)
  if (!/^[1-9][0-9]*$/.test(digits)) return null
  const sequence = Number(digits)
  if (!Number.isSafeInteger(sequence) || sequence > MAX_SEQUENCE) return null
  return { controllerId, sequence }
}
