# PokeSwap — Client/Server Trust Boundary

> **Status:** R05 baseline
> **Purpose:** Establish a single written rule for where each decision belongs. Every public
> write to Supabase is classified as safe direct client write, server-only operation, or read-only.
> **Sources:** `docs/INVARIANTS.md` (R01), `docs/BACKEND_INVENTORY.md` (R02).
> **Labeling:** same convention as prior docs — **FACT**, **INFERENCE**, **OPEN QUESTION**.

---

## 1. Core rule

> **The client is the display layer. The server is the authority layer.**

A decision belongs to the **client** when it is:
- transient (no persistent state change),
- cosmetic (visible effect only, not a source of game truth),
- local (only this user's browser is affected, and the information is not secret).

A decision belongs to the **server** when it is:
- persistent (written to the database),
- economic (affects token balance, ownership, market state, or cooldowns),
- security-relevant (a user could gain an advantage by changing the value),
- shared (other users or server systems depend on the value being correct).

---

## 2. Client may decide (authoritative)

The following are entirely client-owned. The server neither validates nor stores them as
persistent state.

| Responsibility | Examples |
|---|---|
| Animations and transitions | Swap ball animation, Pokémon reveal timing, dungeon battle effects |
| Sound and music | BGM selection, SFX volume, mute state |
| UI state and layout | Active tab, modal open/closed, filter/sort selection, zoom level |
| Language preference | `lang` selection in UI — persisted to `profiles.lang` only when the user explicitly saves |
| Camera and viewport | Map camera position, scroll offset |
| Cosmetic random effects | Non-persistent sparkle/particle effects, shiny reveal animation |
| Client-side simulation | Dungeon combat calculations during a battle turn (INV-DGN-1) |
| localStorage cache | `swap_cooldown_until` mirror used to avoid a network round-trip (advisory only — INV-SWP-2) |

**FACT** — Client RNG for shiny reveal (`js/swap.js:428`) is cosmetic. `swap_history.was_shiny`
is set server-side by `pokeswap-swap`. If the client ever renders shiny from its own random result,
that rendering must have no persistent effect (INV-SWP-3, confirmed in R02 §6.2).

---

## 3. Server must decide (server-authoritative)

These are operations where a client-side result would either be directly exploitable or would
leave shared state inconsistent. **No migration step may move these to the client.**

### 3.1 Token economy

| Operation | Authority | Mechanism |
|---|---|---|
| Token credit — passive accumulation | **Server** (target) | Currently V-01 (client gap). Must move to `collect-passive-tokens` Edge Function. |
| Token credit — dungeon reward | **Server** (target) | Currently V-02 (client gap). Must move to `dungeon-reward` Edge Function. |
| Token credit — market sale proceeds | **Server** ✓ | `market-buy` Edge Function (R02 §6.3). |
| Token credit — swap refund to previous owner | **Server** ✓ (partial) | `claim_slot` RPC refunds previous owner on token-paid claims. `pokeswap-swap` does NOT compensate the previous owner of the received slot (INV-SWP-4 unimplemented). |
| Token debit — market purchase | **Server** ✓ | `market-buy` Edge Function (INV-TOK-5). |
| Token debit — cooldown skip | **Server** (target) | Currently initiated via `create-payment-skip` + `kofi-webhook`/`paypal-ipn`. Skip grant is server-side. Cost must be server-validated. |
| Token debit — dungeon or move cost | **Server** (target) | Currently V-02/V-03 gap. |

**SEC-02 (High, from R02):** The `profiles` UPDATE RLS policy has no column restriction. Any
authenticated user can write `profiles.tokens`, `profiles.dungeon_tokens_today`,
`profiles.token_multiplier`, and `profiles.swap_cooldown_until` directly for their own row.
Every token operation must move to a SECURITY DEFINER RPC before the token economy can be
considered server-authoritative.

### 3.2 Pokémon ownership

| Operation | Authority | Mechanism |
|---|---|---|
| Free claim | **Server** ✓ | `free-claim` Edge Function → `claim_slot` RPC (INV-OWN-2 resolved). |
| Token-paid claim | **Server** ✓ | `claim_slot` RPC. |
| Real-money claim | **Server** ✓ | `claim_slot` (pending) → `confirm_payment` RPC after webhook. |
| Swap ownership transfer | **Server** ✓ | `pokeswap-swap` Edge Function (INV-SWP-1). |
| Market purchase transfer | **Server** ✓ | `market-buy` Edge Function. |

**FACT** — `slots` has no INSERT, UPDATE, or DELETE RLS policy. All slot mutations go through
SECURITY DEFINER functions. Direct client writes to `slots.owner_id` are blocked (R02 §2.2).

### 3.3 Market lifecycle

| Operation | Authority | Mechanism |
|---|---|---|
| Listing creation | **Server** (target) | Currently V-04 gap — direct client INSERT via RLS `ALL` policy. Must move to `market-publish` Edge Function or RPC. |
| Listing cancellation | **Server** (target) | Currently V-05 gap — direct client DELETE via RLS `ALL` policy. Must move to `market-cancel` Edge Function or RPC. |
| Listing purchase + ownership transfer | **Server** ✓ | `market-buy` Edge Function (INV-TOK-5, INV-MKT-2). |
| `is_locked` flag on slots | **Server** (target) | Currently set by the client during `marketPublish()`. Must be set atomically inside `market-publish` (INV-MKT-1). |

**INFERENCE** — Until V-04 and V-05 are fixed, a user who knows the RLS rules can list a
Pokémon they do not own, or cancel another player's listing if the RLS policy has a gap.

### 3.4 Swap

| Operation | Authority | Mechanism |
|---|---|---|
| Eligibility check (cooldown) | **Server** ✓ | `pokeswap-swap` checks `swap_cooldown_until` server-side (INV-SWP-2). |
| Pool selection (which Pokémon can be received) | **Server** ✓ | `pokeswap-swap` queries `slots WHERE owner_id = user AND is_locked = false` (INV-OWN-3). |
| Rarity and shiny roll | **Server** ✓ | `pokeswap-swap` uses server-side RNG (INV-SWP-1, R02 §6.2). |
| Ownership transfer | **Server** ✓ | `pokeswap-swap` upserts both slots. |
| Cooldown set | **Server** ✓ | `pokeswap-swap` writes `profiles.swap_cooldown_until` (8 h). |
| Previous-owner compensation | **Server** (missing) | INV-SWP-4 unimplemented — no token grant to previous owner of received Pokémon. Must be added server-side before swap is considered fully hardened. |

### 3.5 Dungeon rewards

| Operation | Authority | Mechanism |
|---|---|---|
| Energy deduction on entry | **Server** (target) | Currently client-side. Must be server-side first action of a future `dungeon-start` endpoint (INV-DGN-5). |
| XP award | **Server** (target) | Currently V-03 gap — `xpSave()` writes `pokemon_xp` from client-computed values. |
| Dungeon token award | **Server** (target) | Currently V-02 gap — `advAddDungeonTokens()` writes `profiles.tokens` and `profiles.dungeon_tokens_today` from the client. |
| Daily 3,000 token cap | **Server** (target) | Currently enforced client-side only (INV-DGN-3). |

### 3.6 Payments

| Operation | Authority | Mechanism |
|---|---|---|
| Checkout session creation | **Server** ✓ | `create-checkout` Edge Function. |
| Payment confirmation | **Server** ✓ | Webhook handlers (`webhook-paypal`, `paypal-ipn`) verify before acting (INV-PAY-2 resolved). |
| `kofi-webhook` verification | **Server** ✓ (risky) | Hardcoded secret (SEC-04 — must move to env secret). |
| Swap cooldown reset on payment | **Server** ✓ | `kofi-webhook` / `paypal-ipn` write `profiles.swap_cooldown_until`. |

**Rule** — Browser redirects are never proof of payment (INV-PAY-1). A client returning from
a payment provider must wait for the server webhook to confirm before any entitlement is granted.

### 3.7 Profile fields

| Field | Authority | Notes |
|---|---|---|
| `profiles.tokens` | **Server** (target; currently gap) | SEC-02: direct client write possible. Must be restricted. |
| `profiles.dungeon_tokens_today` | **Server** (target; currently gap) | SEC-02: direct client write possible. |
| `profiles.token_multiplier` | **Server** ✓ | Set only by `verify-loyalty` Edge Function. |
| `profiles.swap_cooldown_until` | **Server** ✓ | Set only by `pokeswap-swap` and payment webhooks. Still writable by client due to SEC-02. |
| `profiles.username` | **Server** ✓ | Unique constraint at DB level (V-07 resolved). Min-length only client-side (V-06 gap). |
| `profiles.avatar_url` | Client (safe) | No game-economic value; direct client write acceptable. |
| `profiles.display_name` | Client (safe) | Display only; direct client write acceptable. |
| `profiles.lang` | Client (safe) | UI preference; direct client write acceptable. |
| `profiles.twitch_id` / `youtube_channel_id` | **Server** ✓ | Set by `verify-loyalty`. Should not be writable by client. |

---

## 4. Read-only client access

The following are SELECT-only from the public client. Writing these from the client either
requires a server function or is blocked by RLS.

| Table / View | Access | RLS |
|---|---|---|
| `pokemon` | SELECT all rows | Public |
| `slots` | SELECT all rows | Public |
| `regions` | SELECT all rows | Public |
| `activity_feed` | SELECT all rows | Public |
| `leaderboard_count` | SELECT all rows (view) | Inherits from `profiles` (public) |
| `leaderboard_spent` | SELECT all rows (view) | Inherits from `profiles` (public) |
| `global_stats` | SELECT all rows (view) | Aggregate; public |
| `market_listings` | SELECT active + unexpired only | RLS filter |
| `swap_history` | SELECT own rows only | RLS |
| `token_ledger` | SELECT own rows only | RLS |
| `transactions` | SELECT own rows (buyer or seller) | RLS |
| `rate_limits` | None (DEFINER function only) | Blocked by RLS |

---

## 5. Classification table — every current Supabase write

| Table | Write | Current path | Classification | Target |
|---|---|---|---|---|
| `slots` | UPDATE `owner_id` | `claim_slot` RPC / `pokeswap-swap` / `market-buy` | Server-only ✓ | No change needed |
| `slots` | UPDATE `is_locked` | Client (`marketPublish`) | **Gap (V-04)** | Move to `market-publish` RPC |
| `slots` | UPDATE `link_url`, `link_text` | Client direct | Safe client write | Acceptable |
| `market_listings` | INSERT | Client direct via RLS | **Gap (V-04)** | Move to `market-publish` RPC |
| `market_listings` | DELETE own | Client direct via RLS | **Gap (V-05)** | Move to `market-cancel` RPC |
| `market_listings` | UPDATE `is_purchased` | `market-buy` Edge Function | Server-only ✓ | No change needed |
| `profiles` | UPDATE `tokens` | Client direct (passive, dungeon) | **Gap (V-01, V-02, SEC-02)** | Server RPC only |
| `profiles` | UPDATE `dungeon_tokens_today` | Client direct | **Gap (V-02, SEC-02)** | Server RPC only |
| `profiles` | UPDATE `swap_cooldown_until` | `pokeswap-swap`, payment webhooks | Server-only ✓ (SEC-02 still exposes direct path) | Add column restriction |
| `profiles` | UPDATE `token_multiplier` | `verify-loyalty` | Server-only ✓ (SEC-02 exposes direct path) | Add column restriction |
| `profiles` | UPDATE `username` | Client at signup via trigger | Handle-new-user trigger ✓ (but no min-length check — V-06) | Add DB constraint |
| `profiles` | UPDATE `avatar_url`, `display_name`, `lang` | Client direct | Safe client write | Acceptable |
| `profiles` | UPDATE `twitch_id`, `youtube_channel_id` | Client (inferred) | **Should be server-only** | Restrict to `verify-loyalty` |
| `pokemon_xp` | INSERT/UPDATE | Client direct (`xpSave`) | **Gap (V-03)** | Server `dungeon-reward` function |
| `pokedex_entries` | INSERT/UPDATE | Client direct | Low-risk (cosmetic record) | Acceptable until R13 |
| `token_ledger` | INSERT | `claim_slot`, `market-buy` | Server-only ✓ | No change needed |
| `transactions` | INSERT | `claim_slot` | Server-only ✓ | No change needed |
| `swap_history` | INSERT | `pokeswap-swap` | Server-only ✓ | No change needed |
| `activity_feed` | INSERT | `claim_slot` | Server-only ✓ | No change needed |
| `kofi_payments` | INSERT | `kofi-webhook` | Server-only ✓ | Enable RLS (SEC-01) |
| `rate_limits` | INSERT/UPDATE | `check_rate_limit` DEFINER fn | Server-only ✓ | No change needed |

---

## 6. Security findings inherited from R02 that block server authority

These findings must be resolved before the corresponding operation can be declared
server-authoritative. They are restated here so that any migration task can check
whether the prerequisite is cleared.

| ID | Severity | Blocks | Resolution |
|---|---|---|---|
| SEC-01 | Critical | `kofi_payments` is publicly writable | Enable RLS on `kofi_payments` |
| SEC-02 | High | Token economy, cooldown, multiplier are not server-only | Add a SECURITY DEFINER update RPC; restrict the `profiles` UPDATE policy to safe columns only |
| SEC-03 | Medium | `get_email_by_id` leaks any user's email | Restrict to service-role callers or drop the function |
| SEC-04 | High | `kofi-webhook` secret is hardcoded | Move to `Deno.env.get()` Supabase secret |

---

## 7. Rules for future migration steps

Every PR or migration task that introduces a Supabase write must include in its description:

1. **What is being written** (table and columns).
2. **Who is the authority** (client or server) according to this document.
3. **Which invariant(s) are affected** (reference by ID, e.g. INV-TOK-2).
4. **How the classification was verified** (read the code, read the RLS policy, read the Edge Function).

If the write is being moved from client to server, the PR must also confirm:

- the old client-side write path is removed (not just unused),
- the new server-side path rejects the corresponding client-direct call,
- a test exists that demonstrates the old client path is blocked.

A write classified as a gap in §5 must not be left as-is in any new component. New
components must call the server-side function even if it does not exist yet — create a
stub that returns an error rather than falling back to the direct client write.
