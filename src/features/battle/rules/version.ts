// What version of PokeSwap's battle rules this is (R32.3).
//
// Two versions travel with every battle and they answer different questions:
//
//   `catalogVersion`      — **what the data says**. Which species, moves, types
//                           and natures exist, and with which numbers (R32.1).
//   `battleRulesVersion`  — **how PokeSwap reads that data in a realtime
//                           fight**. The Action Bar, the meaning of priority,
//                           what Protect does, how a status behaves without
//                           turns. None of that is in the catalog, and none of
//                           it is Generation VI's answer either.
//
// A client and a server that agree on the catalog can still disagree on the
// rules, so both are compared before an action is trusted (R32.4).
//
// Bump this when a rule changes in a way that would make the same commands
// produce a different battle. Changing a PLAYTEST parameter in the config is a
// rules change: the config travels inside the state and a replay carries the
// numbers it ran with, but a stored battle from another rules version is not
// replayable here and is rejected rather than reinterpreted.

export const BATTLE_RULES_VERSION = 'pokeswap-battle-v1'

/** Ruleset these rules adapt. The departures are listed in the docs. */
export const BATTLE_RULES_BASE_RULESET = 'oras-gen6'
