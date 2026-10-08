// ECO-GAMEPLAY-2 (experimental): the client's side of a test battle decides nothing. It sends an
// engage, the player's move choices as the core's TransportAction (with the server's JoinAck
// numbering), a flee; it shows what the server answers and ignores anything about another battle.

import { describe, expect, it, vi } from 'vitest'
import type { EcoBattleInfo } from '../../../../services/realtime/src/world/worldProtocol.js'
import { WORLD_MESSAGE } from '../../../../services/realtime/src/world/worldProtocol.js'
import type { ClientBattleSnapshot } from '../../battle/authority'
import type { PokemonInfo } from '../../wildlands/engine/actors'
import { EcoBattleSession } from './ecoBattleSession'
import { SharedWorld } from './sharedWorld'

const world = () => new SharedWorld(async () => null, id => ({ id, name: String(id), shiny: false, frames: {} }) as unknown as PokemonInfo)
const snap = (revision: number, timeMs: number) => ({ battleId: 'eco-battle-a-0000000a', revision, timeMs, catalogVersion: 'cat-1', battleRulesVersion: 'rules-1', combatants: {} }) as unknown as ClientBattleSnapshot
const info = (next = 1, expiresInMs = 120_000): EcoBattleInfo => ({
  battleId: 'eco-battle-a-0000000a', speciesId: 19, fixture: true, fixtureLabel: 'fixture de prueba', expiresInMs, snapshot: snap(1, 0),
  joinAck: { battleId: 'eco-battle-a-0000000a', controllerId: 'player-a', currentRevision: 1, nextActionSequence: next, catalogVersion: 'cat-1', battleRulesVersion: 'rules-1', controlledCombatantIds: ['player-0'] },
})

function connected() {
  const w = world()
  const sent: [string, unknown][] = []
  w.attach((type, payload) => sent.push([type, payload]))
  let now = 1_000
  const session = new EcoBattleSession(w, () => now)
  return { w, sent, session, advance: (ms: number) => { now += ms } }
}

