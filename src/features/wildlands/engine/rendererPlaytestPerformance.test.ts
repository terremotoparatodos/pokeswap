import { describe, expect, it } from 'vitest'

const files = import.meta.glob('./renderer.ts', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>
const source = Object.values(files)[0]

describe('playtest renderer budget', () => {
  it('keeps the pixel-art canvas at CSS resolution in a playtest build', () => {
    expect(source).toContain("import.meta.env.VITE_PLAYTEST === 'on' ? 1 : 2")
    expect(source).toContain('Math.min(MAX_RENDER_DPR, window.devicePixelRatio || 1)')
  })

  it('uses façade sprites instead of CPU-rasterized town models in playtest', () => {
    expect(source).toContain("const ENABLE_TOWN_MODELS = import.meta.env.VITE_PLAYTEST !== 'on'")
    expect(source).toContain('model: ENABLE_TOWN_MODELS ? d.model : undefined')
    expect(source).toContain('if (ENABLE_TOWN_MODELS && d.model && drawTownModel')
  })
})
