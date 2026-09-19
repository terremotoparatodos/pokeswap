// T-S3 — the station visual language.
//
// What these tests protect: that the three stations are deterministic, that all
// four states exist and none of them look alike, that their size and anchor
// never drift, that the art stays plain data the rest of the kit can use, and
// that this module never grows a dependency on the engine's state, the
// renderer, the DOM or the domain.

import { describe, expect, it } from 'vitest'
import { CAMPFIRE_AX, CAMPFIRE_AY, CAMPFIRE_BOUNDS, CAMPFIRE_H, CAMPFIRE_W, campfireStationArt } from './campfireStation'
import { FURNACE_AX, FURNACE_AY, FURNACE_BOUNDS, FURNACE_H, FURNACE_W, furnaceStationArt } from './furnaceStation'
import {
  inked, pixelDifference, STATION_KINDS, STATION_STATES, stationArtHash, stationBounds,
  type StationKind, type StationState,
} from './stationVisuals'
import { WORKBENCH_AX, WORKBENCH_AY, WORKBENCH_BOUNDS, WORKBENCH_H, WORKBENCH_W, workbenchStationArt } from './workbenchStation'

/** The kit, as a consumer would reach it. Assembled here on purpose: there is
 *  no central registry yet, because nothing places a station. */
const BUILDERS: Readonly<Record<StationKind, (state: StationState, frame?: number) => ReturnType<typeof furnaceStationArt>>> = {
  furnace: furnaceStationArt,
  campfire: campfireStationArt,
  workbench: workbenchStationArt,
}

const GEOMETRY: Readonly<Record<StationKind, { w: number; h: number; ax: number; ay: number }>> = {
  furnace: { w: FURNACE_W, h: FURNACE_H, ax: FURNACE_AX, ay: FURNACE_AY },
  campfire: { w: CAMPFIRE_W, h: CAMPFIRE_H, ax: CAMPFIRE_AX, ay: CAMPFIRE_AY },
  workbench: { w: WORKBENCH_W, h: WORKBENCH_H, ax: WORKBENCH_AX, ay: WORKBENCH_AY },
}

describe('the kit covers three stations in four states', () => {
  it('builds every state of every station', () => {
    expect(STATION_KINDS).toEqual(['furnace', 'campfire', 'workbench'])
    expect(STATION_STATES).toEqual(['idle', 'ready', 'working', 'done'])
    for (const kind of STATION_KINDS) {
      for (const state of STATION_STATES) {
        const art = BUILDERS[kind](state)
        expect(art, `${kind}/${state}`).toBeDefined()
        // Actually drawn, not an empty buffer.
        expect(inked(art), `${kind}/${state}`).toBeGreaterThan(120)
      }
    }
  })
})

describe('determinism', () => {
  it('gives the same art for the same state, every time', () => {
    for (const kind of STATION_KINDS) {
      for (const state of STATION_STATES) {
        const first = stationArtHash(BUILDERS[kind](state))
        const second = stationArtHash(BUILDERS[kind](state))
        expect(second, `${kind}/${state}`).toBe(first)
      }
    }
  })

  it('animates only while working, and repeats every four frames', () => {
    for (const kind of STATION_KINDS) {
      // A still state ignores the frame entirely.
      for (const state of ['idle', 'ready', 'done'] as const) {
        expect(stationArtHash(BUILDERS[kind](state, 3)), `${kind}/${state}`)
          .toBe(stationArtHash(BUILDERS[kind](state, 0)))
      }
      // Working moves...
      const frames = [0, 1, 2, 3].map(frame => stationArtHash(BUILDERS[kind]('working', frame)))
      expect(new Set(frames).size, `${kind}/working`).toBeGreaterThan(1)
      // ...and loops.
      expect(stationArtHash(BUILDERS[kind]('working', 4))).toBe(frames[0])
      expect(stationArtHash(BUILDERS[kind]('working', 7))).toBe(frames[3])
    }
  })
})

describe('the four states are visibly different', () => {
  it('never draws two states of a station the same way', () => {
    for (const kind of STATION_KINDS) {
      const hashes = STATION_STATES.map(state => stationArtHash(BUILDERS[kind](state)))
      expect(new Set(hashes).size, kind).toBe(STATION_STATES.length)
    }
  })

  it('changes enough pixels between states to read across a clearing', () => {
    for (const kind of STATION_KINDS) {
      for (const a of STATION_STATES) {
        for (const b of STATION_STATES) {
          if (a === b) continue
          const difference = pixelDifference(BUILDERS[kind](a), BUILDERS[kind](b))
          // Measured floor: the closest pair in the kit today is the campfire's
          // idle/ready at 26 px. Below ~20 a state stops reading at world zoom.
          expect(difference, `${kind}: ${a} vs ${b}`).toBeGreaterThanOrEqual(20)
        }
      }
    }
  })

  it('lights fire only while the fire stations are running', () => {
    // The shared fire colour is the whole point of the palette: one colour
    // means "this is running" on every station that burns.
    const hot = 0xff1878f0 // FIRE_TONES[2] '#f07818' packed as ABGR
    const lit = (art: ReturnType<typeof furnaceStationArt>): boolean => art.pixels.includes(hot)
    for (const kind of ['furnace', 'campfire'] as const) {
      expect(lit(BUILDERS[kind]('working')), `${kind}/working`).toBe(true)
      expect(lit(BUILDERS[kind]('idle')), `${kind}/idle`).toBe(false)
    }
    // The workbench has no fire in any state: its state is carried by the work.
    for (const state of STATION_STATES) expect(lit(workbenchStationArt(state)), `workbench/${state}`).toBe(false)
  })

  it('shows something to take only when a station is done', () => {
    // The shared sparkle marks "there is output waiting".
    const sparkle = 0xffb0f3ff // DONE_SPARKLE '#fff3b0'
    for (const kind of STATION_KINDS) {
      expect(BUILDERS[kind]('done').pixels.includes(sparkle), `${kind}/done`).toBe(true)
      expect(BUILDERS[kind]('idle').pixels.includes(sparkle), `${kind}/idle`).toBe(false)
    }
  })
})

