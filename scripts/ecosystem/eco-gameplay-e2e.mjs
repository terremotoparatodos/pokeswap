// ECO-GAMEPLAY-1 — end-to-end check against the isolated local realtime (development only).
//
//   node scripts/ecosystem/eco-gameplay-local.mjs realtime      (in another terminal)
//   node scripts/ecosystem/eco-gameplay-e2e.mjs [--url ws://127.0.0.1:2790] [--respawn-timeout 150]
//
// Two synthetic players (the browser's own protocol, through the real Colyseus SDK) join Pradera
// and must hold the SAME authoritative population, with several individuals of one species. Player
// A then test-retires one whole group: both must stop seeing it at once, and the nest must respawn
// a new generation within the provisional delay. Exit 0 PASS, 1 FAIL, 3 setup (realtime absent).
// Synthetic data only; nothing is captured, granted or persisted.

import { Client } from '@colyseus/sdk'
import { ECO_PROTOCOL, WORLD_MESSAGE, WORLD_PROTOCOL } from '../../services/realtime/src/world/worldProtocol.js'

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback }
const URL = arg('url', 'ws://127.0.0.1:2790')
const RESPAWN_TIMEOUT_MS = Number(arg('respawn-timeout', 150)) * 1000
const PRESENCE_PROTOCOL = 3 // the browser's (src/features/wildlands/multiplayer/domain/closePolicy.ts)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const log = message => console.log(`[eco-e2e] ${message}`)
const fail = message => { console.error(`[eco-e2e] FAIL: ${message}`); process.exit(1) }

async function player(id) {
  const state = { eco: null, results: [] }
  const room = await new Client(URL).joinOrCreate('presence', {
    token: null, presenceProtocol: PRESENCE_PROTOCOL, worldProtocol: WORLD_PROTOCOL, ecoProtocol: ECO_PROTOCOL,
    tabId: `e2e-${id}`, benchmark: { id, username: id, area: 'pradera' },
  })
  room.reconnection.enabled = false
  room.onMessage('*', () => {})
  room.onMessage(WORLD_MESSAGE.SNAPSHOT, snapshot => { if (snapshot.eco) state.eco = snapshot.eco })
  room.onMessage(WORLD_MESSAGE.ECO, message => { state.eco = message.eco })
  room.onMessage(WORLD_MESSAGE.ECO_DEV_RETIRE_RESULT, result => state.results.push(result))
  room.send('presence:ready')
  return { id, room, state }
}

async function until(predicate, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) { if (predicate()) return; await wait(200) }
  fail(`timed out waiting for ${what}`)
}

const ids = area => (area?.encounters ?? []).map(e => e.id).sort().join(',')

let a, b
try {
  a = await player('eco-e2e-a')
  b = await player('eco-e2e-b')
} catch (error) {
  console.error(`[eco-e2e] setup: cannot join ${URL} (${error?.message ?? error}); start the isolated realtime first`)
  process.exit(3)
}

try {
  await until(() => a.state.eco?.areaId === 'pradera' && b.state.eco?.areaId === 'pradera', 15_000, 'both players in Pradera with an ECO view')
  await until(() => (a.state.eco.encounters.length ?? 0) >= 6, 60_000, 'Pradera to fill')
  await wait(1_500)
  await until(() => ids(a.state.eco) === ids(b.state.eco), 5_000, 'both players to hold the same list')
  const encounters = a.state.eco.encounters
  log(`both players see the same ${encounters.length} encounters (status ${a.state.eco.status})`)
  if (JSON.stringify(a.state.eco) !== JSON.stringify(b.state.eco)) fail('same ids but different content')
  const bySpecies = new Map()
  for (const e of encounters) bySpecies.set(e.speciesId, (bySpecies.get(e.speciesId) ?? 0) + 1)
  const repeated = [...bySpecies].filter(([, n]) => n >= 2)
  log(`species with several individuals: ${repeated.map(([s, n]) => `#${s}×${n}`).join(', ') || 'none yet'}`)
  if (!repeated.length) fail('no species with several individuals in this population')
  if (new Set(encounters.map(e => e.id)).size !== encounters.length) fail('duplicate encounter ids')

  // A test-retires one whole group; B must see it gone at the same flush.
  const group = encounters[0].groupId
  const members = encounters.filter(e => e.groupId === group)
  for (const [i, member] of members.entries()) a.room.send(WORLD_MESSAGE.ECO_DEV_RETIRE, { requestId: i + 1, encounterId: member.id })
  await until(() => a.state.results.length === members.length, 5_000, 'the retirement answers')
  if (!a.state.results.every(r => r.ok)) fail(`retirement refused: ${JSON.stringify(a.state.results)}`)
  await until(() => [a, b].every(p => p.state.eco.encounters.every(e => e.groupId !== group)), 3_000, 'the group to disappear for both')
  log(`A retired group ${group.split(':').slice(2).join(':')} (${members.length}); gone for both`)
  const [ns, area, nest, generation] = group.split(':')
  const retiredAt = Date.now()
  const respawned = p => p.state.eco.encounters.some(e => e.id.startsWith(`${ns}:${area}:${nest}:`) && Number(e.id.split(':')[3]) > Number(generation))
  await until(() => respawned(a) && respawned(b), RESPAWN_TIMEOUT_MS, 'the nest to respawn')
  log(`nest ${nest} respawned a new generation after ${Math.round((Date.now() - retiredAt) / 1000)} s, seen by both`)
  await wait(1_000)
  if (ids(a.state.eco) !== ids(b.state.eco)) fail('the lists diverged after the respawn')
  log('PASS')
} finally {
  await Promise.allSettled([a?.room.leave(), b?.room.leave()])
}
process.exit(0)
