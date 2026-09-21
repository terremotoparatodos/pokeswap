import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadTrainerSheet } from './characters'

describe('trainer sheet cache', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('decodes and crops a sheet once for concurrent wearers', async () => {
    let loads = 0
    class FakeImage {
      width = 8
      height = 4
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_url: string) { loads++; queueMicrotask(() => this.onload?.()) }
    }
    vi.stubGlobal('Image', FakeImage)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(8 * 4 * 4) })),
      fillRect: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
    }) as unknown as CanvasRenderingContext2D)

    const url = `/assets/trainers/cache-${Date.now()}.png`
    const [first, second] = await Promise.all([loadTrainerSheet(url), loadTrainerSheet(url)])

    expect(loads).toBe(1)
    expect(second).toBe(first)
  })
})
