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
