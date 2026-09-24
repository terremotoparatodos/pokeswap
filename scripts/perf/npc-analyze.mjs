// PERF-1 NPC experiment analysis: node scripts/perf/npc-analyze.mjs <dir>
// Per run: what the watcher (B) saw of the 10 runners and of the walker (A),
// A's blocks by cause, and whether B's snaps of A follow A's NPC blocks more
// often than chance (window: 1.5 s after each block).

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
const WINDOW_MS = 1500
const rows = []
for (const file of readdirSync(dir).filter(f => f.startsWith('npc-') && f.endsWith('.json')).sort()) {
  const doc = JSON.parse(readFileSync(join(dir, file), 'utf8'))
  const walker = doc.captures.find(c => c.mode !== 'observe')
  const watcher = doc.captures.find(c => c.mode === 'observe')
  const walkerId = `benchmark-${new URL(walker.url).searchParams.get('benchmarkId')}`
  const snapsOfWalker = watcher.remoteSnapEvents.filter(e => e.id === walkerId)
  const snapsOfRunners = watcher.remoteSnapEvents.filter(e => e.id !== walkerId)
  const npcBlocks = walker.collisions.events.filter(e => e.cause !== 'terrain')
  const minutes = watcher.durationS / 60
  // Chance: the share of the capture covered by the windows, times A's snaps.
  const covered = Math.min(1, (npcBlocks.length * WINDOW_MS) / (watcher.durationS * 1000))
  const followed = snapsOfWalker.filter(s => npcBlocks.some(b => s.at >= b.at && s.at - b.at <= WINDOW_MS)).length
  rows.push({
    run: file.replace(/^npc-|\.json$/g, ''),
    population: watcher.npcExperiment.population,
    seconds: Math.round(watcher.durationS),
    runnersSnapsPerMin: Math.round(snapsOfRunners.length / minutes * 10) / 10,
    watcherWaits: watcher.remote.motion.stopAndGo,
    walkerSnapsSeenByB: snapsOfWalker.length,
    aBlocksNpc: walker.collisions.npcBlocks,
    aBlocksPokemon: walker.collisions.pokemonBlocks,
    aBlocksTerrain: walker.collisions.terrainBlocks,
    snapsAfterNpcBlock: followed,
    expectedByChance: Math.round(snapsOfWalker.length * covered * 10) / 10,
    driverSkips: walker.driver.filter(e => e.kind === 'skipped').length,
    aReconciliations: walker.presenceDiagnostics?.reconciliations ?? null,
    aRejections: walker.presenceDiagnostics ? Object.values(walker.presenceDiagnostics.rejections).reduce((a, b) => a + b, 0) : null,
    aWorkP95: walker.pacing.workMs.p95,
    bWorkP95: watcher.pacing.workMs.p95,
    bDrawables: watcher.entities.drawables.p95,
  })
}
const keys = Object.keys(rows[0] ?? {})
console.log(`| ${keys.join(' | ')} |\n|${keys.map(() => '---').join('|')}|`)
for (const row of rows) console.log(`| ${keys.map(k => row[k]).join(' | ')} |`)
