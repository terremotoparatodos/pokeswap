// The expedition: the instance a player (or group) owns while inside (D3).
//
// APPROVED and enforced here:
//  - loot found inside is EXPEDITION LOOT until the player walks out;
//  - a capture made inside is expedition loot too, with the same risk;
//  - retreating keeps the loot and resets the dungeon to floor 1 next time;
//  - a wipe loses every bit of expedition loot and returns the player to the
//    nearest Pokémon Center; what was owned before entering is untouched, and
//    consumables already spent stay spent;
//  - Floor Keys never leave: not on retreat, not on wipe;
//  - there are no checkpoints and no free healing between floors.
//
// This module is pure state; it neither renders nor talks to a server. Every
// mutation is the CLIENT INTENT of an operation the server must own later.

import { emptyKeyState, spendKey, type FloorKeyState } from './floorKey'
import { cloneParty, isWiped, type PokemonInstance } from './party'

export type ExpeditionStatus = 'active' | 'retreated' | 'wiped'
export type ExpeditionOutcome = 'IN_PROGRESS' | 'EXTRACTED' | 'RETURN_TO_NEAREST_POKEMON_CENTER'

export interface ItemStackLike {
  readonly itemId: string
  readonly quantity: number
}

export interface CapturedPokemon {
  readonly instanceId: string
  readonly speciesId: string | number
  readonly level: number
  readonly floor: number
}

export interface ExpeditionState {
  readonly expeditionId: string
  readonly seed: number
  readonly floor: number
  readonly floors: number
  readonly status: ExpeditionStatus
  /** What the player already owned. The dungeon may spend from it, never lose it. */
  readonly carriedInventory: Readonly<Record<string, number>>
  /** Everything found inside, at risk until extraction. */
  readonly expeditionLoot: Readonly<Record<string, number>>
  /** Captures made inside: also at risk. */
  readonly expeditionCaptures: readonly CapturedPokemon[]
  readonly key: FloorKeyState
  readonly party: readonly PokemonInstance[]
  /** Consumables spent inside, for the report; they are never refunded. */
  readonly spentConsumables: Readonly<Record<string, number>>
}

export interface StartExpeditionInput {
  readonly expeditionId: string
  readonly seed: number
  readonly floors: number
  readonly party: readonly PokemonInstance[]
  readonly carriedInventory: Readonly<Record<string, number>>
}

export function startExpedition(input: StartExpeditionInput): ExpeditionState {
  return {
    expeditionId: input.expeditionId,
    seed: input.seed,
    floor: 1,
    floors: input.floors,
    status: 'active',
    carriedInventory: { ...input.carriedInventory },
    expeditionLoot: {},
    expeditionCaptures: [],
    key: emptyKeyState(),
    // The party is copied: an expedition wears down its own copy, and the lab
    // can restart without the fixture having been mutated underneath it.
    party: cloneParty(input.party),
    spentConsumables: {},
  }
}

const add = (bag: Readonly<Record<string, number>>, itemId: string, quantity: number): Record<string, number> => {
  const next = { ...bag }
  next[itemId] = (next[itemId] ?? 0) + quantity
  if (next[itemId] <= 0) delete next[itemId]
  return next
}

/** Loot picked up inside. It is not the player's yet. */
export function addExpeditionLoot(state: ExpeditionState, stacks: readonly ItemStackLike[]): ExpeditionState {
  if (state.status !== 'active') return state
  let loot = state.expeditionLoot
  for (const stack of stacks) loot = add(loot, stack.itemId, stack.quantity)
  return { ...state, expeditionLoot: loot }
}

/** A capture made inside. Same rule: not safe until extraction (the Larvitar case). */
export function addExpeditionCapture(state: ExpeditionState, captured: CapturedPokemon): ExpeditionState {
  if (state.status !== 'active') return state
  return { ...state, expeditionCaptures: [...state.expeditionCaptures, captured] }
}

/**
 * Spends one consumable. It comes out of the carried inventory first, then out
 * of anything of the same kind found inside; either way it is gone for good.
 */
