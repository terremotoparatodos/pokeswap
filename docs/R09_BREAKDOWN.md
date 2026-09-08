# R09 — Market Atomicity: Breakdown

> **Status:** Approved breakdown — ready for implementation  
> **Parent task:** R09 — Migrate market listing creation/cancellation  
> **LLM effort:** HIGH  
> **Sources:** `docs/BACKEND_INVENTORY.md` (R02), `docs/TRUST_BOUNDARY.md` (R05),
> `docs/INVARIANTS.md` (R01), `src/features/market/api/marketApi.ts` (R06)

---

## What behavior is being preserved

- A user can list a Pokémon they own for sale at a price they set.
- A user can cancel their own active listing.
- A user (who is not the seller) can buy an active listing by paying tokens.
- The seller receives tokens minus a 5% fee.
- A bought or cancelled Pokémon is no longer locked.
- No two buyers can purchase the same listing.
- A cancellation racing a purchase leaves the listing and ownership consistent.

## Who is the authority

All three operations — publish, cancel, buy — are **server-authoritative** per
`TRUST_BOUNDARY.md §3.3`. The client supplies intent (which Pokémon, which listing, which
price); the server validates current database state and performs the mutation atomically.

## What old code is being replaced

| Gap | Current path | Problem |
|---|---|---|
| V-04 | Client INSERTs `market_listings` + UPDATEs `slots.is_locked = true` separately | Not atomic; client can lock a slot it doesn't own or race two listings |
| V-05 | Client DELETEs own `market_listings` row directly via RLS `ALL` policy | Client does not unlock the slot; a cancelled listing leaves the Pokémon permanently locked |
| INV-MKT-3 | `market-buy` Edge Function performs sequential DB writes without a transaction | A crash between steps leaves `is_purchased = true` but slot/tokens unchanged |

## How we prove the replacement works

Each RPC is tested for the race conditions listed in the roadmap:
- two simultaneous publish attempts on the same Pokémon,
- two simultaneous buyers of the same listing,
- cancellation racing a purchase,
- stale price (client sends wrong price),
- stale ownership (Pokémon changed owners before publish),
- expired listing (buyer submits after expiry).

The `market_listings` RLS `ALL` seller policy is removed. A new test proves a direct client
INSERT or DELETE is rejected after the policy is removed.

---

## Task list

### MKT-1 — Postgres RPC: `publish_market_listing`

**File:** `supabase/migrations/YYYYMMDD_market_publish_rpc.sql`

SECURITY DEFINER function. Called by the `market-publish` Edge Function.

```
publish_market_listing(
  p_pokemon_id  integer,
  p_price_tokens integer
) → jsonb { listing_id }
```

Steps (all inside one transaction):
1. Resolve caller from `auth.uid()`.
2. SELECT `slots WHERE pokemon_id = p_pokemon_id FOR UPDATE` — acquire row lock.
3. Reject if `slots.owner_id ≠ caller` → error `not_owner`.
4. Reject if `slots.is_locked = true` → error `already_locked`.
5. Reject if `pokemon.locked = true` → error `pokemon_admin_locked`.
6. Reject if an active listing exists for this pokemon → error `active_listing_exists`.
7. INSERT into `market_listings` (pokemon_id, seller_id, seller_username, price_tokens, expires_at).
8. UPDATE `slots SET is_locked = true WHERE pokemon_id = p_pokemon_id`.
9. Return `{ listing_id }`.

Invariants satisfied: INV-MKT-1 (lock and insert are atomic).

---

### MKT-2 — Postgres RPC: `cancel_market_listing`

**File:** `supabase/migrations/YYYYMMDD_market_cancel_rpc.sql`

SECURITY DEFINER function. Called by the `market-cancel` Edge Function.

```
cancel_market_listing(
  p_listing_id  uuid
) → jsonb { pokemon_id }
```

