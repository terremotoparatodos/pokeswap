import { describe, expect, it } from 'vitest'
import { ALCHEMY_ASSETS } from './alchemyAssets'
import { bubbleFxArt, dropletArt, sparkleArt, steamArt } from './alchemyFx'
import { ALCHEMY_ICON_IDS, alchemyIconArt } from './alchemyItems'
import { liquidOf, LIQUIDS } from './alchemyPalette'
import { alchemyStationArt, STATION_H, STATION_W } from './alchemyStation'
import { color, hasColor, opaqueCount } from './pixelArt'

describe('alchemy items', () => {
  it('builds every icon at 16×16', () => {
    for (const itemId of ALCHEMY_ICON_IDS) {
      const art = alchemyIconArt(itemId)!
      expect(art.w, itemId).toBe(16)
      expect(art.h, itemId).toBe(16)
      expect(opaqueCount(art), itemId).toBeGreaterThan(20)
    }
    expect(alchemyIconArt('iron_ore')).toBeNull()
  })

  it('gives each product its own liquid, so two potions never look alike', () => {
    const potion = alchemyIconArt('potion')!
    const ether = alchemyIconArt('ether')!
    expect(hasColor(potion, color(LIQUIDS.potion.tones[1]))).toBe(true)
    expect(hasColor(potion, color(LIQUIDS.ether.tones[1]))).toBe(false)
    expect(hasColor(ether, color(LIQUIDS.ether.tones[1]))).toBe(true)
    expect(alchemyIconArt('super_potion')!.pixels).not.toEqual(alchemyIconArt('hyper_potion')!.pixels)
  })

  it('falls back to a neutral liquid for anything unmapped', () => {
    expect(liquidOf('potion')).toBe(LIQUIDS.potion)
    expect(liquidOf('iron_ore').tones).toHaveLength(3)
  })
})

describe('alchemy station', () => {
  it('keeps one footprint across every state', () => {
    for (const state of ['idle', 'ready', 'brewing', 'done'] as const) {
      const art = alchemyStationArt(state)
      expect(art.w, state).toBe(STATION_W)
      expect(art.h, state).toBe(STATION_H)
    }
  })

  it('fills the flask with the product being brewed and empties it when idle', () => {
    const idle = alchemyStationArt('idle')
    const brewing = alchemyStationArt('brewing', liquidOf('ether'), 2)
    expect(hasColor(idle, color(LIQUIDS.ether.tones[1]))).toBe(false)
    expect(hasColor(brewing, color(LIQUIDS.ether.tones[1]))).toBe(true)
    // A different recipe repaints the same bench.
    expect(hasColor(alchemyStationArt('brewing', liquidOf('revive'), 2), color(LIQUIDS.revive.tones[1]))).toBe(true)
  })

  it('lights the burner only while brewing', () => {
    const flame = color('#f07818')
    expect(hasColor(alchemyStationArt('brewing', liquidOf('potion'), 1), flame)).toBe(true)
    expect(hasColor(alchemyStationArt('ready'), flame)).toBe(false)
  })
})

describe('alchemy effects', () => {
  it('uses soft shapes that carry the product colour', () => {
    const bubble = bubbleFxArt(liquidOf('potion'), false)
    expect(hasColor(bubble, color(LIQUIDS.potion.tones[1]))).toBe(true)
    // The popping frame is a ring: fewer pixels than the full bubble.
    expect(opaqueCount(bubbleFxArt(liquidOf('potion'), true))).toBeLessThan(opaqueCount(bubble))
    expect(steamArt(0).pixels).not.toEqual(steamArt(2).pixels)
    expect(opaqueCount(dropletArt(liquidOf('ether')))).toBe(3)
    expect(opaqueCount(sparkleArt(true))).toBe(9)
  })
})

describe('alchemy asset registry', () => {
  it('lists unique ids and every asset builds', () => {
    const ids = ALCHEMY_ASSETS.map(asset => asset.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const asset of ALCHEMY_ASSETS) {
      const art = asset.build()
      expect(art.w, asset.id).toBeGreaterThan(0)
      expect(opaqueCount(art), asset.id).toBeGreaterThan(0)
    }
  })

  it('covers the station, the icons, the effects and the markers', () => {
    for (const kind of ['station', 'icon', 'fx', 'marker'] as const) {
      expect(ALCHEMY_ASSETS.some(asset => asset.kind === kind), kind).toBe(true)
    }
  })
})
