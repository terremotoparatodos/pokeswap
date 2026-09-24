#!/usr/bin/env bash
# PERF-1 automated baseline (headless Chrome + local benchmark server).
# Needs the local stack running with --host localhost:
#   node scripts/perf/local-stack.mjs --host localhost
# Usage: scripts/perf/run-baseline.sh <out-dir> [soak-seconds]
# Headless has no real display: pacing here is synthetic (see PERF_1_REPORT.md §2.1).
set -uo pipefail
cd "$(dirname "$0")/../.."
OUT="${1:?out dir}"
SOAK="${2:-600}"
APP="http://localhost:4173"
WS="ws://localhost:2568"
mkdir -p "$OUT"
cap() { node scripts/perf/headless-capture.mjs --out "$OUT/$1.json" --label "$1" "${@:2}" | grep -v progress; }
crowd() { # crowd <players> <seconds> <prefix> [extra benchmark args]
  npm run -s benchmark:multiplayer -- --external-server --url "$WS" --players "$1" --duration "$2" --warmup 2 \
    --protocol 2 --gait run --prefix "$3" "${@:4}" > "$OUT/crowd-$3.json" 2>&1 &
  CROWD=$!
  sleep 6
}

# One player, no other clients.
cap solo-1-pradera --page "$APP/?benchmarkId=solo&area=pradera&x=-5&y=-69|pradera-line"
cap city-1 --page "$APP/?benchmarkId=city&x=31&y=20|city-loop"
cap traversal-1 --page "$APP/?benchmarkId=trav&x=31&y=20|traversal"

# Two clients: A walks and runs the town loop, B stands at the spawn and watches.
cap multi-2 --page "$APP/?benchmarkId=m2a&x=31&y=20|city-loop" --page "$APP/?benchmarkId=m2b&x=31&y=20|observe"

# Crowds of synthetic runners around the spawn while A walks the loop through them.
for n in 10 20 30; do
  crowd "$n" 110 "m$n"
  cap "multi-$n" --page "$APP/?benchmarkId=m${n}a&x=31&y=20|city-loop" --page "$APP/?benchmarkId=m${n}b&x=31&y=20|observe"
  wait "$CROWD"
done
crowd 30 120 a30
cap multi-30-aoi --page "$APP/?benchmarkId=a30a&x=31&y=20|city-loop" --page "$APP/?benchmarkId=a30b&x=31&y=20|observe"
wait "$CROWD"

# Every runner's moves reach the server two at a time.
crowd 20 100 b20 --burst 2
cap multi-20-burst2 --page "$APP/?benchmarkId=b20a&x=31&y=20|observe"
wait "$CROWD"

# Instrumentation overhead: the same loop through the same crowd, with and without the render probe.
crowd 30 200 oh
cap overhead-probe-on --page "$APP/?benchmarkId=oh-a&x=31&y=20|city-loop"
cap overhead-probe-off --no-render-probe --page "$APP/?benchmarkId=oh-b&x=31&y=20|city-loop"
wait "$CROWD"

# Shared world: two clients in the same place dump what they see.
DUMP="$(cat scripts/perf/world-snapshot.js)"
cap shared-2-pradera --duration 20 --dump "$DUMP" --page "$APP/?benchmarkId=sh-a&area=pradera&x=-5&y=-69|observe" --page "$APP/?benchmarkId=sh-b&area=pradera&x=-5&y=-69|observe"
cap shared-2-town --duration 20 --dump "$DUMP" --page "$APP/?benchmarkId=st-a&x=31&y=20|observe" --page "$APP/?benchmarkId=st-b&x=31&y=20|observe"
cap traversal-2 --page "$APP/?benchmarkId=t2-a&x=31&y=20|traversal" --page "$APP/?benchmarkId=t2-b&x=31&y=21|traversal"

# Soak: a watcher in town with 20 runners.
crowd 20 "$((SOAK + 20))" soak
cap soak --duration "$SOAK" --page "$APP/?benchmarkId=soak&x=31&y=20|observe"
wait "$CROWD"
curl -s http://127.0.0.1:2569/metrics > "$OUT/server-metrics.json" || true

# Transport matrix on its own server (port 2590).
for spec in "10 run 1" "20 run 1" "30 run 1" "30 run 2" "30 walk 1"; do
  set -- $spec
  npm run -s benchmark:multiplayer -- --port 2590 --players "$1" --duration 20 --warmup 3 --protocol 2 --gait "$2" --burst "$3" > "$OUT/transport-$1-$2-b$3.json" 2>&1
done

# Deterministic remote movement fidelity (no browser).
LABEL=perf1 bash scripts/perf/remote-fidelity/run.sh --seeds 3 > "$OUT/remote-fidelity.json"
echo "[perf] baseline written to $OUT"
