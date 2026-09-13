# Legacy — PokeSwap Monolith Archive

The original PokeSwap application was a single `index.html` file (~7,800 lines) served via GitHub Pages.
It acted as the behavioral reference during the migration described in
[`agents/POKESWAP_ARCHITECTURE_MIGRATION_ROADMAP.md`](../agents/POKESWAP_ARCHITECTURE_MIGRATION_ROADMAP.md).

## Where the archive lives

The final legacy snapshot is preserved in git at tag **`v0-legacy-baseline`**:

```
git checkout v0-legacy-baseline
```

This tag was created at commit `fd8dd1108631fbd937ebe77c96d9287bfaad80700` (documented in
[`docs/LEGACY_BASELINE.md`](../docs/LEGACY_BASELINE.md)).

## What was retired (R23)

| Path | Reason |
|---|---|
| `index.html` (root) | Legacy monolith — replaced by `src/` (Vue 3 / Vite) |
| `js/market.js` | Replaced by `src/features/market/` |
| `js/swap.js` | Replaced by `src/features/swap/` |
| `js/sfx.js` | No SFX layer in new app yet |
| `css/main.css` | Styles live in component `<style>` blocks |
| `data/pokemon-data.js` | Game data referenced via API / Supabase |
| `data/moves-data.js` | Game data referenced via API / Supabase |
| `data/learnset.js` | Game data referenced via API / Supabase |
| `data/map-data.js` | Map walk-grid — client fallback to `true` is acceptable (cosmetic) |
| `audio/` | No audio layer in new app yet |
| `CNAME` | Domain managed by Cloudflare Pages, not GitHub Pages |

## New architecture

The production frontend is now built by Vite (`npm run build`) and deployed to Cloudflare Pages via
`.github/workflows/deploy.yml`. The entry point is `src/index.html` and all features live under
`src/features/`.
