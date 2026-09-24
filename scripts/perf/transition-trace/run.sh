#!/usr/bin/env bash
# Transition fidelity harness (TRANS-1). Deterministic, no browser, no network.
# REAL mover walking + REAL PresenceRoom batching + REAL observer adapter/queue;
# only the network (latency, jitter, ordering, bunching) is modelled.
# Usage: scripts/perf/transition-trace/run.sh [--timeline] [--json]
set -euo pipefail
cd "$(dirname "$0")/../../.."
ESBUILD="${ESBUILD:-node_modules/.bin/esbuild}"
# Inside the repo so the external packages resolve from node_modules.
OUT="node_modules/.cache/perf/transition-trace.mjs"
mkdir -p "$(dirname "$OUT")"
"$ESBUILD" scripts/perf/transition-trace/trace.ts --bundle --platform=node --format=esm --packages=external \
  --alias:@colyseus/core=./scripts/presence-harness/colyseus-core-stub.mjs \
  --define:import.meta.env='{"DEV":false,"PROD":true,"VITE_PLAYTEST":"on","VITE_SUPABASE_URL":"http://127.0.0.1:1","VITE_SUPABASE_ANON_KEY":"harness"}' \
  --outfile="$OUT" --log-level=error
LABEL="${LABEL:-$(git rev-parse --short HEAD)}" node "$OUT" "$@"