Steps (all inside one transaction):
1. Resolve caller from `auth.uid()`.
2. SELECT `market_listings WHERE id = p_listing_id FOR UPDATE`.
3. Reject if `seller_id ≠ caller` → error `not_seller`.
4. Reject if `is_purchased = true` → error `already_purchased`.
5. DELETE the listing row.
6. UPDATE `slots SET is_locked = false WHERE pokemon_id = listing.pokemon_id`.
7. Return `{ pokemon_id }`.

Invariants satisfied: V-05 resolved — cancel always unlocks the slot.

---

### MKT-3 — Postgres RPC: `buy_market_listing`

**File:** `supabase/migrations/YYYYMMDD_market_buy_rpc.sql`

SECURITY DEFINER function. Replaces the inline sequential writes in the `market-buy`
Edge Function with a single atomic operation.

```
buy_market_listing(
  p_listing_id  uuid
) → jsonb { pokemon_id, price_paid, seller_received }
```

Steps (all inside one transaction):
1. Resolve caller from `auth.uid()`.
2. SELECT `market_listings WHERE id = p_listing_id FOR UPDATE`.
3. Reject if `is_purchased = true` → error `already_purchased`.
4. Reject if `expires_at ≤ now()` → error `listing_expired`.
5. Reject if `seller_id = caller` → error `cannot_buy_own_listing`.
6. SELECT `profiles WHERE id = caller FOR UPDATE` (lock buyer row).
7. Reject if `profiles.tokens < price_tokens` → error `insufficient_tokens`.
8. Mark listing: UPDATE `market_listings SET is_purchased = true, purchased_by = caller, purchased_at = now()`.
9. Transfer slot: UPDATE `slots SET owner_id = caller, owner_username = ..., is_locked = false, ...`.
10. Debit buyer: UPDATE `profiles SET tokens = tokens - price WHERE id = caller`.
11. Compute fee (5%) and seller proceeds.
12. Credit seller: UPDATE `profiles SET tokens = tokens + proceeds WHERE id = seller_id`.
13. INSERT into `token_ledger` (buyer debit, seller credit).
14. INSERT into `transactions` (permanent record).
15. Return `{ pokemon_id, price_paid, seller_received }`.

Invariants satisfied: INV-MKT-2 (double-purchase impossible — FOR UPDATE + is_purchased check),
INV-MKT-3 (atomicity), INV-TOK-5 (debit/credit in single transaction).

---

### MKT-4 — Edge Function: `market-publish`

**File:** `supabase/functions/market-publish/index.ts`

Thin wrapper around `publish_market_listing` RPC.

```
POST /functions/v1/market-publish
Body: { pokemon_id: number, price_tokens: number }
Auth: Bearer JWT (verify_jwt = true)
```

Steps:
1. Validate JWT (Supabase handles this with `verify_jwt = true`).
2. Parse and validate body: `pokemon_id` must be a positive integer,
   `price_tokens` must be a positive integer.
3. Call `supabase.rpc('publish_market_listing', { p_pokemon_id, p_price_tokens })`.
4. Return `{ listing_id }` on success or structured error on failure.

---

### MKT-5 — Edge Function: `market-cancel`

**File:** `supabase/functions/market-cancel/index.ts`

Thin wrapper around `cancel_market_listing` RPC.

```
POST /functions/v1/market-cancel
Body: { listing_id: string }
Auth: Bearer JWT (verify_jwt = true)
```

Steps:
1. Validate JWT.
2. Parse and validate body: `listing_id` must be a non-empty string (UUID format).
3. Call `supabase.rpc('cancel_market_listing', { p_listing_id })`.
4. Return `{ pokemon_id }` on success or structured error on failure.

---

### MKT-6 — Update Edge Function: `market-buy`

**File:** `supabase/functions/market-buy/index.ts`

Replace the current inline sequential write sequence with a call to `buy_market_listing`.

Remove:
- inline UPDATE of `market_listings.is_purchased`
- inline UPDATE of `slots.owner_id`
- inline UPDATE of `profiles.tokens` (buyer and seller)
- inline INSERT of `token_ledger`
- inline INSERT of `transactions`

Replace with:
- `supabase.rpc('buy_market_listing', { p_listing_id })`

