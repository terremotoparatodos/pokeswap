// What the Tienda sells during Community Playtest 0.1.
//
// A safety net, not an economy. Buying something is one of the interactions
// we get to watch. Every price is a PLAYTEST VALUE.
//
// The catalog only names items that already exist: the Dungeon prototype's
// own supplies. Profession tools were retired in SKILLS-1 — the Pokémon does
// the work — so there is nothing a player must buy to use a skill.

/** What a purchase does, decided by whoever owns the state it lands in. */
export type ShopEffect =
  /** Adds Poké Balls to what the player walks into a Dungeon with. */
  | { readonly kind: 'ball'; readonly quantity: number }
  /** Adds a Dungeon consumable (potion, revive, ether) by its prototype id. */
  | { readonly kind: 'consumable'; readonly itemId: string; readonly quantity: number }

export interface ShopEntry {
  readonly id: string
  readonly name: string
  readonly note: string
  /** PLAYTEST VALUE. */
  readonly price: number
  readonly effect: ShopEffect
}

/**
 * PLAYTEST PARAMETER: the starting purse.
 *
 * Room for several rounds of supplies, so a tester who spends badly is
 * inconvenienced and never stuck. There is no way to earn more during the
 * playtest, on purpose: an earning loop is an economy, and this build is not
 * testing one.
 */
export const PLAYTEST_START_COINS = 400

/** The name on screen. Not tokens: tokens are real and persistent, these are not. */
export const COIN_NAME = 'fichas'

export const SHOP_ENTRIES: readonly ShopEntry[] = [
  {
    id: 'poke_ball_5', name: 'Poké Ball básica ×5', note: 'Ratio de captura malísimo. Es la idea.',
    price: 40, effect: { kind: 'ball', quantity: 5 },
  },
  {
    id: 'potion_3', name: 'Poción ×3', note: 'Para la Dungeon',
    price: 45, effect: { kind: 'consumable', itemId: 'potion', quantity: 3 },
  },
  {
    id: 'revive_1', name: 'Revivir ×1', note: 'Para la Dungeon',
    price: 60, effect: { kind: 'consumable', itemId: 'revive', quantity: 1 },
  },
]

export const entryById = (id: string): ShopEntry | null =>
  SHOP_ENTRIES.find(entry => entry.id === id) ?? null

/** Stock is infinite for the playtest (§49): a stock economy is not what we are watching. */
export type PurchaseRefusal = 'unknown' | 'poor'

export type Purchase =
  | { readonly ok: true; readonly entry: ShopEntry; readonly coins: number }
  | { readonly ok: false; readonly reason: PurchaseRefusal }

export interface PurchaseInput {
  readonly entryId: string
  readonly coins: number
}

/**
 * Whether a purchase goes through, and what is left afterwards.
 *
 * Pure, and it returns the new balance rather than a delta, because the whole
 * failure mode this guards against is two clicks each subtracting from a
 * balance neither of them has seen the other change.
 */
export function buy({ entryId, coins }: PurchaseInput): Purchase {
  const entry = entryById(entryId)
  if (!entry) return { ok: false, reason: 'unknown' }
  if (coins < entry.price) return { ok: false, reason: 'poor' }
  return { ok: true, entry, coins: coins - entry.price }
}

export const REFUSAL_TEXT: Readonly<Record<PurchaseRefusal, string>> = {
  unknown: 'Eso no está a la venta.',
  poor: 'No te alcanzan las fichas.',
}
