// PRESENCE UX-1 — entering the shared world without showing a provisional area.
//
// Online, the area the player stands in is the presence server's. The browser
// owns none of it: this machine only tracks how far the current socket got
// (snapshot received), whether the engine finished building the area that
// snapshot put it in (area prepared) and whether the scene is drawing (live).
// The scene goes live only once the first two hold. No area id, tile or
// coordinate is stored here.

export type WorldEntryPhase =
  /** No realtime configured: the local world, exactly as before UX-1. */
  | 'offline'
  /** First entry: nothing drawn yet, input blocked, waiting for the server. */
  | 'connecting'
  /** Live and playable. */
  | 'ready'
  /** The room was lost after entering: last frame kept, input blocked. */
  | 'reconnecting'
  /** The wait ran out (`failed` says which); only a manual retry continues. */
  | 'connection-error'
  /**
   * Another tab or device owns the account's session (4409, a resume refused with 4409, or a
   * 4001 read as a replacement). Never retried automatically: only «Jugar acá» (takeover).
   */
  | 'replaced'

export interface WorldEntryState {
  phase: WorldEntryPhase
  /** Which wait ran out, for the wording of `connection-error`. */
  failed: 'entry' | 'reconnect' | null
  /** The current socket's room answered with an authoritative snapshot. */
  authority: boolean
  /** The engine finished preparing the area that snapshot placed it in. */
  prepared: boolean
  /** The scene is drawing and accepting input (authority and prepared). */
  live: boolean
  /** A scene was revealed at least once, so its last frame is under the overlay. */
  sceneShown: boolean
}

export type WorldEntryEvent =
  | { type: 'snapshot' }
  | { type: 'prepared' }
  | { type: 'lost' }
  | { type: 'timeout' }
  /** The engine could not build the area the server placed it in. */
  | { type: 'prepare-failed' }
  | { type: 'replaced' }
  | { type: 'retry' }
  /** WORLD LOCATION-4: «Jugar acá», the player's explicit takeover out of a replaced session. */
  | { type: 'takeover' }
  /** The browser session changed and the socket is replaced (sign-in, sign-out). */
  | { type: 'renew' }

/** No authority waited for longer than this on the first entry. */
export const ENTRY_TIMEOUT_MS = 12_000
/** No authority waited for longer than this after losing the room. */
export const RECONNECT_TIMEOUT_MS = 15_000

export function initialWorldEntry(online: boolean): WorldEntryState {
  return { phase: online ? 'connecting' : 'offline', failed: null, authority: false, prepared: false, live: false, sceneShown: false }
}

/**
 * The world is there to play: the local world, or a live scene. Every other phase shows the
 * entry overlay (WorldEntryOverlay), which makes the map and the HUD inert (CHAT-SHORTCUT-1, CH-R1).
 */
export function worldPlayable(state: WorldEntryState): boolean {
  return state.phase === 'offline' || state.phase === 'ready'
}

/** Waiting for the server: the phases a timeout applies to. */
export function isWaiting(state: WorldEntryState): boolean {
  return state.phase === 'connecting' || state.phase === 'reconnecting'
}

/** How long the current wait may last, or null when nothing is being waited for. */
export function waitLimitMs(state: WorldEntryState): number | null {
  if (!isWaiting(state) || state.authority) return null
  return state.phase === 'connecting' ? ENTRY_TIMEOUT_MS : RECONNECT_TIMEOUT_MS
}

const waiting = (state: WorldEntryState, phase: 'connecting' | 'reconnecting'): WorldEntryState =>
  ({ ...state, phase, failed: null, authority: false, prepared: false, live: false })

export function nextWorldEntry(state: WorldEntryState, event: WorldEntryEvent): WorldEntryState {
  if (state.phase === 'offline') return state
  switch (event.type) {
    case 'snapshot':
      // In `ready` a snapshot is an ordinary area change or resync: not ours.
      return isWaiting(state) ? { ...state, authority: true, prepared: false, live: false } : state
    case 'prepared':
      if (!isWaiting(state) || !state.authority) return state
      return { ...state, phase: 'ready', prepared: true, live: true, sceneShown: true }
    case 'lost':
      if (state.phase === 'ready') return waiting(state, 'reconnecting')
      // A snapshot whose area was still being prepared no longer counts.
      return isWaiting(state) ? waiting(state, state.phase as 'connecting' | 'reconnecting') : state
    case 'timeout':
      if (!isWaiting(state) || state.authority) return state
      return { ...waiting(state, state.phase as 'connecting' | 'reconnecting'), phase: 'connection-error', failed: state.phase === 'connecting' ? 'entry' : 'reconnect' }
    case 'prepare-failed':
      if (!isWaiting(state) || !state.authority) return state
      return { ...waiting(state, state.phase as 'connecting' | 'reconnecting'), phase: 'connection-error', failed: state.phase === 'connecting' ? 'entry' : 'reconnect' }
    case 'replaced':
      return { ...state, phase: 'replaced', failed: null, authority: false, prepared: false, live: false }
    case 'retry':
      if (state.phase !== 'connection-error') return state
      return waiting(state, state.failed === 'reconnect' ? 'reconnecting' : 'connecting')
    case 'takeover':
      if (state.phase !== 'replaced') return state
      return waiting(state, 'connecting')
    case 'renew':
      // No automatic attempt out of an error or a replaced session.
      if (state.phase === 'ready') return waiting(state, 'reconnecting')
      return isWaiting(state) ? waiting(state, state.phase as 'connecting' | 'reconnecting') : state
  }
}
