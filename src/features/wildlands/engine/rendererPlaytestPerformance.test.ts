import { describe, expect, it } from 'vitest'

const files = import.meta.glob('./renderer.ts', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>
const source = Object.values(files)[0]
const areaFiles = import.meta.glob('../areas/hearthome.ts', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>
const hearthome = Object.values(areaFiles)[0]
const townAreaFiles = import.meta.glob('../areas/townArea.ts', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>
const townArea = Object.values(townAreaFiles)[0]

describe('playtest renderer budget', () => {
  it('keeps the pixel-art canvas at CSS resolution in a playtest build', () => {
    expect(source).toContain("import.meta.env.VITE_PLAYTEST === 'on' ? 1 : 2")
    expect(source).toContain('Math.min(MAX_RENDER_DPR, window.devicePixelRatio || 1)')
    expect(source).toContain('projectionViewportScale(W, this.canvas.clientWidth)')
    expect(source).toContain('scene.lens.zoom * viewportScale * fit')
  })

  it('can measure renderer phases locally without enabling the remote playtest gate', () => {
    expect(source).toContain("import.meta.env.VITE_PERF === 'on'")
  })

  it('uses façade sprites instead of the CPU town rasterizer in every build', () => {
    expect(source).not.toContain('drawTownModel')
    expect(source).not.toContain('ENABLE_TOWN_MODELS')
    expect(townArea).not.toContain('loadTownModel')
    expect(townArea).not.toContain('LOAD_TOWN_MODELS')
  })

  it('keeps route gates and benches visible through pre-rendered 2D sprites', () => {
    expect(hearthome).toContain("import.meta.env.VITE_PLAYTEST === 'on'")
    expect(hearthome).toContain("modelSprite('bench-1')")
    expect(hearthome).toContain("modelSprite('bench-2')")
    for (const gate of ['gate-north', 'gate-west', 'gate-east', 'gate-south']) {
      expect(hearthome).toContain(`'${gate}'`)
    }
  })

  it('reuses hot-path collections instead of allocating them every frame', () => {
    expect(source).toContain('private readonly drawables: Drawable[] = []')
    expect(source).toContain('frame.hits.length = 0')
    expect(source).toContain('list.length = 0')
    expect(source).toContain('nameplates.length = 0')
    expect(source).toContain('private readonly waterPatterns: CanvasPattern[]')
    expect(source).not.toContain('const eye =')
  })
})
