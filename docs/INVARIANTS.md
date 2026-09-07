# PokeSwap — Product Invariants

> **Status:** R01 baseline  
> **Purpose:** Turn the implicit rules of the current prototype into explicit, named invariants that every
> migration step must preserve. An agent implementing a feature must be able to determine from this document
> whether a proposed change violates an invariant.  
> **Source:** Static reading of `index.html`, `js/swap.js`, `js/market.js`, `js/sfx.js`, and
> `docs/LEGACY_BASELINE.md`. Runtime behavior has not been verified against a live environment.  
> **Labeling:** Same convention as `LEGACY_BASELINE.md` — **FACT**, **INFERENCE**, **OPEN QUESTION**.

---

## How to use this document

Each invariant states a rule that must hold *before and after* a migration task is applied.

When migrating a responsibility:

1. Identify which invariant group it belongs to.
2. Confirm the invariant is currently satisfied (or note if it is violated — see §8).
3. Implement the new behavior so the invariant continues to hold.
4. Add a test that would catch a regression.

If a proposed change cannot satisfy an invariant, **stop and raise the conflict** rather than working
around it.

---

## 1. Identity

### INV-ID-1 — Supabase Auth is the identity authority

**FACT** — All session establishment, token refresh, password reset, and OAuth login go through
`sb.auth.*` calls (`index.html:3412, 3447, 3476, 3505, 3556`). No parallel identity system exists in
the frontend.

**Rule:** A user's identity (`user.id`) is always a Supabase Auth UUID. No migration step may substitute
a locally-generated or frontend-supplied identifier as an authoritative user id.

### INV-ID-2 — Username minimum length is 3 characters

**FACT** — Client validates `username.length < 3` at signup (`index.html:3469`).

**OPEN QUESTION** — No corresponding server-side constraint (DB check constraint or RLS policy) was
found in the frontend code. Whether Supabase enforces this at the database level is unknown.

**Rule:** When this moves to a new auth flow, the 3-character minimum must be enforced *server-side*
regardless of client validation, since client validation alone can be bypassed.

### INV-ID-3 — Usernames must be unique across all accounts

**FACT** — Before signup, the client queries `profiles` for a matching `username` and aborts if found
(`index.html:3473-3474`).

**OPEN QUESTION** — This uniqueness check is a client-side read followed by a separate write (classic
check-then-act race). Whether the `profiles` table has a database-level unique constraint on `username`
is unknown. Deferred to R02.

**Rule:** Username uniqueness must be enforced by a database-level unique constraint, not by client-side
pre-flight checks alone.

### INV-ID-4 — Usernames must not be rendered as trusted HTML

**INFERENCE** — Usernames appear in market listings, leaderboards, and activity feeds. No explicit
escaping was found in the rendering paths examined.

**Rule:** Any rendering of a username into HTML must treat it as untrusted text (escape or use
`textContent`/`createTextNode`). This applies to all future components.

---

## 2. Pokémon ownership

### INV-OWN-1 — A Pokémon has at most one current owner

**FACT** — The `slots` table has one row per Pokémon with a single `owner_id` column
(`js/swap.js:166-167`, `index.html:2362`).

**Rule:** No operation may result in two players both believing they own the same Pokémon. Ownership
changes require the `owner_id` field to be updated atomically (server-side) to exactly one value.

### INV-OWN-2 — The server decides all persistent ownership changes

**FACT — swap:** The `pokeswap-swap` Edge Function is called, and ownership is updated by the server.
The client only reads the result (`js/swap.js:396-403`).

**FACT — market buy:** The `market-buy` Edge Function is called for purchase. The client does not write
ownership tables directly in the buy path (`index.html:2140-2142`).

**INFERENCE — free claim / adoption:** The initial adoption flow that grants "5 free claims" reads
`profile.free_claims_remaining` on the client. Whether the actual ownership write goes through an Edge
Function or is a direct client write to `slots` is **OPEN QUESTION** — deferred to R02.

**Rule:** Ownership changes (`slots.owner_id`) must be performed server-side (Edge Function, trigger, or
RLS-protected function). The frontend must not write `owner_id` directly.

