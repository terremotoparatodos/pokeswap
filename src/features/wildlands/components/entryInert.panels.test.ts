import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, type PropType } from 'vue'
import { initialWorldEntry, nextWorldEntry, type WorldEntryEvent, type WorldEntryState } from '../multiplayer/domain/worldEntry'
import AuthModal from '../../auth/components/AuthModal.vue'
import LobbyPanel from './LobbyPanel.vue'
import PlazaPokemonCard from './PlazaPokemonCard.vue'
import WildPokemonCard from './WildPokemonCard.vue'
import WorldEntryOverlay from './WorldEntryOverlay.vue'
import { KEEP_INTERACTIVE } from './entryInert'

// PRESENCE UX-1 R4: the dialogs that live under the overlay. A feature panel
// and the plaza's cards are `aria-modal` dialogs too, yet they sit below the
// overlay, so they go inert with the rest of the world; only the sign-in
// dialog (marked as WildlandsView marks it) stays usable. Real components,
// laid out as WildlandsView lays them out: LobbyPlaza is a fragment, so its
// cards are direct children of `.wl`, like the panel and the sign-in dialog.

vi.mock('../../auth/api/authApi', () => ({
  loginWithEmail: vi.fn(), loginWithGoogle: vi.fn(), signUp: vi.fn(), resetPassword: vi.fn(),
}))

const observers = { active: new Set<MutationObserver>() }
class CountedObserver extends MutationObserver {
  observe(target: Node, options?: MutationObserverInit): void { super.observe(target, options); observers.active.add(this) }
  disconnect(): void { super.disconnect(); observers.active.delete(this) }
}

const card = { pokemonId: 25, name: 'Pikachu', ownerUsername: 'ash', price: 120, owned: true, mine: false }
const wild = { id: 16, name_es: 'Pidgey', type1: 'normal', type2: 'volador', sprite_url: null }
const activations: string[] = []

const Host = defineComponent({
  props: {
    state: { type: Object as PropType<WorldEntryState>, required: true },
    panel: Boolean, plaza: Boolean, wild: Boolean, signIn: Boolean,
  },
  setup(props) {
    return () => h('div', { class: 'wl' }, [
      h('canvas', { id: 'world', tabindex: 0 }),
      h('div', { id: 'was-inert', inert: '' }, [h('button', { type: 'button' }, 'oculto')]),
      h(WorldEntryOverlay, { state: props.state }),
      props.plaza ? h(PlazaPokemonCard, { card, onClose: () => activations.push('plaza:close'), onMarket: () => activations.push('plaza:market') }) : null,
      props.wild ? h(WildPokemonCard, { pokemon: wild, onClose: () => activations.push('wild:close'), onFeature: (f: string) => activations.push(`wild:${f}`) }) : null,
      props.panel
        ? h(LobbyPanel, { title: 'Mercado', onClose: () => activations.push('panel:close') }, () => [
          h('a', { href: '#comprar', id: 'panel-link' }, 'Comprar'),
          h('input', { id: 'panel-input' }),
          h('button', { id: 'panel-buy', type: 'button', onClick: () => activations.push('panel:buy') }, 'Confirmar'),
        ])
        : null,
      h(AuthModal, { open: props.signIn, [KEEP_INTERACTIVE]: '', onClose: () => activations.push('auth:close') }),
    ])
  },
})

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
/** What Tab and focus can reach: focusable and outside an inert subtree, as a browser enforces it. */
const reachable = (root: string) => Array.from(document.querySelectorAll<HTMLElement>(`${root}, ${root} *`))
  .filter(element => element.matches(FOCUSABLE) && !element.closest('[inert]'))
const covered = (root: string) => document.querySelector(root)!.closest('[inert]') !== null
const settle = async () => { await nextTick(); await nextTick(); await new Promise(resolve => setTimeout(resolve, 0)) }

const run = (...events: WorldEntryEvent['type'][]) => events.reduce((state, type) => nextWorldEntry(state, { type } as WorldEntryEvent), initialWorldEntry(true))
const PHASES: Record<string, WorldEntryState> = {
  connecting: run(),
  reconnecting: run('snapshot', 'prepared', 'lost'),
  'connection-error': run('timeout'),
  replaced: run('snapshot', 'prepared', 'replaced'),
}
const ready = run('snapshot', 'prepared')
const UNDER = ['.lp-backdrop', '.pc-backdrop', '.wc-backdrop']

