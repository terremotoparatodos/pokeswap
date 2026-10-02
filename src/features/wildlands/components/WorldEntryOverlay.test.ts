import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { initialWorldEntry, nextWorldEntry, type WorldEntryEvent, type WorldEntryState } from '../multiplayer/domain/worldEntry'
import WorldEntryOverlay from './WorldEntryOverlay.vue'

const run = (...events: WorldEntryEvent['type'][]): WorldEntryState =>
  events.reduce((state, type) => nextWorldEntry(state, { type } as WorldEntryEvent), initialWorldEntry(true))
const view = (state: WorldEntryState) => mount(WorldEntryOverlay, { props: { state } })

describe('WorldEntryOverlay (PRESENCE UX-1)', () => {
  it('connecting: an opaque “Entrando al mundo…”, never the town’s arrival text, and no button', () => {
    const wrapper = view(run())
    expect(wrapper.text()).toBe('Entrando al mundo…')
    expect(wrapper.text()).not.toContain('Ciudad')
    expect(wrapper.attributes('role')).toBe('status')
    expect(wrapper.attributes('aria-busy')).toBe('true')
    expect(wrapper.classes()).not.toContain('wl-entry--scene')
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('stays “Entrando al mundo…” while the server’s area is still being prepared', () => {
    expect(view(run('snapshot')).text()).toBe('Entrando al mundo…')
  })

  it('disappears once the scene is ready, and is never shown offline', () => {
    expect(view(run('snapshot', 'prepared')).find('[data-testid="world-entry"]').exists()).toBe(false)
    expect(view(initialWorldEntry(false)).find('[data-testid="world-entry"]').exists()).toBe(false)
  })

  it('reconnecting: “Reconectando…” over the dimmed last scene', () => {
    const wrapper = view(run('snapshot', 'prepared', 'lost'))
    expect(wrapper.text()).toBe('Reconectando…')
    expect(wrapper.classes()).toContain('wl-entry--scene')
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('entry error: an alert with an accessible Reintentar button that emits retry', async () => {
    const wrapper = view(run('timeout'))
    expect(wrapper.attributes('role')).toBe('alert')
    expect(wrapper.find('.wl-entry-text').text()).toBe('No pudimos entrar al mundo.')
    const button = wrapper.get('button')
    expect(button.text()).toBe('Reintentar')
    expect(button.attributes('type')).toBe('button')
    await button.trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('reconnect error: its own wording, same button', () => {
    const wrapper = view(run('snapshot', 'prepared', 'lost', 'timeout'))
    expect(wrapper.find('.wl-entry-text').text()).toBe('No pudimos reconectar.')
    expect(wrapper.get('button').text()).toBe('Reintentar')
  })

  it('replaced (4001): says so, with no retry offered', () => {
    const wrapper = view(run('snapshot', 'prepared', 'replaced'))
    expect(wrapper.attributes('role')).toBe('alert')
    expect(wrapper.text()).toBe('Tu sesión se abrió en otra pestaña.')
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('markup per state (visual guard)', () => {
    const states: Record<string, WorldEntryState> = {
      connecting: run(), reconnecting: run('snapshot', 'prepared', 'lost'),
      entryError: run('timeout'), reconnectError: run('snapshot', 'prepared', 'lost', 'timeout'),
      replaced: run('replaced'),
    }
    const markup = Object.fromEntries(Object.entries(states).map(([name, state]) => [name, view(state).html()]))
    expect(markup).toMatchSnapshot()
  })
})
