# PokeSwap — Backend Inventory

> **Status:** R02 baseline
> **Purpose:** Inventory the real Supabase backend (tables, constraints, RLS policies, triggers, SQL
> functions, and Edge Functions) so that migration steps are grounded in what actually exists, not
> what the frontend code implies. Resolves all OPEN QUESTIONs deferred from R00 and R01.
> **Source:** Live read of project `qsufableozmyugcrhcai` via Supabase MCP on 2026-09-07.
> **Labeling:** Same convention as R00/R01 — **FACT**, **INFERENCE**, **OPEN QUESTION**.

---

## 1. Tables

All tables are in the `public` schema. Row Level Security status is noted per table.
Columns marked `[unique]` have a database-level unique constraint.
Columns marked `[check: ...]` have a database-level check constraint.

### 1.1 `profiles`

**FACT** — RLS enabled. 6 rows.

| Column | Type | Nullable | Default | Constraints |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | — | PK, FK → `auth.users.id` |
| `username` | text | NOT NULL | — | **[unique]** |
| `avatar_url` | text | nullable | — | |
| `display_name` | text | nullable | — | |
| `tokens` | numeric | nullable | 0 | [check: `tokens >= 0`] |
| `free_claims_remaining` | integer | nullable | 1 | |
| `free_claim_last_reset` | date | nullable | `CURRENT_DATE` | |
| `total_spent` | numeric | nullable | 0 | |
| `lang` | text | nullable | `'es'` | [check: one of `es`, `en`, `pt`, `fr`] |
| `swap_cooldown_until` | timestamptz | nullable | — | |
| `token_multiplier` | numeric | nullable | 1.0 | |
| `dungeon_tokens_today` | integer | nullable | 0 | |
| `dungeon_tokens_reset_at` | timestamptz | nullable | `now()` | |
| `passive_tokens_collected_at` | timestamptz | nullable | `now()` | |
| `twitch_id` | text | nullable | — | |
| `twitch_username` | text | nullable | — | |
| `twitch_sub_verified_at` | timestamptz | nullable | — | |
| `youtube_channel_id` | text | nullable | — | |
| `youtube_member_verified_at` | timestamptz | nullable | — | |
| `created_at` | timestamptz | nullable | `now()` | |
| `updated_at` | timestamptz | nullable | `now()` | |

### 1.2 `pokemon`

**FACT** — RLS enabled. 493 rows.

| Column | Type | Nullable | Default | Constraints |
|---|---|---|---|---|
| `id` | integer | NOT NULL | sequence | PK |
| `name_es` | text | NOT NULL | — | |
| `name_en` | text | NOT NULL | — | |
| `name_pt` | text | NOT NULL | — | |
| `name_fr` | text | NOT NULL | — | |
| `type1` | text | NOT NULL | — | |
| `type2` | text | nullable | — | |
| `region` | text | NOT NULL | — | FK → `regions.name` |
| `is_legendary` | boolean | nullable | false | |
| `is_popular` | boolean | nullable | false | |
| `base_price` | numeric | nullable | 1 | |
| `sprite_url` | text | nullable | — | |
| `locked` | boolean | nullable | false | admin lock (blocks all operations) |
| `generation` | integer | nullable | — | |
| `base_aura` | integer | nullable | 100 | |
| `created_at` | timestamptz | nullable | `now()` | |

### 1.3 `slots`

**FACT** — RLS enabled. 172 rows. PK is `pokemon_id` — one row per Pokémon, enforcing
single ownership at the table structure level.

