import { describe, expect, it, vi } from 'vitest'
import type { RemoteActorsPort, RemotePresenceActor } from '../domain/presence'

vi.mock('../../../../shared/api/supabase', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: null } })) } },
}))

import { ColyseusPresence } from './colyseusPresence'

const actor = (id: string): RemotePresenceActor => ({
  id, areaId: 'ciudad-corazon', tx: 1, ty: 2, username: id, characterId: 'lucas', companionId: null,
  dir: 'down', speed: 3.75, moveSequence: 1,
})

function remotePort() {
  return {
    replaceRemoteActors: vi.fn(), upsertRemoteActor: vi.fn(), removeRemoteActor: vi.fn(),
    setAuthoritativeActor: vi.fn(), setPresenceAccess: vi.fn(), presenceRejected: vi.fn(),
  } satisfies RemoteActorsPort
}

describe('ColyseusPresence remote deltas', () => {
  it('forwards one upsert without rebuilding a complete actor array', () => {
    const remote = remotePort()
    const presence = new ColyseusPresence(remote)
    ;(presence as unknown as { apply(delta: unknown): void }).apply({ type: 'upsert', actor: actor('a') })
    expect(remote.upsertRemoteActor).toHaveBeenCalledOnce()
    expect(remote.upsertRemoteActor).toHaveBeenCalledWith(actor('a'))
    expect(remote.replaceRemoteActors).not.toHaveBeenCalled()
  })

  it('forwards a leave by id', () => {
    const remote = remotePort()
    const presence = new ColyseusPresence(remote)
    ;(presence as unknown as { apply(delta: unknown): void }).apply({ type: 'leave', actor: actor('a') })
    expect(remote.removeRemoteActor).toHaveBeenCalledWith('a')
    expect(remote.replaceRemoteActors).not.toHaveBeenCalled()
  })

  it('applies every actor operation carried by one socket batch', () => {
    const remote = remotePort()
    const presence = new ColyseusPresence(remote)
    ;(presence as unknown as { applyBatch(deltas: unknown[]): void }).applyBatch([
      { type: 'upsert', actor: actor('a') },
      { type: 'upsert', actor: actor('b') },
      { type: 'leave', actor: actor('a') },
    ])
    expect(remote.upsertRemoteActor).toHaveBeenCalledTimes(2)
    expect(remote.removeRemoteActor).toHaveBeenCalledWith('a')
    expect(remote.replaceRemoteActors).not.toHaveBeenCalled()
  })

  it('expands a compact step with the identity of the last full actor', () => {
    const remote = remotePort()
    const presence = new ColyseusPresence(remote)
    const apply = (delta: unknown) => (presence as unknown as { apply(delta: unknown): void }).apply(delta)
    apply({ type: 'upsert', actor: { ...actor('a'), companionId: 25 } })
    apply({ type: 'step', actor: { id: 'a', tx: 2, ty: 2, dir: 'right', speed: 7.5, moveSequence: 2 } })
    expect(remote.upsertRemoteActor).toHaveBeenLastCalledWith({ ...actor('a'), companionId: 25, tx: 2, dir: 'right', speed: 7.5, moveSequence: 2 })
  })

  it('drops a step for an actor it never received in full, and forgets actors that left', () => {
    const remote = remotePort()
    const presence = new ColyseusPresence(remote)
    const apply = (delta: unknown) => (presence as unknown as { apply(delta: unknown): void }).apply(delta)
    apply({ type: 'step', actor: { id: 'ghost', tx: 2, ty: 2, dir: 'right', speed: 3.75, moveSequence: 2 } })
    apply({ type: 'upsert', actor: actor('a') })
    apply({ type: 'leave', actor: actor('a') })
    apply({ type: 'step', actor: { id: 'a', tx: 2, ty: 2, dir: 'right', speed: 3.75, moveSequence: 2 } })
    expect(remote.upsertRemoteActor).toHaveBeenCalledOnce()
  })
})
