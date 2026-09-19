// What an item and a ball *are*, decided server-side (R32.4).
//
// R32.3's `USE_ITEM` command carries an `ItemEffect` — "heal 20 HP" — because
// the rules own what an item does to a Pokémon and deliberately know nothing
// about inventories (§29 of the rules doc). That is the right seam for a pure
// engine and a hole the size of a bus on a socket: a client would send
// `{ kind: 'healHp', amount: 99999 }` and the rules, correctly, would obey.
//
// So a client sends an **id**. The server looks the effect up here and builds
// the command itself. The same reasoning applies to a ball: the client says
// which ball it threw, the server owns the multiplier that decides a capture.
//
// This is not an inventory and it is not the economy. Nobody checks whether
// the player *has* the item — that needs ownership, which needs persistence,
// which is R36. What this file buys today is that the numbers are the
// server's, so R35 only has to add the stock check to a boundary that already
// exists.

import type { BallSpec, ItemEffect } from '../rules'

export interface AuthorityItemCatalog {
  /** The effect of an item id, or `null` when this server has no such item. */
  itemEffect(itemId: string, moveId: number | null): ItemEffect | null
  /** The ball behind an id, or `null`. */
  ball(ballId: string): BallSpec | null
}

/**
 * The R32.4 baseline: the three effects the rules implement and the four balls
 * the prototype used. PLAYTEST numbers, every one of them — the contract is
 * "the server owns the number", not "this is the number".
 */
const ITEMS: Readonly<Record<string, (moveId: number | null) => ItemEffect | null>> = {
  potion: () => ({ kind: 'healHp', amount: 20 }),
  'super-potion': () => ({ kind: 'healHp', amount: 50 }),
  'hyper-potion': () => ({ kind: 'healHp', amount: 200 }),
  ether: moveId => (moveId === null ? null : { kind: 'restorePp', moveId, amount: 10 }),
  'max-ether': moveId => (moveId === null ? null : { kind: 'restorePp', moveId, amount: 64 }),
  revive: () => ({ kind: 'revive', hpFraction: 0.5 }),
  'max-revive': () => ({ kind: 'revive', hpFraction: 1 }),
}

const BALLS: Readonly<Record<string, number>> = {
  'poke-ball': 1,
  'great-ball': 1.5,
  'ultra-ball': 2,
  'master-ball': 255,
}

export function createAuthorityItemCatalog(): AuthorityItemCatalog {
  return {
    itemEffect: (itemId, moveId) => ITEMS[itemId]?.(moveId) ?? null,
    ball: ballId => (ballId in BALLS ? { id: ballId, bonus: BALLS[ballId] } : null),
  }
}
