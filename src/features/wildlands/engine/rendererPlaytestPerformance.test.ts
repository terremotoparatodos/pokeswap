import { describe, expect, it } from 'vitest'

const files = import.meta.glob('./renderer.ts', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>
const source = Object.values(files)[0]

describe('playtest renderer budget', () => {
  it('keeps the pixel-art canvas at CSS resolution in a playtest build', () => {
    expect(source).toContain("import.meta.env.VITE_PLAYTEST === 'on' ? 1 : 2")
    expect(source).toContain('Math.min(MAX_RENDER_DPR, window.devicePixelRatio || 1)')
  })
})
