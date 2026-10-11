// ISOLATED TEST: real SDK/room/Edge handler/catalog/core, SCRIPTED identity and read adapters.
// These rows are test data, never proof of hosted accounts or recovered individual attributes.
// Node 22: node scripts/ecosystem/eco-owned-combatant-e2e.mjs --report <outside-repo.json>
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Client } from '@colyseus/sdk'
import { ECO_COMBATANT_PROTOCOL, ECO_PROTOCOL, WORLD_MESSAGE as M, WORLD_PROTOCOL } from '../../services/realtime/src/world/worldProtocol.js'
import { publicBattleView } from '../../services/realtime/src/world/ecoBattlePublic.js'

assert.equal(process.versions.node.split('.')[0], '22')
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222'
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(predicate, ms, description) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) { if (predicate()) return; await wait(25) }
  throw new Error(`Timeout: ${description}`)
}

async function serveTest(port) {
  const backend = createRequire(new URL('../../services/realtime/package.json', import.meta.url))
  // Use the same ESM module instances as PresenceRoom (CJS would duplicate matchmaker state).
  const { Server, ServerError } = await import(pathToFileURL(backend.resolve('@colyseus/core').replace(/\.cjs$/, '.mjs')))
  const { WebSocketTransport } = await import(pathToFileURL(backend.resolve('@colyseus/ws-transport').replace(/\.cjs$/, '.mjs')))
  const { PresenceRoom, configureWorld, liveActorForTesting } = await import('../../services/realtime/src/rooms/PresenceRoom.js')
  const { worldDependencies } = await import('../../services/realtime/src/world/worldConfig.js')
  const { createEdgePlayerData } = await import('../../services/realtime/src/world/persistence/playerData.js')
  const { handleWorldAuthority } = await import('../../supabase/functions/world-authority/handler.ts')
  const { readEcoCombatants } = await import('../../supabase/functions/world-authority/ecoCombatantRead.ts')
  const { isWalkable } = await import('../../services/realtime/src/world/navigation.js')
  const { battleStage, wildPoseAt } = await import('../../services/realtime/src/world/ecoScene.js')
  const audit = { adapter: 'SCRIPTED TEST identity/slots/progression; no hosted verification', reads: [], rpc: [], writes: 0 }
  const row = (user, id, moves) => ({
    slot: { pokemon_id: id, owner_id: user, is_locked: false, first_owner_id: user, owned_since: null },
    progression: { user_id: user, pokemon_id: id, xp: 4356, level: 12, moves },
  })
  const rows = [row(A, 25, ['thunder-shock', 'quick-attack']), row(A, 19, ['tackle']), row(B, 43, ['absorb'])]
  const store = {
    async slots(user, id) { return rows.filter(r => r.slot.owner_id === user && (id === null || r.slot.pokemon_id === id)).map(r => structuredClone(r.slot)) },
    async progressions(user, ids) { return rows.filter(r => r.progression.user_id === user && ids.includes(r.progression.pokemon_id)).map(r => structuredClone(r.progression)) },
  }
  const secret = 'SCRIPTED-TEST-NOT-A-CREDENTIAL-000000000000'
  const playerData = createEdgePlayerData({ url: 'http://scripted-test.invalid', secret, publishableKey: 'SCRIPTED-TEST',
    fetcher: async (url, init) => {
      assert.equal(url, 'http://scripted-test.invalid')
      const body = JSON.parse(init.body)
      audit.reads.push({ op: body.op, userId: body.userId, slotPokemonId: body.slotPokemonId })
      return handleWorldAuthority(new Request(url, init), { secret,
        rpc: async (name) => {
          audit.rpc.push(name)
          if (name === 'world_skills_access') return { data: 'tester', error: null }
          if (name === 'world_player_state') return { data: { xp: {}, materials: {}, pokemon: [] }, error: null }
          if (name === 'world_load_nodes') return { data: [], error: null }
          audit.writes++; throw new Error('TEST forbids every other RPC')
        },
        ecoCombatants: (user, id) => readEcoCombatants(store, user, id),
      })
    } })
  const world = configureWorld({ ...worldDependencies(), playerData })
  await world.ecoBattles.ready
  await until(() => world.ready, 2_000, 'scripted read-only restore')
  class ScriptedOwnedRoom extends PresenceRoom {
    async onAuth(_client, options) {
      if (options.benchmark || !['SCRIPTED-A', 'SCRIPTED-B'].includes(options.token)) throw new ServerError(401, 'SCRIPTED test identity refused')
      return { kind: 'player', userId: options.token === 'SCRIPTED-A' ? A : B, username: 'ADAPTADOR DE PRUEBA ' + options.token, token: null }
    }
    freshActor(auth, characterId) { return super.freshActor(auth, characterId, { areaId: 'pradera', tx: -5, ty: -69, dir: 'down' }) }
    onCreate() {
      super.onCreate()
      // Test-only positioning: no product handler, no world geometry/range/core changes.
      this.onMessage('test:stand', (client, payload) => {
        const actor = liveActorForTesting(client.userData.actorId)
        const encounter = world.eco.encounter(payload.encounterId)
        assert(actor && encounter && !world.ecoBattles.byPlayer.has(actor.id))
        const seen = wildPoseAt(encounter, Date.now())
        for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
          const place = { tx: seen.tx + dx, ty: seen.ty + dy, dir: 'down' }
          if (isWalkable('pradera', place.tx, place.ty) && battleStage({ areaId: 'pradera', trainer: { ...actor, ...place }, wild: seen })) {
            this.placeActor(actor, place)
            client.send('test:stood', payload)
            return
          }
        }
        throw new Error('No legal test stand')
      })
    }
  }
  const server = new Server({ transport: new WebSocketTransport() })
  server.define('presence', ScriptedOwnedRoom)
  await server.listen(port, '127.0.0.1')
  process.send({ ready: true, port, adapter: audit.adapter })
  process.on('message', async message => {
    if (message !== 'stop') return
    await server.gracefullyShutdown(false)
    process.send({ audit }, () => process.exit(0))
  })
}

