#!/usr/bin/env bash
# Deterministic presence reconciliation harness (no browser, no network).
# Couples the REAL PresenceRoom with the REAL WildlandsGame reconciliation code.
# The Colyseus Room base class is replaced by a two-method stub: this harness
# exercises PokeSwap logic and message ordering, not Colyseus transport.
# Usage: scripts/presence-harness/run.sh   (from the repo root; needs esbuild)
set -euo pipefail
cd "$(dirname "$0")/../.."
ESBUILD="${ESBUILD:-node_modules/.bin/esbuild}"
OUT="$(mktemp -d)/reconciliation.mjs"
"$ESBUILD" scripts/presence-harness/reconciliation.ts --bundle --platform=node --format=esm \
  --alias:@colyseus/core=./scripts/presence-harness/colyseus-core-stub.mjs \
  --define:import.meta.env='{"DEV":false,"PROD":true,"VITE_PLAYTEST":"on"}' \
  --outfile="$OUT" --log-level=error
LABEL="${LABEL:-$(git rev-parse --short HEAD)}" node "$OUT"
