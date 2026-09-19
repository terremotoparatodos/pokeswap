import { describe, expect, it, vi } from 'vitest'
import type { Area } from './area'
import type { PlacedObjectSpec } from './placedObjects'
import { composeWorldProbes, type WorldProbeProvider } from './worldProbes'

const area = { id: 'pradera' } as Area
const target = { area, tx: 1, ty: 2 }

const spec = (id: string): PlacedObjectSpec => ({ id, areaId: 'pradera', anchor: { tx: 0, ty: 0 }, kind: 'campfire' })

const provider = (over: Partial<WorldProbeProvider> = {}): WorldProbeProvider => ({
  inspect: () => false,
  isWorldObject: () => false,
  placedObjects: () => [],
  ...over,
})

describe('composeWorldProbes', () => {
  it('survives providers that have not mounted yet', () => {
    const probes = composeWorldProbes(() => [null, undefined])
    expect(probes.inspect(target)).toBe(false)
    expect(probes.isWorldObject(target)).toBe(false)
    expect(probes.placedObjects(area)).toEqual([])
  })

  it('gives an interaction to exactly one provider', () => {
    const second = vi.fn(() => true)
    const probes = composeWorldProbes(() => [provider({ inspect: () => true }), provider({ inspect: second })])
    expect(probes.inspect(target)).toBe(true)
    expect(second).not.toHaveBeenCalled()
  })

  it('falls through to the next provider when the first passes', () => {
    const probes = composeWorldProbes(() => [provider(), provider({ inspect: () => true })])
    expect(probes.inspect(target)).toBe(true)
  })

  it('treats a tile as interesting when any provider claims it', () => {
    expect(composeWorldProbes(() => [provider(), provider({ isWorldObject: () => true })]).isWorldObject(target)).toBe(true)
    expect(composeWorldProbes(() => [provider(), provider()]).isWorldObject(target)).toBe(false)
  })

  it('unions the physical layer', () => {
    const probes = composeWorldProbes(() => [
      provider({ placedObjects: () => [spec('a')] }),
      provider({ placedObjects: () => [spec('b'), spec('c')] }),
    ])
    expect(probes.placedObjects(area).map(o => o.id)).toEqual(['a', 'b', 'c'])
  })

  it('re-reads the providers on every call, so a late mount is picked up', () => {
    let mounted: WorldProbeProvider | null = null
    const probes = composeWorldProbes(() => [mounted])
    expect(probes.isWorldObject(target)).toBe(false)
    mounted = provider({ isWorldObject: () => true })
    expect(probes.isWorldObject(target)).toBe(true)
  })
})
