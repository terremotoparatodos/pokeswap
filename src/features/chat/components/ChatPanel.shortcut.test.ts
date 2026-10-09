import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatPanel from './ChatPanel.vue'
import { useChat } from '../state/useChat'
import { KeyboardInput } from '../../wildlands/engine/keyboard'

// CHAT-SHORTCUT-1: Enter from the map opens the chat with the cursor in the box,
// Enter in the box sends through the usual flow, Escape gives the keys back to
// the map. Nobody else's Enter is taken, and a held key never opens and sends.

describe('the chat Enter shortcut (desktop)', () => {
  let map: HTMLCanvasElement
  let sent: string[]
  let wrapper: VueWrapper | null = null

  beforeEach(() => {
    map = document.createElement('canvas')
    map.tabIndex = 0
    document.body.append(map)
    sent = []
    const chat = useChat()
    chat.attach(text => { sent.push(text) })
    chat.sink.setAccess('player')
  })
  afterEach(() => {
    wrapper?.unmount(); wrapper = null
    const chat = useChat()
    chat.attach(null)
    chat.open.value = false
    document.body.replaceChildren()
  })

  const panel = (props: { shortcutBlocked?: boolean } = {}) => {
    wrapper = mount(ChatPanel, { props: { mapFocus: () => map, ...props }, attachTo: document.body })
    return wrapper
  }
  const press = (target: EventTarget, key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key, code: key === ' ' ? 'Space' : key, bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    return event
  }
  const input = () => wrapper!.find<HTMLInputElement>('.ch-input')
  const lastOpen = (w: VueWrapper) => { const all = w.emitted('open') ?? []; return all[all.length - 1] }

  it('Enter on the map opens the chat and focuses the box; this keystroke does not also submit', async () => {
    const w = panel()
    map.focus()
    const event = press(map, 'Enter')
    await flushPromises()
    expect(w.find('.ch-panel').exists()).toBe(true)
    expect(document.activeElement).toBe(input().element)
    expect(event.defaultPrevented).toBe(true)
    expect(sent).toEqual([])
    expect(lastOpen(w)).toEqual([true])
  })

  it('also from nowhere (the page body), and an open chat just gets the cursor back', async () => {
    const w = panel()
    press(document.body, 'Enter'); await flushPromises()
    expect(document.activeElement).toBe(input().element)
    map.focus()
    press(map, 'Enter'); await flushPromises()
    expect(w.find('.ch-panel').exists()).toBe(true)
    expect(document.activeElement).toBe(input().element)
  })

  it('Enter in the box sends through the existing flow; a held (repeating) Enter sends nothing more', async () => {
    panel()
    press(map, 'Enter'); await flushPromises()
    await input().setValue('hola')
    // A repeat of the key that opened the chat (or of the one that just sent) is not a send.
    expect(press(input().element, 'Enter', { repeat: true }).defaultPrevented).toBe(true)
    expect(press(input().element, 'Enter').defaultPrevented).toBe(false) // left to the form's own submit
    await wrapper!.find('form').trigger('submit')
    expect(sent).toEqual(['hola'])
    expect(input().element.value).toBe('')
  })

  it('a held Enter on the map does nothing: only the first press opens', async () => {
    const w = panel()
    map.focus()
    press(map, 'Enter', { repeat: true }); await flushPromises()
    expect(w.find('.ch-panel').exists()).toBe(false)
    expect(document.activeElement).toBe(map)
  })

  it('Escape in the box closes the chat and gives the focus back to the map', async () => {
    const w = panel()
    press(map, 'Enter'); await flushPromises()
    press(input().element, 'Escape'); await flushPromises()
    expect(w.find('.ch-panel').exists()).toBe(false)
    expect(document.activeElement).toBe(map)
  })

  it('while typing, Space, arrows and WASD neither move the trainer nor act; on the map again they do', async () => {
    let interactions = 0
    const keys = new KeyboardInput({ cycleLens: () => {}, toggleGrid: () => {}, skipTime: () => {}, interact: () => { interactions++ } })
    keys.attach()
    try {
      panel()
      map.focus()
      press(map, 'Enter'); await flushPromises()
      for (const [key, code] of [[' ', 'Space'], ['ArrowUp', 'ArrowUp'], ['ArrowLeft', 'ArrowLeft'], ['w', 'KeyW'], ['a', 'KeyA'], ['s', 'KeyS'], ['d', 'KeyD'], ['e', 'KeyE']]) {
        press(input().element, key, { code })
      }
      expect(interactions).toBe(0)
      expect(keys.direction).toBeNull()
      press(input().element, 'Escape'); await flushPromises()
      press(map, 'ArrowUp', { code: 'ArrowUp' })
      expect(keys.direction).toBe('up')
    } finally {
      keys.detach()
    }
  })

  it('leaves every other Enter alone: inputs, buttons, dialogs and the battle controls', async () => {
    const w = panel()
    const field = document.createElement('input')
    const button = document.createElement('button')
    const dialog = document.createElement('section'); dialog.setAttribute('role', 'dialog'); dialog.tabIndex = -1
    const inDialog = document.createElement('button'); dialog.append(inDialog)
    const battle = document.createElement('section'); battle.className = 'ebp'; battle.tabIndex = -1
    const move = document.createElement('button'); battle.append(move)
    document.body.append(field, button, dialog, battle)
    for (const target of [field, button, dialog, inDialog, battle, move]) {
      target.focus()
      const event = press(target, 'Enter')
      await flushPromises()
      expect(w.find('.ch-panel').exists(), target.outerHTML).toBe(false)
      expect(event.defaultPrevented, target.outerHTML).toBe(false)
      expect(document.activeElement).toBe(target)
    }
  })

  it('during a battle the map Enter still opens the chat (the panel on screen changes nothing)', async () => {
    const w = panel()
    const battle = document.createElement('section'); battle.className = 'ebp'
    battle.append(document.createElement('button'))
    document.body.append(battle)
    map.focus()
    press(map, 'Enter'); await flushPromises()
    expect(w.find('.ch-panel').exists()).toBe(true)
    expect(document.activeElement).toBe(input().element)
  })

  it('not when something sits over the map, with a modifier, or without a map to type from', async () => {
    const blocked = panel({ shortcutBlocked: true })
    map.focus()
    press(map, 'Enter'); await flushPromises()
    expect(blocked.find('.ch-panel').exists()).toBe(false)
    blocked.unmount()

    const w = panel()
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey']) press(map, 'Enter', { [modifier]: true })
    await flushPromises()
    expect(w.find('.ch-panel').exists()).toBe(false)
    w.unmount()

    wrapper = mount(ChatPanel, { attachTo: document.body }) // no mapFocus: no shortcut, as before
    press(document.body, 'Enter'); await flushPromises()
    expect(wrapper.find('.ch-panel').exists()).toBe(false)
  })

  it('stops listening when unmounted', async () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    panel().unmount(); wrapper = null
    const added = add.mock.calls.filter(([type]) => type === 'keydown').map(([, fn]) => fn)
    const removed = remove.mock.calls.filter(([type]) => type === 'keydown').map(([, fn]) => fn)
    add.mockRestore(); remove.mockRestore()
    expect(added.length).toBeGreaterThan(0)
    expect(removed).toEqual(expect.arrayContaining(added))
    press(document.body, 'Enter'); await flushPromises()
    expect(useChat().open.value).toBe(false)
  })
})
