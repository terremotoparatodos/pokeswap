import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WorldHintTray from './WorldHintTray.vue'
import type { WorldHint } from './worldHints'

const dungeon: WorldHint = { id: 'dungeon', badge: 'Dungeon', tone: 'dungeon', text: 'Hay cuevas cerca.' }
const skills: WorldHint = { id: 'skills', badge: 'Skills', tone: 'skills', text: 'Acercate a una roca.' }

describe('WorldHintTray', () => {
  it('draws every hint as a row of one shared body', () => {
    const wrapper = mount(WorldHintTray, { props: { hints: [dungeon, skills] } })
    expect(wrapper.findAll('.wh')).toHaveLength(1)
    const rows = wrapper.findAll('.wh-row')
    expect(rows.map(row => row.find('.wh-badge').text())).toEqual(['Dungeon', 'Skills'])
    expect(rows[0].find('.wh-badge').classes()).toContain('wh-badge--dungeon')
    expect(rows[1].find('.wh-text').text()).toBe('Acercate a una roca.')
  })

  it('draws no empty body when there is nothing to say', () => {
    const wrapper = mount(WorldHintTray, { props: { hints: [] } })
    expect(wrapper.find('.wh').exists()).toBe(false)
  })
})

// MOBILE-1: guidance, not a band that cannot be dismissed.
describe('WorldHintTray closing', () => {
  it('has a title from its hints and closes from × or Entendido into a "?" that reopens it', async () => {
    const wrapper = mount(WorldHintTray, { props: { hints: [dungeon, skills] } })
    expect(wrapper.get('.wh-title').text()).toBe('Dungeon y Skills')
    await wrapper.get('.wh-x').trigger('click')
    expect(wrapper.find('.wh').exists()).toBe(false)
    expect(wrapper.find('.wh-chip').exists()).toBe(true)
    await wrapper.get('.wh-chip').trigger('click')
    expect(wrapper.find('.wh').exists()).toBe(true)
    await wrapper.get('.wh-ok').trigger('click')
    expect(wrapper.find('.wh').exists()).toBe(false)
  })

  it('stays closed while the hints change, and shows nothing when there are none', async () => {
    const wrapper = mount(WorldHintTray, { props: { hints: [dungeon, skills] } })
    await wrapper.get('.wh-ok').trigger('click')
    await wrapper.setProps({ hints: [skills] })
    expect(wrapper.find('.wh').exists()).toBe(false)
    await wrapper.setProps({ hints: [] })
    expect(wrapper.find('.wh-chip').exists()).toBe(false)
  })
})