| Column | Type | Nullable | Default | Constraints |
|---|---|---|---|---|
| `pokemon_id` | integer | NOT NULL | — | PK, FK → `pokemon.id` |
| `owner_id` | uuid | nullable | — | FK → `profiles.id` |
| `owner_username` | text | nullable | — | denormalized cache |
| `current_price` | numeric | NOT NULL | 1 | |
| `claim_count` | integer | nullable | 0 | |
| `is_locked` | boolean | nullable | false | true = in market listing |
| `last_claimed_at` | timestamptz | nullable | `now()` | |
| `aura` | integer | nullable | 0 | |
| `aura_updated_at` | timestamptz | nullable | `now()` | |
| `owned_since` | timestamptz | nullable | `now()` | |
| `first_owner_id` | uuid | nullable | — | FK → `profiles.id` |
| `first_owner_username` | text | nullable | — | denormalized cache |
| `energy` | integer | nullable | 100 | dungeon energy |
| `energy_updated_at` | timestamptz | nullable | `now()` | |
| `link_url` | text | nullable | — | owner-set link |
| `link_text` | text | nullable | — | owner-set link text |
| `created_at` | timestamptz | nullable | `now()` | |
| `updated_at` | timestamptz | nullable | `now()` | |

**FACT** — No `is_shiny` or `is_paid_permanent` column exists on `slots`. Shiny status and paid
permanent ownership are not tracked as current-state properties of a slot.

### 1.4 `market_listings`

**FACT** — RLS enabled. 1 row currently.

| Column | Type | Nullable | Default | Constraints |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PK |
| `pokemon_id` | integer | NOT NULL | — | FK → `pokemon.id` |
| `seller_id` | uuid | NOT NULL | — | FK → `profiles.id` |
| `seller_username` | text | NOT NULL | — | denormalized |
| `price_tokens` | integer | NOT NULL | — | [check: `price_tokens > 0`] |
| `is_purchased` | boolean | nullable | false | |
| `purchased_by` | uuid | nullable | — | FK → `profiles.id` |
| `purchased_at` | timestamptz | nullable | — | |
| `expires_at` | timestamptz | nullable | `now() + '7 days'` | |
| `created_at` | timestamptz | nullable | `now()` | |

### 1.5 `transactions`

**FACT** — RLS enabled. 44 rows. Permanent ledger of all ownership changes.

| Column | Type | Nullable | Default | Constraints |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PK |
| `pokemon_id` | integer | NOT NULL | — | FK → `pokemon.id` |
| `buyer_id` | uuid | NOT NULL | — | FK → `profiles.id` |
| `buyer_username` | text | NOT NULL | — | |
| `seller_id` | uuid | nullable | — | FK → `profiles.id` |
| `seller_username` | text | nullable | — | |
| `price` | numeric | NOT NULL | — | |
| `was_free_claim` | boolean | nullable | false | |
| `tokens_refunded` | numeric | nullable | 0 | to previous owner |
| `payment_provider` | text | nullable | — | `free`, `tokens`, `paypal`, etc. |
| `payment_id` | text | nullable | — | provider's transaction ID |
| `payment_status` | text | nullable | `'pending'` | [check: `pending`, `confirmed`, `failed`, `refunded`] |
| `created_at` | timestamptz | nullable | `now()` | |

### 1.6 `token_ledger`

**FACT** — RLS enabled. 10 rows. Double-entry audit trail for token movements.

| Column | Type | Nullable | Constraints |
|---|---|---|---|
| `id` | uuid | NOT NULL | PK |
| `user_id` | uuid | NOT NULL | FK → `profiles.id` |
| `amount` | numeric | NOT NULL | positive = credit, negative = debit |
| `reason` | text | NOT NULL | e.g. `market_purchase`, `market_sale`, `spent_on_claim`, `refund_slot_stolen` |
| `related_transaction_id` | uuid | nullable | FK → `transactions.id` |
| `pokemon_id` | integer | nullable | FK → `pokemon.id` |
| `created_at` | timestamptz | nullable | |

### 1.7 `swap_history`

**FACT** — RLS enabled. 16 rows.

| Column | Type | Nullable | Constraints |
|---|---|---|---|
| `id` | uuid | NOT NULL | PK |
| `user_id` | uuid | nullable | FK → `profiles.id` |
| `pokemon_given_id` | integer | nullable | FK → `pokemon.id` |
| `pokemon_received_id` | integer | nullable | FK → `pokemon.id` |
| `was_shiny` | boolean | nullable | default false |
| `rarity` | text | nullable | tier string |
| `created_at` | timestamptz | nullable | |

