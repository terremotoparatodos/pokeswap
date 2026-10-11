import test from 'node:test'
import assert from 'node:assert/strict'
import { limitedOwnedData } from './limitedOwnedData.js'
import { withPlayerDataMetrics } from './playerDataMetrics.js'
import { worldDependencies } from '../worldConfig.js'
import { WorldRoom } from '../worldRoom.js'
import { ECO_COMBATANT_PROTOCOL, ECO_PROTOCOL, WORLD_PROTOCOL } from '../worldProtocol.js'
import { fakeClient } from '../testing.js'

const A = '11111111-1111-4111-8111-111111111111'
const config = () => ({ NODE_ENV: 'production', WORLD_ECO_RELEASE: 'limited', WORLD_ECO_EXPERIMENT: 'on', WORLD_ECO_COMBATANT_MODE: 'owned',
  WORLD_ECO_TESTER_IDS: A, WORLD_ECO_EXPIRES_AT: new Date(Date.now() + 60_000).toISOString(), ALLOWED_ORIGINS: 'https://eco-scripted.invalid',
  SUPABASE_URL: 'https://auth-scripted.invalid', SUPABASE_PUBLISHABLE_KEY: 'SCRIPTED', WORLD_AUTHORITY_URL: 'https://edge-scripted.invalid',
  WORLD_AUTHORITY_SECRET: 'SCRIPTED-only-'.repeat(4), WORLD_LOCATION_PERSISTENCE: 'off' })

test('facade exposes only the existing owned reader and disposable transport state', async () => {
  const calls = []
  const source = new Proxy({ readEcoCombatants: async (...args) => { calls.push(args); return ['SCRIPTED-row'] } }, {
    get: (object, key) => { assert.equal(key, 'readEcoCombatants', 'no other capability is even inspected'); return object[key] },
  })
  const data = withPlayerDataMetrics(limitedOwnedData(source))
  assert.deepEqual(await data.readEcoCombatants(A, 25), ['SCRIPTED-row'])
  assert.deepEqual(calls, [[A, 25]])
  assert.deepEqual(await data.playerState(A), { xp: {}, materials: {}, pokemon: [] })
  assert.deepEqual(await data.loadNodes(), [])
  for (const name of ['commitWork', 'ownsPokemon', 'locationClaim', 'locationSave', 'presenceAcquire', 'presenceActivate', 'presenceRenew', 'presenceDrain', 'presenceStop']) assert.equal(data[name], undefined, name)
  assert.deepEqual(Object.keys(data.metrics()).sort(), ['loadNodes', 'playerState', 'readEcoCombatants'])
  assert.throws(() => limitedOwnedData({}), /unavailable/)
  await assert.rejects(limitedOwnedData({ readEcoCombatants: async () => { throw new Error('SCRIPTED read failure') } }).readEcoCombatants(A), /SCRIPTED read failure/)
})

test('limited wiring rejects manual work/retire and calls only eco_combatants through the existing Edge adapter', async () => {
  const original = globalThis.fetch, calls = []
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://edge-scripted.invalid')
    const body = JSON.parse(options.body); calls.push(body.op)
    assert.equal(body.op, 'eco_combatants')
    assert.equal(body.userId, A)
    return Response.json({ rows: [] }) // SCRIPTED empty owned box: never a synthetic combatant.
  }
  try {
    const deps = worldDependencies(config())
    const actor = { id: A, areaId: 'pradera', tx: -5, ty: -69 }, client = fakeClient(A)
    const world = new WorldRoom({ ...deps, lookupActor: id => id === A ? actor : null, clientForPlayer: id => id === A ? client : null, log: () => {} })
    await world.start(); await world.ecoBattles.ready
    world.join(client, { worldProtocol: WORLD_PROTOCOL, ecoProtocol: ECO_PROTOCOL, ecoCombatantProtocol: ECO_COMBATANT_PROTOCOL }, { kind: 'player', userId: A })
    assert.equal(world.work(actor, { requestId: 1, nodeId: 'forged', pokemonInstanceId: 25 }, client).reason, 'disabled')
    assert.equal(world.ecoDevRetire(actor, { requestId: 2, encounterId: 'forged' }, client).reason, 'disabled')
    assert.equal((await world.ecoCombatantSelect(actor, { requestId: 3, slotPokemonId: 25 }, client)).reason, 'not-owner')
    assert.equal(deps.mode, 'eco-limited-readonly')
    assert.equal(deps.ecoCombatantMode, 'owned')
    assert.equal(world.ecoBattles.active, 0)
    assert.deepEqual(calls, ['eco_combatants'])
    assert.equal(deps.playerData.commitWork, undefined)
    assert.equal(deps.playerData.presenceAcquire, undefined)
  } finally { globalThis.fetch = original }
})
