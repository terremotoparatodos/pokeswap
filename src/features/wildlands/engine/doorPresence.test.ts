import { describe, expect, it } from 'vitest'
import { Atlas } from '../areas/atlas'
import { createActor, createWalkerState, driveWalker, isMoving, type Actor, type MoveRules } from './actors'
import type { Dir } from './characters'
import { Entrances, type BuildingDoor } from './doors'
import { WildlandsGame } from './game'
import { AreaTravel } from './travel'
import { PresenceDiagnostics } from '../multiplayer/domain/presenceDiagnostics'
import type { RemotePresenceActor } from '../multiplayer/domain/presence'
import { applyMove } from '../../../../services/realtime/src/presence/movement.js'

// TRANS-1: a building is not an area. The player never leaves the street, so
// leaving must be something the presence service sees, or the service stays
// on the door tile and the next step lands inside the building.

type Harness = {
  area: { id: string; doors?: readonly BuildingDoor[] }
  player: Actor
  walker: ReturnType<typeof createWalkerState>
  nextMoveSequence: number
  presenceDiagnostics: PresenceDiagnostics
  placeAtDoor: WildlandsGame['placeAtDoor']
  setAuthoritativeActor: WildlandsGame['setAuthoritativeActor']
  startStep(player: Actor): void
  solidAt(tx: number, ty: number): boolean
}

const atlas = new Atlas()
const town = atlas.get('ciudad-corazon')
const door = town.doors![0]

function game({ presence = true } = {}) {
  const sent: string[] = []
  // The service, reduced to what it does with a move: apply it to its own tile.
  const server = {
    id: 'me', areaId: 'ciudad-corazon', tx: door.door.tx, ty: door.door.ty, username: 'Me', characterId: 'lucas',
    companionId: null, dir: 'up', speed: 3.75, moveSequence: 3, moveTokens: 15, moveTokensAt: 0,
  }
  const g = Object.create(WildlandsGame.prototype) as Harness
  let clock = 0
  const ack = () => g.setAuthoritativeActor({ ...server } as RemotePresenceActor, 'self')
  Object.assign(g, {
    atlas, area: town, spectator: false, localPresenceActorId: 'me', pendingPresenceArea: null,
    awaitingAreaSnapshot: false, receivedAuthoritativeActor: presence, nextMoveSequence: 3, walker: createWalkerState(),
    nav: { cancel() {} }, travel: new AreaTravel(), companion: { reset() {} }, camX: 0, camY: 0, seconds: 0, toast: null,
    keys: { sprinting: false }, entrances: new Entrances(), placedObjects: { isSolid: () => false },
    onTownPosition: null, presenceDiagnostics: new PresenceDiagnostics(),
    player: createActor({ id: 'player', kind: 'player', habitat: 'any', tx: door.door.tx, ty: door.door.ty, dir: 'up' }),
    presence: presence ? {
      move: (dir: Dir, running: boolean, sequence: number) => {
        sent.push(`move ${dir} #${sequence}`)
        clock += 1000
        applyMove(server, dir, clock, running, sequence)
        ack()
      },
      changeArea: (areaId: string) => sent.push(`area ${areaId}`),
    } : null,
  })
  const rules: MoveRules = { blocked: (_a, tx, ty) => g.solidAt(tx, ty), occupied: () => false }
  const walk = (dir: Dir | null, seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 60) driveWalker(g.player, dir, 1 / 60, rules, g.walker, undefined, false, p => g.startStep(p))
  }
  return { g, sent, server, walk }
}

describe('leaving a building under presence', () => {
  for (const dir of ['left', 'right', 'down'] as const) {
    it(`keeps the service on the player's tile when walking ${dir} after leaving`, () => {
      const { g, sent, server, walk } = game()
      g.placeAtDoor(door.feature)
      walk(null, 0.5)
      walk(dir, 0.8)
      walk(null, 0.5)
      expect(g.presenceDiagnostics.snapshot().solidRecoveries).toBe(0)
      expect(sent.some(line => line.startsWith('area'))).toBe(false)
      expect([server.tx, server.ty]).toEqual([g.player.tx, g.player.ty])
      expect(g.solidAt(server.tx, server.ty)).toBe(false)
    })
  }

  it('steps out of the doorway as one announced move, animated rather than placed', () => {
    const { g, sent, server } = game()
    g.placeAtDoor(door.feature)
    expect(sent).toEqual(['move down #4'])
    expect(isMoving(g.player)).toBe(true)
    expect([g.player.fromTx, g.player.fromTy, g.player.tx, g.player.ty]).toEqual([door.door.tx, door.door.ty, door.exit.tx, door.exit.ty])
    expect([server.tx, server.ty]).toEqual([door.exit.tx, door.exit.ty])
  })

  it('is a plain placement without presence authority', () => {
    const { g, sent } = game({ presence: false })
    g.placeAtDoor(door.feature)
    expect(sent).toEqual([])
    expect(isMoving(g.player)).toBe(false)
    expect([g.player.tx, g.player.ty, g.player.dir]).toEqual([door.exit.tx, door.exit.ty, door.exit.dir])
  })

  it('still sends a genuinely invalid authoritative tile to the safe point', () => {
    const { g, sent } = game()
    const wall = { tx: door.door.tx - 1, ty: door.door.ty }
    expect(g.solidAt(wall.tx, wall.ty)).toBe(true)
    g.setAuthoritativeActor({
      id: 'me', areaId: 'ciudad-corazon', ...wall, username: 'Me', characterId: 'lucas', companionId: null,
      dir: 'left', speed: 3.75, moveSequence: 3,
    }, 'self')
    expect(g.presenceDiagnostics.snapshot().solidRecoveries).toBe(1)
    expect(sent).toEqual(['area ciudad-corazon'])
    expect([g.player.tx, g.player.ty]).toEqual([town.arrival(null).tx, town.arrival(null).ty])
  })
})
