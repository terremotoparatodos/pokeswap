// WORLD LOCATION-4 (design §5.2) — what a closed presence socket means for this client.
//
// Only an authoritative replacement stops the client (and offers «Jugar acá»); a shutdown,
// deploy, drain or network loss reconnects with `resume`, which never displaces another tab.
// A 4001 is ambiguous only against a server that did not announce protocol 3: there it may be
// Colyseus' own shutdown close or an older server's replacement, so at most one reconnection a
// minute is tried. No rule here can make two tabs evict each other in a loop.

/** Declared on join: compact steps (2) and the WORLD LOCATION-4 close codes (3). */
export const PRESENCE_PROTOCOL = 3

export const CLOSE_CODE = {
  /** The client left on its own. */
  CONSENTED: 4000,
  /** Colyseus' shutdown, or an older server's replacement. */
  LEGACY: 4001,
  /** Another tab or device owns the session (close code, or join refusal of a resume). */
  REPLACED: 4409,
  /** Shutdown, deploy or drain (close code, or join refusal of a draining host). */
  DRAINING: 4503,
} as const

/** A socket closed with an ambiguous 4001 is retried only if it lived at least this long… */
export const AMBIGUOUS_MIN_LIFETIME_MS = 30_000
/** …and no other ambiguous 4001 happened within this window. */
export const AMBIGUOUS_WINDOW_MS = 60_000

export type ClosingReason = 'replaced' | 'draining'
export type CloseAction =
  /** Stop for good: the overlay offers «Jugar acá». */
  | 'replaced'
  /** Reconnect with `resume`; `immediate` restarts the backoff (a drain is not a failure). */
  | 'reconnect'
  /** Nothing to retry (the client's own leave). */
  | 'none'

export interface ClosedSocket {
  code: number
  /** `presence:closing` received on this socket before it closed, if any. */
  closing: ClosingReason | null
  /** The `presenceProtocol` the server echoed in its snapshot (null: none, an older server). */
  serverProtocol: number | null
  /** How long the socket was joined. */
  livedMs: number
  now: number
  /** When the last ambiguous 4001 was taken as a restart (null: never). */
  lastAmbiguousAt: number | null
}

export interface CloseDecision {
  action: CloseAction
  immediate: boolean
  /** This decision spent the once-a-minute ambiguous 4001 allowance. */
  ambiguous: boolean
}

const decision = (action: CloseAction, immediate = false, ambiguous = false): CloseDecision => ({ action, immediate, ambiguous })

export function closeDecision(closed: ClosedSocket): CloseDecision {
  // The server said why before closing: that wins over the code.
  if (closed.closing === 'replaced') return decision('replaced')
  if (closed.closing === 'draining') return decision('reconnect', true)
  switch (closed.code) {
    case CLOSE_CODE.REPLACED: return decision('replaced')
    case CLOSE_CODE.DRAINING: return decision('reconnect', true)
    case CLOSE_CODE.CONSENTED: return decision('none')
    case CLOSE_CODE.LEGACY: {
      // A protocol-3 server never replaces a protocol-3 client with 4001: only Colyseus sends it.
      if ((closed.serverProtocol ?? 0) >= PRESENCE_PROTOCOL) return decision('reconnect', true)
      const recent = closed.lastAmbiguousAt !== null && closed.now - closed.lastAmbiguousAt < AMBIGUOUS_WINDOW_MS
      if (closed.livedMs >= AMBIGUOUS_MIN_LIFETIME_MS && !recent) return decision('reconnect', false, true)
      return decision('replaced')
    }
    default: return decision('reconnect')
  }
}

/** A refused join (ServerError code): replaced stops, anything else is retried with `resume`. */
export function joinRefusalDecision(code: unknown): CloseDecision {
  if (code === CLOSE_CODE.REPLACED) return decision('replaced')
  if (code === CLOSE_CODE.DRAINING) return decision('reconnect', true)
  return decision('reconnect')
}
