/**
 * WORLD LOCATION-4 — WebSocket close codes and join refusals of the presence room
 * (docs/design/WORLD_LOCATION_4_DESIGN.md §5).
 *
 * Colyseus 0.18 reserves 4000 CONSENTED, 4001 SERVER_SHUTDOWN, 4002 WITH_ERROR,
 * 4003 FAILED_TO_RECONNECT, 4010 MAY_TRY_RECONNECT (and 4217 as a matchmaking error).
 * Before WORLD LOCATION-4 this room also used 4001 for "a newer session owns the
 * account", so every graceful restart looked like a replacement to the client.
 *
 *   4409  session-replaced  an authoritative replacement: stop, offer «Jugar acá»
 *   4503  host-draining     shutdown, deploy or drain: reconnect (with resume)
 *   4001  legacy replace    only towards clients that declare presenceProtocol <= 2
 *
 * CLOUD JOIN-ORDER-2 (only with WORLD_JOIN_ORDER=on, only to joins that carry an attempt):
 *   4410  stale-attempt / duplicate-attempt   the page already moved past this join: it is
 *         discarded quietly (never placed, never retried); the page's current socket is untouched
 *   4422  invalid-attempt   the join's attempt is unreadable: refused, never retried
 * Clients that send no attempt never receive either.
 */
export const SESSION_REPLACED_CODE = 4409
export const HOST_DRAINING_CODE = 4503
export const LEGACY_REPLACED_CODE = 4001
export const STALE_ATTEMPT_CODE = 4410
export const INVALID_ATTEMPT_CODE = 4422
/** The presence protocol that understands 4409 / 4503 / resume (the server echoes it). */
export const CLOSE_CODES_PROTOCOL = 3
