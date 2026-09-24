// PERF-2 before/after table for remote-fidelity runs:
//   node scripts/perf/remote-fidelity/compare.mjs before.json after.json [--by network]
// Seeds and observer rates are pooled per scenario (and network with --by network).
// Columns: snaps (sum), largest snap, stall ms per moving second (mean),
// representation delay p50/p95 (mean of per-run percentiles), tiles never shown.

import { readFileSync } from 'node:fs'

const [beforePath, afterPath] = process.argv.slice(2)
const byNetwork = process.argv.includes('--by') && process.argv[process.argv.indexOf('--by') + 1] === 'network'
const load = path => JSON.parse(readFileSync(path, 'utf8')).results

function summarise(results) {
  const groups = new Map()
  for (const r of results) {
    const key = byNetwork ? `${r.scenario} ${r.network}` : r.scenario
    const g = groups.get(key) ?? { name: r.name, runs: [] }
    g.runs.push(r)
    groups.set(key, g)
  }
  const mean = list => list.reduce((s, v) => s + v, 0) / list.length
  const out = new Map()
  for (const [key, { name, runs }] of groups) {
    out.set(key, {
      name,
      snaps: runs.reduce((s, r) => s + r.visual.snaps, 0),
      maxSnap: Math.max(...runs.map(r => r.visual.maxSnapTiles)),
      stall: Math.round(mean(runs.map(r => r.visual.stallMsPerMovingSecond))),
      p50: Math.round(mean(runs.map(r => r.visual.representationDelayMs.p50))),
      p95: Math.round(mean(runs.map(r => r.visual.representationDelayMs.p95))),
      unseen: runs.reduce((s, r) => s + r.visual.tilesNeverShown, 0),
    })
  }
  return out
}

const before = summarise(load(beforePath))
const after = summarise(load(afterPath))
const cell = (b, a) => (b === a ? `${a}` : `${b} → ${a}`)
console.log('| scenario | snaps | max snap | stall ms/s | delay p50 | delay p95 | tiles unseen |')
console.log('|---|---:|---:|---:|---:|---:|---:|')
for (const [key, a] of after) {
  const b = before.get(key)
  if (!b) continue
  console.log(`| ${key} ${a.name} | ${cell(b.snaps, a.snaps)} | ${cell(b.maxSnap, a.maxSnap)} | ${cell(b.stall, a.stall)} | ${cell(b.p50, a.p50)} | ${cell(b.p95, a.p95)} | ${cell(b.unseen, a.unseen)} |`)
}