**FACT** — `was_shiny` is persisted in `swap_history` as a historical record of the swap event,
not as a property of the current slot state. `slots` has no `is_shiny` column.

### 1.8 `pokedex_entries`

**FACT** — RLS enabled. 399 rows. Composite PK `(user_id, pokemon_id)`.

### 1.9 `pokemon_xp`

**FACT** — RLS enabled. 7 rows. Composite PK `(user_id, pokemon_id)`. Includes a `moves` jsonb column.

### 1.10 `activity_feed`

**FACT** — RLS enabled. 15 rows. `type` has a check constraint: one of
`claim`, `steal`, `unlock_region`, `unlock_legendary`, `free_claim`.

### 1.11 `rate_limits`

**FACT** — RLS enabled. 1 row. Used exclusively by the `check_rate_limit` SECURITY DEFINER
function; no client-facing RLS policies exist, so direct client access is blocked by default.

### 1.12 `regions`

**FACT** — RLS enabled. 4 rows. `name` column has a unique constraint.

### 1.13 `kofi_payments`

**FACT** — **RLS DISABLED.** 0 rows. Records Ko-fi and PayPal webhook payment events.

> ⚠️ **SEC-01 (Critical):** `kofi_payments` has no Row Level Security. Any client with the
> anon key can read, insert, update, or delete every row. This table contains donor email
> addresses, transaction IDs, and raw webhook payloads. RLS must be enabled before this table
> accumulates real data.

### 1.14 Tables referenced by frontend but not found as tables

**FACT** — The following names appear in `index.html` `.from('...')` calls but do not exist as
tables in the public schema:

- `auth_usernames` — does not exist as a table or view. The frontend uses it for username
  reservation at signup (`index.html:3435-3484`). Whether this table was dropped, renamed to
  `profiles`, or never created is **OPEN QUESTION** (OQ-01).
- `leaderboard_count`, `leaderboard_spent`, `global_stats` — exist as **views** (see §3).

---

## 2. Row Level Security Policies

### 2.1 Summary table

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | Anyone (all rows) | — | Own row only | — |
| `pokemon` | Anyone (all rows) | — | — | — |
| `slots` | Anyone (all rows) | — | — | — |
| `regions` | Anyone (all rows) | — | — | — |
| `activity_feed` | Anyone (all rows) | — | — | — |
| `market_listings` | Active + unexpired only | Own listing | Own listing | Own listing |
| `pokedex_entries` | Own rows | Own rows | Own rows | Own rows |
| `pokemon_xp` | Own rows | Own rows | Own rows | Own rows |
| `swap_history` | Own rows | — | — | — |
| `token_ledger` | Own rows | — | — | — |
| `transactions` | Own (buyer or seller) | — | — | — |
| `rate_limits` | None (DEFINER fn only) | None | None | None |
| `kofi_payments` | ⚠️ **No RLS** | ⚠️ **No RLS** | ⚠️ **No RLS** | ⚠️ **No RLS** |

### 2.2 Notable policy gaps

**FACT — `slots` has no INSERT, UPDATE, or DELETE policy.** All slot mutations go through
SECURITY DEFINER functions (`claim_slot`) or Edge Functions using the service role key.
Direct client writes to `slots` are blocked by RLS. This is intentional and correct.

**FACT — `market_listings` `sellers manage own listings` is an ALL-command policy.** This
means sellers can INSERT, UPDATE, and DELETE their own listings directly from the client
without going through an Edge Function. Listing creation and cancellation are direct client
writes gated only by the seller-id check in RLS. (See V-04, V-05 in INVARIANTS.md §8.)

**FACT — `profiles` UPDATE policy has no `WITH CHECK` clause.** A user updating their own
profile row is not constrained to specific columns — they can update any column including
`tokens`, `dungeon_tokens_today`, `token_multiplier`, and `swap_cooldown_until`. The
`tokens >= 0` check constraint provides a floor, but the ceiling is unconstrained.

