// The two doors that open during the playtest, and the ones that do not.
//
// These are mounted rather than reasoned about because the interesting parts
// are refusals: a seventh party member, an empty party, a purchase you cannot
// afford, a second copy of a tool. A domain test proves the rule; mounting
// proves the button is actually wired to it and actually goes grey.

import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import CityPanel from './CityPanel.vue'
import { MAX_PARTY } from '../../dungeonPrototype/domain/party'
import { playtestSurfaceFor } from '../domain/cityFeatures'
import { PLAYTEST_START_COINS } from '../domain/playtestShop'
import { usePlaytestStore } from '../state/usePlaytestStore'

const store = usePlaytestStore()

const open = (feature: Parameters<typeof playtestSurfaceFor>[0]) =>
  mount(CityPanel, { props: { surface: playtestSurfaceFor(feature) } })

beforeEach(() => store.reset())

describe('a closed door', () => {
  it('says it is closed and why, instead of doing nothing', () => {
    const wrapper = open('swap')
    expect(wrapper.text()).toContain('No disponible durante Community Playtest 0.1')
    expect(wrapper.text()).toContain('Swap')
    expect(wrapper.find('.cp-title').text()).toBe('Silph Co.')
  })

  it('points the Gimnasio at where Dungeons actually are', () => {
    expect(open('dungeon').text()).toMatch(/cueva/i)
  })
})

describe('the Centro Pokémon', () => {
  it('shows the team and the boxes, and says how full the team is', () => {
    const wrapper = open('caja')
    expect(wrapper.text()).toContain(`Equipo (${store.party.value.length}/${MAX_PARTY})`)
    expect(wrapper.findAll('.pc-row').length).toBe(store.party.value.length + store.box.value.length)
  })

  it('moves a Pokémon to the team and back', async () => {
    const wrapper = open('caja')
    const before = store.party.value.length
    await wrapper.findAll('.pc-col')[1].findAll('.pc-move')[0].trigger('click')
    expect(store.party.value).toHaveLength(before + 1)

    const partyButtons = wrapper.findAll('.pc-col')[0].findAll('.pc-move')
    await partyButtons[partyButtons.length - 1].trigger('click')
    expect(store.party.value).toHaveLength(before)
  })

  it('greys out the box buttons once the team is full, rather than failing on click', async () => {
    const wrapper = open('caja')
    while (store.party.value.length < MAX_PARTY) store.addToParty(store.box.value[0].instanceId)
    await wrapper.vm.$nextTick()

    const boxButtons = wrapper.findAll('.pc-col')[1].findAll('.pc-move')
    expect(boxButtons.length).toBeGreaterThan(0)
    for (const button of boxButtons) expect(button.attributes('disabled')).toBeDefined()
    expect(store.party.value).toHaveLength(MAX_PARTY)
  })

  it('will not let the last Pokémon leave the team', async () => {
    const wrapper = open('caja')
    while (store.party.value.length > 1) {
      const members = store.party.value
      store.sendToBox(members[members.length - 1].instanceId)
    }
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('.pc-col')[0].findAll('.pc-move')[0].attributes('disabled')).toBeDefined()
  })

  it('heals, and says so', async () => {
    const wrapper = open('caja')
    await wrapper.find('.pc-heal-btn').trigger('click')
    expect(store.hurt.value).toBe(false)
    expect(wrapper.find('.pc-notice').text()).toContain('como nuevo')
  })
})

describe('the Tienda', () => {
  it('shows the purse and every entry', () => {
    const wrapper = open('mercado')
    expect(wrapper.find('.sh-purse').text()).toContain(String(PLAYTEST_START_COINS))
    expect(wrapper.findAll('.sh-row').length).toBeGreaterThan(4)
  })

  it('charges once and then marks the tool as owned', async () => {
    const wrapper = open('mercado')
    const row = wrapper.findAll('.sh-row').find(entry => entry.text().includes('Pico de piedra'))!
    await row.find('.sh-buy').trigger('click')

    expect(store.coins.value).toBe(PLAYTEST_START_COINS - 60)
    expect(store.tools.value).toContain('stone_pickaxe')
    await wrapper.vm.$nextTick()
    expect(row.find('.sh-buy').text()).toBe('Comprado')
    expect(row.find('.sh-buy').attributes('disabled')).toBeDefined()
  })

  it('cannot be double-clicked into a second copy or a second charge', async () => {
    const wrapper = open('mercado')
    const row = wrapper.findAll('.sh-row').find(entry => entry.text().includes('Caña básica'))!
    await row.find('.sh-buy').trigger('click')
    await row.find('.sh-buy').trigger('click')
    await row.find('.sh-buy').trigger('click')

    expect(store.coins.value).toBe(PLAYTEST_START_COINS - 70)
    expect(store.tools.value.filter(id => id === 'basic_rod')).toHaveLength(1)
  })

  it('lets supplies be bought repeatedly, and stacks them', async () => {
    const wrapper = open('mercado')
    const row = wrapper.findAll('.sh-row').find(entry => entry.text().includes('Poké Ball'))!
    const before = store.supplies.value.poke_ball ?? 0
    await row.find('.sh-buy').trigger('click')
    await row.find('.sh-buy').trigger('click')
    expect(store.supplies.value.poke_ball).toBe(before + 10)
  })

  it('refuses when the purse runs out, and never goes negative', async () => {
    while (store.coins.value >= 40) store.purchase('poke_ball_5')
    const wrapper = open('mercado')
    const row = wrapper.findAll('.sh-row').find(entry => entry.text().includes('Poké Ball'))!
    expect(row.find('.sh-buy').attributes('disabled')).toBeDefined()
    expect(store.coins.value).toBeGreaterThanOrEqual(0)
  })
})
