import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WildlandsGame } from './game'

// PRESENCE UX-1: the engine's hold. A held scene simulates, draws and accepts
// nothing. Without a hold (the offline world) it draws from the first frame,
// exactly as before.

function stubContext(): CanvasRenderingContext2D {
  const imageData = (a?: unknown, b?: number, c?: number, d?: number) => {
    const w = typeof a === 'number' ? (d ? c! : a) : 1
    const h = typeof a === 'number' ? (d ? d : b!) : 1
    return { width: w, height: h, data: new Uint8ClampedArray(Math.max(1, w * h * 4)) }
  }
  return new Proxy({}, {
    get: (_target, key) => {
      if (key === 'canvas') return { width: 320, height: 240 }
      if (key === 'measureText') return () => ({ width: 1 })
      if (key === 'getImageData' || key === 'createImageData') return imageData
      if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createPattern') return () => ({ addColorStop() {}, setTransform() {} })
      return () => undefined
    },
    set: () => true,
  }) as CanvasRenderingContext2D
}

const frames = new Map<number, FrameRequestCallback>()
let frameId = 0
let clock = 0
function runFrames(count: number): void {
  for (let i = 0; i < count; i++) {
    const queued = [...frames.values()]
    frames.clear()
    clock += 16
    for (const callback of queued) callback(clock)
  }
}

beforeEach(() => {
  frames.clear()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(stubContext() as never)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  if (!('DOMMatrix' in globalThis)) {
    class Matrix { e = 0; f = 0; translateSelf() { return this } translate() { return new Matrix() } multiply() { return new Matrix() } }
    vi.stubGlobal('DOMMatrix', Matrix)
  }
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function make(options: { startArea?: 'pradera'; presence?: boolean } = {}) {
  const canvas = document.createElement('canvas')
  const huds: string[] = []
  const game = new WildlandsGame(canvas, {
    pokedex: [], onHud: hud => huds.push(hud.areaId), startArea: options.startArea,
    presence: options.presence ? { move: vi.fn(), changeArea: vi.fn(), observe: vi.fn() } : undefined,
  })
  const internals = game as unknown as {
    renderer: { render(scene: { area: { id: string } }): void; pick(): unknown }
    keys: { attach(): void; detach(): void; virtualDir: string | null }
    nav: { goTo(...args: unknown[]): void }
    player: { tx: number; ty: number }
  }
  const drawn: string[] = []
  internals.renderer.render = scene => { drawn.push(scene.area.id) }
  internals.renderer.pick = () => ({ tile: { tx: 1, ty: 1 }, actor: null })
  return { game, internals, drawn, huds, attach: vi.spyOn(internals.keys, 'attach'), goTo: vi.spyOn(internals.nav, 'goTo') }
}

describe('scene hold (PRESENCE UX-1)', () => {
  it('offline, unchanged: the start area is drawn from the first frames and input is live', () => {
    const s = make({ startArea: 'pradera' })
    s.game.start()
    runFrames(5)
    expect(s.drawn.length).toBeGreaterThan(0)
    expect(new Set(s.drawn)).toEqual(new Set(['pradera']))
    expect(s.attach).toHaveBeenCalled()
    s.game.tap(5, 5)
    expect(s.goTo).toHaveBeenCalledOnce()
  })

  it('held before start: no frame, no HUD, no keyboard and no tap until revealed', () => {
    const s = make()
    s.game.holdScene()
    s.game.start()
    runFrames(20)
    expect(s.drawn).toEqual([])
    expect(s.huds).toEqual([])
    expect(s.attach).not.toHaveBeenCalled()
    s.game.tap(5, 5)
    s.game.drag(30, 30)
    expect(s.goTo).not.toHaveBeenCalled()
    s.game.revealScene()
    runFrames(3)
    expect(s.drawn).toContain('ciudad-corazon')
    expect(s.attach).toHaveBeenCalled()
  })

  it('nothing re-attaches the keyboard while held: unpause, visibility, spectator off', () => {
    const s = make()
    s.game.start()
    s.attach.mockClear()
    s.game.holdScene()
    s.game.setPaused(true); s.game.setPaused(false)
    s.game.setVisibilityPaused(true); s.game.setVisibilityPaused(false)
    s.game.setSpectator(true); s.game.setSpectator(false)
    runFrames(5)
    expect(s.attach).not.toHaveBeenCalled()
  })

  it('a held scene keeps its last frame: no draw while held, even with a direction pressed', () => {
    const s = make({ startArea: 'pradera', presence: true })
    s.game.setPresenceAccess('player')
    s.game.start()
    runFrames(3)
    const drawnBefore = s.drawn.length
    const at = { ...s.internals.player }
    s.game.holdScene()
    s.game.setVirtualDir('right')
    runFrames(60)
    expect(s.drawn.length).toBe(drawnBefore)
    expect({ tx: s.internals.player.tx, ty: s.internals.player.ty }).toEqual({ tx: at.tx, ty: at.ty })
  })

  it('each guard holds on its own: a stray frame callback draws nothing, a direct update reads no direction', () => {
    const s = make({ startArea: 'pradera', presence: true })
    s.game.setPresenceAccess('player')
    s.game.start()
    runFrames(3)
    s.game.holdScene()
    const internals = s.internals as unknown as { loop(now: number): void; update(dt: number): void; walker: unknown }
    const drawnBefore = s.drawn.length
    // A frame already dispatched when the hold landed.
    internals.loop(clock + 16)
    internals.loop(clock + 32)
    expect(s.drawn.length).toBe(drawnBefore)
    const at = { tx: s.internals.player.tx, ty: s.internals.player.ty }
    s.game.setVirtualDir('right')
    for (let i = 0; i < 40; i++) internals.update(0.05)
    expect({ tx: s.internals.player.tx, ty: s.internals.player.ty }).toEqual(at)
  })
})