> ⚠️ **SEC-02 (High):** Any authenticated user can write arbitrary values to
> `profiles.tokens`, `profiles.dungeon_tokens_today`, and `profiles.swap_cooldown_until`
> for their own row directly via the Supabase client. This is the mechanism behind violations
> V-01, V-02, and V-03 (client-authoritative token awards). Migration must add column-level
> restrictions (via a SECURITY DEFINER update function) before these fields can be
> considered server-authoritative.

---

## 3. Views

**FACT** — Four views exist in the public schema:

| View | Purpose |
|---|---|
| `global_stats` | Aggregate counts: total claimed, total available, unique owners, total tokens in play |
| `leaderboard_count` | Profiles ranked by number of owned Pokémon |
| `leaderboard_spent` | Profiles ranked by `total_spent` |
| `leaderboard_types` | Per-type Pokémon counts per user (not referenced by frontend in R00 grep) |

**FACT** — No RLS policies on views were found. Views inherit access from their underlying
tables, so a user reading `leaderboard_count` or `leaderboard_spent` gets all rows (profiles
is publicly readable).

---

## 4. SQL Functions

All functions are `SECURITY DEFINER` and set `search_path = 'public'`.

### 4.1 `handle_new_user()` → trigger

Called by the `on_auth_user_created` AFTER INSERT trigger on `auth.users`. Creates a row in
`profiles` using `raw_user_meta_data.username` (or the email prefix as fallback) and
`raw_user_meta_data.full_name`.

**FACT** — No minimum-length check on username is performed here. The 3-character minimum is
client-side only. **V-06 is confirmed unmitigated at the database layer.**

**FACT** — The `profiles.username` column has a database-level unique constraint. If two
signups race with the same username, the second insert will fail with a unique-violation
error. **V-07 (INV-ID-3) is resolved: uniqueness IS enforced at the DB level.**

### 4.2 `claim_slot(p_pokemon_id, p_buyer_id, p_payment_provider, p_payment_id, p_is_free)` → jsonb

The core ownership-transfer function. Uses `FOR UPDATE` row lock on `slots` to prevent
concurrent claims on the same Pokémon. Handles:

- Free claims (empties slots only, non-popular/legendary, decrement `free_claims_remaining`)
- Token-paid claims (debit buyer, refund previous owner, record ledger entries)
- Real-money claims (`payment_status = 'pending'` until `confirm_payment` is called)
- Cancels any active `market_listings` row for the Pokémon as part of the transfer
- Writes `activity_feed` entry
- Always sets `is_locked = false` on the new slot

**FACT** — This function is the server-side gate for the free-claim and token-claim paths.
**INV-OWN-2 is resolved: the free-claim ownership write is server-authoritative.**

### 4.3 `confirm_payment(p_transaction_id, p_payment_id)` → jsonb

Finalizes a `pending` transaction created by `claim_slot`. Uses `FOR UPDATE` on `transactions`
to prevent double-confirmation. Transfers ownership, refunds previous owner, cancels market
listing. Called by webhook handlers after payment provider confirmation.

### 4.4 `check_rate_limit(p_user_id, p_action, p_max_requests, p_window_minutes)` → boolean

Window-based rate limiter backed by the `rate_limits` table. Returns false when the user
exceeds `p_max_requests` in the current window. Used by `market-buy`.

### 4.5 `reset_daily_free_claim()` → void

Resets `free_claims_remaining = 1` for all profiles where `free_claim_last_reset < CURRENT_DATE`.
Called by the `free-claim` Edge Function on every invocation.

### 4.6 `cleanup_rate_limits()` → void

Deletes `rate_limits` rows older than 1 day. No scheduled invocation was found — this
function exists but may not be called regularly. **OPEN QUESTION (OQ-02):** Is this called
by a Supabase cron job or scheduled task?

