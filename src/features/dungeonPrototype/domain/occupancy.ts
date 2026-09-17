// Encounter occupancy: who is allowed to fight this wild Pokémon (D4).
//
// APPROVED: a wild Pokémon cannot be in combat with two players at once; other
// players must see it as busy and must not be able to start that fight.
//
// **This module is a contract, not an implementation of it.** The real decision
// is SERVER AUTHORITY: only the server may grant a reservation, and the client
// may do nothing but ask and render the answer. What lives here is the state
// machine the server will have to implement, written purely so the races can be
// tested before anyone writes networking.
//
// The invariant, stated once: for a given encounter, at most one holder exists
// at any time, and a claim that arrives when a holder exists is rejected —
// never queued, never merged, never silently promoted.

export type EncounterStatus = 'AVAILABLE' | 'RESERVED' | 'IN_COMBAT' | 'DEFEATED' | 'DESPAWNED'

export interface EncounterOccupancy {
  readonly encounterId: string
  readonly status: EncounterStatus
  /** Player or party that holds the reservation, if any. */
  readonly holder: string | null
  /** Clock value at which an unconfirmed reservation expires. */
  readonly reservedUntil: number
}

/**
 * How long a reservation survives without the fight starting. It exists so a
 * player who walks away, disconnects or loses the race does not lock the
 * encounter forever. PROTOTYPE ASSUMPTION: 8 seconds.
 */
export const RESERVATION_SECONDS = 8

export const availableEncounter = (encounterId: string): EncounterOccupancy => ({
  encounterId, status: 'AVAILABLE', holder: null, reservedUntil: 0,
})

export type ClaimRejection = 'busy' | 'gone' | 'already-holder'

export interface ClaimResult {
  readonly state: EncounterOccupancy
  readonly granted: boolean
  readonly reason: ClaimRejection | 'ok'
}

/** Expiry is evaluated against the caller's clock; the server's clock is the real one. */
function expired(state: EncounterOccupancy, now: number): boolean {
  return state.status === 'RESERVED' && now >= state.reservedUntil
}

/**
 * One player asks for the encounter. Exactly one of two concurrent claims can
 * be granted, because the second one sees the state the first one left.
 */
export function claim(state: EncounterOccupancy, playerId: string, now: number): ClaimResult {
  if (state.status === 'DEFEATED' || state.status === 'DESPAWNED') {
    return { state, granted: false, reason: 'gone' }
  }
  if (state.status === 'IN_COMBAT') {
    return { state, granted: false, reason: state.holder === playerId ? 'already-holder' : 'busy' }
  }
  if (state.status === 'RESERVED' && !expired(state, now)) {
    return { state, granted: false, reason: state.holder === playerId ? 'already-holder' : 'busy' }
  }
  return {
    state: { ...state, status: 'RESERVED', holder: playerId, reservedUntil: now + RESERVATION_SECONDS },
    granted: true,
    reason: 'ok',
  }
}

/** The holder actually starts the fight; nobody else can. */
export function beginCombat(state: EncounterOccupancy, playerId: string, now: number): ClaimResult {
  if (state.status !== 'RESERVED' || state.holder !== playerId || expired(state, now)) {
    return { state, granted: false, reason: state.status === 'AVAILABLE' ? 'gone' : 'busy' }
  }
  return { state: { ...state, status: 'IN_COMBAT', reservedUntil: 0 }, granted: true, reason: 'ok' }
}

/** The fight ended with the Pokémon defeated or captured. */
export const resolveCombat = (state: EncounterOccupancy, outcome: 'defeated' | 'despawned'): EncounterOccupancy => ({
  ...state, status: outcome === 'defeated' ? 'DEFEATED' : 'DESPAWNED', holder: null, reservedUntil: 0,
})

/** The holder walked away or the fight never started: back to the pool. */
export function release(state: EncounterOccupancy, playerId: string): EncounterOccupancy {
  if (state.holder !== playerId) return state
  return availableEncounter(state.encounterId)
}

/** Called on a clock tick: an abandoned reservation frees itself. */
export const expireIfStale = (state: EncounterOccupancy, now: number): EncounterOccupancy =>
  expired(state, now) ? availableEncounter(state.encounterId) : state

/** What another player sees. The only two words the UI needs. */
export const isBusyForOthers = (state: EncounterOccupancy, playerId: string, now: number): boolean =>
  (state.status === 'IN_COMBAT' || (state.status === 'RESERVED' && !expired(state, now))) && state.holder !== playerId

/** A tiny registry so a lab can drive several encounters at once. */
export class OccupancyRegistry {
  private readonly states = new Map<string, EncounterOccupancy>()

  get(encounterId: string): EncounterOccupancy {
    return this.states.get(encounterId) ?? availableEncounter(encounterId)
  }

  claim(encounterId: string, playerId: string, now: number): ClaimResult {
    const result = claim(this.get(encounterId), playerId, now)
    if (result.granted) this.states.set(encounterId, result.state)
    return result
  }

  begin(encounterId: string, playerId: string, now: number): ClaimResult {
    const result = beginCombat(this.get(encounterId), playerId, now)
    if (result.granted) this.states.set(encounterId, result.state)
    return result
  }

  resolve(encounterId: string, outcome: 'defeated' | 'despawned'): void {
    this.states.set(encounterId, resolveCombat(this.get(encounterId), outcome))
  }

  release(encounterId: string, playerId: string): void {
    this.states.set(encounterId, release(this.get(encounterId), playerId))
  }
}
