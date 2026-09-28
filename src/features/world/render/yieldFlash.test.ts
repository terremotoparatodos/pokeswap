import { describe, expect, it } from 'vitest'
import { YIELD_FLASH_MS, yieldFlash } from './worldResourceOverlay'

// RESOURCE YIELD-2: what observers see of a confirmed unit — a flash that
// fades, from the server's `yieldAt` on the shared clock. Never a count.

describe('yieldFlash', () => {
  it('is full at the unit, fades out over YIELD_FLASH_MS, and is nothing before, after or without a unit', () => {
    expect(yieldFlash(undefined, 1_000)).toBe(0)
    expect(yieldFlash(1_000, 1_000)).toBe(1)
    expect(yieldFlash(1_000, 1_000 + YIELD_FLASH_MS / 2)).toBeCloseTo(0.5)
    expect(yieldFlash(1_000, 1_000 + YIELD_FLASH_MS)).toBe(0)
    expect(yieldFlash(1_000, 999), 'a clock a hair behind the server shows nothing yet').toBe(0)
  })
})