if (process.argv[2] === '--server') {
  await serveTest(Number(process.argv[3]))
} else {
  const report = { node: process.version, adapter: 'SCRIPTED TEST identity/slots/progression; no hosted verification', checks: [], result: 'FAIL' }
  const reportIndex = process.argv.indexOf('--report'), reportPath = reportIndex < 0 ? null : process.argv[reportIndex + 1]
  const rooms = new Set()
  let server, logs = '', ready = false, audit = null, requestId = 0
  const check = name => { report.checks.push(name); console.log('PASS · ' + name) }
  const freePort = () => new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)) })
  })
  async function player(url, token) {
    const state = { eco: null, choices: [], engage: [], updates: [], publics: [], ends: [], stood: [] }
    const room = await new Client(url).joinOrCreate('presence', {
      token, presenceProtocol: 3, worldProtocol: WORLD_PROTOCOL, ecoProtocol: ECO_PROTOCOL, ecoCombatantProtocol: ECO_COMBATANT_PROTOCOL,
      tabId: token + Date.now(),
    })
    rooms.add(room)
    room.onLeave(() => rooms.delete(room))
    room.reconnection.enabled = false
    room.onMessage('*', () => {})
    for (const type of [M.SNAPSHOT, M.ECO]) room.onMessage(type, value => { if (value.eco) state.eco = value.eco })
    for (const [type, key] of [[M.ECO_COMBATANT_STATE, 'choices'], [M.ECO_ENGAGE_RESULT, 'engage'], [M.ECO_BATTLE, 'updates'], [M.ECO_BATTLE_PUBLIC, 'publics'], [M.ECO_BATTLE_END, 'ends'], ['test:stood', 'stood']]) room.onMessage(type, value => state[key].push(value))
    room.send('presence:ready')
    await until(() => state.choices.length, 5_000, token + ' choices')
    return { room, state }
  }
  async function select(p, slotPokemonId, extra = {}) {
    const id = ++requestId
    p.room.send(M.ECO_COMBATANT_SELECT, { requestId: id, slotPokemonId, ...extra })
    await until(() => p.state.choices.some(c => c.requestId === id), 3_000, 'selection ACK')
    return p.state.choices.find(c => c.requestId === id)
  }
  async function start(p, encounterId) {
    const id = ++requestId
    p.room.send('test:stand', { requestId: id, encounterId })
    await until(() => p.state.stood.some(c => c.requestId === id), 3_000, 'test stand ACK')
    p.room.send(M.ECO_ENGAGE, { requestId: id, encounterId })
    await until(() => p.state.engage.some(c => c.requestId === id), 3_000, 'engage ACK')
    const answer = p.state.engage.find(c => c.requestId === id)
    assert.equal(answer.ok, true, JSON.stringify(answer))
    return answer.battle
  }
  async function parity(p, battle, snapshot = battle.snapshot) {
    await until(() => p.state.publics.some(v => v.battleId === battle.battleId && v.revision === snapshot.revision), 3_000, 'public parity')
    const view = p.state.publics.find(v => v.battleId === battle.battleId && v.revision === snapshot.revision)
    const expected = publicBattleView({ ...view, stage: battle.stage, snapshot })
    assert.deepEqual(view.combatants, expected.combatants)
    assert.deepEqual(view.stage, battle.stage)
    for (const field of ['ownerId', 'instanceId', 'ivs', 'evs', 'moves', 'experience', 'natureId', 'joinAck']) assert(!JSON.stringify(view).includes('"' + field + '"'), field)
  }
  try {
    const port = await freePort()
    report.port = port
    const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec'].filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]))
    Object.assign(env, { NODE_ENV: 'development', WORLD_ECO_EXPERIMENT: 'on', WORLD_ECO_COMBATANT_MODE: 'owned', WORLD_DEMO_SKILLS: 'on', WORLD_LOCATION_PERSISTENCE: 'off' })
    server = spawn(process.execPath, [fileURLToPath(import.meta.url), '--server', String(port)], { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    server.stdout.on('data', data => { logs += data }); server.stderr.on('data', data => { logs += data })
    server.on('message', message => { if (message.ready) ready = true; if (message.audit) audit = message.audit })
    await until(() => ready, 10_000, 'isolated server ready')
    const url = `ws://127.0.0.1:${port}`
    await assert.rejects(new Client(url).joinOrCreate('presence', { token: 'unknown', benchmark: { id: 'benchmark-forged' } }))
    const a = await player(url, 'SCRIPTED-A'), b = await player(url, 'SCRIPTED-B')
    assert.equal(a.state.choices[0].mode, 'owned')
    assert.equal(a.state.choices[0].speciesId, null)
    assert.equal((await select(a, 25)).speciesId, 25)
    assert.equal((await select(b, 43)).speciesId, 43)
    assert.equal((await select(a, 43)).reason, 'not-owner')
    assert.equal((await select(a, 25, { moves: [84], level: 100 })).reason, 'invalid')
    check('owned mode: no fixture default, unknown/benchmark identity and forged fields refused; independent selections')
    await until(() => a.state.eco?.encounters.length >= 2, 90_000, 'real admitted population')
    const [targetA, targetB] = a.state.eco.encounters
    const first = await start(a, targetA.id), other = await start(b, targetB.id)
    const own = first.snapshot.combatants['player-0']
    assert.equal(own.instance.speciesId, 25)
    assert.equal(own.instance.ownership.ownerId, A)
    assert.equal(own.level, 12)
    assert.deepEqual(own.instance.moves.map(m => m.moveId), [84, 98])
    assert.equal(other.snapshot.combatants['player-0'].instance.speciesId, 43)
    assert.equal((await select(a, 19)).reason, 'in-battle')
    await parity(b, first); await parity(a, other)
    check('Pikachu and Oddish: real authoritative snapshots, stored moves, spectator species/scene/bars and privacy')
    a.room.send(M.ECO_BATTLE_ACTION, { battleId: first.battleId, actionId: `${A}:${first.joinAck.nextActionSequence}`, catalogVersion: first.snapshot.catalogVersion, battleRulesVersion: first.snapshot.battleRulesVersion,
      intent: { kind: 'useMove', combatantId: 'player-0', moveId: 84, targetId: 'wild-0' } })
    await until(() => a.state.updates.some(u => u.result?.kind === 'accepted'), 3_000, 'real core action')
    await until(() => a.state.updates.some(u => u.events?.length), 15_000, 'real battle tick events')
    const update = a.state.updates.find(u => u.events?.length && u.snapshot)
    await parity(b, first, update.snapshot)
    check('native core action and live owner/spectator HP/action bars agree')
    for (const [p, battle] of [[a, first], [b, other]]) {
      p.room.send(M.ECO_FLEE, { battleId: battle.battleId })
      await until(() => p.state.ends.some(e => e.battleId === battle.battleId), 3_000, 'flee')
    }
    assert.equal((await select(a, 19)).speciesId, 19)
    const next = await start(a, targetA.id), nextOwn = next.snapshot.combatants['player-0']
    assert.notEqual(next.battleId, first.battleId)
    assert.equal(nextOwn.instance.speciesId, 19)
    assert.deepEqual(nextOwn.instance.moves.map(m => m.moveId), [33])
    // The existing model's HEALTHY sentinel is null HP (resolved by the unchanged core).
    assert.equal(nextOwn.condition.currentHp ?? nextOwn.stats.hp, nextOwn.stats.hp)
    assert.equal(nextOwn.condition.majorStatus, 'none')
    await parity(b, next)
    a.room.send(M.ECO_FLEE, { battleId: next.battleId })
    await until(() => a.state.ends.some(e => e.battleId === next.battleId), 3_000, 'second flee')
    check('flee/change/restart uses fresh Rattata with no prior HP or moves')
    report.result = 'PASS'
  } catch (error) {
    report.failure = String(error.stack ?? error)
    report.serverLog = logs.slice(-4_000)
    process.exitCode = 1
    console.error(report.failure)
  } finally {
    for (const room of rooms) room.connection.close()
    if (server?.connected) server.send('stop')
    if (server) {
      try { await until(() => server.exitCode !== null, 7_000, 'owned server exit') }
      catch { server.kill(); await until(() => server.exitCode !== null || server.signalCode !== null, 3_000, 'forced owned server exit') }
    }
    report.audit = audit
    report.cleanup = { serverPid: server?.pid, exitCode: server?.exitCode, signal: server?.signalCode, socketsClosed: true }
    if (report.result === 'PASS') {
      if (!audit || audit.writes !== 0 || !audit.reads.some(r => r.op === 'eco_combatants') || !audit.rpc.includes('world_skills_access') || server.exitCode !== 0) {
        report.result = 'FAIL'; report.failure = 'read-only audit / orderly cleanup failed'; process.exitCode = 1
      }
    }
    if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  }
}
