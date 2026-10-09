import assert from 'node:assert/strict'
import { ECO_PROTOCOL } from './ecoPopulation.js'
import { prepareBundledBattles } from './ecoBattles.js'
import { createDemoSkillPolicy } from './demoSkillPolicy.js'
import { createStaticOwnership } from './pokemonOwnership.js'
import { seededRandom } from './wildPopulation.js'
import { WORLD_MESSAGE, WORLD_PROTOCOL } from './worldProtocol.js'
import { WorldRoom } from './worldRoom.js'
import { fakeClient, lastMessage, manualClock, messagesOf } from './testing.js'

// Test kit of the ECO test battles (ECO-GAMEPLAY-2), shared by ecoBattles.test.js and
// ecoBattles.spectators.test.js (ECO-BATTLE-SPECTATORS-1): a WorldRoom with the ECO experiment,
// scripted or real battles, and the room's tick + flush.

export const PRADERA = { tx: -5, ty: -69 }
export const TICK = 50

/** A scripted battle factory: each battle's outcome is set by the test (`battle.result`). */
export function scriptedBattles() {
  const made = []
  const battles = {
    fixture: { label: 'fixture de prueba' },
    fail: false,
    start(input) {
      if (battles.fail) return { ok: false, reason: 'battle-unavailable' }
      const battle = {
        ...input, elapsed: 0, result: 'ongoing', submits: [], advances: [],
        advance(ms) {
          battle.advances.push(ms)
          if (Number.isFinite(ms) && ms > 0 && battle.result === 'ongoing') battle.elapsed += ms
          return { events: ms > 0 ? [{ seq: battle.advances.length }] : [], snapshot: battle.snapshot(), outcome: battle.result }
        },
        submit(controllerId, payload) { battle.submits.push({ controllerId, payload }); return { kind: 'accepted', actionId: payload.actionId, revision: battle.submits.length } },
        snapshot: () => ({ battleId: input.battleId, timeMs: battle.elapsed }),
        joinAck: controllerId => ({ battleId: input.battleId, controllerId, nextActionSequence: battle.submits.length + 1 }),
        outcome: () => battle.result,
        elapsedMs: () => battle.elapsed,
      }
      made.push(battle)
      return { ok: true, battle }
    },
  }
  return { battles, made }
}

let ids = 0
const newId = () => { ids++; return `eco-battle-t${ids}-${ids.toString(16).padStart(8, '0')}` }

export async function setup({ prepare, ecoExperiment = true, random = () => 0.25, playerData = null } = {}) {
  const scripted = scriptedBattles()
  const clock = manualClock()
  const actors = new Map()
  const sockets = new Map()
  const world = new WorldRoom({
    skills: createDemoSkillPolicy({ durationMs: 3_000 }), ownership: createStaticOwnership({}), now: clock.now, playerData,
    lookupActor: id => actors.get(id) ?? null, clientForPlayer: id => sockets.get(id) ?? null,
    ecoExperiment, ecoRandom: seededRandom(20261007), log: () => {},
    ecoBattles: { prepare: prepare ?? (async () => ({ ok: true, battles: scripted.battles })), random, newId },
  })
  if (playerData) await world.start()
  await world.ecoBattles?.ready
  /** A player (or guest) socket joining and receiving its world snapshot, like the room does. */
  const join = (id, { areaId = 'pradera', eco = true, guest = false, actor: existing } = {}) => {
    const client = fakeClient(id)
    const actor = guest ? null : (existing ?? { id, areaId, tx: PRADERA.tx, ty: PRADERA.ty })
    if (actor) { actors.set(id, actor); sockets.set(id, client) }
    world.join(client, { worldProtocol: WORLD_PROTOCOL, ...(eco ? { ecoProtocol: ECO_PROTOCOL } : {}) }, guest ? { kind: 'guest' } : { kind: 'player', userId: id, token: null })
    world.snapshot(client, actor ?? { areaId, tx: PRADERA.tx, ty: PRADERA.ty })
    return { id, client, actor }
  }
  /** The room's 50 ms tick + flush, for `ms` of server time. */
  const run = (ms, until = () => false) => {
    for (let t = 0; t < ms; t += TICK) {
      clock.advance(TICK)
      world.tick()
      world.flush()
      if (until()) return true
    }
    return false
  }
  const ecoOf = client => lastMessage(client, WORLD_MESSAGE.ECO)?.eco ?? lastMessage(client, WORLD_MESSAGE.SNAPSHOT)?.eco
  /** Populates Pradera (someone must be watching) and returns a live encounter. */
  const populated = viewer => { assert.ok(run(90_000, () => (ecoOf(viewer.client)?.encounters.length ?? 0) > 1), 'Pradera fills'); return ecoOf(viewer.client).encounters[0] }
  /** Stands `player` `distance` tiles (Chebyshev) from the encounter's CURRENT tile. */
  const standNear = (player, encounterId, distance = 0) => {
    const e = world.eco.encounter(encounterId)
    player.actor.areaId = e.areaId; player.actor.tx = e.tx + distance; player.actor.ty = e.ty
  }
  const engage = (player, encounterId, requestId = 1) => world.ecoEngage(player.actor, { requestId, encounterId }, player.client)
  const action = (player, battleId, sequence, intent = { kind: 'useMove', combatantId: 'player-0', moveId: 84, targetId: 'wild-0' }, actionId = `${player.id}:${sequence}`) => {
    const versions = world.ecoBattles.byPlayer.get(player.id)?.battle.snapshot() ?? {}
    return world.ecoBattleAction(player.actor, { actionId, battleId, catalogVersion: versions.catalogVersion ?? 'x', battleRulesVersion: versions.battleRulesVersion ?? 'x', intent }, player.client)
  }
  const reservation = playerId => world.ecoBattles.byPlayer.get(playerId)
  return { world, clock, join, run, ecoOf, populated, standNear, engage, action, reservation, scripted, actors, sockets }
}

export const ended = client => messagesOf(client, WORLD_MESSAGE.ECO_BATTLE_END)

export async function realCycle(speciesId) {
  const prepared = await prepareBundledBattles()
  assert.equal(prepared.ok, true)
  const s = await setup({
    random: () => 7.5 / 0x7fffffff, // seed 7
    prepare: async () => ({ ok: true, battles: { fixture: prepared.battles.fixture, start: input => (assert.equal(input.seed, 7), prepared.battles.start({ ...input, speciesId })) } }),
  })
  const a = s.join('eco-a')
  const target = s.populated(a)
  s.standNear(a, target.id)
  const { battle } = s.engage(a, target.id)
  const elapsed = () => s.reservation('eco-a')?.battle.elapsedMs() ?? null
  return { s, a, target, battle, elapsed }
}
