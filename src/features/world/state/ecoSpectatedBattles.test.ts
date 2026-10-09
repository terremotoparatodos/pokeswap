// ECO-BATTLE-SPECTATORS-1: the spectator side keeps the latest accepted public view of each battle
// of this area and nothing it was not told. Through the real SharedWorld routing:
//   - duplicates (also deserialized anew) and late messages change nothing: no bar goes back, no
//     effect repeats, no end is prolonged, and a finished battle never reopens;
//   - pause and resume restart the interpolation origin even with the same revision;
//   - arrival, area change and disconnection drop everything; only the server's re-send comes back;
//   - another area's battle and this player's own battle are never watched.

import { describe, expect, it } from 'vitest'
import type { EcoPublicBattle } from '../../../../services/realtime/src/world/worldProtocol.js'
import { WORLD_MESSAGE as M } from '../../../../services/realtime/src/world/worldProtocol.js'
import type { PokemonInfo } from '../../wildlands/engine/actors'
import { ECO_SPECTATOR_END_MS, EcoSpectatedBattles, type SpectatedBattle } from './ecoSpectatedBattles'
import { SharedWorld } from './sharedWorld'

const combatant = (currentHp: number, actionElapsedMs = 400) => ({ speciesId: 25, level: 12, maxHp: 34, currentHp, majorStatus: 'none', confused: false, spe: 60, speStage: 0, actionElapsedMs, cooldownMultiplier: 1 })
const view = (over: Partial<EcoPublicBattle> & { seq: number }): EcoPublicBattle => ({
  battleId: 'b1', encounterId: 'eco-n:pradera:soto:1:0', areaId: 'pradera', revision: 1, timeMs: 0, connected: true,
  stage: { owner: { tx: 0, ty: 0 }, wild: { tx: 3, ty: 0 } },
  config: { actionBar: { baseSeconds: 2.6, referenceSpeed: 60, minSeconds: 1.4, maxSeconds: 4, paralysisMultiplier: 2 }, statStages: { minStage: -2, maxStage: 2, multiplierByStage: { 0: 1 } } },
  combatants: { 'player-0': combatant(34), 'wild-0': combatant(20) },
  ...over,
})
const damage = (sequence: number) => ({ sequence, event: { type: 'DAMAGE' as const, combatantId: 'wild-0', sourceId: 'player-0', amount: 3, remainingHp: 17, critical: false, effectiveness: 1, hit: 1, cause: 'move' } })

function setup(own: string | null = null) {
  const w = new SharedWorld(async () => null, id => ({ id, name: String(id), shiny: false, frames: {} }) as unknown as PokemonInfo)
  w.attach(() => {})
  w.snapshot({ now: 1, areaId: 'pradera', chunks: [], nodes: [] })
  let now = 1_000
  const timers: { at: number; run: () => void; cancelled: boolean }[] = []
  const store = new EcoSpectatedBattles(w, () => now, () => own, (run, ms) => {
    const timer = { at: now + ms, run, cancelled: false }
    timers.push(timer)
    return () => { timer.cancelled = true }
  })
  const lists: (readonly SpectatedBattle[])[] = []
  const events: [string, number[]][] = []
  store.subscribe(list => lists.push(list))
  store.onEvents((battleId, es) => events.push([battleId, es.map(e => e.sequence)]))
  const send = (payload: unknown) => w.ecoBattleMessage(M.ECO_BATTLE_PUBLIC, JSON.parse(JSON.stringify(payload)))
  const advance = (ms: number) => {
    now += ms
    for (const t of timers) if (!t.cancelled && t.at <= now) { t.cancelled = true; t.run() }
  }
  const one = () => store.list()[0]
  return { w, store, send, advance, one, lists, events, timers, now: () => now }
}

