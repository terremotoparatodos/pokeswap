import { describe, expect, it } from 'vitest'
import type { Area } from '../engine/area'
import { isRestorableTownPosition } from './townPosition'

function area(): Area {
  return {
    id: 'town', name: 'Town', kind: 'town', lens: 'handheld',
    portals: [{ to: 'world', label: '', tiles: [{ tx: 2, ty: 2 }] }],
    doors: [{ buildingId: 'b', feature: 'mercado', door: { tx: 3, ty: 3 }, exit: { tx: 3, ty: 4, dir: 'down' }, footprint: { x: 3, y: 3, w: 1, d: 1 } }],
    isSolid: (tx, ty) => tx === 4 && ty === 4,
    isWater: () => false, placeName: () => '', arrival: () => ({ tx: 0, ty: 0, dir: 'down' }),
    drawGround: () => undefined, decorIn: () => [], createPopulace: () => ({ actors: [], update: () => undefined }),
    weather: () => ({ kind: 'clear', intensity: 0 }), talkAt: () => null, collect: () => false,
    paintMinimap: () => undefined, tick: () => undefined,
  }
}

describe('town position restoration', () => {
  it('accepts ordinary walkable tiles and rejects transitions or solids', () => {
    const town = area()
    expect(isRestorableTownPosition(town, { tx: 1, ty: 1, dir: 'left' })).toBe(true)
    expect(isRestorableTownPosition(town, { tx: 2, ty: 2, dir: 'down' })).toBe(false)
    expect(isRestorableTownPosition(town, { tx: 3, ty: 3, dir: 'down' })).toBe(false)
    expect(isRestorableTownPosition(town, { tx: 4, ty: 4, dir: 'down' })).toBe(false)
  })
})