### 4.7 `get_email_by_id(user_id uuid)` → text

Returns `email` from `auth.users` for any UUID. SECURITY DEFINER with no caller-identity
check.

> ⚠️ **SEC-03 (Medium):** Any code path that can invoke this function with an arbitrary UUID
> (e.g., via `supabase.rpc('get_email_by_id', ...)` from an authenticated client) can
> retrieve any user's email. Access should be restricted to service-role callers only, or the
> function should be dropped in favor of using the service role key directly inside Edge
> Functions.

---

## 5. Triggers

**FACT** — One application trigger exists:

| Trigger | Table | Event | Timing | Function |
|---|---|---|---|---|
| `on_auth_user_created` | `auth.users` | INSERT | AFTER | `handle_new_user()` |

**FACT** — No triggers exist on public-schema tables. All data integrity for public tables
is enforced through SECURITY DEFINER functions and Edge Functions, not triggers.

---

## 6. Edge Functions

All functions use `verify_jwt = true` except the two public webhook receivers.

| Slug | Version | JWT | Purpose |
|---|---|---|---|
| `free-claim` | 15 | ✓ | Authenticated free-claim via `claim_slot` RPC |
| `pokeswap-swap` | 10 | ✓ | Swap execution — rolls rarity, transfers ownership |
| `market-buy` | 3 | ✓ | Market purchase with rate limit and optimistic lock |
| `verify-loyalty` | 6 | ✓ | Twitch/YouTube sub check → updates `token_multiplier` |
| `create-checkout` | 20 | ✓ | Initiates real-money checkout (provider TBD — see §6.5) |
| `create-payment-skip` | 1 | ✓ | Creates payment for swap cooldown skip |
| `webhook-stripe` | 13 | ✓ | Stripe webhook handler |
| `webhook-mercadopago` | 13 | ✓ | MercadoPago webhook handler |
| `webhook-paypal` | 6 | ✓ | PayPal webhook handler |
| `kofi-webhook` | 1 | ✗ | Ko-fi donation webhook → resets swap cooldown |
| `paypal-ipn` | 1 | ✗ | PayPal IPN → resets swap cooldown |

### 6.1 `free-claim`

Calls `reset_daily_free_claim()` then `claim_slot(... p_is_free = true)`. Entirely
server-authoritative. No client-supplied price or outcome. **INV-OWN-2 resolved.**

### 6.2 `pokeswap-swap`

- Validates JWT and fetches profile.
- Checks `swap_cooldown_until` server-side; rejects if still in cooldown. **INV-SWP-2 confirmed.**
- Queries `slots WHERE owner_id = user AND is_locked = false`. **INV-OWN-3 resolved: locked
  Pokémon are excluded from swap.**
- Accepts optional `pokemon_given_id`; validates it belongs to the caller. Falls back to random.
- Rolls rarity (server-side RNG) and shiny (server-side, `1/128`). **INV-SWP-3 update:** shiny
  is determined server-side and persisted to `swap_history.was_shiny`. It is NOT stored on
  `slots`, so it has no effect on market value or display in the current data model.
- Releases given slot (`owner_id = null`) and assigns received slot via upsert.
- Sets new cooldown (8 hours) on `profiles`.
- **Does NOT compensate the previous owner of the received slot.** The previous owner of
  the Pokémon the user receives simply loses it with no token refund. **INV-SWP-4:
  CONFIRMED UNIMPLEMENTED. The in-game copy promise is not fulfilled in code.**
- **Does NOT check whether a received Pokémon was paid for.** A real-money Pokémon can be
  taken by swap. **INV-PAY-3: CONFIRMED UNIMPLEMENTED.**
- Operations are independent `await` calls (not a transaction). A crash between the slot
  release and the slot assignment could leave the given Pokémon owner-less indefinitely.
  **OPEN QUESTION (OQ-03):** Is there a recovery mechanism for orphaned slots?

### 6.3 `market-buy`

