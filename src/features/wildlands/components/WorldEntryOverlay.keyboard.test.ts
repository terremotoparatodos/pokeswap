import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, type PropType } from 'vue'
import { initialWorldEntry, nextWorldEntry, type WorldEntryEvent, type WorldEntryState } from '../multiplayer/domain/worldEntry'
import WorldEntryOverlay from './WorldEntryOverlay.vue'
import { KEEP_INTERACTIVE } from './entryInert'

// PRESENCE UX-1 R4: the overlay with what it covers, as WildlandsView lays it
// out (world canvas, HUD controls, chat input and the sign-in dialog are its
// siblings). jsdom has no tab navigation, so the tab order is computed: every
// focusable element outside an inert subtree, in document order.

const run = (...events: WorldEntryEvent['type'][]): WorldEntryState =>
  events.reduce((state, type) => nextWorldEntry(state, { type } as WorldEntryEvent), initialWorldEntry(true))
const ready = run('snapshot', 'prepared')

const Host = defineComponent({
  props: {
    state: { type: Object as PropType<WorldEntryState>, required: true },
    signIn: { type: Boolean, default: false },
    toast: { type: Boolean, default: false },
  },
  emits: ['retry'],
  setup(props, { emit }) {
    return () => h('div', { class: 'wl' }, [
      h('canvas', { id: 'world', tabindex: 0 }),
      h('button', { id: 'hud', type: 'button' }, 'Menú'),
      h('input', { id: 'chat' }),
      h(WorldEntryOverlay, { state: props.state, onRetry: () => emit('retry') }),
      props.toast ? h('button', { id: 'late', type: 'button' }, 'Aviso') : null,
      props.signIn
        ? h('div', { class: 'auth-overlay', [KEEP_INTERACTIVE]: '' }, [h('div', { role: 'dialog', 'aria-modal': 'true' }, [h('button', { id: 'google', type: 'button' }, 'Google')])])
        : null,
    ])
  },
})

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
const tabOrder = () => Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(element => !element.closest('[inert]')).map(element => element.id || element.textContent)
const active = () => (document.activeElement as HTMLElement | null)?.id || document.activeElement?.textContent || null
/** What one Tab press reaches from the focused element (wrapping, as the browser would within the page). */
function tab(): string | null {
  const order = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(element => !element.closest('[inert]'))
  if (order.length === 0) return null
  const next = order[(order.indexOf(document.activeElement as HTMLElement) + 1) % order.length]
  next.focus()
  return active()
}
const settle = async () => { await nextTick(); await nextTick(); await Promise.resolve() }

let wrapper: VueWrapper | null = null
const host = async (state: WorldEntryState, extra: { signIn?: boolean; toast?: boolean } = {}) => {
  wrapper = mount(Host, { props: { state, ...extra }, attachTo: document.body })
  await settle()
  return wrapper
}
afterEach(() => { wrapper?.unmount(); wrapper = null; document.body.replaceChildren() })

describe('world entry overlay: keyboard and focus (PRESENCE UX-1 R4)', () => {
  it('while connecting nothing under it can be reached with Tab', async () => {
    await host(run())
    expect(document.querySelectorAll('#world[inert], #hud[inert], #chat[inert]')).toHaveLength(3)
    expect(tabOrder()).toEqual([])
    expect(tab()).toBeNull()
  })

  it('a loss moves the keyboard out of the chat input it covers', async () => {
    const w = await host(ready)
    ;(document.getElementById('chat') as HTMLInputElement).focus()
    expect(active()).toBe('chat')
    await w.setProps({ state: nextWorldEntry(ready, { type: 'lost' }) })
    await settle()
    expect(document.getElementById('chat')!.hasAttribute('inert')).toBe(true)
    expect(active()).not.toBe('chat')
    expect(tabOrder()).toEqual([])
  })

  it('an error focuses Reintentar, the only stop in the tab order, which still retries', async () => {
    const w = await host(run())
    await w.setProps({ state: run('timeout') })
    await settle()
    expect(active()).toBe('Reintentar')
    expect(tabOrder()).toEqual(['Reintentar'])
    expect(tab()).toBe('Reintentar')
    expect(tab()).toBe('Reintentar')
    ;(document.activeElement as HTMLButtonElement).click()
    expect(w.emitted('retry')).toHaveLength(1)
  })

  it('the reconnect error also lands on Reintentar', async () => {
    const lost = nextWorldEntry(ready, { type: 'lost' })
    const w = await host(lost)
    await w.setProps({ state: nextWorldEntry(lost, { type: 'timeout' }) })
    await settle()
    expect(active()).toBe('Reintentar')
    expect(tabOrder()).toEqual(['Reintentar'])
  })

  it('replaced (4001) focuses its message, offers no button and nothing to tab to', async () => {
    const w = await host(ready)
    await w.setProps({ state: nextWorldEntry(ready, { type: 'replaced' }) })
    await settle()
    expect(document.activeElement?.textContent).toBe('Tu sesión se abrió en otra pestaña o dispositivo.')
    expect(document.activeElement?.getAttribute('tabindex')).toBe('-1')
    expect(document.querySelector('[data-testid="world-entry"] button')).toBeNull()
    expect(tabOrder()).toEqual([])
  })

  it('once ready nothing stays inert and the keyboard is not left on the gone overlay', async () => {
    const w = await host(run('timeout'))
    expect(active()).toBe('Reintentar')
    await w.setProps({ state: ready })
    await settle()
    expect(document.querySelectorAll('[inert]')).toHaveLength(0)
    expect(document.querySelector('[data-testid="world-entry"]')).toBeNull()
    expect(document.activeElement === document.body || !document.activeElement?.isConnected).toBe(true)
    expect(tabOrder()).toEqual(['world', 'hud', 'chat'])
  })

  it('what appears while it is shown is covered too; the sign-in dialog above it is not', async () => {
    const w = await host(run())
    await w.setProps({ toast: true, signIn: true })
    await settle()
    expect(document.getElementById('late')!.hasAttribute('inert')).toBe(true)
    expect(document.querySelector('.auth-overlay')!.hasAttribute('inert')).toBe(false)
    expect(tabOrder()).toEqual(['google'])
  })

  it('unmounting while shown gives everything back', async () => {
    const w = await host(run())
    expect(document.querySelectorAll('[inert]').length).toBeGreaterThan(0)
    w.unmount()
    wrapper = null
    expect(document.querySelectorAll('[inert]')).toHaveLength(0)
  })
})