### INV-OWN-3 — A Pokémon locked for market is unavailable for other operations

**FACT** — Before starting a dungeon run, the client checks `slots[p.id]?.is_locked` and also
cross-checks active `market_listings` rows (`index.html:5132-5136, 5172`). A locked Pokémon cannot
enter the dungeon.

**INFERENCE** — A similar lock should block swap, but whether the `pokeswap-swap` Edge Function
validates the `is_locked` flag is **OPEN QUESTION** — deferred to R02.

**Rule:** Any server-side operation that changes ownership must verify `is_locked` and reject the
operation when the Pokémon is in an active market listing.

### INV-OWN-4 — A failed transaction must not leave a Pokémon permanently locked

**Rule:** If `market-buy` or any other ownership transfer fails after setting `is_locked = true`, the
lock must be released. Permanent lock-out is unacceptable.

---

## 3. Token economy

### INV-TOK-1 — Token balance is stored in `profiles.tokens`

**FACT** — All balance reads and writes target `profiles.tokens` (`index.html:2375-2379,
2260-2262, 7657-7662`).

### INV-TOK-2 — Passive token collection is currently client-authoritative *(known gap)*

**FACT** — `collectPassiveTokens()` computes earned tokens in the browser (rate × elapsed hours, capped
at 24h offline) and writes the result directly to `profiles.tokens` via a client Supabase call
(`index.html:2348-2388`).

**FACT** — The claim cooldown (10 minutes between claims, `CLAIM_COOLDOWN_MIN = 10`) is enforced
client-side only.

