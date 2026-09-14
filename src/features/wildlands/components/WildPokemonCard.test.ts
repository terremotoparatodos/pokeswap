import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WildPokemonCard from './WildPokemonCard.vue'

const pokemon = { id: 25, name_es: '<img src=x onerror=alert(1)>', type1: 'electric', type2: null, sprite_url: null }

describe('WildPokemonCard', () => {
  it('renders catalog text literally and only emits navigation intents', async () => {
    const wrapper = mount(WildPokemonCard, { props: { pokemon } })
    expect(wrapper.get('h2').html()).not.toContain('<img src=x')
    expect(wrapper.text()).toContain(pokemon.name_es)
    await wrapper.get('.wc-actions button').trigger('click')
    expect(wrapper.emitted('feature')).toEqual([['pokedex']])
  })
})