describe('EcoBattleSession', () => {
  it('engages by individual id and enters the battle the server answers', () => {
    const { w, sent, session } = connected()
    session.engage('eco-n:pradera:nest:1:0')
    expect(sent).toEqual([[WORLD_MESSAGE.ECO_ENGAGE, { requestId: 1, encounterId: 'eco-n:pradera:nest:1:0' }]])
    expect(session.view.phase).toBe('engaging')
    session.engage('eco-n:pradera:nest:1:1') // one request at a time
    expect(sent).toHaveLength(1)
    w.ecoBattleMessage(WORLD_MESSAGE.ECO_ENGAGE_RESULT, { requestId: 1, encounterId: 'eco-n:pradera:nest:1:0', ok: true, battle: info() })
    expect(session.view).toMatchObject({ phase: 'battle', battleId: 'eco-battle-a-0000000a', fixtureLabel: 'fixture de prueba', connected: true })
  })

  it('a refusal (busy, too far…) is shown; an answer to another request is ignored', () => {
    const { w, session } = connected()
    session.engage('x')
    w.ecoBattleMessage(WORLD_MESSAGE.ECO_ENGAGE_RESULT, { requestId: 99, encounterId: 'x', ok: true, battle: info() })
    expect(session.view.phase).toBe('engaging')
    w.ecoBattleMessage(WORLD_MESSAGE.ECO_ENGAGE_RESULT, { requestId: 1, encounterId: 'x', ok: false, reason: 'busy' })
    expect(session.view).toEqual({ phase: 'refused', encounterId: 'x', reason: 'busy' })
    session.dismiss()
    expect(session.view.phase).toBe('idle')
  })

  it('moves are the core\'s TransportAction, numbered from the server\'s JoinAck; capture and items do not exist here', () => {
    const { w, sent, session } = connected()
    session.engage('x')
    w.ecoBattleMessage(WORLD_MESSAGE.ECO_ENGAGE_RESULT, { requestId: 1, encounterId: 'x', ok: true, battle: info(4) })
    session.useMove(84, false)
    session.useMove(104, true)
    expect(sent.slice(1)).toEqual([
      [WORLD_MESSAGE.ECO_BATTLE_ACTION, { actionId: 'player-a:4', battleId: 'eco-battle-a-0000000a', catalogVersion: 'cat-1', battleRulesVersion: 'rules-1', intent: { kind: 'useMove', combatantId: 'player-0', moveId: 84, targetId: 'wild-0' } }],
      [WORLD_MESSAGE.ECO_BATTLE_ACTION, { actionId: 'player-a:5', battleId: 'eco-battle-a-0000000a', catalogVersion: 'cat-1', battleRulesVersion: 'rules-1', intent: { kind: 'useMove', combatantId: 'player-0', moveId: 104, targetId: 'player-0' } }],
    ])
    expect('capture' in session).toBe(false)
    expect('useItem' in session).toBe(false)
  })

  it('shows refusals, follows the server\'s count after STALE_ACTION, and never takes an older snapshot', () => {
    const { w, sent, session } = connected()
    session.engage('x')
    w.ecoBattleMessage(WORLD_MESSAGE.ECO_ENGAGE_RESULT, { requestId: 1, encounterId: 'x', ok: true, battle: info() })
    w.ecoBattleMessage(WORLD_MESSAGE.ECO_BATTLE, { battleId: 'eco-battle-a-0000000a', events: [], result: { kind: 'rejected', reason: 'STALE_ACTION', actionId: 'player-a:1', revision: 3, nextActionSequence: 7 } })
    expect(session.view).toMatchObject({ lastRejection: 'STALE_ACTION' })
    session.useMove(84, false)
    expect((sent[sent.length - 1]?.[1] as { actionId: string }).actionId).toBe('player-a:7')
    w.ecoBattleMessage(WORLD_MESSAGE.ECO_BATTLE, { battleId: 'eco-battle-a-0000000a', events: [], snapshot: snap(5, 2_000) })
    w.ecoBattleMessage(WORLD_MESSAGE.ECO_BATTLE, { battleId: 'eco-battle-a-0000000a', events: [], snapshot: snap(4, 1_500) })
    expect(session.view).toMatchObject({ snapshot: { revision: 5 }, expiresInMs: 118_000 })
    // another battle's messages are ignored
    w.ecoBattleMessage(WORLD_MESSAGE.ECO_BATTLE, { battleId: 'eco-battle-b-0000000b', events: [], snapshot: snap(9, 9_000) })
    w.ecoBattleMessage(WORLD_MESSAGE.ECO_BATTLE_END, { battleId: 'eco-battle-b-0000000b', encounterId: 'y', outcome: 'victory', retired: true, snapshot: snap(9, 9_000) })
    expect(session.view).toMatchObject({ phase: 'battle', snapshot: { revision: 5 } })
  })

  it('the end is the server\'s: victory (retired) or a release; flee only asks', () => {
    const { w, sent, session } = connected()
    session.engage('x')
    w.ecoBattleMessage(WORLD_MESSAGE.ECO_ENGAGE_RESULT, { requestId: 1, encounterId: 'x', ok: true, battle: info() })
    session.flee()
    expect(sent[sent.length - 1]).toEqual([WORLD_MESSAGE.ECO_FLEE, { battleId: 'eco-battle-a-0000000a' }])
    expect(session.view.phase).toBe('battle') // nothing changes until the server answers
    w.ecoBattleMessage(WORLD_MESSAGE.ECO_BATTLE_END, { battleId: 'eco-battle-a-0000000a', encounterId: 'x', outcome: 'fled', retired: false, snapshot: snap(2, 500) })
    expect(session.view).toMatchObject({ phase: 'ended', outcome: 'fled', retired: false })
    expect(session.useMove(84, false)).toBe(false)
  })

  it('a disconnection pauses; the resume after the next snapshot continues the same battle; no resume means released', () => {
    const { w, sent, session, advance } = connected()
    session.engage('x')
    w.ecoBattleMessage(WORLD_MESSAGE.ECO_ENGAGE_RESULT, { requestId: 1, encounterId: 'x', ok: true, battle: info(1, 60_000) })
    advance(10_000)
    expect(session.remainingMs()).toBe(50_000)
    w.detach()
    expect(session.view).toMatchObject({ phase: 'battle', connected: false })
    advance(5_000)
    expect(session.remainingMs()).toBe(50_000) // paused
    expect(session.useMove(84, false)).toBe(false)
    w.attach((type, payload) => sent.push([type, payload]))
    w.snapshot({ now: 2, areaId: 'pradera', chunks: [], nodes: [] })
    w.ecoBattleMessage(WORLD_MESSAGE.ECO_ENGAGE_RESULT, { requestId: null, encounterId: 'x', ok: true, resumed: true, battle: info(3, 50_000) })
    expect(session.view).toMatchObject({ phase: 'battle', connected: true, battleId: 'eco-battle-a-0000000a' })
    session.useMove(84, false)
    expect((sent[sent.length - 1]?.[1] as { actionId: string }).actionId).toBe('player-a:3')
    // gone past the grace: the rejoin snapshot comes with no resume
    w.detach()
    w.attach(() => {})
    w.snapshot({ now: 3, areaId: 'pradera', chunks: [], nodes: [] })
    expect(session.view).toMatchObject({ phase: 'ended', outcome: 'disconnected', retired: false })
  })

  it('offline or unanswered engages resolve locally as refused (the server still decides)', () => {
    vi.useFakeTimers()
    try {
      const offline = new EcoBattleSession(world())
      offline.engage('x')
      expect(offline.view).toEqual({ phase: 'refused', encounterId: 'x', reason: 'offline' })
      const { session } = connected()
      session.engage('x')
      vi.advanceTimersByTime(8_000)
      expect(session.view).toEqual({ phase: 'refused', encounterId: 'x', reason: 'no-answer' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('without a session SharedWorld drops battle messages; dispose unhooks it', () => {
    const w = world()
    expect(() => w.ecoBattleMessage(WORLD_MESSAGE.ECO_BATTLE, {})).not.toThrow()
    const session = new EcoBattleSession(w)
    const seen: string[] = []
    session.subscribe(view => seen.push(view.phase))
    session.dispose()
    w.ecoBattleMessage(WORLD_MESSAGE.ECO_ENGAGE_RESULT, { requestId: null, encounterId: 'x', ok: true, resumed: true, battle: info() })
    expect(seen).toEqual(['idle'])
  })
})
