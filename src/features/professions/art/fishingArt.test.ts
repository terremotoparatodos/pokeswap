import { describe, expect, it } from 'vitest'
import { FISHING_ASSETS } from './fishingAssets'
import { biteMarkArt, bobberArt, rippleArt, RIPPLE_FRAMES, splashArt } from './fishingFx'
import { WATER_TONES } from './fishingPalette'
import { FISHING_RESOURCE_ICON_IDS, fishingResourceIconArt, rodCastArt, rodIconArt, rodTipOffset } from './fishingItems'
import { FISHING_NODE_IDS, fishingSpotArt, SPOT_RESPAWN_FRAMES, spotHasArt } from './fishingSpots'
import { color, hasColor, opaqueCount } from './pixelArt'

/** The fish blur under the surface, at the alpha each state paints it with. */
const fishShadow = (alpha: number) => color('#0b2740', alpha)
const hasFish = (art: { pixels: Uint32Array; w: number; h: number; ax: number; ay: number }) =>
  [60, 90, 120, 190].some(alpha => hasColor(art, fishShadow(alpha)))

describe('fishing spots', () => {
  it('draws a flat mark centred on the water tile', () => {
    for (const nodeId of FISHING_NODE_IDS) {
      const art = fishingSpotArt(nodeId, 'ready')
      expect(spotHasArt(art)).toBe(true)
      expect(art.ax).toBeCloseTo(art.w / 2)
      expect(art.ay).toBeCloseTo(art.h / 2)
    }
  })

  it('shows the fish while the spot is alive and empty water when spent', () => {
    expect(hasFish(fishingSpotArt('shore_spot', 'ready'))).toBe(true)
    expect(hasFish(fishingSpotArt('shore_spot', 'bite'))).toBe(true)
    expect(hasFish(fishingSpotArt('shore_spot', 'spent'))).toBe(false)
  })

  it('reads louder at the bite than at rest', () => {
    const foam = WATER_TONES.shore_spot.foam
    expect(hasColor(fishingSpotArt('shore_spot', 'bite'), color(foam, 230))).toBe(true)
    expect(hasColor(fishingSpotArt('shore_spot', 'ready'), color(foam, 230))).toBe(false)
    expect(hasColor(fishingSpotArt('shore_spot', 'bite'), fishShadow(190))).toBe(true)
  })

  it('brings the fish back only as the spot refills', () => {
    expect(hasFish(fishingSpotArt('shore_spot', 'respawning', 0))).toBe(false)
    expect(hasFish(fishingSpotArt('shore_spot', 'respawning', SPOT_RESPAWN_FRAMES - 1))).toBe(true)
    expect(fishingSpotArt('shore_spot', 'respawning', 99)).toBe(fishingSpotArt('shore_spot', 'respawning', SPOT_RESPAWN_FRAMES - 1))
  })

  it('gives each water depth its own tones', () => {
    expect(hasColor(fishingSpotArt('shore_spot', 'ready'), color(WATER_TONES.shore_spot.tones[0], 160))).toBe(true)
    expect(hasColor(fishingSpotArt('reef_spot', 'ready'), color(WATER_TONES.shore_spot.tones[0], 160))).toBe(false)
  })
})

describe('fishing items', () => {
  it('builds every resource icon at 16×16', () => {
    for (const itemId of FISHING_RESOURCE_ICON_IDS) {
      const art = fishingResourceIconArt(itemId)!
      expect(art.w, itemId).toBe(16)
      expect(art.h, itemId).toBe(16)
      expect(opaqueCount(art), itemId).toBeGreaterThan(20)
    }
    expect(fishingResourceIconArt('iron_ore')).toBeNull()
  })

  it('separates rod tiers and conditions', () => {
    const ok = rodIconArt(1)
    expect(opaqueCount(ok)).toBeGreaterThan(10)
    expect(opaqueCount(rodIconArt(1, 'broken'))).toBeLessThan(opaqueCount(ok))
    expect(rodIconArt(3).pixels).not.toEqual(rodIconArt(1).pixels)
    expect(rodIconArt(2, 'retired').pixels).not.toEqual(rodIconArt(2).pixels)
  })

  it('mirrors the cast for the other facing and reports the rod tip', () => {
    const right = rodCastArt(1, 1, false)
    const left = rodCastArt(1, 1, true)
    expect(left.w).toBe(right.w)
    expect(left.pixels).not.toEqual(right.pixels)
    expect(rodTipOffset(1, false).dx).toBeGreaterThan(0)
    expect(rodTipOffset(1, true).dx).toBeLessThan(0)
    expect(rodTipOffset(0, false).dy).toBeLessThan(0)
  })
})

describe('fishing effects', () => {
  it('widens the ripple and keeps every effect tiny', () => {
    const sizes = Array.from({ length: RIPPLE_FRAMES }, (_, frame) => rippleArt(frame, '#ffffff').w)
    expect(sizes[RIPPLE_FRAMES - 1]).toBeGreaterThan(sizes[0])
    for (const art of [splashArt(0), splashArt(1), bobberArt(false), bobberArt(true)]) {
      expect(art.w).toBeLessThanOrEqual(6)
      expect(art.h).toBeLessThanOrEqual(6)
    }
    expect(bobberArt(true).h).toBeLessThan(bobberArt(false).h)
    expect(biteMarkArt().h).toBeGreaterThan(4)
  })
})

describe('fishing asset registry', () => {
  it('lists unique ids and every asset builds', () => {
    const ids = FISHING_ASSETS.map(asset => asset.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const asset of FISHING_ASSETS) {
      const art = asset.build()
      expect(art.w, asset.id).toBeGreaterThan(0)
      expect(opaqueCount(art), asset.id).toBeGreaterThan(0)
    }
  })

  it('covers spots, rods, icons, effects and markers', () => {
    for (const kind of ['spot', 'tool', 'icon', 'fx', 'marker'] as const) {
      expect(FISHING_ASSETS.some(asset => asset.kind === kind), kind).toBe(true)
    }
  })
})
