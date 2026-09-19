import { describe, expect, it } from 'vitest'

const files = import.meta.glob('./PlayDungeon.vue', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>
const source = Object.values(files)[0]

describe('PlayDungeon playtest shell', () => {
  it('keeps debug tools behind a compile-time development gate', () => {
    expect(source).toContain('const DevTools = import.meta.env.DEV')
    expect(source).toContain('v-if="DevTools"')
    expect(source).not.toContain("import DevTools, { type DevCommand }")
  })

  it('lets the world consume the available screen instead of capping it in vh', () => {
    expect(source).toContain('grid-template-rows: auto minmax(0, 1fr) auto')
    expect(source).toContain('.pd-stage { height: 100%')
    expect(source).not.toMatch(/\.pd-stage\s*\{[^}]*\b(?:50|58)vh/)
  })

  it('updates Vue at HUD frequency while the canvas keeps its own frame loop', () => {
    expect(source).toContain("clock - uiClock.value >= 1 / 12")
  })
})
