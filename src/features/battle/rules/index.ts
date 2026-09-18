// Shared Battle Rules (R32.3).
//
// PokeSwap's battle engine: pure, deterministic, and the **same module** on a
// client and on a server. No UI, no networking, no persistence, no Supabase,
// no Dungeon — a dependency in any of those directions would make it
// unrunnable on the other side, and R32.4 needs to run it on both.
//
//   same initial state
// + same commands, in the same order
// + same seed
// + same catalogVersion and battleRulesVersion
// ------------------------------------------------
//   same final state, and the same events
//
// Nothing here calls `Math.random()`, reads a clock, touches the DOM, imports
// Vue or opens a socket. Randomness is injected as an `RngState` that lives
// inside the state; time arrives as whole milliseconds on a command.
//
// Import from here; the files are an implementation detail.

export * from './version'
export * from './config'
export * from './rng'
export * from './catalogView'
export * from './moveSupport'
export * from './state'
export * from './stats'
export * from './actionBar'
export * from './damage'
export * from './capture'
export * from './commands'
export * from './events'
export * from './setup'
export { reduceBattle, currentTargetOf } from './reduce'
export type { BattleContext, BattleTransition } from './reduce'
export { STRUGGLE_MOVE_NAME } from './moveEffects'
