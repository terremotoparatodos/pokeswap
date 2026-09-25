import { describe, expect, it } from 'vitest'
import { WorldResourceMirror } from './worldResources'
import { WorldClock } from './worldClock'

const ID = 'pradera:-6:-64:tree'
const CHUNK = '-1,-4'

describe('WorldResourceMirror', () => {
  it('holds only non-base nodes of the chunks the server sent', () => {
    const mirror = new WorldResourceMirror()
    mirror.applySnapshot({ now: 1, areaId: 'pradera', chunks: [CHUNK], nodes: [{ id: ID, state: 'depleted', version: 4, respawnAt: 90 }] })
    expect(mirror.node(ID)?.state).toBe('depleted')
    expect(mirror.knows('pradera', -6, -64)).toBe(true)
    expect(mirror.knows('pradera', 200, 200)).toBe(false)
  })

  it('ignores a delta older than what it holds, and forgets a node back at base', () => {
    const mirror = new WorldResourceMirror()
    mirror.applySnapshot({ now: 1, areaId: 'pradera', chunks: [CHUNK], nodes: [{ id: ID, state: 'depleted', version: 4 }] })
    mirror.applyBatch({ now: 2, nodes: [{ id: ID, state: 'working', version: 3, actionId: 'x' }] })
    expect(mirror.node(ID)?.state).toBe('depleted')
    mirror.applyBatch({ now: 3, nodes: [{ id: ID, state: 'available', version: 5, base: true }] })
    expect(mirror.node(ID)).toBeNull()
    expect(mirror.activeNodes).toBe(0)
  })

  it('drops a chunk on leave and takes the server state again on enter', () => {
    const mirror = new WorldResourceMirror()
    mirror.applySnapshot({ now: 1, areaId: 'pradera', chunks: [CHUNK], nodes: [{ id: ID, state: 'depleted', version: 4 }] })
    mirror.applyBatch({ now: 2, leave: [CHUNK] })
    expect(mirror.node(ID)).toBeNull()
    expect(mirror.knows('pradera', -6, -64)).toBe(false)
    // A delta for a chunk not held is not invented into state.
    mirror.applyBatch({ now: 3, nodes: [{ id: ID, state: 'depleted', version: 9 }] })
    expect(mirror.node(ID)).toBeNull()
    mirror.applyBatch({ now: 4, enter: [{ chunk: CHUNK, nodes: [{ id: ID, state: 'depleted', version: 4 }] }] })
    expect(mirror.node(ID)?.version).toBe(4)
  })
})

describe('WorldClock', () => {
  it('keeps the least-delayed sample and resets after a jump', () => {
    let local = 1_000
    const clock = new WorldClock(() => local)
    expect(clock.now()).toBeNull()
    clock.sample(50_000) // offset 49 000 (this sample was delayed)
    local = 1_100
    clock.sample(50_150) // offset 49 050: less delay, kept
    expect(clock.now()).toBe(50_150)
    local = 1_200
    clock.sample(50_220) // offset 49 020: more delay, ignored
    expect(clock.now()).toBe(1_200 + 49_050 - Math.round(0.1 * 2 * 1000) / 1000)
    local = 1_300
    clock.sample(10_000) // server restarted with another clock
    expect(clock.now()).toBe(10_000)
  })
})
