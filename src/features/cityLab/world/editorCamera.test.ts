// EDIT camera and gestures: pure maths, no canvas.

import { describe, expect, it } from 'vitest'
import { HEARTHOME, LOBBY_ID } from '../../wildlands/areas/atlas'
import { TILE } from '../../wildlands/engine/world'
import { diffCities, serializePatch } from '../domain/cityPatch'
import { deepFreeze, fromTownDef } from '../domain/labCity'
import { loadPrefs, PREFS_KEY, savePrefs } from '../domain/labPrefs'
import { DRAFT_KEY, type DraftStore } from '../domain/labDraft'
import { clampZoom, fitZoom, stepZoom, wheelZoom, withZoom, zoomAt, ZOOM_MAX, ZOOM_MIN } from './editorCamera'
import { DRAG_THRESHOLD, isDrag, pressGesture } from './editorGestures'
import { EDIT_LENSES, geometryFor, screenAt, tileAt, worldAtDevice } from './labProjection'

const VIEW = { width: 1600, height: 1000, dpr: 2, fit: 1 }
const ZOOMS = [0.5, 0.75, 1, 1.5, 2, ZOOM_MAX]

describe('world ↔ screen with zoom', () => {
  for (const lensName of ['plan', 'handheld'] as const) {
    it(`round-trips tile centres exactly at every zoom (${lensName})`, () => {
      for (const zoom of ZOOMS) {
        const f = geometryFor(VIEW, withZoom(EDIT_LENSES[lensName], zoom), 31 * TILE, 20 * TILE)
        for (const [tx, ty] of [[31, 20], [28, 18], [35, 23], [30, 25], [33, 17]]) {
          const p = screenAt(f, tx * TILE + 8, ty * TILE + 8)!
          // Clicking the centre of a tile on screen (CSS px) lands on that same tile.
          expect(tileAt(f, p.x / VIEW.dpr, p.y / VIEW.dpr), `zoom ${zoom} (${tx}, ${ty})`).toEqual({ tx, ty })
        }
      }
    })
  }

  it('places a click one tile from a tile edge on the right side of that edge', () => {
    for (const zoom of ZOOMS) {
      const f = geometryFor(VIEW, withZoom(EDIT_LENSES.plan, zoom), 500, 330)
      const inside = screenAt(f, 32 * TILE + 1, 21 * TILE + 1)!
      expect(tileAt(f, inside.x / VIEW.dpr, inside.y / VIEW.dpr)).toEqual({ tx: 32, ty: 21 })
      const before = screenAt(f, 32 * TILE - 1, 21 * TILE - 1)!
      expect(tileAt(f, before.x / VIEW.dpr, before.y / VIEW.dpr)).toEqual({ tx: 31, ty: 20 })
    }
  })
})

describe('zoom', () => {
  it('stays within a safe range', () => {
    expect(clampZoom(0.01)).toBe(ZOOM_MIN)
    expect(clampZoom(99)).toBe(ZOOM_MAX)
    expect(wheelZoom(1, -10_000)).toBe(ZOOM_MAX)
    expect(wheelZoom(1, 10_000)).toBe(ZOOM_MIN)
    expect(wheelZoom(1, -100)).toBeGreaterThan(1) // wheel up → in
    expect(wheelZoom(1, 100)).toBeLessThan(1) // wheel down → out
  })

  it('steps in and out and snaps back to exactly 100 %', () => {
    expect(stepZoom(1, 1)).toBeCloseTo(1.25)
    expect(stepZoom(stepZoom(1, 1), -1)).toBe(1)
    expect(stepZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX)
  })

  it('keeps the world point under the cursor fixed', () => {
    const lens = EDIT_LENSES.plan
    const cursor = { sx: 1300, sy: 300 }
    for (const next of [0.5, 0.8, 1.6, 2.4]) {
      const cam = { x: 31 * TILE, y: 20 * TILE, zoom: 1 }
      const before = worldAtDevice(geometryFor(VIEW, withZoom(lens, cam.zoom), cam.x, cam.y), cursor.sx, cursor.sy)!
      const moved = zoomAt(cam, next, cursor, VIEW, lens)
      const after = worldAtDevice(geometryFor(VIEW, withZoom(lens, moved.zoom), moved.x, moved.y), cursor.sx, cursor.sy)!
      expect(after.x).toBeCloseTo(before.x, 6)
      expect(after.y).toBeCloseTo(before.y, 6)
    }
  })

  it('frames the whole city', () => {
    const fit = fitZoom(64 * TILE, 49 * TILE, VIEW, EDIT_LENSES.plan)
    expect(fit.x).toBe(32 * TILE)
    expect(fit.zoom).toBeGreaterThanOrEqual(ZOOM_MIN)
    expect(fit.zoom).toBeLessThan(1)
  })
})

