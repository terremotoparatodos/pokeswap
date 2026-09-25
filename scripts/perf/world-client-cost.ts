// WORLD-1 client cost, measured on the real modules (no browser):
//   npx vite-node scripts/perf/world-client-cost.ts
// Per-frame work the shared world adds: sampling shared patrols, the resource
// overlay's decor lookups and progress rings, and applying world batches.

import { performance } from 'node:perf_hooks'
import { createActor, type Actor } from '../../src/features/wildlands/engine/actors'
import { followPatrol } from '../../src/features/wildlands/engine/patrolMotion'
import { World } from '../../src/features/wildlands/engine/world'
import { WorldClock } from '../../src/features/world/domain/worldClock'
import { WorldResourceMirror } from '../../src/features/world/domain/worldResources'
import { WorldResourceOverlay } from '../../src/features/world/render/worldResourceOverlay'
import { buildPatrol } from '../../services/realtime/src/world/patrol.js'
import { resourcesInChunk } from '../../services/realtime/src/world/resourceLayout.js'

const world = new World(208)
const walkable = (tx: number, ty: number) => !world.isSolid(tx, ty) && !world.isWater(tx, ty)
const time = (label: string, iterations: number, fn: (i: number) => void) => {
  for (let i = 0; i < Math.min(200, iterations); i++) fn(i)
  const started = performance.now()
  for (let i = 0; i < iterations; i++) fn(i)
  const us = ((performance.now() - started) / iterations) * 1000
  return { label, usPerCall: Math.round(us * 100) / 100 }
}

const results = []

// Building patrols happens once per actor when it spawns.
results.push(time('buildPatrol (one actor spawn)', 2000, i => buildPatrol({ key: `wild:${i}`, home: { tx: -5 + (i % 30), ty: -69 + (i % 17) }, walkable, speed: 3 })))

// 60 shared wanderers on screen, sampled every frame.
const actors: Actor[] = Array.from({ length: 60 }, (_, i) => {
  const home = { tx: -5 + (i % 12) * 2, ty: -69 + Math.floor(i / 12) * 2 }
  const actor = createActor({ id: `a${i}`, kind: i % 2 ? 'pokemon' : 'npc', habitat: 'land', ...home })
  actor.patrol = buildPatrol({ key: actor.id, home, walkable, speed: 3 })
  return actor
})
results.push(time('followPatrol × 60 actors (one frame)', 20000, i => { const now = 1_727_000_000_000 + i * 16.7; for (const actor of actors) followPatrol(actor, now) }))

// The resource overlay with 20 active nodes and 300 decor props in view.
const clock = new WorldClock(() => performance.now())
clock.sample(1_727_000_000_000)
const mirror = new WorldResourceMirror()
const nodes = [-2, -1, 0].flatMap(cx => [-5, -4].flatMap(cy => resourcesInChunk('pradera', cx, cy)))
mirror.applySnapshot({
  now: 0, areaId: 'pradera', chunks: ['-2,-5', '-1,-5', '0,-5', '-2,-4', '-1,-4', '0,-4'],
  nodes: nodes.slice(0, 20).map((node, i) => ({ id: node.id, state: 'working', version: i + 1, actionId: `x${i}`, workKind: 'chop' as const, worker: { playerId: 'p', pokemonInstanceId: 1, speciesId: 1 }, startedAt: 0, endsAt: 3000 })),
})
const overlay = new WorldResourceOverlay(mirror, clock)
const area = { id: 'pradera' } as never
const decor = Array.from({ length: 300 }, (_, i) => ({ kind: 'tree' as const, tx: -30 + (i % 30), ty: -80 + Math.floor(i / 30), x: 0, y: 0, seed: 0 }))
results.push(time('overlay.decor × 300 props, 20 active nodes (one frame)', 5000, () => { for (const d of decor) overlay.decor(d, area) }))
const ring = { save() {}, restore() {}, beginPath() {}, ellipse() {}, stroke() {}, lineWidth: 0, strokeStyle: '' } as unknown as CanvasRenderingContext2D
results.push(time('overlay.ground + labels, 20 active nodes (one frame)', 20000, () => { overlay.ground(ring, area, 0, 0); overlay.labels(area) }))

// A world batch with 10 node changes.
results.push(time('mirror.applyBatch (10 node deltas)', 20000, i => mirror.applyBatch({ now: i, nodes: nodes.slice(0, 10).map(node => ({ id: node.id, state: 'depleted', version: 100 + i })) })))

console.log(JSON.stringify({ tool: 'world-client-cost', node: process.version, results }, null, 2))