**Rule / Gap:** This is a security gap: a user who bypasses the client can award themselves arbitrary
tokens. R01 records it as a known violation of the target invariant ("token balance is
server-authoritative") rather than pretending it is already enforced. **Migration must move passive
token calculation to a server-side function** before the token economy can be considered safe.

### INV-TOK-3 — Dungeon token rewards are currently client-authoritative *(known gap)*

**FACT** — `advAddDungeonTokens(amount)` computes the capped reward and writes it directly to
`profiles.tokens` and `profiles.dungeon_tokens_today` (`index.html:7647-7666`).

**FACT** — The daily cap of 3,000 dungeon tokens is enforced client-side by reading
`profile.dungeon_tokens_today` before granting tokens.

**Rule / Gap:** Same category as INV-TOK-2. The client currently controls dungeon token grants. **Migration
must move dungeon reward application to a server-side function.**

### INV-TOK-4 — Every token debit has an explicit UI confirmation

**INFERENCE** — Token debits observed in the code (market listing, swap skip cooldown, market buy cost)
are preceded by a `confirm()` dialog or a clearly labeled action.

**Rule:** No migration step may introduce a token debit that is invisible to the user or that happens
without an explicit user action.

### INV-TOK-5 — The market buy debit is server-authoritative

**FACT** — The purchase price is validated and the token transfer is performed by the `market-buy` Edge
Function, not by the client (`index.html:2140-2142`).

**Rule:** The market buy price must always be the `price_tokens` field on the server's listing row, never
a value supplied by the client.

---

## 4. Market

### INV-MKT-1 — Listing creation currently uses direct client writes *(known gap)*

**FACT** — `marketPublish()` writes directly to `market_listings` and updates `slots.is_locked` via
client Supabase calls (`index.html:2101-2125`).

**FACT** — Ownership verification before listing is a client-side check (`slots[p.id]?.owner_id === user?.id`).

**Rule / Gap:** This means a user who bypasses the client could list a Pokémon they do not own, or list
the same Pokémon twice without a lock, depending on RLS policies. **Migration must move listing creation
to a server-side function** that atomically verifies ownership and sets the lock.

### INV-MKT-2 — A listing cannot be bought twice

**FACT** — The `market-buy` Edge Function is the gatekeeper for purchase. The `is_purchased` flag on
`market_listings` is the source of truth for whether a listing has been sold.

**OPEN QUESTION** — Whether `market-buy` uses a database transaction or row-level lock to prevent double
purchase under concurrent calls is unknown. Deferred to R02.

**Rule:** The `market-buy` function must reject any purchase where `is_purchased` is already `true` or
the Pokémon's `owner_id` no longer matches the seller.

### INV-MKT-3 — Purchase and ownership transfer must be atomic

**Rule:** After a successful `market-buy` call, all of the following must be true simultaneously or none:
- buyer's token balance is debited,
- seller's token balance is credited,
- `slots.owner_id` is updated to the buyer,
- `market_listings` row is marked `is_purchased = true`,
- `slots.is_locked` is cleared.

Any partial application is a bug.

### INV-MKT-4 — Listing cancellation currently uses direct client writes *(known gap)*

**INFERENCE** — No `market-cancel` Edge Function call was found in `index.html`. Cancellation likely
writes directly to `market_listings` and clears `slots.is_locked` from the client.

**OPEN QUESTION** — Whether a `market-cancel` Edge Function exists in Supabase is deferred to R02.

**Rule / Gap:** If cancellation is a direct client write, a malicious user could cancel another user's
listing if RLS is not correctly configured. **Migration must confirm RLS or move cancellation to a
server-side function.**

---

## 5. Swap

### INV-SWP-1 — The `pokeswap-swap` Edge Function is the authority for swap outcomes

**FACT** — `swapConfirm()` calls `${SB_URL}/functions/v1/pokeswap-swap` with `pokemon_given_id` and
uses the server's response to determine which Pokémon the user received (`js/swap.js:396-429`). The
client does not write ownership tables directly.

**Rule:** The swap result (which Pokémon is received) must always come from the server. Client-side RNG
(`swapRollResult()`) is cosmetic simulation only and must never be used as an authoritative outcome.

### INV-SWP-2 — The server enforces the swap cooldown

**FACT** — `profile.swap_cooldown_until` (Supabase) is the primary source of truth for cooldown.
`localStorage` is used as a client-side cache only (`js/swap.js:58-68`). The server returns
`cooldown_until` in the response, which is stored locally.

**Rule:** The swap cooldown must be checked and set by the `pokeswap-swap` Edge Function. Client-side
cooldown state is advisory only and must not be the final gate.

### INV-SWP-3 — Shiny determination is cosmetic

**FACT** — `isShiny = Math.random() < SWAP_SHINY_CHANCE` is computed client-side after the server
response is received (`js/swap.js:428`). Shiny is a visual flag, not persisted to the database in the
observable code.

**OPEN QUESTION** — Whether shiny status is persisted server-side (in `slots` or another table) is
unknown. Deferred to R02.

**Rule:** If shiny is ever made persistent (affects market value, display, etc.), it must be assigned
server-side, not by client RNG.

### INV-SWP-4 — The previous owner receives compensation

**FACT** — The in-game copy states "el anterior dueño recibe compensación" (the previous owner receives
compensation) (`index.html:1701`).

**OPEN QUESTION** — Whether this compensation is implemented in `pokeswap-swap`, a trigger, or not yet
implemented is unknown. Deferred to R02.

**Rule:** Any migration of the swap flow must preserve (or implement) seller compensation without
requiring client-side orchestration.

---

## 6. Dungeon

### INV-DGN-1 — The client may simulate and render all combat

**FACT** — The entire battle engine (damage calculation, status effects, loot collection) runs in the
browser (`index.html:4534-4920`). No server call is made during a battle turn.

**Rule:** Client-side combat simulation is acceptable. The invariant that must be enforced is on the
*output* of that simulation — what gets persisted.

### INV-DGN-2 — XP rewards are currently client-authoritative *(known gap)*

**FACT** — `dgClose()` computes `totalXp` from `dg.earnedXp` and candy loot accumulated during the
session, then calls `xpSave()` to write to `pokemon_xp` (`index.html:4921-4948`).

**Rule / Gap:** A user who can call `xpSave()` with arbitrary values, or who can manipulate `dg.earnedXp`
in the browser console, can award unlimited XP. **Migration must move XP grant to a server-side function
that validates the dungeon session.**

### INV-DGN-3 — The daily dungeon token cap is 3,000 tokens per user

**FACT** — `advAddDungeonTokens()` reads `profile.dungeon_tokens_today`, caps the grant at
`3000 - todayTokens`, and resets the counter when the calendar date changes
(`index.html:7646-7666`).

**Rule:** This cap must be enforced server-side. The current client-side enforcement is a known gap (see
INV-TOK-3). The 3,000 daily limit is a product rule that must survive the migration.

### INV-DGN-4 — A Pokémon in an active market listing cannot enter the dungeon

**FACT** — The dungeon entry screen checks `is_locked` and cross-references active listings before
showing the Pokémon as selectable (`index.html:5132-5136, 5172-5173`).

**Rule:** This exclusion must be enforced server-side in any future dungeon entry endpoint.

### INV-DGN-5 — Energy is consumed on dungeon entry, not on completion

**FACT** — `advConsumeEnergy(p.id, DUNGEON_ENERGY_COST)` is called at the start of `advStart()`
before any combat begins (`index.html:7698`). Energy is not refunded on exit without victory.

**Rule:** Energy deduction must be non-refundable on dungeon entry. A future server-side entry gate must
deduct energy as its first persistent action.

---

## 7. Payments

### INV-PAY-1 — Browser redirects are not proof of payment

**Rule:** A user returning from a PayPal redirect must not be credited with tokens or Pokémon ownership
until a server-side webhook or callback from PayPal has verified the transaction.

### INV-PAY-2 — Payment confirmation requires a verified server callback

**FACT** — `create-checkout` is called to initiate a PayPal purchase (`index.html:3124`).
`free-claim` and `verify-loyalty` are also referenced.

**OPEN QUESTION** — Whether a `paypal-ipn` or equivalent webhook handler exists and correctly validates
PayPal signatures before granting entitlements is unknown. Deferred to R02.

**Rule:** Payment secrets (PayPal client secret, webhook verification keys) must never reach the browser.

### INV-PAY-3 — Paid Pokémon cannot be stolen via swap

**FACT** — The in-game copy states "Comprarlo con dinero real te da propiedad permanente (nadie puede
robártelo)" (`index.html:1707`).

