import { describe, expect, it } from 'vitest'
import { precipitationTarget } from './atmosphere'

describe('precipitation particle budget', () => {
  it('does no particle work in clear weather', () => {
    expect(precipitationTarget('clear', 1, 1920)).toBe(0)
  })

  it('scales down for smaller viewports and caps wide displays', () => {
    expect(precipitationTarget('rain', 1, 700)).toBe(80)
    expect(precipitationTarget('rain', 1, 3840)).toBe(180)
    expect(precipitationTarget('snow', 1, 3840)).toBe(110)
  })

  it('clamps intensity instead of creating unbounded particles', () => {
    expect(precipitationTarget('rain', 10, 1400)).toBe(160)
    expect(precipitationTarget('snow', -1, 1400)).toBe(0)
  })
})
