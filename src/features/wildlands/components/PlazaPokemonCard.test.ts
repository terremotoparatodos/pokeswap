import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ActivityBoard from './ActivityBoard.vue'
import PlazaNotice from './PlazaNotice.vue'
import PlazaPokemonCard from './PlazaPokemonCard.vue'

const HOSTILE = '<img src=x onerror="alert(1)">'

describe('PlazaPokemonCard', () => {
  const card = { pokemonId: 25, name: 'Pikachu', ownerUsername: HOSTILE, price: 12500, owned: true, mine: false }

  it('renders the owner username as text, never as HTML', () => {
    const wrapper = mount(PlazaPokemonCard, { props: { card } })
    expect(wrapper.find('.pc-owner').text()).toBe(HOSTILE)
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('.pc-price').text()).toBe('12.500 tokens')
    expect(wrapper.find('.pc-mine').exists()).toBe(false)
  })

  it('marks the viewer’s own Pokémon and handles one that lost its owner', () => {
    expect(mount(PlazaPokemonCard, { props: { card: { ...card, mine: true } } }).find('.pc-mine').text()).toBe('Tuyo')
    const gone = mount(PlazaPokemonCard, { props: { card: { ...card, owned: false } } })
    expect(gone.find('.pc-facts').exists()).toBe(false)
    expect(gone.find('.pc-muted').text()).toContain('Ya no tiene dueño')
  })

  it('opens the market and closes', async () => {
    const wrapper = mount(PlazaPokemonCard, { props: { card }, attachTo: document.body })
    await wrapper.find('.pc-market').trigger('click')
    expect(wrapper.emitted('market')).toHaveLength(1)
    await wrapper.find('.pc-close').trigger('click')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toHaveLength(2)
    wrapper.unmount()
  })
})

describe('ActivityBoard and PlazaNotice', () => {
  it('render database text as text', () => {
    const board = mount(ActivityBoard, {
      props: { entries: [{ id: 'a', label: HOSTILE, pokemon: HOSTILE, when: 'recién' }], connected: true, loadError: false },
    })
    expect(board.find('.ab-label').text()).toBe(HOSTILE)
    expect(board.find('.ab-pokemon').text()).toBe(HOSTILE)
    expect(board.find('img').exists()).toBe(false)

    const notice = mount(PlazaNotice, { props: { text: HOSTILE } })
    expect(notice.text()).toBe(HOSTILE)
    expect(notice.find('img').exists()).toBe(false)
  })

  it('shows an empty board and a read error', () => {
    expect(mount(ActivityBoard, { props: { entries: [], connected: false, loadError: false } }).find('.ab-empty').text()).toContain('Todavía')
    expect(mount(ActivityBoard, { props: { entries: [], connected: false, loadError: true } }).find('[role="alert"]').exists()).toBe(true)
  })
})
