import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, type PropType } from 'vue'
import { initialWorldEntry, nextWorldEntry, type WorldEntryEvent, type WorldEntryState } from '../multiplayer/domain/worldEntry'
import AuthModal from '../../auth/components/AuthModal.vue'
import WorldEntryOverlay from './WorldEntryOverlay.vue'

// PRESENCE UX-1 R4: the overlay's `inert` over a whole entry lifecycle, with
// the real sign-in dialog among what it covers. Every phase change goes
// through the real state machine.

vi.mock('../../auth/api/authApi', () => ({
  loginWithEmail: vi.fn(), loginWithGoogle: vi.fn(), signUp: vi.fn(), resetPassword: vi.fn(),
}))

/** Every MutationObserver the overlay creates, and which of them still observe. */
const observers = { created: 0, active: new Set<MutationObserver>(), peak: 0 }
class CountedObserver extends MutationObserver {
  constructor(callback: MutationCallback) { super(callback); observers.created++ }
  observe(target: Node, options?: MutationObserverInit): void {
    super.observe(target, options)
    observers.active.add(this)
    observers.peak = Math.max(observers.peak, observers.active.size)
  }
  disconnect(): void { super.disconnect(); observers.active.delete(this) }
}

const Host = defineComponent({
  props: {
    state: { type: Object as PropType<WorldEntryState>, required: true },
    signIn: { type: Boolean, default: false },
  },
  setup(props) {
    return () => h('div', { class: 'wl' }, [
      h('canvas', { id: 'world', tabindex: 0 }),
      h('button', { id: 'hud', type: 'button' }, 'Menú'),
      // Inert before the overlay ever showed: it must stay exactly so.
      h('div', { id: 'was-inert', inert: '' }, [h('button', { type: 'button' }, 'oculto')]),
      h(WorldEntryOverlay, { state: props.state }),
      h(AuthModal, { open: props.signIn }),
    ])
  },
})

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
const reachable = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(element => element.matches(FOCUSABLE) && !element.closest('[inert]'))
const inertIds = () => Array.from(document.querySelectorAll('[inert]')).map(element => element.id || element.className)
const settle = async () => { await nextTick(); await nextTick(); await new Promise(resolve => setTimeout(resolve, 0)) }

let wrapper: VueWrapper | null = null
beforeEach(() => {
  observers.created = 0; observers.active.clear(); observers.peak = 0
  vi.stubGlobal('MutationObserver', CountedObserver)
})
afterEach(() => { wrapper?.unmount(); wrapper = null; document.body.replaceChildren(); vi.unstubAllGlobals() })

describe('entry overlay inert lifecycle (PRESENCE UX-1 R4)', () => {
  it('connecting → error → retry → ready → reconnecting → error → retry → ready → replaced → unmount', async () => {
    let state = initialWorldEntry(true)
    const step = async (...events: WorldEntryEvent['type'][]) => {
      state = events.reduce((current, type) => nextWorldEntry(current, { type } as WorldEntryEvent), state)
      await wrapper!.setProps({ state })
      await settle()
      expect(observers.active.size).toBeLessThanOrEqual(1)
    }
    wrapper = mount(Host, { props: { state }, attachTo: document.body })
    await settle()
    const covered = ['world', 'hud', 'was-inert']

    expect(inertIds().sort()).toEqual(covered.slice().sort())
    await step('timeout')
    expect(inertIds().sort()).toEqual(covered.slice().sort())
    await step('retry')
    await step('snapshot', 'prepared')
    expect(state.phase).toBe('ready')
    expect(inertIds()).toEqual(['was-inert'])
    expect(observers.active.size).toBe(0)
    await step('lost')
    expect(inertIds().sort()).toEqual(covered.slice().sort())
    await step('timeout')
    await step('retry')
    await step('snapshot', 'prepared')
    expect(inertIds()).toEqual(['was-inert'])
    expect(observers.active.size).toBe(0)
    await step('replaced')
    expect(inertIds().sort()).toEqual(covered.slice().sort())

    wrapper.unmount()
    wrapper = null
    await settle()
    expect(observers.active.size).toBe(0)
    // One observer per time the overlay appeared (first entry, the loss, replaced), never two at once.
    expect(observers.created).toBe(3)
    expect(observers.peak).toBe(1)
  })

  it('leaves the real sign-in dialog usable, whether it opened before or during the overlay', async () => {
    const lost = nextWorldEntry(nextWorldEntry(nextWorldEntry(initialWorldEntry(true), { type: 'snapshot' }), { type: 'prepared' }), { type: 'lost' })
    wrapper = mount(Host, { props: { state: lost, signIn: true }, attachTo: document.body })
    await settle()
    expect(document.querySelector('.auth-overlay')!.hasAttribute('inert')).toBe(false)
    expect(reachable('.auth-overlay button, .auth-overlay input').length).toBeGreaterThan(1)
    expect(reachable('#world, #hud')).toEqual([])

    await wrapper.setProps({ signIn: false })
    await settle()
    await wrapper.setProps({ signIn: true })
    await settle()
    expect(document.querySelector('.auth-overlay')!.hasAttribute('inert')).toBe(false)
    expect(reachable('.auth-overlay input').length).toBeGreaterThan(0)

    await wrapper.setProps({ state: nextWorldEntry(nextWorldEntry(lost, { type: 'snapshot' }), { type: 'prepared' }) })
    await settle()
    expect(inertIds()).toEqual(['was-inert'])
  })
})
