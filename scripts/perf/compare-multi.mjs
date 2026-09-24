// PERF-2 before/after of run-multi.sh captures:
//   node scripts/perf/compare-multi.mjs <before-dir> <after-dir>
// Walker (A): frame work. Watcher (B): what the crowd looks like on screen.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const [beforeDir, afterDir] = process.argv.slice(2)
const round = v => Math.round(v * 10) / 10

function row(dir, file) {
  const doc = JSON.parse(readFileSync(join(dir, file), 'utf8'))
  const walker = doc.captures.find(c => c.mode !== 'observe')
  const watcher = doc.captures.find(c => c.mode === 'observe')
  const remoteMinutes = (watcher.remote.lifecycle.concurrentPerFrame.mean * watcher.durationS) / 60
  const motion = watcher.remote.motion
  return {
    'A work p95': walker.pacing.workMs.p95,
    'A update p95': walker.pacing.updateMs.p95,
    'A render p95': walker.pacing.renderMs.p95,
    'B work p95': watcher.pacing.workMs.p95,
    'B heap p95 MB': watcher.mainThread.heapMb?.p95 ?? '—',
    'B remotes': round(watcher.remote.lifecycle.concurrentPerFrame.mean),
    'snaps/remote-min': remoteMinutes ? round(motion.snaps / remoteMinutes) : 0,
    'max snap': motion.maxSnapTiles,
    'waits/remote-min': remoteMinutes ? round(motion.stopAndGo / remoteMinutes) : 0,
    'wait p95 ms': motion.stopAndGoMs.p95,
    'wait max ms': motion.stopAndGoMs.max,
    'B AOI recreated': watcher.remote.lifecycle.recreated,
    'A AOI exits/min': walker.remote.aoi.exitsPerMinute,
    'A AOI re-entries < 2 s': walker.remote.lifecycle.recreatedWithin2s,
    'A AOI exit distance p50': walker.remote.aoi.distanceAtExit.p50,
    'A AOI time out p50 ms': walker.remote.aoi.gapMs.p50,
    'A remotes p95': walker.remote.lifecycle.concurrentPerFrame.p95,
  }
}

const size = f => parseInt(f.match(/(\d+)\.json$/)[1])
const files = readdirSync(afterDir).filter(f => /^multi-(pradera-)?\d+\.json$/.test(f)).sort((a, b) => a.length - b.length || size(a) - size(b))
for (const file of files) {
  if (!existsSync(join(beforeDir, file))) continue
  const b = row(beforeDir, file)
  const a = row(afterDir, file)
  console.log(`\n### ${file.replace('.json', '')}\n\n| metric | before | after |\n|---|---:|---:|`)
  for (const key of Object.keys(a)) console.log(`| ${key} | ${b[key]} | ${a[key]} |`)
}
