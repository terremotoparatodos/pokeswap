// ECO-COMBATANT-1: self-contained real-SDK test, loopback clients and ephemeral ports,
// synthetic identities, explicit environment, no database; always closes its own process/sockets.
// node scripts/ecosystem/eco-combatant-e2e.mjs [--report <file>]
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { Client } from '@colyseus/sdk'
import { isWalkable } from '../../services/realtime/src/world/navigation.js'
import { wildPoseAt } from '../../services/realtime/src/world/ecoScene.js'
import { publicBattleView } from '../../services/realtime/src/world/ecoBattlePublic.js'
import { ECO_PROTOCOL, WORLD_MESSAGE as M, WORLD_PROTOCOL } from '../../services/realtime/src/world/worldProtocol.js'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const report = { node: process.version, checks: [], result: 'FAIL' }
const reportIndex = process.argv.indexOf('--report')
const reportPath = reportIndex < 0 ? null : process.argv[reportIndex + 1]
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const rooms = new Set()
let server, logs = ''
async function until(predicate, ms, description) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) { if (predicate()) return; await wait(50) }
  throw new Error(`Timeout: ${description}`)
}
const check = name => { report.checks.push(name); console.log(`PASS · ${name}`) }
const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer()
  probe.once('error', reject)
  probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)) })
})

async function player(url, id) {
  const state = { self: null, eco: null, clock: null, choices: [], engage: [], updates: [], publics: [], ends: [], sequence: 0 }
  const room = await new Client(url).joinOrCreate('presence', {
    token: null, presenceProtocol: 3, worldProtocol: WORLD_PROTOCOL, ecoProtocol: ECO_PROTOCOL,
    tabId: `combatant-${id}-${Date.now()}`, benchmark: { id, username: id, area: 'pradera' },
  })
  rooms.add(room)
  room.onLeave(() => rooms.delete(room))
  room.reconnection.enabled = false
  room.onMessage('*', () => {})
  room.onMessage('presence:snapshot', value => { if (value.self) { state.self = value.self; state.sequence = value.self.moveSequence ?? 0 } })
  room.onMessage('presence:self', value => { state.self = value; state.sequence = Math.max(state.sequence, value.moveSequence ?? 0) })
  const world = value => { if (value.eco) state.eco = value.eco; state.clock = { now: value.now, at: Date.now() } }
  room.onMessage(M.SNAPSHOT, world)
  room.onMessage(M.ECO, world)
  room.onMessage(M.ECO_COMBATANT_STATE, value => state.choices.push(value))
  room.onMessage(M.ECO_ENGAGE_RESULT, value => state.engage.push(value))
  room.onMessage(M.ECO_BATTLE, value => state.updates.push(value))
  room.onMessage(M.ECO_BATTLE_PUBLIC, value => state.publics.push(value))
  room.onMessage(M.ECO_BATTLE_END, value => state.ends.push(value))
  room.send('presence:ready')
  await until(() => state.self && state.choices.length, 8_000, `${id} ready with choice`)
  return { id, room, state }
}
let requestId = 0
async function select(p, speciesId, extra = {}) {
  const id = ++requestId
  p.room.send(M.ECO_COMBATANT_SELECT, { requestId: id, speciesId, ...extra })
  await until(() => p.state.choices.some(c => c.requestId === id), 3_000, 'selection reply')
  return p.state.choices.find(c => c.requestId === id)
}
async function engage(p, encounterId) {
  const id = ++requestId
  p.room.send(M.ECO_ENGAGE, { requestId: id, encounterId, playerSpeciesId: 25, level: 100 })
  await until(() => p.state.engage.some(c => c.requestId === id), 3_000, 'engage reply')
  const reply = p.state.engage.find(c => c.requestId === id)
  assert.equal(reply.ok, true, JSON.stringify(reply))
  return reply.battle
}
function seen(p, encounterId) {
  const e = p.state.eco.encounters.find(c => c.id === encounterId)
  if (!e) throw new Error(`Encounter disappeared: ${encounterId}`)
  const clock = p.state.clock
  return e.stand ?? wildPoseAt({ ...e, areaId: 'pradera' }, clock.now + Date.now() - clock.at)
}
const steps = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }
function firstStep(from, goal) {
  const key = (x, y) => `${x},${y}`
  const visited = new Map([[key(from.tx, from.ty), null]]), queue = [[from.tx, from.ty]]
  for (let i = 0; i < queue.length && i < 40_000; i++) {
    const [x, y] = queue[i]
    if (Math.max(Math.abs(x - goal.tx), Math.abs(y - goal.ty)) <= 2) {
      let at = key(x, y), step = null
      while (visited.get(at)) { step = visited.get(at); at = step.from }
      return step?.direction ?? null
    }
    for (const [direction, [dx, dy]] of Object.entries(steps)) {
      const nx = x + dx, ny = y + dy
      if (visited.has(key(nx, ny)) || !isWalkable('pradera', nx, ny)) continue
      visited.set(key(nx, ny), { from: key(x, y), direction }); queue.push([nx, ny])
    }
  }
  throw new Error('No walkable path to encounter')
}
async function walk(p, encounterId) {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    const goal = seen(p, encounterId)
    if (Math.max(Math.abs(p.state.self.tx - goal.tx), Math.abs(p.state.self.ty - goal.ty)) <= 2) return
    const direction = firstStep(p.state.self, goal)
    p.room.send('move', { direction, running: false, sequence: ++p.state.sequence })
    await wait(140)
  }
  throw new Error('Timed out walking to encounter')
}
function parity(view, snapshot, stage) {
  const expected = publicBattleView({ battleId: view.battleId, encounterId: view.encounterId, areaId: view.areaId, seq: view.seq, stage, snapshot, connected: view.connected })
  assert.deepEqual(view.combatants, expected.combatants)
  assert.deepEqual(view.stage, stage)
}