- Validates JWT.
- Calls `check_rate_limit` (max 20 purchases per hour).
- Fetches listing with `is_purchased = false AND expires_at > now()`.
- Checks buyer's token balance.
- Marks listing `is_purchased = true` with `.eq('is_purchased', false)` condition (optimistic lock).
- Transfers slot, debits buyer, credits seller (minus 5% fee), writes ledger entries.
- **No database transaction wraps these steps.** The optimistic lock on the UPDATE provides
  a practical guard against double-purchase but does not guarantee atomicity of the full
  sequence. A crash after marking `is_purchased = true` but before updating `slots` or
  `profiles.tokens` would produce an inconsistent state. **INV-MKT-3 is not fully satisfied.**
- **INV-MKT-2 update:** double-purchase is blocked in practice by the optimistic lock, but
  it is not guaranteed by a serializable transaction.

### 6.4 `verify-loyalty`

- Checks Twitch subscription and YouTube membership via their respective APIs.
- Sets `profiles.token_multiplier` to 1.0 / 1.5 / 2.0 depending on sub status.
- Applies a 1-hour cooldown between manual verifications.
- Google `access_token` is taken from `auth.identities` via the admin API — this token is
  short-lived and may be expired by the time the function runs.

### 6.5 `create-checkout` and payment webhooks

**FACT** — `create-checkout` exists at version 20 (frequently updated). Its source was not
fetched in this inventory pass. **OPEN QUESTION (OQ-04):** What payment providers does
`create-checkout` currently support, and does it generate a `transaction` row with
`payment_status = 'pending'` that `confirm_payment` is expected to finalize?

**FACT** — Three provider-specific webhooks exist: `webhook-stripe`, `webhook-mercadopago`,
`webhook-paypal`. Their source was not fetched. **OPEN QUESTION (OQ-05):** Which of these
call `confirm_payment`, and which are stubs or legacy?

### 6.6 `kofi-webhook` and `paypal-ipn`

Both handle payment-provider callbacks to reset the swap cooldown (skip-cooldown product).
Neither grants Pokémon ownership — they only write `kofi_payments` and update
`profiles.swap_cooldown_until`.

**FACT — `paypal-ipn` performs IPN verification** by posting back to
`https://ipnpb.paypal.com/cgi-bin/webscr` with `cmd=_notify-validate` and only proceeding
on a `VERIFIED` response. **INV-PAY-2 resolved: payment callback verification exists.**

**FACT — `paypal-ipn` has `verify_jwt = false`.** This is correct for a server-to-server
webhook, since PayPal cannot supply a Supabase JWT. The IPN protocol's own verification
step is the authentication mechanism.

> ⚠️ **SEC-04 (High):** `kofi-webhook` hardcodes its verification token as a string
> literal in the function source. This secret is visible to anyone with dashboard access
> and will appear in any source export or version control snapshot of the function. It must
> be moved to a Supabase secret (environment variable) and read via `Deno.env.get(...)`.

**FACT — User identification in both webhooks relies on fuzzy matching** (username in the
payment `custom`/`message` field, or email from payer). This is susceptible to
impersonation: a payer who knows another player's username could potentially trigger a
cooldown reset for that player's account. The practical risk is low (the payer loses money
to trigger it) but the design should be noted.

---

## 7. Resolution of OPEN QUESTIONs from R00 and R01

