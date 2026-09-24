#!/usr/bin/env bash
# PERF-2 before/after of the crowd captures (subset of run-baseline.sh).
# Needs a local stack: node scripts/perf/local-stack.mjs --host localhost [--app-port N --realtime-port M]
# Usage: APP=http://localhost:4173 WS=ws://localhost:2568 scripts/perf/run-multi.sh <out-dir> [players...]
# For each crowd of synthetic runners, A walks the town loop through them and
# B stands at the spawn and watches: B's remote motion, A's frame cost.
set -uo pipefail
cd "$(dirname "$0")/../.."
OUT="${1:?out dir}"; shift
PLAYERS=("$@")
[ $# -eq 0 ] && PLAYERS=(10 20 30)
APP="${APP:-http://localhost:4173}"
WS="${WS:-ws://localhost:2568}"
mkdir -p "$OUT"
for n in "${PLAYERS[@]}"; do
  tag="m$n-$RANDOM"
  npm run -s benchmark:multiplayer -- --external-server --url "$WS" --players "$n" --duration 110 --warmup 2 \
    --protocol 2 --gait run --prefix "$tag" > "$OUT/crowd-$n.json" 2>&1 &
  crowd=$!
  sleep 6
  node scripts/perf/headless-capture.mjs --out "$OUT/multi-$n.json" --label "multi-$n" \
    --page "$APP/?benchmarkId=${tag}a&x=31&y=20|city-loop" --page "$APP/?benchmarkId=${tag}b&x=31&y=20|observe" | grep -v progress
  wait "$crowd"
done
