import { describe, expect, it } from 'vitest'
import type { Actor } from './actors'
import { WildlandsGame } from './game'
import { RemoteStepPlayback } from './remotePlayback'
import type { RemotePresenceActor } from '../multiplayer/domain/presence'

type RemoteGameState = {
  area: { id: string }
  renderer: { playerSprites: object }
  pokedex: readonly never[]
  remoteActors: Actor[]
  remoteCompanions: Actor[]
  remoteActorsById: Map<string, Actor>
  remoteCompanionsByOwnerId: Map<string, Actor>
  remoteCharacterIds: Map<string, string>
  remoteMoveSequences: Map<string, number>
  remotePlayback: RemoteStepPlayback
}
type RemoteGame = RemoteGameState & Pick<WildlandsGame, 'upsertRemoteActor' | 'replaceRemoteActors' | 'removeRemoteActor'>

const remote = (id: string, tx: number, ty = 2): RemotePresenceActor => ({
  id, areaId: 'ciudad-corazon', tx, ty, username: id, characterId: 'lucas', companionId: null,
  dir: 'right', speed: 3.75, moveSequence: tx,
})

function game(): RemoteGame {
  const instance = Object.create(WildlandsGame.prototype) as RemoteGame
  instance.area = { id: 'ciudad-corazon' }
  instance.renderer = { playerSprites: {} }
  instance.pokedex = []
  instance.remoteActors = []
  instance.remoteCompanions = []
  instance.remoteActorsById = new Map()
  instance.remoteCompanionsByOwnerId = new Map()
  instance.remoteCharacterIds = new Map()
  instance.remoteMoveSequences = new Map()
  instance.remotePlayback = new RemoteStepPlayback()
  return instance
}

describe('incremental remote actors', () => {
  it('preserves unrelated actors and their in-flight animation on a delta', () => {
    const instance = game()
    instance.upsertRemoteActor(remote('a', 1))
    instance.upsertRemoteActor(remote('b', 5))
    const unchanged = instance.remoteActorsById.get('b')!
    unchanged.progress = 0.42

    const changed = instance.remoteActorsById.get('a')!
    instance.upsertRemoteActor(remote('a', 2))

    expect(instance.remoteActorsById.get('a')).toBe(changed)
    expect(changed.progress).toBe(0)
    expect(instance.remoteActorsById.get('b')).toBe(unchanged)
    expect(unchanged.progress).toBe(0.42)
  })

  it('reconciles snapshots without recreating actors that remain present', () => {
    const instance = game()
    instance.replaceRemoteActors([remote('a', 1), remote('b', 5)])
    const kept = instance.remoteActorsById.get('a')

    instance.replaceRemoteActors([remote('a', 1)])

    expect(instance.remoteActorsById.get('a')).toBe(kept)
    expect(instance.remoteActorsById.has('b')).toBe(false)
    expect(instance.remoteActors).toHaveLength(1)
  })

  it('queues a newer step without resetting the step currently on screen', () => {
    const instance = game()
    instance.upsertRemoteActor(remote('a', 1))
    instance.upsertRemoteActor(remote('a', 2))
    const moving = instance.remoteActorsById.get('a')!
    moving.progress = 0.4

    instance.upsertRemoteActor(remote('a', 3))

    expect(moving.tx).toBe(2)
    expect(moving.progress).toBe(0.4)
    expect(instance.remotePlayback.backlog('a')).toBe(1)
    expect(instance.remotePlayback.tail('a', moving)).toEqual(expect.objectContaining({ tx: 3 }))
  })

  it('ignores an out-of-order movement sequence', () => {
    const instance = game()
    instance.upsertRemoteActor(remote('a', 1))
    instance.upsertRemoteActor(remote('a', 2))
    const moving = instance.remoteActorsById.get('a')!
    moving.progress = 0.5

    instance.upsertRemoteActor({ ...remote('a', 0), moveSequence: 1 })

    expect(moving.tx).toBe(2)
    expect(moving.progress).toBe(0.5)
  })
})
