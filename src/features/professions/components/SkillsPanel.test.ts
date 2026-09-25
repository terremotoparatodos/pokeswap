import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SkillsPanel from './SkillsPanel.vue'
import { useProfessionDemo } from '../demo/useProfessionDemo'

// MOBILE-1: the button that opens Skills closes it; × is the alternative.
describe('SkillsPanel open and close', () => {
  it('toggles from the same button, with a fixed header and a scrolling body', async () => {
    const wrapper = mount(SkillsPanel, { props: { session: useProfessionDemo() } })
    const tab = () => wrapper.get('.sk-tab')
    await tab().trigger('click')
    expect(tab().attributes('aria-expanded')).toBe('true')
    expect(tab().classes()).toContain('sk-tab--on')
    // The header is outside the scrolling part, so its × never scrolls away.
    expect(wrapper.find('.sk-panel > .sk-head .sk-x').exists()).toBe(true)
    expect(wrapper.find('.sk-panel > .sk-scroll .sk-list').exists()).toBe(true)
    await tab().trigger('click')
    expect(wrapper.find('.sk-panel').exists()).toBe(false)
    wrapper.unmount()
  })

  it('closes from ×, closes when the host asks, and reports each change', async () => {
    const wrapper = mount(SkillsPanel, { props: { session: useProfessionDemo() } })
    await wrapper.get('.sk-tab').trigger('click')
    await wrapper.get('.sk-x').trigger('click')
    expect(wrapper.find('.sk-panel').exists()).toBe(false)
    await wrapper.get('.sk-tab').trigger('click')
    ;(wrapper.vm as unknown as { close: () => void }).close()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sk-panel').exists()).toBe(false)
    expect(wrapper.emitted('open')?.map(([open]) => open)).toEqual([true, false, true, false])
    wrapper.unmount()
  })
})
