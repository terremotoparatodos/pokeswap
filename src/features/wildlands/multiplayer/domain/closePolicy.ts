// WORLD LOCATION-4 (design §5.2) — what a closed presence socket means for this client.
//
// Only an authoritative replacement stops the client (and offers «Jugar acá»); a shutdown,
// deploy, drain or network loss reconnects with `resume`, which never displaces another tab.
// A 4001 is ambiguous only against a server that did not announce protocol 3: there it may be
// Colyseus' own shutdown close or an older server's replacement, so at most one reconnection a
// minute is tried. No rule here can make two tabs evict each other in a loop.
//
// CLOUD JOIN-ORDER-2: every join carries this page's next attempt number. 4410 answers an attempt the
// page already moved past (an abandoned join that arrived late, or a repeated one); 4422 an attempt
// the server cannot read. Neither ever reconnects on its own: an abandoned socket stays silent, and
// the page's current connection is never closed, moved or retried because of them.

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
  /** CLOUD JOIN-ORDER-2: this join is an older (or repeated) attempt of the page: discarded. */
  STALE_ATTEMPT: 4410,
  /** CLOUD JOIN-ORDER-2: the server could not read this join's attempt (a client defect). */
  INVALID_ATTEMPT: 4422,
} as const

/** A socket closed with an ambiguous 4001 is retried only if it lived at least this long… */
export const AMBIGUOUS_MIN_LIFETIME_MS = 30_000
/** …and no other ambiguous 4001 happened within this window. */
export const AMBIGUOUS_WINDOW_MS = 60_000

/**
 * CLOUD READINESS-3: 'owner-unreachable' — the server that held this account's session does not
 * answer (crash or partition). Retried like a drain, but only OWNER_UNREACHABLE_ATTEMPTS times in a
 * row: then the adapter stops and the overlay offers «Jugar acá» (never taken automatically).
 */
export type ClosingReason = 'replaced' | 'draining' | 'owner-unreachable'
/** Consecutive owner-unreachable closes before the adapter stops retrying (backoff 0.5 → 4 s: ≈ 7.5 s). */
export const OWNER_UNREACHABLE_ATTEMPTS = 4
export type CloseAction =
  /** Stop for good: the overlay offers «Jugar acá». */
  | 'replaced'
  /** CLOUD READINESS-3: reconnect like a drain, counted; past the limit the player chooses («Jugar acá»). */
  | 'owner-unreachable'
  /**
   * Reconnect with `resume`, on the transport's bounded backoff. A drain does not reset it
   * (review F7): repeated 4503 refusals during a drain keep backing off; only a stable
   * (ready) connection resets it.
   */
  | 'reconnect'
  /** Nothing to retry (the client's own leave). */
  | 'none'
  /**
   * CLOUD JOIN-ORDER-2 (4410): the page already moved past this attempt. Silent for an abandoned socket;
   * never a reconnection. If the socket that gets it is still the page's own, it stops (no retry loop).
   */
  | 'discarded'
  /** CLOUD JOIN-ORDER-2 (4422): the attempt was unreadable. Stops without retrying (no automatic loop). */
  | 'invalid'

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
  /** This decision spent the once-a-minute ambiguous 4001 allowance. */
  ambiguous: boolean
}

const decision = (action: CloseAction, ambiguous = false): CloseDecision => ({ action, ambiguous })

export function closeDecision(closed: ClosedSocket): CloseDecision {
  // The server said why before closing: that wins over the code.
  if (closed.closing === 'replaced') return decision('replaced')
  if (closed.closing === 'draining') return decision('reconnect')
  if (closed.closing === 'owner-unreachable') return decision('owner-unreachable')
  switch (closed.code) {
    case CLOSE_CODE.REPLACED: return decision('replaced')
    case CLOSE_CODE.DRAINING: return decision('reconnect')
    case CLOSE_CODE.CONSENTED: return decision('none')
    case CLOSE_CODE.STALE_ATTEMPT: return decision('discarded')
    case CLOSE_CODE.INVALID_ATTEMPT: return decision('invalid')
    case CLOSE_CODE.LEGACY: {
      // A protocol-3 server never replaces a protocol-3 client with 4001: only Colyseus sends it.
      if ((closed.serverProtocol ?? 0) >= PRESENCE_PROTOCOL) return decision('reconnect')
      const recent = closed.lastAmbiguousAt !== null && closed.now - closed.lastAmbiguousAt < AMBIGUOUS_WINDOW_MS
      if (closed.livedMs >= AMBIGUOUS_MIN_LIFETIME_MS && !recent) return decision('reconnect', true)
      return decision('replaced')
    }
    default: return decision('reconnect')
  }
}

/**
 * A refused join (ServerError code): replaced stops, a discarded or unreadable attempt stops quietly
 * (CLOUD JOIN-ORDER-2), anything else is retried with `resume`.
 */
export function joinRefusalDecision(code: unknown): CloseDecision {
  if (code === CLOSE_CODE.REPLACED) return decision('replaced')
  if (code === CLOSE_CODE.STALE_ATTEMPT) return decision('discarded')
  if (code === CLOSE_CODE.INVALID_ATTEMPT) return decision('invalid')
  if (code === CLOSE_CODE.DRAINING) return decision('reconnect')
  return decision('reconnect')
}
