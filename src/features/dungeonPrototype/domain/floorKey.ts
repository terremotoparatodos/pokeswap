// Floor keys and their bad-luck protection (D1).
//
// APPROVED: Pokémon inside the dungeon may drop a Floor Key; the key opens the
// way to the next floor; it belongs to the expedition, never leaves it, and is
// lost on retreat and on wipe.
//
// PROTOTYPE ASSUMPTION: the numbers, and the shape of the protection. The rule
// is that RNG may make a floor slower, never impossible.

export interface FloorKeyConfig {
  /** Chance the first defeated encounter of the floor drops the key. */
  readonly baseChance: number
  /** Added to the chance for every defeat since the last key. */
  readonly increment: number
  /** Defeats without a key after which the next one is guaranteed. */
  readonly guaranteedAfter: number
}

/**
 * Chosen option: **escalating chance with a hard guarantee**.
 *
 * A floor of 5–8 encounters drops the key in about 2 tries on average and can
 * never take more than 4. The alternative considered was "the key is carried by
 * one marked Pokémon in the floor", which is more readable but makes the floor
 * a search rather than a fight, and a third option, "the key drops from the
 * first encounter always", which removes the tension entirely. Both are noted
 * in the design doc as live alternatives.
 */
export const DEFAULT_KEY_CONFIG: FloorKeyConfig = { baseChance: 0.35, increment: 0.2, guaranteedAfter: 4 }

export interface FloorKeyState {
  readonly hasKey: boolean
  /** Defeats on this floor since the last key was granted. */
  readonly defeatsWithoutKey: number
}

export const emptyKeyState = (): FloorKeyState => ({ hasKey: false, defeatsWithoutKey: 0 })

/** The chance the next defeat drops the key, given what has happened so far. */
export function keyChance(state: FloorKeyState, config: FloorKeyConfig = DEFAULT_KEY_CONFIG): number {
  if (state.hasKey) return 0
  if (state.defeatsWithoutKey + 1 >= config.guaranteedAfter) return 1
  return Math.min(1, config.baseChance + config.increment * state.defeatsWithoutKey)
}

export interface KeyRoll {
  readonly state: FloorKeyState
  readonly dropped: boolean
  readonly chance: number
  /** True when the drop came from the guarantee rather than the roll. */
  readonly guaranteed: boolean
}

/** Resolves one defeat. `roll` is injected so a test can pin the outcome. */
export function rollFloorKey(
  state: FloorKeyState, roll: number, config: FloorKeyConfig = DEFAULT_KEY_CONFIG,
): KeyRoll {
  if (state.hasKey) return { state, dropped: false, chance: 0, guaranteed: false }
  const chance = keyChance(state, config)
  const guaranteed = chance >= 1
  const dropped = guaranteed || roll < chance
  return {
    state: dropped ? { hasKey: true, defeatsWithoutKey: 0 } : { hasKey: false, defeatsWithoutKey: state.defeatsWithoutKey + 1 },
    dropped, chance, guaranteed,
  }
}

/** Entering a new floor: the key is spent on the door behind you. */
export const spendKey = (state: FloorKeyState): FloorKeyState =>
  state.hasKey ? emptyKeyState() : state
