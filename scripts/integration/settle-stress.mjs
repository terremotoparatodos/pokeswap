// INTEGRATION-1 settlement stress: world_commit_work on the embedded Postgres
// (PGlite, real migration), without the room, to see what the database side
// of a settlement costs and that duplicates stay exactly-once under load.
//
//   node scripts/integration/settle-stress.mjs [--players 50] [--actions 20] [--concurrency 50] [--duplicates 0.2]
//
// Each player settles `actions` gathering actions (XP + one material + a node
// override); a fraction is sent twice concurrently (a retry racing its
// original). Output: JSON with latency percentiles, throughput and a ledger
// check (XP and materials equal exactly one reward per distinct action).
// Local only; nothing touches a Supabase project.

import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { createDevPlayerData } from '../../services/realtime/src/world/persistence/dev/devPlayerData.js'

const option = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? Number(process.argv[i + 1]) : fallback }
const players = option('players', 50)
const actionsPerPlayer = option('actions', 20)
const concurrency = option('concurrency', 50)
const duplicates = option('duplicates', 0.2)
const percentile = (values, p) => { const s = [...values].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.ceil(s.length * p) - 1)] * 10) / 10 }

const data = await createDevPlayerData()
const ids = Array.from({ length: players }, (_, i) => `stress-${i}`)
for (const id of ids) await data.playerState(id)

const jobs = []
for (const [p, playerId] of ids.entries()) {
  for (let a = 0; a < actionsPerPlayer; a++) {
    const commit = {
      actionId: randomUUID(), userId: playerId, skillId: 'woodcutting', outcome: 'completed', xpGained: 10,
      rewards: [{ itemId: 'common_log', quantity: 1, bonus: false }], levelBefore: 1, levelAfter: 1, rulesVersion: 'stress',
      node: { nodeId: `pradera:${p}:${a}:tree`, areaId: 'pradera', chunkId: '0,0', state: 'depleted', respawnAt: Date.now() + 90_000, plot: null, base: false },
    }
    jobs.push(commit)
    if (Math.random() < duplicates) jobs.push(commit)
  }
}
jobs.sort(() => Math.random() - 0.5)

const latency = []
let applied = 0
let replays = 0
const started = performance.now()
let next = 0
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (next < jobs.length) {
    const commit = jobs[next++]
    const t = performance.now()
    const result = await data.commitWork(commit)
    latency.push(performance.now() - t)
    if (result.applied) applied++; else replays++
  }
}))
const seconds = (performance.now() - started) / 1000

// Ledger: every player must hold exactly one reward per distinct action.
let wrong = 0
for (const id of ids) {
  const state = await data.playerState(id)
  if (state.xp.woodcutting !== 10 * actionsPerPlayer || state.materials.common_log !== actionsPerPlayer) wrong++
}
const overrides = (await data.loadNodes()).length
console.log(JSON.stringify({
  benchmark: 'integration-1 settle-stress', database: 'pglite (in memory, single connection)', players, actionsPerPlayer, concurrency,
  commits: jobs.length, distinctActions: players * actionsPerPlayer, applied, replays, seconds: Math.round(seconds * 100) / 100,
  commitsPerSecond: Math.round(jobs.length / seconds), latencyMs: { p50: percentile(latency, 0.5), p95: percentile(latency, 0.95), max: percentile(latency, 1) },
  ledger: { playersWithWrongTotals: wrong, nodeOverrides: overrides },
}, null, 2))
process.exit(wrong === 0 && applied === players * actionsPerPlayer ? 0 : 1)
