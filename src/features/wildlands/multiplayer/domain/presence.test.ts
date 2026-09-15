import { describe, expect, it } from 'vitest'
import { isPresenceAreaId } from './presence'

describe('R30 shared-area boundary', () => {
  it('allows only Ciudad Corazón and the shared Pradera wild zone', () => {
    expect(isPresenceAreaId('ciudad-corazon')).toBe(true)
    expect(isPresenceAreaId('pradera')).toBe(true)
    expect(isPresenceAreaId('tundra')).toBe(false)
    expect(isPresenceAreaId('bosque')).toBe(false)
  })
})
