import { describe, expect, it } from 'vitest'
import { Atlas } from '../areas/atlas'
import { createActor, createWalkerState, type Actor } from './actors'
import { WildlandsGame } from './game'
import { PresenceDiagnostics } from '../multiplayer/domain/presenceDiagnostics'
import { AreaTravel } from './travel'
import type { RemotePresenceActor } from '../multiplayer/domain/presence'

type Sent = { kind: 'move' | 'area'; value: string; sequence?: number }
type Harness = Pick<WildlandsGame, 'setAuthoritativeActor'> & {
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
    placedObjects: { isSolid: () => false }, onTownPosition: null, presenceDiagnostics: new PresenceDiagnostics(),
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

  it('treats an unreachable town pocket like collision instead of trapping the player there', () => {
    const { g, sent } = game()
    g.setAuthoritativeActor(self({ tx: 37, ty: 9, moveSequence: 2 }), 'snapshot')
    expect([g.player.tx, g.player.ty]).toEqual([31, 20])
    expect(sent).toEqual([{ kind: 'area', value: 'ciudad-corazon' }])
  })
})

describe('a move the server made (WORLD VISUAL-2: the trainer steps aside for its worker)', () => {
  const settled = (g: Harness) => {
    g.setAuthoritativeActor(self({ tx: 31, ty: 20, moveSequence: 4 }), 'snapshot')
    g.nextMoveSequence = 4
  }

  it('steps one tile to the server’s tile and numbers the next move after the server’s', () => {
    const { g, sent } = game()
    settled(g)
    g.setAuthoritativeActor(self({ tx: 31, ty: 21, dir: 'up', moveSequence: 5 }), 'self')
    expect([g.player.tx, g.player.ty, g.player.dir]).toEqual([31, 21, 'up'])
    // A short step from the old tile, not a jump.
    expect([g.player.fromTx, g.player.fromTy, g.player.progress]).toEqual([31, 20, 0])
    expect(g.nextMoveSequence).toBe(5)
    Object.assign(g, { keys: { sprinting: false } })
    ;(g as unknown as { startStep(actor: Actor): void }).startStep(g.player)
    expect(sent[sent.length - 1]).toEqual({ kind: 'move', value: 'up', sequence: 6 })
  })

  it('with reduced motion, or farther than a tile, it is placed at once', () => {
    const { g } = game()
    settled(g)
    Object.assign(g, { reduceMotion: true })
    g.setAuthoritativeActor(self({ tx: 31, ty: 21, moveSequence: 5 }), 'self')
    expect([g.player.tx, g.player.ty, g.player.progress]).toEqual([31, 21, 1])
    const far = game()
    settled(far.g)
    far.g.setAuthoritativeActor(self({ tx: 33, ty: 20, moveSequence: 5 }), 'self')
    expect([far.g.player.tx, far.g.player.ty, far.g.player.progress]).toEqual([33, 20, 1])
  })
})

describe('CAVES-3: a refused crossing', () => {
  it('stops waiting for the cave and accepts the snapshot of where the actor really is', () => {
    const { g } = game('pradera')
    g.setAuthoritativeActor(self({ areaId: 'pradera', tx: -25, ty: -73, moveSequence: 4 }), 'snapshot')
    // The client stepped onto the mouth and asked for the cave; the service refused.
    Object.assign(g, { pendingPresenceArea: 'cueva-inicial', awaitingAreaSnapshot: true })
    ;(g as unknown as { presenceRejected(reason: string): void }).presenceRejected('area transition denied')
    g.setAuthoritativeActor(self({ areaId: 'pradera', tx: -25, ty: -73, moveSequence: 4 }), 'snapshot')
    expect(g.area.id).toBe('pradera')
    expect([g.player.tx, g.player.ty]).toEqual([-25, -73])
    expect((g as unknown as { pendingPresenceArea: string | null }).pendingPresenceArea).toBeNull()
    expect((g as unknown as { awaitingAreaSnapshot: boolean }).awaitingAreaSnapshot).toBe(false)
  })

  it('any other refusal leaves a pending crossing pending', () => {
    const { g } = game('pradera')
    Object.assign(g, { pendingPresenceArea: 'cueva-inicial', awaitingAreaSnapshot: true })
    ;(g as unknown as { presenceRejected(reason: string): void }).presenceRejected('movement rate denied')
    expect((g as unknown as { pendingPresenceArea: string | null }).pendingPresenceArea).toBe('cueva-inicial')
  })
})

describe('CAVES-4: answers without a move', () => {
  it('a resync (same-area request outside town) is accepted once, where the actor stands, and asks nothing more', () => {
    const { g, sent } = game('pradera')
    g.setAuthoritativeActor(self({ areaId: 'pradera', tx: -5, ty: -67, moveSequence: 9 }), 'snapshot')
    Object.assign(g, { pendingPresenceArea: 'pradera', awaitingAreaSnapshot: true })
    g.setAuthoritativeActor(self({ areaId: 'pradera', tx: -5, ty: -67, moveSequence: 9 }), 'snapshot')
    expect([g.area.id, g.player.tx, g.player.ty]).toEqual(['pradera', -5, -67])
    expect((g as unknown as { awaitingAreaSnapshot: boolean }).awaitingAreaSnapshot).toBe(false)
    expect(sent).toEqual([])
    expect(g.toast).toBeNull()
  })

  it('a refused step (wall, edge or skipped number) is acknowledged with the consumed number: the client adopts it and does not resend', () => {
    const { g, sent } = game('pradera')
    g.setAuthoritativeActor(self({ areaId: 'pradera', tx: -5, ty: -67, moveSequence: 4 }), 'snapshot')
    g.nextMoveSequence = 9
    ;(g as unknown as { presenceRejected(reason: string): void }).presenceRejected('movement sequence denied')
    g.setAuthoritativeActor(self({ areaId: 'pradera', tx: -5, ty: -67, moveSequence: 9 }), 'self')
    expect(g.nextMoveSequence).toBe(9)
    expect([g.player.tx, g.player.ty]).toEqual([-5, -67])
    expect(sent).toEqual([])
  })
})

describe('CAVES-4: no "Ciudad" teleport', () => {
  it('the engine has no recall entry point', () => {
    expect('returnToLobby' in WildlandsGame.prototype).toBe(false)
  })

  it('an old client\'s refused "Ciudad" request from Pradera reconciles to where the actor really is, once', () => {
    const { g, sent } = game('pradera')
    g.setAuthoritativeActor(self({ areaId: 'pradera', tx: -5, ty: -67, moveSequence: 6 }), 'snapshot')
    // What a pre-CAVES-4 bundle did on "Ciudad": wait for the town and ask for it.
    Object.assign(g, { pendingPresenceArea: 'ciudad-corazon', awaitingAreaSnapshot: true })
    ;(g as unknown as { presenceRejected(reason: string): void }).presenceRejected('area transition denied')
    g.setAuthoritativeActor(self({ areaId: 'pradera', tx: -5, ty: -67, moveSequence: 6 }), 'snapshot')
    expect([g.area.id, g.player.tx, g.player.ty]).toEqual(['pradera', -5, -67])
    expect((g as unknown as { pendingPresenceArea: string | null }).pendingPresenceArea).toBeNull()
    expect(sent).toEqual([])
  })
})