let wrapper: VueWrapper | null = null
beforeEach(() => { activations.length = 0; observers.active.clear(); vi.stubGlobal('MutationObserver', CountedObserver) })
afterEach(() => { wrapper?.unmount(); wrapper = null; document.body.replaceChildren(); vi.unstubAllGlobals() })

describe('dialogs under the world entry overlay (PRESENCE UX-1 R4)', () => {
  for (const [phase, state] of Object.entries(PHASES)) {
    it(`${phase}: panel and cards are inert and unreachable; the sign-in dialog stays usable`, async () => {
      wrapper = mount(Host, { props: { state, panel: true, plaza: true, wild: true, signIn: true }, attachTo: document.body })
      await settle()
      expect(state.phase).toBe(phase)
      for (const root of UNDER) {
        expect(covered(root)).toBe(true)
        expect(reachable(root)).toEqual([])
      }
      // The panel's own link, input and button, and each card's buttons, are all out of reach.
      for (const id of ['panel-link', 'panel-input', 'panel-buy']) expect(document.getElementById(id)!.closest('[inert]')).not.toBeNull()
      expect(document.querySelectorAll('.pc-backdrop button, .wc-backdrop button').length).toBeGreaterThan(2)
      expect(Array.from(document.querySelectorAll('.pc-backdrop button, .wc-backdrop button')).every(button => button.closest('[inert]'))).toBe(true)
      // The sign-in dialog: not inert, its fields reachable, typing and closing work.
      expect(covered('.auth-overlay')).toBe(false)
      const fields = reachable('.auth-overlay')
      expect(fields.length).toBeGreaterThan(2)
      const input = document.querySelector<HTMLInputElement>('.auth-overlay input')!
      input.focus()
      expect(document.activeElement).toBe(input)
      await wrapper.find('.auth-overlay input').setValue('ash@example.test')
      expect(input.value).toBe('ash@example.test')
      await wrapper.find('.auth-close').trigger('click')
      expect(activations).toEqual(['auth:close'])
    })
  }

  it('someone typing in the sign-in dialog keeps focus when the error arrives', async () => {
    wrapper = mount(Host, { props: { state: run(), signIn: true }, attachTo: document.body })
    await settle()
    const input = document.querySelector<HTMLInputElement>('.auth-overlay input')!
    input.focus()
    await wrapper.setProps({ state: run('timeout') })
    await settle()
    expect(document.activeElement).toBe(input)
  })

  it('opening and closing panel and cards while the overlay already shows covers each new one', async () => {
    wrapper = mount(Host, { props: { state: PHASES.connecting }, attachTo: document.body })
    await settle()
    for (const round of [1, 2]) {
      await wrapper.setProps({ panel: true, plaza: true, wild: true, signIn: true })
      await settle()
      for (const root of UNDER) expect(covered(root), `${root} round ${round}`).toBe(true)
      expect(covered('.auth-overlay')).toBe(false)
      await wrapper.setProps({ panel: false, plaza: false, wild: false, signIn: false })
      await settle()
      for (const root of [...UNDER, '.auth-overlay']) expect(document.querySelector(root)).toBeNull()
    }
    // A new state (the error) does not lose the cover either.
    await wrapper.setProps({ state: PHASES['connection-error'], panel: true })
    await settle()
    expect(covered('.lp-backdrop')).toBe(true)
  })

  it('once ready exactly the previous inert state is back, and unmount leaves no inert and no observer', async () => {
    wrapper = mount(Host, { props: { state: PHASES.reconnecting, panel: true, plaza: true, wild: true, signIn: true }, attachTo: document.body })
    await settle()
    expect(observers.active.size).toBe(1)
    await wrapper.setProps({ state: ready })
    await settle()
    expect(Array.from(document.querySelectorAll('[inert]')).map(element => element.id)).toEqual(['was-inert'])
    for (const root of UNDER) expect(reachable(root).length).toBeGreaterThan(0)
    expect(observers.active.size).toBe(0)
    await wrapper.setProps({ state: nextWorldEntry(ready, { type: 'lost' }) })
    await settle()
    expect(observers.active.size).toBe(1)
    wrapper.unmount()
    wrapper = null
    await settle()
    expect(document.querySelectorAll('[inert]')).toHaveLength(0)
    expect(observers.active.size).toBe(0)
  })
})
