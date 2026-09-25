import { describe, expect, it } from 'vitest'
import { trackKeyboardInset } from './keyboardInset'

// iPhone 15 Pro, Safari: an 852 px tall layout viewport; the keyboard leaves 470 px visible.
function fakeWindow() {
  const listeners = new Map<string, () => void>()
  const viewport = {
    height: 852, offsetTop: 0,
    addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
  }
  const root = document.createElement('html')
  const target = { innerHeight: 852, visualViewport: viewport, document: { documentElement: root } } as unknown as Window
  return { target, viewport, root, fire: (type: string) => listeners.get(type)?.(), listeners }
}

describe('keyboard inset', () => {
  it('publishes how much of the bottom the keyboard covers, following resizes and pans', () => {
    const { target, viewport, root, fire } = fakeWindow()
    const stop = trackKeyboardInset(target)
    expect(root.style.getPropertyValue('--keyboard-inset')).toBe('0px')

    viewport.height = 470
    fire('resize')
    expect(root.style.getPropertyValue('--keyboard-inset')).toBe('382px')
    expect(root.style.getPropertyValue('--visible-height')).toBe('470px')

    // Safari pans the visual viewport to keep the field in view.
    viewport.offsetTop = 100
    fire('scroll')
    expect(root.style.getPropertyValue('--keyboard-inset')).toBe('282px')

    stop()
    expect(root.style.getPropertyValue('--keyboard-inset')).toBe('')
  })

  it('does nothing without visualViewport', () => {
    const stop = trackKeyboardInset({ document } as unknown as Window)
    expect(() => stop()).not.toThrow()
  })
})

describe('keyboard inset with several surfaces', () => {
  it('keeps publishing until the last one stops', () => {
    const { target, root } = fakeWindow()
    const chat = trackKeyboardInset(target)
    const form = trackKeyboardInset(target)
    chat()
    expect(root.style.getPropertyValue('--keyboard-inset')).toBe('0px')
    chat()
    expect(root.style.getPropertyValue('--keyboard-inset')).toBe('0px')
    form()
    expect(root.style.getPropertyValue('--keyboard-inset')).toBe('')
  })
})
