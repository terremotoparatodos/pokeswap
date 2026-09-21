import { describe, expect, it } from 'vitest'

const files = import.meta.glob('./game.ts', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>
const source = Object.values(files)[0]

describe('world loop while a primary surface is open', () => {
  it('keeps rendering while blocking world controls', () => {
    const pauseMethod = source.slice(source.indexOf('setPaused('), source.indexOf('/** Stops simulation'))
    expect(source).not.toContain('PAUSED_FRAME_MS')
    expect(source).toContain('if (this.visibilityPaused) return')
    expect(source).toContain('this.travel.active || this.paused || this.spectator')
    expect(pauseMethod).toContain('this.keys.detach()')
    expect(pauseMethod).not.toContain('this.stopFrameLoop()')
    expect(source).toContain('this.remoteUpdatesSinceSample = 0')
    expect(source).toContain('if (this.last === 0)')
    expect(source).not.toContain('this.presence?.disconnect()')
  })
})