try {
  const port = await freePort()
  let health = await freePort()
  while (health === port) health = await freePort()
  const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec'].filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]))
  Object.assign(env, { NODE_ENV: 'development', PRESENCE_BENCHMARK: 'on', WORLD_ECO_EXPERIMENT: 'on', PORT: String(port), HEALTH_PORT: String(health), ALLOWED_ORIGINS: 'http://127.0.0.1:5199' })
  server = spawn(process.execPath, ['services/realtime/src/index.js'], { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  server.stdout.on('data', data => { logs += data }); server.stderr.on('data', data => { logs += data })
  server.on('error', error => { logs += error.message })
  await until(() => logs.includes('Listening on') || logs.includes('listening on'), 10_000, 'isolated realtime start')
  const url = `ws://127.0.0.1:${port}`, run = Date.now().toString(36)
  let a = await player(url, `combatant-a-${run}`)
  const b = await player(url, `combatant-b-${run}`), c = await player(url, `combatant-c-${run}`)
  assert.equal(a.state.choices[0].speciesId, 25)
  assert.deepEqual(a.state.choices[0].options.map(o => o.speciesId), [25, 19, 43, 74, 41, 10])
  assert.equal((await select(a, 19)).speciesId, 19)
  assert.equal((await select(b, 43)).speciesId, 43)
  for (const [species, extra, reason] of [[999, {}, 'invalid-species'], [74, { level: 100, moves: [1], stats: { hp: 999 } }, 'invalid']]) {
    const reply = await select(a, species, extra)
    assert.equal(reply.reason, reason); assert.equal(reply.speciesId, 19)
  }
  check('two independent choices; invalid and forged input rejected')
  await until(() => a.state.eco?.encounters.length >= 2, 90_000, 'population')
  const nearest = p => [...p.state.eco.encounters].sort((x, y) => Math.max(Math.abs(x.tx - p.state.self.tx), Math.abs(x.ty - p.state.self.ty)) - Math.max(Math.abs(y.tx - p.state.self.tx), Math.abs(y.ty - p.state.self.ty)))
  const targetA = nearest(a)[0].id, targetB = nearest(b).find(e => e.id !== targetA).id
  await Promise.all([walk(a, targetA), walk(b, targetB)])
  const battleA = await engage(a, targetA), battleB = await engage(b, targetB)
  assert.equal(battleA.snapshot.combatants['player-0'].instance.speciesId, 19)
  assert.equal(battleB.snapshot.combatants['player-0'].instance.speciesId, 43)
  assert.equal((await select(a, 74)).reason, 'in-battle')
  assert.equal((await select(b, 10)).reason, 'in-battle')
  await until(() => c.state.publics.some(v => v.battleId === battleA.battleId) && c.state.publics.some(v => v.battleId === battleB.battleId), 3_000, 'both public starts')
  for (const [p, battle] of [[a, battleA], [b, battleB]]) {
    parity(c.state.publics.find(v => v.battleId === battle.battleId && v.seq === 1), battle.snapshot, battle.stage)
    assert.ok(!p.state.publics.some(v => v.battleId === battle.battleId), 'owner excluded from own public stream')
  }
  check('two species in owner and spectator scenes; active choices locked')
  const old = a
  old.room.connection.close()
  await until(() => c.state.publics.some(v => v.battleId === battleA.battleId && !v.connected), 3_000, 'disconnect grace')
  a = await player(url, old.id)
  assert.equal(a.state.choices[0].speciesId, 19)
  await until(() => a.state.engage.some(v => v.resumed), 3_000, 'resumed battle')
  assert.equal(a.state.engage.find(v => v.resumed).battle.battleId, battleA.battleId)
  assert.equal((await select(a, 74)).reason, 'in-battle')
  check('choice and battle survive reconnect during grace')
  for (const [p, battle] of [[a, battleA], [b, battleB]]) {
    await until(() => p.state.updates.some(m => m.snapshot && m.events.length), 15_000, 'ongoing owner update')
    const update = p.state.updates.find(m => m.snapshot && m.events.length)
    await until(() => c.state.publics.some(v => v.battleId === battle.battleId && v.revision === update.snapshot.revision), 3_000, 'spectator update')
    parity(c.state.publics.find(v => v.battleId === battle.battleId && v.revision === update.snapshot.revision), update.snapshot, battle.stage)
    p.room.send(M.ECO_FLEE, { battleId: battle.battleId })
    await until(() => p.state.ends.some(v => v.battleId === battle.battleId), 3_000, 'flee')
  }
  check('live HP/action bars and species match owner/public updates')
  assert.equal((await select(a, 74)).speciesId, 74)
  await a.room.leave()
  const again = await player(url, a.id)
  assert.equal(again.state.choices[0].speciesId, 74)
  check('choice unlocked after end and retained on out-of-combat reconnect')
  report.result = 'PASS'
} catch (error) {
  report.failure = String(error.stack ?? error)
  report.serverLog = logs.slice(-4_000)
  process.exitCode = 1
  console.error(report.failure)
} finally {
  // Room.leave() can wait forever on a socket already dropped in the reconnect test.
  // Close the tracked transports directly; there is no persistent state to settle here.
  for (const room of rooms) room.connection.close()
  if (server?.pid && server.exitCode === null) {
    server.kill()
    await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve) })
  }
  report.cleanup = 'all owned sockets closed; isolated realtime exited'
  if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
}
