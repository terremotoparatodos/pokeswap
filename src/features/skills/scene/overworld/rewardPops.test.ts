import { describe, expect, it, vi } from 'vitest'

vi.mock('../art/pixelArt', async importOriginal => ({
  ...(await importOriginal<typeof import('../art/pixelArt')>()),
  toSprite: (art: unknown) => ({ art }),
}))

import { pixelArt } from '../art/pixelArt'
import { RewardPops } from './rewardPops'

const icon = pixelArt(2, 2)

describe('reward pops', () => {
  it('lays out a gathered reward: one pop per stack, then the XP label, staggered', () => {
    const pops = new RewardPops()
    pops.pushGathered([{ itemId: 'stone', quantity: 2 }, { itemId: 'coal', quantity: 1 }], 30, 100, 50, 20, 10)

    // At t = 10.2 s every pop has started (stack 2 starts at 10.12, XP at 10.2).
    const labels = pops.labels(10.2)
    expect(labels.map(label => label.text)).toEqual(['+2', '+1', '+30 XP'])
    expect(labels.map(label => label.wx)).toEqual([93 + 12, 107 + 12, 100])
    expect(labels[2]).toMatchObject({ wy: 50, lift: 36, color: '#ffd27a', alpha: 1 })
  })

  it('hides pops that have not started and drifts and fades the ones that have', () => {
    const pops = new RewardPops()
    pops.push({ itemId: 'stone', text: '+1', color: '#fff', x: 0, y: 0, lift: 20, start: 1, life: 2 })

    expect(pops.labels(0.5)).toEqual([])
    expect(pops.iconSprites(0.5, () => icon)).toEqual([])

    const [early] = pops.iconSprites(2, () => icon)
    expect(early).toMatchObject({ lift: 20 + 0.5 * 14, alpha: 1, depthBias: 2 })
    const [late] = pops.iconSprites(2.8, () => icon)
    expect(late.alpha).toBeCloseTo((1 - 0.9) / 0.3)
    expect(pops.labels(2)[0]).toMatchObject({ wx: 12, lift: 20 + 7 + 4 })
  })

  it('skips pops without an icon and text-only pops when drawing icons', () => {
    const pops = new RewardPops()
    pops.pushXp(5, 0, 0, 10, 0)
    pops.push({ itemId: 'unknown', text: '+1', color: '#fff', x: 0, y: 0, lift: 0, start: 0, life: 1 })
    expect(pops.iconSprites(0.5, () => null)).toEqual([])
    expect(pops.labels(0.5)).toHaveLength(2)
  })

  it('prunes finished pops and clears on demand', () => {
    const pops = new RewardPops()
    pops.push({ itemId: null, text: 'a', color: '#fff', x: 0, y: 0, lift: 0, start: 0, life: 1 })
    pops.push({ itemId: null, text: 'b', color: '#fff', x: 0, y: 0, lift: 0, start: 0, life: 3 })
    pops.prune(1)
    expect(pops.labels(1).map(label => label.text)).toEqual(['b'])
    pops.clear()
    expect(pops.labels(1)).toEqual([])
  })
})