describe('size and anchor', () => {
  it('keeps one footprint across every state', () => {
    for (const kind of STATION_KINDS) {
      const expected = GEOMETRY[kind]
      for (const state of STATION_STATES) {
        const art = BUILDERS[kind](state)
        expect({ w: art.w, h: art.h, ax: art.ax, ay: art.ay }, `${kind}/${state}`).toEqual(expected)
      }
    }
  })

  it('freezes the declared sizes, so a placement built on them cannot drift silently', () => {
    expect(FURNACE_BOUNDS).toEqual({ width: 30, height: 34, anchorX: 15, anchorY: 33 })
    expect(CAMPFIRE_BOUNDS).toEqual({ width: 32, height: 26, anchorX: 16, anchorY: 25 })
    expect(WORKBENCH_BOUNDS).toEqual({ width: 34, height: 28, anchorX: 17, anchorY: 27 })
  })

  it('puts the anchor on the front-bottom edge, like every world prop', () => {
    for (const kind of STATION_KINDS) {
      const art = BUILDERS[kind]('idle')
      const bounds = stationBounds(art)
      expect(bounds.anchorY, kind).toBe(art.h - 1)
      // Horizontally centred, within a pixel for odd widths.
      expect(Math.abs(bounds.anchorX - Math.floor(art.w / 2)), kind).toBeLessThanOrEqual(1)
    }
  })

  it('stands taller than it is wide only where the silhouette says so', () => {
    // The furnace is the tall one, the campfire the low one: that difference is
    // part of telling them apart at a glance.
    expect(FURNACE_BOUNDS.height).toBeGreaterThan(CAMPFIRE_BOUNDS.height)
    expect(CAMPFIRE_BOUNDS.height).toBeLessThan(WORKBENCH_BOUNDS.height)
  })
})

describe('it is plain art, in the format the kit already uses', () => {
  it('returns PixelArt buffers the size of their own geometry', () => {
    for (const kind of STATION_KINDS) {
      const art = BUILDERS[kind]('ready')
      expect(art.pixels, kind).toBeInstanceOf(Uint32Array)
      expect(art.pixels.length, kind).toBe(art.w * art.h)
    }
  })

  it('carries exactly the fields the sprite bridge reads', () => {
    // `toSprite` needs a real 2D context, which jsdom does not have, so this
    // asserts the shape it consumes rather than calling it.
    const art = furnaceStationArt('idle')
    for (const key of ['w', 'h', 'pixels', 'ax', 'ay'] as const) expect(art, key).toHaveProperty(key)
    expect(typeof art.ax).toBe('number')
    expect(typeof art.ay).toBe('number')
  })

  it('never mutates a cached buffer between calls', () => {
    const first = furnaceStationArt('working', 1)
    const before = first.pixels.slice()
    furnaceStationArt('working', 2)
    furnaceStationArt('done')
    expect(furnaceStationArt('working', 1).pixels).toEqual(before)
  })
})

describe('no forbidden dependencies', () => {
  const SOURCES = import.meta.glob<string>(
    ['./stationVisuals.ts', './furnaceStation.ts', './campfireStation.ts', './workbenchStation.ts'],
    { query: '?raw', import: 'default', eager: true },
  )

  /**
   * The kit may use the pure pixel primitives the whole `art/` folder is built
   * on, and nothing else. Everything below that line — engine state, renderer,
   * overlays, Vue, DOM, domain, inventory, services — stays out.
   */
  const ALLOWED = [
    './pixelArt',
    './stationVisuals',
    '../../wildlands/engine/pixels',
    '../../wildlands/engine/sprite',
    '../../wildlands/engine/props',
  ]

  const FORBIDDEN = [
    'engine/game', 'engine/renderer', 'engine/area', 'engine/world', 'engine/navigator',
    'engine/picking', 'engine/placedObjects', 'engine/sceneOverlay', 'engine/chunks',
    'domain/', 'inventory/', 'services/', 'supabase', 'vue', '/ui/', 'Overlay', 'Controller',
  ]

  it('imports only the shared pixel primitives', () => {
    for (const [path, source] of Object.entries(SOURCES)) {
      const specifiers = [...source.matchAll(/from '([^']+)'/g)].map(match => match[1])
      expect(specifiers.length, path).toBeGreaterThan(0)
      for (const specifier of specifiers) {
        expect(ALLOWED, `${path} imports ${specifier}`).toContain(specifier)
      }
    }
  })

  it('mentions nothing from the engine, the UI or the domain', () => {
    for (const [path, source] of Object.entries(SOURCES)) {
      const imports = source.split('\n').filter(line => line.startsWith('import'))
      for (const forbidden of FORBIDDEN) {
        expect(imports.some(line => line.includes(forbidden)), `${path} must not import ${forbidden}`).toBe(false)
      }
    }
  })

  it('declares no solidity, hitbox, placement, recipe or interaction', () => {
    // This kit is art. The moment one of these words shows up in it, the
    // separation F-1 was built on has started to leak.
    const banned = ['solid', 'hitbox', 'PlacedObject', 'footprint', 'recipe', 'interact', 'collision']
    for (const [path, source] of Object.entries(SOURCES)) {
      const code = source.split('\n')
        .filter(line => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
        .join('\n')
      for (const word of banned) {
        expect(code.toLowerCase().includes(word.toLowerCase()), `${path} must not mention ${word} in code`).toBe(false)
      }
    }
  })
})