export function consumeItem(state: ExpeditionState, itemId: string): { state: ExpeditionState; used: boolean } {
  if (state.status !== 'active') return { state, used: false }
  if ((state.carriedInventory[itemId] ?? 0) > 0) {
    return {
      state: {
        ...state,
        carriedInventory: add(state.carriedInventory, itemId, -1),
        spentConsumables: add(state.spentConsumables, itemId, 1),
      },
      used: true,
    }
  }
  if ((state.expeditionLoot[itemId] ?? 0) > 0) {
    return {
      state: {
        ...state,
        expeditionLoot: add(state.expeditionLoot, itemId, -1),
        spentConsumables: add(state.spentConsumables, itemId, 1),
      },
      used: true,
    }
  }
  return { state, used: false }
}

export const itemCount = (state: ExpeditionState, itemId: string): number =>
  (state.carriedInventory[itemId] ?? 0) + (state.expeditionLoot[itemId] ?? 0)

export function grantKey(state: ExpeditionState, key: FloorKeyState): ExpeditionState {
  return state.status === 'active' ? { ...state, key } : state
}

export interface AdvanceResult {
  readonly state: ExpeditionState
  readonly advanced: boolean
  readonly reason: 'ok' | 'no-key' | 'last-floor' | 'not-active'
}

/** The locked door: one key, one floor. HP and PP carry over untouched. */
export function advanceFloor(state: ExpeditionState): AdvanceResult {
  if (state.status !== 'active') return { state, advanced: false, reason: 'not-active' }
  if (state.floor >= state.floors) return { state, advanced: false, reason: 'last-floor' }
  if (!state.key.hasKey) return { state, advanced: false, reason: 'no-key' }
  return {
    state: { ...state, floor: state.floor + 1, key: spendKey(state.key) },
    advanced: true,
    reason: 'ok',
  }
}

export interface ExpeditionResult {
  readonly state: ExpeditionState
  readonly outcome: ExpeditionOutcome
  /** Items that actually reach the player's inventory. */
  readonly extractedLoot: Readonly<Record<string, number>>
  readonly extractedCaptures: readonly CapturedPokemon[]
  readonly lostLoot: Readonly<Record<string, number>>
  readonly lostCaptures: readonly CapturedPokemon[]
  /** Where the next expedition into this dungeon starts. Always floor 1: no checkpoints. */
  readonly nextEntryFloor: 1
}

/** Walking out: everything found inside becomes the player's. The key does not. */
export function retreat(state: ExpeditionState): ExpeditionResult {
  const merged = { ...state.carriedInventory }
  for (const [itemId, quantity] of Object.entries(state.expeditionLoot)) {
    merged[itemId] = (merged[itemId] ?? 0) + quantity
  }
  return {
    state: {
      ...state, status: 'retreated', carriedInventory: merged,
      expeditionLoot: {}, key: emptyKeyState(),
    },
    outcome: 'EXTRACTED',
    extractedLoot: { ...state.expeditionLoot },
    extractedCaptures: [...state.expeditionCaptures],
    lostLoot: {},
    lostCaptures: [],
    nextEntryFloor: 1,
  }
}

/**
 * Every member fainted. The expedition ends: the loot and the captures made
 * inside are gone, the carried inventory survives as it stands (already-spent
 * consumables stay spent), and the key disappears.
 */
export function wipe(state: ExpeditionState): ExpeditionResult {
  return {
    state: {
      ...state, status: 'wiped',
      expeditionLoot: {}, expeditionCaptures: [], key: emptyKeyState(),
    },
    outcome: 'RETURN_TO_NEAREST_POKEMON_CENTER',
    extractedLoot: {},
    extractedCaptures: [],
    lostLoot: { ...state.expeditionLoot },
    lostCaptures: [...state.expeditionCaptures],
    nextEntryFloor: 1,
  }
}

/** Called after any damage: the wipe is a consequence, not a button. */
export const shouldWipe = (state: ExpeditionState): boolean =>
  state.status === 'active' && isWiped(state.party)
