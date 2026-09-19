// Authority Foundations (R32.4).
//
// The server-side half of a PokeSwap battle. Shared Battle Rules (R32.3) say
// what happens; this says **whose word counts**, and the answer is never the
// client's.
//
//     transport payload (unknown)
//       → validate.ts        shape, ids, bounds — a whitelist, never a cast
//       → authority.ts       controller, target, versions, idempotency
//       → reduceBattle       the same rules a client runs
//       → events + revision + snapshot without the RNG
//
// Trusted: the clock, the seed, the catalog, the rules, the control mapping
// and the canonical state. Untrusted: everything that arrived on a socket —
// the intent, the ids, any timing a client mentions, and above all anything
// that looks like a *result*. A client proposes; the server decides (§35, and
// AGENTS §2).
//
// R32.4 stops here on purpose. No persistence, no inventory, no dungeon, no
// loot, no capture ownership, no co-op: `AUTHORITY_FOUNDATIONS.md` lists what
// belongs to R33 and later, and why putting it here would be a mistake rather
// than a shortcut.
//
// Import from here; the files are an implementation detail.

export * from './clock'
export * from './seed'
export * from './actionId'
export * from './protocol'
export * from './validate'
export * from './snapshot'
export * from './idempotency'
export * from './itemCatalog'
export * from './authority'
export * from './expeditionRoomCore'