**OPEN QUESTION** — Whether the `pokeswap-swap` Edge Function excludes paid Pokémon from the swap pool
is unknown. Deferred to R02.

**Rule:** Any migration of the swap flow must preserve permanent ownership for paid Pokémon. This
invariant must be validated in R02 before any swap migration begins.

---

## 8. Current known invariant violations

The following invariants described above are **not satisfied by the current prototype** and represent
known security/integrity gaps. They are recorded here (not hidden) so that migration steps can
explicitly fix them rather than carry them forward unchanged.

| Violation | Invariant | Description |
|---|---|---|
| V-01 | INV-TOK-2 | Passive token awards are computed and written by the client |
| V-02 | INV-TOK-3 | Dungeon token awards are computed and written by the client |
| V-03 | INV-DGN-2 | XP awards are computed and written by the client |
| V-04 | INV-MKT-1 | Market listing creation is a direct client write |
| V-05 | INV-MKT-4 | Market listing cancellation is likely a direct client write |
| V-06 | INV-ID-2 | Username minimum length has no confirmed server-side constraint |
| V-07 | INV-ID-3 | Username uniqueness has no confirmed server-side unique constraint |
| V-08 | INV-DGN-3 | Daily dungeon token cap is enforced client-side only |

These violations **must be fixed** as their respective systems are migrated. They must **not** be
reproduced in the new architecture.

---

## 9. What this document does not cover

- RLS policies, triggers, and SQL functions — deferred to **R02 (Backend Inventory)**.
- Whether `market-buy`, `pokeswap-swap`, `create-checkout`, `free-claim`, or `verify-loyalty` correctly
  implement the invariants they are supposed to enforce — deferred to **R02**.
- Exact database schema (columns, types, indexes, FK constraints) — deferred to **R02**.
- Network-level invariants (HTTPS enforcement, CORS policy) — deferred to **R02**.