describe('EcoSpectatedBattles', () => {
  it('watches this area\'s battles only — never another area\'s, never its own, never a malformed message', () => {
    const s = setup('mine')
    s.send(view({ seq: 1, areaId: 'cueva-inicial' }))
    s.send(view({ seq: 1, battleId: 'mine' }))
    for (const bad of [null, 7, { ...view({ seq: 1 }), seq: 'x' }, { ...view({ seq: 1 }), stage: { owner: {} } }, { ...view({ seq: 1 }), events: 'x' }]) s.send(bad)
    expect(s.store.list()).toEqual([])
    s.send(view({ seq: 1 }))
    expect(s.store.list().map(b => b.battleId)).toEqual(['b1'])
    // the owner's own session never receives the public message
    s.w.ecoBattleMessage(M.ECO_BATTLE, { battleId: 'b1', events: [] })
    expect(s.store.list()).toHaveLength(1)
  })

  it('a duplicate (deserialized anew) or a late message changes nothing: no bar back, no effect again', () => {
    const s = setup()
    s.send(view({ seq: 1 }))
    s.send(view({ seq: 2, revision: 4, timeMs: 900, events: [damage(5), damage(6)], combatants: { 'player-0': combatant(34, 100), 'wild-0': combatant(14, 100) } }))
    const taken = s.one()
    expect([taken.view.revision, taken.receivedAt]).toEqual([4, 1_000])
    s.advance(600)
    s.send(view({ seq: 2, revision: 4, timeMs: 900, events: [damage(5), damage(6)], combatants: { 'player-0': combatant(34, 100), 'wild-0': combatant(14, 100) } }))
    s.send(view({ seq: 1, revision: 1, timeMs: 0 }))
    expect(s.one()).toBe(taken)
    expect(s.events).toEqual([['b1', [5, 6]]])
    // a newer message that repeats old events alongside new ones: only the new ones are drawn
    s.send(view({ seq: 3, revision: 6, timeMs: 1_400, events: [damage(6), damage(7)] }))
    expect(s.events).toEqual([['b1', [5, 6]], ['b1', [7]]])
    expect([s.one().view.revision, s.one().receivedAt]).toEqual([6, 1_600])
  })

  it('pause and resume restart the interpolation origin although the revision does not change', () => {
    const s = setup()
    s.send(view({ seq: 1, revision: 3 }))
    s.advance(700)
    s.send(view({ seq: 2, revision: 3, connected: false }))
    expect([s.one().view.connected, s.one().receivedAt]).toEqual([false, 1_700])
    s.advance(5_000)
    s.send(view({ seq: 3, revision: 3, connected: true }))
    expect([s.one().view.connected, s.one().receivedAt, s.one().view.revision]).toEqual([true, 6_700, 3])
    // a later message at the same revision and connection (e.g. a resend): the origin stays
    s.advance(300)
    s.send(view({ seq: 4, revision: 3, connected: true }))
    expect(s.one().receivedAt).toBe(6_700)
  })

  it('an end shows for 1.5 s and goes; a duplicate end does not prolong it; nothing reopens a finished battle', () => {
    const s = setup()
    s.send(view({ seq: 1 }))
    s.send(view({ seq: 2, revision: 5, ended: { outcome: 'fled' } }))
    expect(s.one().ended).toEqual({ outcome: 'fled', at: 1_000 })
    s.advance(1_000)
    s.send(view({ seq: 2, revision: 5, ended: { outcome: 'fled' } }))
    s.send(view({ seq: 3, revision: 6, ended: { outcome: 'victory' } }))
    expect(s.one().ended).toEqual({ outcome: 'fled', at: 1_000 })
    expect(s.timers.filter(t => !t.cancelled)).toHaveLength(1)
    s.advance(ECO_SPECTATOR_END_MS - 1_000)
    expect(s.store.list()).toEqual([])
    // late messages of that battle, even after an area change: never again
    s.send(view({ seq: 9, revision: 9 }))
    s.w.snapshot({ now: 2, areaId: 'pradera', chunks: [], nodes: [] })
    s.send(view({ seq: 10, revision: 10, events: [damage(20)] }))
    expect(s.store.list()).toEqual([])
    expect(s.events).toEqual([])
  })

  it('leaving drops everything (its end timers too); coming back shows only what the server sends again', () => {
    const s = setup()
    s.send(view({ seq: 4, revision: 8, events: [damage(3)] }))
    s.send(view({ seq: 1, battleId: 'b2', encounterId: 'eco-n:pradera:soto:1:1', ended: { outcome: 'victory' } }))
    expect(s.store.list()).toHaveLength(2)
    s.w.snapshot({ now: 2, areaId: 'cueva-inicial', chunks: [], nodes: [] })
    expect(s.store.list()).toEqual([])
    expect(s.timers.every(t => t.cancelled)).toBe(true)
    s.send(view({ seq: 5, revision: 9 })) // Pradera's, arriving late: another area now
    expect(s.store.list()).toEqual([])
    s.w.snapshot({ now: 3, areaId: 'pradera', chunks: [], nodes: [] })
    expect(s.store.list(), 'no cached scene comes back by itself').toEqual([])
    // the server's re-send of what is still running, as it is now (its seq may equal the last one seen)
    s.send(view({ seq: 5, revision: 12 }))
    expect([s.one().view.revision, s.one().receivedAt]).toEqual([12, 1_000])
    expect(s.events).toEqual([['b1', [3]]])
  })

  it('a lost connection drops everything too; two battles at once are kept apart', () => {
    const s = setup()
    s.send(view({ seq: 1, events: [damage(1)] }))
    s.send(view({ seq: 1, battleId: 'b2', encounterId: 'eco-n:pradera:soto:1:1', events: [damage(1)] }))
    s.send(view({ seq: 2, battleId: 'b2', encounterId: 'eco-n:pradera:soto:1:1', revision: 2, events: [damage(2)] }))
    expect(s.store.list().map(b => [b.battleId, b.view.seq])).toEqual([['b1', 1], ['b2', 2]])
    expect(s.events).toEqual([['b1', [1]], ['b2', [1]], ['b2', [2]]])
    s.w.detach()
    expect(s.store.list()).toEqual([])
  })

  // ── Review of 3decc3d: S1 (the seen area runs ahead of the world snapshot), S2 (one scene per individual) ──

  it('S1 the area the player sees changes before the snapshot: its battles and their end timers go at once; late messages do not bring them back; coming back waits for the server', () => {
    const s = setup()
    s.store.setViewArea('pradera')
    s.send(view({ seq: 1, events: [damage(1)] }))
    s.send(view({ seq: 1, battleId: 'b2', encounterId: 'eco-n:pradera:soto:1:1', ended: { outcome: 'fled' } }))
    expect(s.store.list()).toHaveLength(2)
    s.store.setViewArea('cueva-inicial') // the game entered the cave; the server has not answered yet
    expect(s.store.list()).toEqual([])
    expect(s.timers.every(t => t.cancelled)).toBe(true)
    s.send(view({ seq: 2, revision: 2, events: [damage(2)] })) // Pradera's, still flowing to this socket
    expect(s.store.list()).toEqual([])
    expect(s.events).toEqual([['b1', [1]]])
    // back in Pradera before any snapshot (e.g. a refused crossing): nothing until the server re-sends
    s.store.setViewArea('pradera')
    s.send(view({ seq: 3, revision: 3, events: [damage(3)] }))
    expect(s.store.list()).toEqual([])
    s.w.snapshot({ now: 2, areaId: 'pradera', chunks: [], nodes: [] })
    s.send(view({ seq: 3, revision: 4 }))
    expect(s.store.list().map(b => [b.battleId, b.view.revision])).toEqual([['b1', 4]])
    expect(s.events).toEqual([['b1', [1]]])
  })

  it('S1 the snapshot may also come first: the new area’s battles wait, unseen, until the player sees that area', () => {
    const s = setup()
    s.store.setViewArea('pradera')
    s.w.snapshot({ now: 2, areaId: 'cueva-inicial', chunks: [], nodes: [] })
    s.send(view({ seq: 1, areaId: 'cueva-inicial', events: [damage(1)] }))
    expect(s.store.list()).toEqual([])
    expect(s.events).toEqual([])
    s.store.setViewArea('cueva-inicial')
    expect(s.store.list().map(b => b.areaId)).toEqual(['cueva-inicial'])
  })

  it('S2 a new battle against the same individual replaces the earlier one still showing its end; distinct individuals stay side by side', () => {
    const s = setup()
    s.store.setViewArea('pradera')
    s.send(view({ seq: 1 }))
    s.send(view({ seq: 1, battleId: 'other', encounterId: 'eco-n:pradera:soto:1:9' }))
    s.send(view({ seq: 2, revision: 5, ended: { outcome: 'fled' } }))
    s.advance(300)
    s.send(view({ seq: 1, battleId: 'b1-again', revision: 1, stage: { owner: { tx: 2, ty: 0 }, wild: { tx: 3, ty: 0 } } }))
    expect(s.store.list().map(b => b.battleId).sort()).toEqual(['b1-again', 'other'])
    expect(s.timers.filter(t => !t.cancelled)).toHaveLength(0)
    // the replaced battle never comes back, whatever arrives for it
    s.send(view({ seq: 9, revision: 9 }))
    s.advance(ECO_SPECTATOR_END_MS)
    expect(s.store.list().map(b => b.battleId).sort()).toEqual(['b1-again', 'other'])
  })

  it('dispose unhooks it from the world', () => {
    const s = setup()
    s.store.dispose()
    s.send(view({ seq: 1 }))
    expect(s.store.list()).toEqual([])
  })
})
