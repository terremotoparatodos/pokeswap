# PokeSwap — Legacy Baseline

> **Status:** Archived — legacy retired (R23, 2026-09-09)
> **Purpose:** Freeze the current prototype as the behavioral reference for the migration described in
> [`agents/POKESWAP_ARCHITECTURE_MIGRATION_ROADMAP.md`](../agents/POKESWAP_ARCHITECTURE_MIGRATION_ROADMAP.md).
> **Baseline commit:** `fd8dd1108631fbd937efe77c92f03ad9b4dab300` ("Delete .agents", tip of `main`)
> **Baseline tag:** `v0-legacy-baseline`
> **Migration branch:** `migration` (created from the baseline commit)

This document does not change or reorganize any legacy file. It only records what exists today so that,
at any point during the migration, the team can answer: *"how did this work before the migration?"*

Labeling convention used below (per `AGENTS.md`): **FACT** (confirmed by reading the code),
**INFERENCE** (reasonable conclusion from naming/usage but not independently verified),
**OPEN QUESTION** (cannot be determined from the repository alone — needs runtime/dashboard access).

---

## 1. Current public URL

- **FACT** — `https://pokeswap.lol`, via the [`CNAME`](../CNAME) file at the repo root pointing GitHub Pages
  to the custom domain.

## 2. Current deployment mechanism

- **FACT** — Static GitHub Pages deployment. There is no `.github/workflows/` directory and no build step:
  the repo root itself is the deployed site (`index.html`, `css/`, `js/`, `data/`, `audio/`, `CNAME`).
