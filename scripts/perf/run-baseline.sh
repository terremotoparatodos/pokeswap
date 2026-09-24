#!/usr/bin/env bash
# PERF-1 automated baseline (headless Chrome + local benchmark server).
# Needs the local stack running with --host localhost:
#   node scripts/perf/local-stack.mjs --host localhost
# Usage: scripts/perf/run-baseline.sh <out-dir> [soak-seconds]
set -euo pipefail
cd "$(dirname "$0")/../.."
OUT="${1:?out dir}"
SOAK="${2:-600}"
APP="http://localhost:4173"
WS="ws://localhost:2568"
mkdir -p "$OUT"
cap() { node scripts/perf/headless-capture.mjs --out "$OUT/$1.json" --label "$1" "${@:2}"; }
crowd() { # crowd <players> <seconds> <prefix> [extra benchmark args]
  npm run -s benchmark:multiplayer -- --external-server --url "$WS" --players "$1" --duration "$2" --warmup 2 \
    --protocol 2 --gait run --prefix "$3" "${@:4}" > "$OUT/crowd-$3.json" 2>&1 &
  CROWD=$!
  sleep 6
}

# Solo and traversal: no other clients.
cap solo-1-pradera --page "$APP/?benchmarkId=solo&area=pradera&x=-5&y=-69|pradera-line"
cap city-1 --page "$APP/?benchmarkId=city&x=31&y=20|city-loop"
cap traversal-1 --page "$APP/?benchmarkId=trav&x=31&y=20|traversal"

# Two real clients: A walks and runs the town loop, B stands at the spawn and watches.
cap multi-2 --page "$APP/?benchmarkId=m2a&x=31&y=20|city-loop" --page "$APP/?benchmarkId=m2b&x=31&y=20|observe"

# Crowds of synthetic runners around the spawn while A walks the loop through them.
for n in 10 20 30; do
  crowd "$n" 120 "m$n"
  cap "multi-$n" --page "$APP/?benchmarkId=m${n}a&x=31&y=20|city-loop" --page "$APP/?benchmarkId=m${n}b&x=31&y=20|observe"
  wait "$CROWD" || true
done

# Same crowd, but every runner's moves reach the server two at a time.
crowd 20 120 "b20" --burst 2
cap multi-20-burst2 --page "$APP/?benchmarkId=b20a&x=31&y=20|observe"
wait "$CROWD" || true

# Soak: a watcher in town with 20 runners for SOAK seconds.
crowd 20 "$((SOAK + 20))" "soak"
cap soak --duration "$SOAK" --page "$APP/?benchmarkId=soak&x=31&y=20|observe"
wait "$CROWD" || true
curl -s http://127.0.0.1:2569/metrics > "$OUT/server-metrics.json" || true
echo "[perf] baseline written to $OUT"
