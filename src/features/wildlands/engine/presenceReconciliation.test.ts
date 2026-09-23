import { describe, expect, it } from 'vitest'
import { Atlas } from '../areas/atlas'
import { createActor, createWalkerState, type Actor } from './actors'
import { WildlandsGame } from './game'
import { AreaTravel } from './travel'
import type { RemotePresenceActor } from '../multiplayer/domain/presence'

type Sent = { kind: 'move' | 'area'; value: string; sequence?: number }
type Harness = Pick<WildlandsGame, 'setAuthoritativeActor' | 'returnToLobby'> & {
  area: { id: string; arrival(from: string | null): { tx: number; ty: number } }
  player: Actor
  nextMoveSequence: number
  toast: { text: string } | null
}

const atlas = new Atlas()

function game(areaId: 'ciudad-corazon' | 'pradera' = 'ciudad-corazon'): { g: Harness; sent: Sent[] } {
  const sent: Sent[] = []
  const g = Object.create(WildlandsGame.prototype)
  Object.assign(g, {
    atlas, area: atlas.get(areaId), spectator: false, localPresenceActorId: null, pendingPresenceArea: null,
    awaitingAreaSnapshot: false, receivedAuthoritativeActor: false, nextMoveSequence: 0, walker: createWalkerState(),
    nav: { cancel() {} }, travel: new AreaTravel(), companion: { reset() {} }, camX: 0, camY: 0, seconds: 0, toast: null,
    placedObjects: { isSolid: () => false }, onTownPosition: null,
    player: createActor({ id: 'player', kind: 'player', habitat: 'any', tx: 0, ty: 0 }),
    presence: {
      move: (value: string, _running: boolean, sequence: number) => sent.push({ kind: 'move', value, sequence }),
      changeArea: (value: string) => sent.push({ kind: 'area', value }),
    },
  })
  return { g, sent }
}

const self = (patch: Partial<RemotePresenceActor>): RemotePresenceActor => ({
  id: 'me', areaId: 'ciudad-corazon', tx: 31, ty: 20, username: 'Me', characterId: 'lucas', companionId: null,
  dir: 'down', speed: 3.75, moveSequence: 0, ...patch,
})

describe('presence reconciliation around area requests', () => {
  it('ignores a pre-reset move ack after "Ciudad" until the reset snapshot arrives', () => {
    const { g } = game()
    g.setAuthoritativeActor(self({ tx: 34, ty: 20, moveSequence: 3 }), 'snapshot')
    g.nextMoveSequence = 3
    g.returnToLobby()
    // The ack for seq 3 was already in flight and still describes (34, 20).
    g.setAuthoritativeActor(self({ tx: 34, ty: 20, moveSequence: 3 }), 'self')
    expect([g.player.tx, g.player.ty]).toEqual([31, 20])
    g.setAuthoritativeActor(self({ tx: 31, ty: 20, moveSequence: 3 }), 'snapshot')
    expect([g.player.tx, g.player.ty]).toEqual([31, 20])
  })

  it('keeps the move sequence across a reset so steps taken before the reply are not replays', () => {
    const { g, sent } = game()
    g.setAuthoritativeActor(self({ moveSequence: 7 }), 'snapshot')
    g.returnToLobby()
    expect(g.nextMoveSequence).toBe(7)
    expect(sent).toEqual([{ kind: 'area', value: 'ciudad-corazon' }])
  })

  it('repairs a solid authoritative tile once and then accepts the corrected placement', () => {
    const { g, sent } = game('pradera')
    const arrival = g.area.arrival(null)
    // The pre-fix server placed Pradera arrivals on the town gate tile (8, 41): solid here.
    g.setAuthoritativeActor(self({ areaId: 'pradera', tx: 8, ty: 41, moveSequence: 5 }), 'snapshot')
    expect(g.toast?.text).toContain('punto seguro')
    expect(sent).toEqual([{ kind: 'area', value: 'pradera' }])
    expect(g.nextMoveSequence).toBe(5)
    g.toast = null
    g.setAuthoritativeActor(self({ areaId: 'pradera', tx: arrival.tx, ty: arrival.ty, moveSequence: 5 }), 'snapshot')
    expect(g.toast).toBeNull()
    expect(sent).toHaveLength(1)
    expect([g.player.tx, g.player.ty]).toEqual([arrival.tx, arrival.ty])
  })
})
