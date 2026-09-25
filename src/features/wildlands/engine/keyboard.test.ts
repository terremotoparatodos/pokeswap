import { describe, expect, it } from 'vitest'
import { KeyboardInput } from './keyboard'

const noop = () => undefined
const input = () => new KeyboardInput({ cycleLens: noop, toggleGrid: noop, skipTime: noop, interact: noop })
const key = (type: 'keydown' | 'keyup', code: string, key = code) => window.dispatchEvent(new KeyboardEvent(type, { code, key }))

describe('keyboard input lifecycle', () => {
  it('forgets held keys when detached, so a keyup lost behind a panel or hidden tab cannot keep walking', () => {
    const keys = input()
    keys.attach()
    key('keydown', 'KeyD')
    key('keydown', 'ShiftLeft', 'Shift')
    expect(keys.direction).toBe('right')
    expect(keys.sprinting).toBe(true)
    keys.detach()
    // Released while detached: this keyup never reaches the input.
    key('keyup', 'KeyD')
    key('keyup', 'ShiftLeft', 'Shift')
    keys.attach()
    expect(keys.direction).toBeNull()
    expect(keys.sprinting).toBe(false)
    keys.detach()
  })

  it('still tracks keys normally while attached', () => {
    const keys = input()
    keys.attach()
    key('keydown', 'ArrowUp')
    key('keydown', 'ArrowLeft')
    expect(keys.direction).toBe('left')
    key('keyup', 'ArrowLeft')
    expect(keys.direction).toBe('up')
    keys.detach()
  })
})

// MOBILE-1: the touch Correr toggle feeds the same gait as Shift.
describe('run mode (touch Correr)', () => {
  it('runs while on, walks when off, and is the same flag Shift sets', () => {
    const keys = input()
    keys.attach()
    expect(keys.sprinting).toBe(false)
    keys.runMode = true
    expect(keys.sprinting).toBe(true)
    // Shift on top changes nothing; releasing it does not end the mode.
    key('keydown', 'ShiftLeft', 'Shift')
    key('keyup', 'ShiftLeft', 'Shift')
    expect(keys.sprinting).toBe(true)
    keys.runMode = false
    expect(keys.sprinting).toBe(false)
    key('keydown', 'ShiftLeft', 'Shift')
    expect(keys.sprinting).toBe(true)
    keys.detach()
  })

  it('survives a panel, a hidden tab or a lost focus, unlike a held key', () => {
    const keys = input()
    keys.attach()
    keys.runMode = true
    keys.detach()
    window.dispatchEvent(new Event('blur'))
    keys.attach()
    expect(keys.sprinting).toBe(true)
    keys.detach()
  })
})
