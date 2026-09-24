#!/usr/bin/env bash
# PERF-1 NPC experiment: the same 10 synthetic runners and the same scripted
# route, with this client's population on (control) and off (no drawing, no
# collision). Two clients per run: A walks the route, B watches from the
# spawn with the same population setting.
# Needs an isolated stack: node scripts/perf/local-stack.mjs --host localhost --realtime-port 2578 --app-port 4183
# Usage: scripts/perf/npc-experiment.sh <out-dir> [repeats]
set -uo pipefail
cd "$(dirname "$0")/../.."
OUT="${1:?out dir}"
REPEATS="${2:-2}"
APP="http://localhost:4183"
WS="ws://localhost:2578"
mkdir -p "$OUT"
run=0
for r in $(seq 1 "$REPEATS"); do
  for area in town pradera; do
    for npc in on off; do
      run=$((run + 1))
      # A fresh identity prefix per run: the same pattern, with no reconnect-cache position carried over.
      if [ "$area" = town ]; then
        bench_area=ciudad-corazon; where="x=31&y=20"; scenario=city-loop
      else
        bench_area=pradera; where="area=pradera&x=-5&y=-69"; scenario=pradera-loop
      fi
      node scripts/benchmark-presence.mjs --external-server --url "$WS" --players 10 --duration 150 --warmup 1 \
        --protocol 2 --gait run --area "$bench_area" --prefix "npc$run" > /dev/null 2>&1 &
      CROWD=$!
      sleep 5
      extra=""; [ "$npc" = off ] && extra="&perfNpc=off"
      node scripts/perf/headless-capture.mjs --out "$OUT/npc-$area-$npc-r$r.json" --label "npc-$area-$npc-r$r" \
        --page "$APP/?benchmarkId=nx${run}a&$where$extra|$scenario" \
        --page "$APP/?benchmarkId=nx${run}b&$where$extra|observe" | grep -v progress
      kill "$CROWD" 2>/dev/null; wait "$CROWD" 2>/dev/null
      # Every runner of this run must be gone before the next one starts.
      for i in $(seq 1 30); do
        players=$(curl -s http://127.0.0.1:2579/metrics | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).players)}catch{console.log(-1)}})")
        [ "$players" = "0" ] && break
        sleep 1
      done
    done
  done
done
echo "[perf] npc experiment written to $OUT"