Keep:
- rate limit check (`check_rate_limit` — remains in the Edge Function, not the RPC,
  because it is a network-boundary concern, not a transaction concern)
- JWT validation

---

### MKT-7 — Migration: restrict `market_listings` RLS

**File:** `supabase/migrations/YYYYMMDD_market_rls_restrict.sql`

Remove the `sellers manage own listings` ALL policy that currently allows direct client
INSERT and DELETE.

Replace with:
- SELECT policy (active + unexpired rows) — keep as-is.
- No INSERT policy — blocked; only the `publish_market_listing` DEFINER RPC can insert.
- No DELETE policy — blocked; only the `cancel_market_listing` DEFINER RPC can delete.
- UPDATE policy — retain only for the `is_purchased` field, or remove entirely if
  `market-buy` now calls the RPC exclusively (DEFINER bypasses RLS).

This migration is the final step that closes V-04 and V-05 at the database level. It must
be applied **after** MKT-4 and MKT-5 are deployed and verified, to avoid blocking the
existing publish and cancel paths before the replacement is live.

---

### MKT-8 — Add migration files to repo

**File:** `supabase/migrations/` directory

Collect all DDL from MKT-1, MKT-2, MKT-3, MKT-7 into timestamped migration files so the
schema is version-controlled and reproducible. Apply to the remote project using the
Supabase MCP (`apply_migration`).

---

### MKT-9 — Tests

**File:** `src/features/market/api/marketApi.test.ts` (unit stubs)  
**File:** `tests/market-invariants.test.ts` (integration — requires a real DB or a Supabase
local stack)

Scenarios to cover (from the roadmap):

| Scenario | Expected result |
|---|---|
| Two publish attempts on the same Pokémon (sequential, same user) | Second publish returns `already_locked` |
| Two simultaneous buyers of the same listing | Exactly one succeeds; other returns `already_purchased` |
| Cancellation racing a purchase | Purchase wins: slot transferred, tokens settled; OR cancel wins: listing deleted, slot unlocked. Neither state is inconsistent. |
| Client attempts direct INSERT into `market_listings` after MKT-7 | Rejected by Supabase (RLS policy violation) |
| Client attempts direct DELETE from `market_listings` after MKT-7 | Rejected by Supabase (RLS policy violation) |
| Stale price (price changed between UI render and buy submission) | `buy_market_listing` reads the stored `price_tokens`; price mismatch is not a client concern — but the RPC should verify the price the client saw matches DB. Add `p_expected_price` check. |
| Stale ownership (Pokémon changed owners before publish) | Rejected with `not_owner` |
| Expired listing purchase attempt | Rejected with `listing_expired` |
| Cancel a listing you don't own | Rejected with `not_seller` |
| Hostile username in listing | `seller_username` is read from `profiles.username` inside the RPC, never from client input |

---

## Implementation order

The order below ensures the live product is never broken between steps:

```
MKT-1  publish_market_listing RPC
MKT-2  cancel_market_listing RPC
MKT-3  buy_market_listing RPC
MKT-8  Apply all migration files
MKT-4  market-publish Edge Function  (deploy)
MKT-5  market-cancel Edge Function   (deploy)
MKT-6  market-buy Edge Function update
       ← verify all three operations end-to-end before proceeding
MKT-7  Restrict market_listings RLS  (closes the gap — do last)
MKT-9  Tests
```

---

## What can be deleted after the migration

- The `sellers manage own listings` RLS ALL policy on `market_listings` (removed in MKT-7).
- Any legacy `index.html` path that:
  - directly INSERTs into `market_listings`,
  - directly DELETEs from `market_listings`,
  - directly UPDATEs `slots.is_locked`.
- The inline sequential write block in `market-buy` (removed in MKT-6).

---

## What this migration does NOT do

- Move token economy for passive tokens, dungeon rewards, or XP (those are R10).
- Harden the `profiles` UPDATE RLS policy (SEC-02 — needed for R10).
- Touch the swap or dungeon features.