- **INFERENCE** — Publishing a change means committing/pushing directly to whichever branch GitHub Pages is
  configured to serve (this repository's Pages branch/config lives in GitHub repo settings, not in-repo).
- **OPEN QUESTION** — Exact Pages source branch configured in the GitHub repository settings, and whether
  any manual step (e.g. cache purge, CDN) is involved in a deploy.

## 3. Current Supabase project

- **FACT** — Project URL: `https://qsufableozmyugcrhcai.supabase.co` (`SB_URL` in `index.html:1751`).
  Project ref: `qsufableozmyugcrhcai`.
- **FACT** — The frontend authenticates with a publishable/anon key (`SB_KEY`, used to build the client at
  `index.html:1757`). No service-role key is present in the frontend source.
- **OPEN QUESTION** — Full schema (columns, indexes, FKs, unique constraints), RLS policies, triggers, and
  SQL functions/RPCs are not recoverable from the frontend alone. This is explicitly deferred to **R02 —
  Inventory the real backend**.

### 3.1 Tables referenced by the frontend (`supabase.from(...)` calls in `index.html`)

**FACT** — grep of `.from('...')` in `index.html` surfaces these table names:

- `profiles`
- `pokemon`
- `slots`
- `market_listings`
- `pokemon_xp`
- `pokedex_entries`
- `auth_usernames`
- `activity_feed`
- `leaderboard_count`
- `leaderboard_spent`
- `global_stats`

No inference is made here about columns or constraints — that belongs to R02.

### 3.2 Edge Functions referenced by the frontend

**FACT** — grep of `functions/v1/...` in `index.html` surfaces these Edge Function calls:

- `market-buy` (`index.html:2140`) — invoked when a user buys a market listing.
- `create-checkout` (`index.html:3124`) — invoked from the PayPal purchase flow (`pay('paypal')` /
  `payBox('paypal')`).
- `free-claim` (`index.html:3110`) — invoked near the checkout/claim UI.
- `verify-loyalty` (`index.html:3566`) — invoked in a separate flow, name suggests a loyalty/reward check.

- **INFERENCE** — The roadmap (`agents/POKESWAP_ARCHITECTURE_MIGRATION_ROADMAP.md`) also names
  `market-publish`, `market-cancel`, `pokeswap-swap`, `paypal-ipn`, and `get_email_by_id` as functions to
  investigate. These are **not** referenced anywhere in current `index.html` via `functions/v1/...`, so
  either: (a) those responsibilities are still handled by direct client-side table writes rather than a
  dedicated function (see §5, Market), or (b) they exist in Supabase but are called from another Edge
  Function (server-to-server) rather than from the browser.
- **OPEN QUESTION** — Full Edge Function list, their source code, and their secrets are only visible from
  the Supabase project itself. Deferred to R02.

## 4. Known working flows

Based on static reading of `index.html`, `js/market.js`, `js/swap.js`, `js/sfx.js`, and `data/*.js`.
Marked **INFERENCE** because "known working" is being asserted from code presence/wiring, not from a live
manual QA pass — no runtime testing was performed to produce this document.

- **INFERENCE** — Auth: signup/login/session, with a separate `auth_usernames` table for username
  reservation (`index.html:3435-3484`).
- **INFERENCE** — Pokémon ownership / adoption: Pokémon appear on a map with "exactly one owner on the
  whole server" (per in-UI copy at `index.html:1683`), tracked via the `pokemon` and `slots` tables.
- **INFERENCE** — Passive token generation ("tokens/hour" per owned Pokémon, `index.html:2358`) with a
  claim flow.
- **INFERENCE** — Market: listing creation, cancellation, and purchase against `market_listings` and
  `slots`, with `market-buy` as a dedicated Edge Function for the purchase step.
- **INFERENCE** — Swap: a dedicated `js/swap.js` module, plus a "skip cooldown" paid flow
  (`swapSkipCooldown('paypal')`, `index.html:1427`).
- **INFERENCE** — Dungeon: combat and reward collection UI (`_dgVFCollect`, `_advVFCollect`,
  `index.html:4472`/`6307`), including type-effectiveness tables (`index.html:4293+`).
- **INFERENCE** — Pokédex: seen/registered entries persisted via `pokedex_entries`.
- **INFERENCE** — XP/progression: persisted via `pokemon_xp`, with an in-memory cache layer referenced by
  the roadmap (`_xpCache`) — see R12 for the localStorage/cache/DB ambiguity this creates.
- **INFERENCE** — Leaderboard / activity feed: `leaderboard_count`, `leaderboard_spent`, `activity_feed`.
- **INFERENCE** — Payments: PayPal buttons for buying a Pokémon with real money and for skipping swap
  cooldown, going through `create-checkout` (and possibly `free-claim`).
- **INFERENCE** — Map/world: tile-based movement with sprites loaded from the external
  `terremotoparatodos/sprites-overworld` GitHub raw content repo (`index.html:1753-1755`).

## 5. Known broken / unverified flows

- **OPEN QUESTION** — No broken flows are documented in-repo (no `TODO`/`FIXME`/`BUG` markers were found
  in `index.html`). Whether any current flow is actually broken in production has not been verified by
  manual testing as part of this baseline. This section should be filled in from direct knowledge of
  production issues, not guessed.
- **OPEN QUESTION** — Whether `market-publish` and `market-cancel` (named in the roadmap) exist as real
  Edge Functions or are still implemented as direct client-side writes to `market_listings`/`slots` is
  unresolved — see §3.2. If the latter, this is itself the non-atomic pattern R09 exists to fix, not a
  "broken" flow per se.
- **OPEN QUESTION** — Whether `pokeswap-swap` and `paypal-ipn` (named in the roadmap) exist as Edge
  Functions is unresolved for the same reason.

## 6. Legacy module map (for later reference, not to be reorganized yet)

- **FACT** — `index.html` (7,808 lines / ~1.05 MB) — the monolith: markup, styles, and nearly all
  application logic (auth, market, swap, dungeon, pokédex, map, payments) in one file.
- **FACT** — `js/market.js`, `js/swap.js`, `js/sfx.js` — separate legacy scripts alongside the inline logic
  in `index.html` (their overlap with the inline implementation is unresolved — see roadmap R18, "known
  duplicate candidates").
- **FACT** — `css/main.css` — separate stylesheet, coexists with inline `<style>` in `index.html` (also
  flagged by roadmap R18).
- **FACT** — `data/pokemon-data.js`, `data/moves-data.js`, `data/learnset.js`, `data/map-data.js` — static
  game data.
- **FACT** — `audio/*.mp3` — game music assets served directly from the repo.

## 7. What this document does not do

Per R00 scope, this baseline does **not**:

- reorganize `index.html` or any legacy file,
- rename any legacy function,
- perform any cosmetic refactor,
- resolve the `OPEN QUESTION`s above — those are the explicit subject of **R01** (invariants) and
  **R02** (backend inventory), which come next.
