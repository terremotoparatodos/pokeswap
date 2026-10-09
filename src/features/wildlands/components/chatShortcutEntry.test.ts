import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defineComponent, h, type PropType } from 'vue'
import ChatPanel from '../../chat/components/ChatPanel.vue'
import { useChat } from '../../chat/state/useChat'
import { initialWorldEntry, nextWorldEntry, worldPlayable, type WorldEntryEvent, type WorldEntryState } from '../multiplayer/domain/worldEntry'
import WorldEntryOverlay from './WorldEntryOverlay.vue'
import viewSource from './WildlandsView.vue?raw'

// CHAT-SHORTCUT-1, CH-R1 (review of 6a01ad9): while the entry overlay covers the world
// (connecting, reconnecting, and its error and replaced states) Enter must not open the chat
// behind it — not even from the page body, where the overlay leaves the focus — and the chat must
// not show up open once the world is back. The block comes from the view's real entry state, not
// from whether sending is possible. Real components, laid out as WildlandsView lays them out.

const run = (...events: WorldEntryEvent['type'][]) => events.reduce((state, type) => nextWorldEntry(state, { type } as WorldEntryEvent), initialWorldEntry(true))
const ready = run('snapshot', 'prepared')
const COVERED: Record<string, WorldEntryState> = {
  connecting: run(),
  reconnecting: run('snapshot', 'prepared', 'lost'),
  'connection-error': run('timeout'),
  replaced: run('snapshot', 'prepared', 'replaced'),
}

const Host = defineComponent({
  props: { state: { type: Object as PropType<WorldEntryState>, required: true } },
  setup(props) {
    const mapFocus = () => document.getElementById('map')
    // The view binds `overHud || !worldPlayable(entry)`; nothing sits over the HUD here.
    return () => h('div', { class: 'wl' }, [
      h('canvas', { id: 'map', tabindex: 0 }),
      h(ChatPanel, { mapFocus, shortcutBlocked: !worldPlayable(props.state) }),
      h(WorldEntryOverlay, { state: props.state }),
    ])
  },
})

const enter = (target: EventTarget) => {
  const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

describe('the chat Enter shortcut and the world entry overlay (CH-R1)', () => {
  let wrapper: VueWrapper | null = null

  beforeEach(() => {
    const chat = useChat()
    chat.attach(() => {})
    chat.sink.setAccess('player') // sending allowed: the block must not depend on it
  })
  afterEach(() => {
    wrapper?.unmount(); wrapper = null
    const chat = useChat()
    chat.attach(null)
    chat.open.value = false
    document.body.replaceChildren()
  })

  for (const [phase, covered] of Object.entries(COVERED)) {
    it(`${phase}: Enter from the body keeps the chat closed, and back to ready it is still closed`, async () => {
      wrapper = mount(Host, { props: { state: ready }, attachTo: document.body })
      document.getElementById('map')!.focus()
      await wrapper.setProps({ state: covered }); await flushPromises()
      expect(document.querySelector('.ch')!.closest('[inert]'), 'the chat is covered').not.toBeNull()
      ;(document.activeElement as HTMLElement | null)?.blur() // where the overlay leaves the focus
      expect(document.activeElement).toBe(document.body)

      const event = enter(document.body); await flushPromises()
      expect(useChat().open.value).toBe(false)
      expect(wrapper.find('.ch-panel').exists()).toBe(false)
      expect(event.defaultPrevented).toBe(false)

      await wrapper.setProps({ state: ready }); await flushPromises()
      expect(document.querySelector('.ch')!.closest('[inert]')).toBeNull()
      expect(useChat().open.value).toBe(false)
      expect(wrapper.find('.ch-panel').exists()).toBe(false)
    })
  }

  it('also with sending already off (connecting access): still closed', async () => {
    useChat().sink.setAccess('connecting')
    wrapper = mount(Host, { props: { state: COVERED.connecting }, attachTo: document.body })
    await flushPromises()
    enter(document.body); await flushPromises()
    expect(useChat().open.value).toBe(false)
  })

  it('ready: the shortcut works as approved (opens and puts the cursor in the box)', async () => {
    wrapper = mount(Host, { props: { state: COVERED.reconnecting }, attachTo: document.body })
    await wrapper.setProps({ state: ready }); await flushPromises()
    const map = document.getElementById('map')!
    map.focus()
    expect(enter(map).defaultPrevented).toBe(true)
    await flushPromises()
    expect(wrapper.find('.ch-panel').exists()).toBe(true)
    expect(document.activeElement).toBe(wrapper.find('.ch-input').element)
  })

  it('the world is playable only offline or live', () => {
    expect(worldPlayable(initialWorldEntry(false))).toBe(true)
    expect(worldPlayable(ready)).toBe(true)
    for (const covered of Object.values(COVERED)) expect(worldPlayable(covered), covered.phase).toBe(false)
  })

  it('WildlandsView binds the chat to that state, on top of what sits over the HUD', () => {
    expect(viewSource).toMatch(/:map-focus="mapFocus"\s+:shortcut-blocked="overHud \|\| !worldPlayable\(entry\)"/)
  })
})