describe('press → click or drag', () => {
  const base = { button: 0, spaceHeld: false, altKey: false, tool: 'select' as const, onEntity: false }

  it('drags an object when the press starts on one', () => {
    expect(pressGesture({ ...base, onEntity: true })).toEqual({ drag: 'object', click: 'select' })
  })

  it('pans when the press starts on empty ground; a plain click deselects', () => {
    expect(pressGesture(base)).toEqual({ drag: 'pan', click: 'deselect' })
  })

  it('pans from anywhere with Space, the middle or the right button', () => {
    expect(pressGesture({ ...base, onEntity: true, spaceHeld: true }).drag).toBe('pan')
    expect(pressGesture({ ...base, onEntity: true, button: 1 }).drag).toBe('pan')
    expect(pressGesture({ ...base, button: 2 }).drag).toBe('pan')
    expect(pressGesture({ ...base, tool: 'add', spaceHeld: true }).click).toBe('none')
  })

  it('places on a click with Agregar, but a drag only pans (no accidental prop)', () => {
    expect(pressGesture({ ...base, tool: 'add' })).toEqual({ drag: 'pan', click: 'place' })
  })

  it('paints with Terreno', () => {
    expect(pressGesture({ ...base, tool: 'terrain' }).drag).toBe('paint')
  })

  it('needs a few pixels of travel before a press becomes a drag', () => {
    expect(isDrag({ x: 10, y: 10 }, { x: 12, y: 11 })).toBe(false)
    expect(isDrag({ x: 10, y: 10 }, { x: 10 + DRAG_THRESHOLD, y: 10 })).toBe(true)
  })
})

describe('the view is not the map', () => {
  it('pan and zoom never change the patch', () => {
    const base = deepFreeze(fromTownDef(HEARTHOME))
    const before = serializePatch(diffCities(base, base, LOBBY_ID))
    // Everything the camera does is numbers outside the working copy.
    zoomAt({ x: 10, y: 10, zoom: 1 }, 2, { sx: 5, sy: 5 }, VIEW, EDIT_LENSES.plan)
    fitZoom(1024, 784, VIEW, EDIT_LENSES.plan)
    expect(serializePatch(diffCities(base, base, LOBBY_ID))).toBe(before)
  })

  it('remembers pan, zoom, lens and palette apart from the LOCAL DRAFT', () => {
    const data = new Map<string, string>()
    const store: DraftStore = { getItem: k => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: k => void data.delete(k) }
    savePrefs(store, { camX: 100, camY: 200, zoom: 1.5, lens: 'plan', palette: 'city-tree-round' })
    expect(loadPrefs(store)).toEqual({ camX: 100, camY: 200, zoom: 1.5, lens: 'plan', palette: 'city-tree-round' })
    expect([...data.keys()]).toEqual([PREFS_KEY])
    expect(PREFS_KEY).not.toBe(DRAFT_KEY)
    data.set(PREFS_KEY, '{nope')
    expect(loadPrefs(store)).toEqual({})
  })
})
