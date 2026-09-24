import { describe, expect, it } from 'vitest'
import { createActor, type Actor } from '../engine/actors'
import type { TrainerSprites } from '../engine/characters'
import { RemoteTrace } from './remoteTrace'

const fallback = { down: [], up: [], left: [], right: [] } as unknown as TrainerSprites
const sheet = { down: [], up: [], left: [], right: [] } as unknown as TrainerSprites

function remote(id: string, tx = 0): Actor {
  return createActor({ id: `remote:${id}`, kind: 'remote', habitat: 'any', tx, ty: 0, trainer: fallback, remote: true })
}

describe('remote trace', () => {
  it('tells a first sheet load from a sprite that falls back again', () => {
    let now = 0
    const trace = new RemoteTrace(() => now)
    const a = remote('a')
    trace.frame([a], fallback)
    now = 120; a.trainer = sheet; trace.frame([a], fallback)
    now = 200; a.trainer = fallback; trace.frame([a], fallback)
    const sprites = trace.report().sprites
    expect(sprites.fallbackToSheet).toBe(1)
    expect(sprites.fallbackToSheetMs.max).toBe(120)
    expect(sprites.sheetToFallback).toBe(1)
  })

  it('counts a rebuilt actor object separately from a new player', () => {
    let now = 0
    const trace = new RemoteTrace(() => now)
    trace.frame([remote('a'), remote('b')], fallback)
    now = 16; trace.frame([remote('a'), remote('b')], fallback)
    const lifecycle = trace.report().lifecycle
    expect(lifecycle.created).toBe(4)
    expect(lifecycle.recreated).toBe(2)
    expect(lifecycle.destroyed).toBe(0)
  })

  it('counts interest flapping: gone and back within two seconds', () => {
    let now = 0
    const trace = new RemoteTrace(() => now)
    trace.frame([remote('a')], fallback)
    now = 16; trace.frame([], fallback)
    now = 500; trace.frame([remote('a')], fallback)
    expect(trace.report().lifecycle).toMatchObject({ destroyed: 1, recreated: 1, recreatedWithin2s: 1 })
  })

  it('measures snaps in tiles and short stop-and-go rests', () => {
    let now = 0
    const trace = new RemoteTrace(() => now)
    const a = remote('a')
    trace.frame([a], fallback)
    // A two-tile teleport.
    now = 16; a.fromTx = a.tx = 2; trace.frame([a], fallback)
    // Step, rest 50 ms, step again.
    now = 32; a.fromTx = 2; a.tx = 3; a.progress = 0.5; trace.frame([a], fallback)
    now = 48; a.fromTx = 3; a.progress = 1; trace.frame([a], fallback)
    now = 98; a.tx = 4; a.progress = 0.2; trace.frame([a], fallback)
    const motion = trace.report().motion
    expect(motion.snaps).toBe(1)
    expect(motion.maxSnapTiles).toBe(2)
    expect(motion.stopAndGo).toBe(1)
    expect(motion.stopAndGoMs.max).toBe(50)
  })

  it('reads distance and sequence gaps from what the network delivered', () => {
    let now = 0
    const trace = new RemoteTrace(() => now)
    const base = { id: 'a', username: 'A', areaId: 'ciudad-corazon', characterId: 'lucas', companionId: null, dir: 'right', speed: 7.5 } as const
    trace.received({ ...base, tx: 0, ty: 0, moveSequence: 1 })
    trace.frame([remote('a')], fallback)
    now = 50; trace.received({ ...base, tx: 2, ty: 0, moveSequence: 3 })
    const receive = trace.report().receive
    expect(receive.tileDistance.two).toBe(1)
    expect(receive.sequenceGaps).toBe(1)
    expect(receive.intervalMs.max).toBe(50)
  })
})
