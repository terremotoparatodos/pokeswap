import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareBundledBattles } from './ecoBattles.js'
import { PUBLIC_EVENT_FIELDS, publicBattleView, publicCombatant, publicEvents } from './ecoBattlePublic.js'

// ECO-BATTLE-SPECTATORS-1: the public view is built by explicit whitelists — never the owner's
// snapshot or events whole. Checked on the REAL test-battle bundle (seed 7) and on hostile input.

const COMBATANT_KEYS = ['actionElapsedMs', 'confused', 'cooldownMultiplier', 'currentHp', 'level', 'majorStatus', 'maxHp', 'spe', 'speStage', 'speciesId']
const VIEW_KEYS = ['areaId', 'battleId', 'combatants', 'config', 'connected', 'encounterId', 'revision', 'seq', 'stage', 'timeMs']
const stage = { owner: { tx: 1, ty: 2 }, wild: { tx: 4, ty: 2 } }

async function realBattle() {
  const prepared = await prepareBundledBattles()
  assert.equal(prepared.ok, true)
  const started = prepared.battles.start({ battleId: 'eco-battle-pub-0000000a', controllerId: 'owner-a', speciesId: 19, seed: 7 })
  assert.equal(started.ok, true)
  return started.battle
}

test('the public view of a real battle carries only whitelisted fields — no moves, PP, selection, stats, joinAck or ids', async () => {
  const battle = await realBattle()
  const events = []
  for (let i = 0; i < 400 && events.length < 12; i++) events.push(...battle.advance(50).events)
  const snapshot = battle.snapshot()
  const view = publicBattleView({ battleId: 'eco-battle-pub-0000000a', encounterId: 'eco-n:pradera:x:1:0', areaId: 'pradera', seq: 3, stage, snapshot, connected: true, events, ended: null })

  assert.deepEqual(Object.keys(view).sort(), [...VIEW_KEYS, 'events'].sort())
  assert.deepEqual(Object.keys(view.combatants).sort(), ['player-0', 'wild-0'])
  for (const id of ['player-0', 'wild-0']) {
    assert.deepEqual(Object.keys(view.combatants[id]).sort(), COMBATANT_KEYS)
    const own = snapshot.combatants[id]
    assert.equal(view.combatants[id].currentHp, own.condition.currentHp)
    assert.equal(view.combatants[id].maxHp, own.stats.hp)
    assert.equal(view.combatants[id].spe, own.stats.spe)
    assert.equal(view.combatants[id].actionElapsedMs, own.runtime.actionElapsedMs)
  }
  assert.deepEqual(Object.keys(view.config).sort(), ['actionBar', 'statStages'])
  assert.deepEqual(Object.keys(view.config.actionBar).sort(), ['baseSeconds', 'maxSeconds', 'minSeconds', 'paralysisMultiplier', 'referenceSpeed'])
  assert.equal(view.revision, snapshot.revision)
  assert.equal(view.timeMs, snapshot.timeMs)

  // events: only listed types, only their fields, no action id / revision / server time
  assert.ok(view.events.length > 0, 'the battle produced drawable events')
  for (const envelope of view.events) {
    assert.deepEqual(Object.keys(envelope).sort(), ['event', 'sequence'])
    const fields = PUBLIC_EVENT_FIELDS[envelope.event.type]
    assert.ok(fields, `${envelope.event.type} is public`)
    for (const key of Object.keys(envelope.event)) assert.ok(key === 'type' || fields.includes(key), `${envelope.event.type}.${key}`)
  }
  const dropped = events.filter(e => !PUBLIC_EVENT_FIELDS[e.event.type]).map(e => e.event.type)
  assert.ok(dropped.includes('ACTION_STARTED') || dropped.includes('ACTION_READY') || dropped.includes('PP_CHANGED'), 'private event types exist in the source and are dropped')

  const text = JSON.stringify(view)
  for (const secret of ['owner-a', 'joinAck', 'controller', '"moves"', '"pp"', 'selected', 'actionId', 'serverTimeMs', '"atk"', '"def"', '"spa"', '"spd"', 'lastMoveId', 'PP_CHANGED', 'ACTION_STARTED']) {
    assert.ok(!text.includes(secret), `no ${secret}`)
  }
})

test('hostile or partial input: unknown event types and extra fields are dropped; missing combatants are left out', () => {
  const events = publicEvents([
    { sequence: 1, actionId: 'owner:1', revision: 4, event: { type: 'DAMAGE', combatantId: 'wild-0', sourceId: 'player-0', amount: 3, remainingHp: 7, critical: false, effectiveness: 1, hit: 1, cause: 'move', secret: 'x', seq: 9, atMs: 5 } },
    { sequence: 2, event: { type: 'PP_CHANGED', combatantId: 'player-0', moveId: 84, remaining: 3, max: 30 } },
    { sequence: 3, event: { type: 'COMMAND_REJECTED', reason: 'x' } },
    { sequence: 'x', event: { type: 'FAINTED', combatantId: 'wild-0' } },
    { event: { type: 'FAINTED', combatantId: 'wild-0' } },
    null,
  ])
  assert.deepEqual(events, [{ sequence: 1, event: { type: 'DAMAGE', combatantId: 'wild-0', sourceId: 'player-0', amount: 3, remainingHp: 7, critical: false, effectiveness: 1, hit: 1, cause: 'move' } }])
  assert.equal(publicCombatant(null), null)
  const view = publicBattleView({
    battleId: 'b', encounterId: 'e', areaId: 'a', seq: 1, stage, connected: false, ended: 'fled',
    snapshot: { revision: 2, timeMs: 10, config: { actionBar: { baseSeconds: 2, secret: 1 }, statStages: { minStage: -2, multiplierByStage: { 0: 1, '-1': 0.5, x: 9, 1: 'no' } } }, combatants: { 'wild-0': { level: 3, extra: 'no' }, 'someone-1': { level: 9 } } },
  })
  assert.deepEqual(Object.keys(view.combatants), ['wild-0'])
  assert.equal(view.connected, false)
  assert.deepEqual(view.ended, { outcome: 'fled' })
  assert.equal(view.events, undefined)
  assert.deepEqual(view.config.actionBar, { baseSeconds: 2 })
  assert.deepEqual(view.config.statStages, { minStage: -2, multiplierByStage: { 0: 1, '-1': 0.5 } })
})