| ID | From | Question | Resolution |
|---|---|---|---|
| INV-ID-2 | R01 | Server-side username min-length constraint? | **NOT enforced.** `handle_new_user` trigger has no length check. V-06 confirmed. |
| INV-ID-3 | R01 | DB-level unique constraint on `profiles.username`? | **EXISTS.** Unique constraint is on the column. V-07 resolved — DB enforces uniqueness. |
| INV-OWN-2 | R01 | Free claim writes `owner_id` server-side? | **YES.** `free-claim` → `claim_slot` SECURITY DEFINER RPC. Fully server-authoritative. |
| INV-OWN-3 | R01 | Does `pokeswap-swap` validate `is_locked`? | **YES.** Queries `slots WHERE is_locked = false`. Locked Pokémon are excluded. |
| INV-MKT-2 | R01 | Does `market-buy` prevent double-purchase? | **PARTIALLY.** Optimistic lock (UPDATE WHERE `is_purchased = false`) provides a practical guard but no DB transaction wraps the full sequence. |
| INV-MKT-4 | R01 | Does `market-cancel` Edge Function exist? | **NO.** Sellers delete their own listings via the RLS `ALL` policy directly from the client. Direct client write, not server-side function. V-05 confirmed. |
| INV-SWP-3 | R01 | Is shiny persisted server-side? | **PARTIALLY.** `swap_history.was_shiny` is set server-side, but `slots` has no shiny column. Shiny is a historical event record, not a current slot property. |
| INV-SWP-4 | R01 | Is previous-owner compensation implemented in swap? | **NO.** `pokeswap-swap` releases the given slot to `owner_id = null` with no token grant to the previous owner of the received slot. In-game copy promise is unmet. |
| INV-PAY-2 | R01 | Does a webhook handler verify PayPal signatures? | **YES.** `paypal-ipn` verifies via `ipnpb.paypal.com` IPN protocol before acting. |
| INV-PAY-3 | R01 | Are paid Pokémon excluded from swap? | **NO.** No `is_paid_permanent` column or equivalent exists. Real-money Pokémon can be taken by swap. In-game copy promise is unmet. |
| LEGACY §3.2 | R00 | Do `market-publish`, `market-cancel`, `pokeswap-swap`, `paypal-ipn` exist as Edge Functions? | `pokeswap-swap` and `paypal-ipn` **exist**. `market-publish` and `market-cancel` do **not** exist — those responsibilities are direct client writes via RLS. |

---

## 8. New security findings

| ID | Severity | Finding | Location |
|---|---|---|---|
| SEC-01 | Critical | `kofi_payments` table has RLS disabled | Table definition |
| SEC-02 | High | `profiles` UPDATE policy allows direct client write to `tokens`, `dungeon_tokens_today`, `token_multiplier`, `swap_cooldown_until` — no column restriction | RLS policy |
| SEC-03 | Medium | `get_email_by_id` SECURITY DEFINER function leaks any user's email to any caller | SQL function |
| SEC-04 | High | `kofi-webhook` verification token is hardcoded in function source, not in a Supabase secret | Edge Function source |
| SEC-05 | Low | Swap cooldown reset webhooks identify users by fuzzy username/email matching; a paying attacker can target another player | `kofi-webhook`, `paypal-ipn` |

---

## 9. New OPEN QUESTIONs

| ID | Question | Blocking? |
|---|---|---|
| OQ-01 | `auth_usernames` table referenced in `index.html` does not exist. Is username reservation broken, or was this replaced by the `profiles.username` unique constraint? | Yes — affects signup correctness |
| OQ-02 | Is `cleanup_rate_limits()` called on a schedule? `rate_limits` will grow unbounded if not. | No — operational concern |
| OQ-03 | Is there a recovery path for a `slots` row left owner-less by a crash mid-swap? | No — edge case |
| OQ-04 | What does `create-checkout` (v20) currently do? Which providers does it support? | Yes — needed before R_PAY migration |
| OQ-05 | Which of `webhook-stripe`, `webhook-mercadopago`, `webhook-paypal` are active and call `confirm_payment`? | Yes — needed before R_PAY migration |

---

## 10. What this document does not cover

- Source of `create-checkout`, `webhook-stripe`, `webhook-mercadopago`, `webhook-paypal`,
  `create-payment-skip` — deferred to the payment migration task (R_PAY).
- Network-level invariants (HTTPS enforcement, CORS policy) — CORS is set to `*` in all
  inspected Edge Functions; production hardening deferred to a dedicated task.
- Supabase Realtime subscriptions — whether the frontend subscribes to any table changes
  was not audited in this pass.
