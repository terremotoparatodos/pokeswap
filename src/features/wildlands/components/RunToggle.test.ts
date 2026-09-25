import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import RunToggle from './RunToggle.vue'

describe('RunToggle', () => {
  it('toggles the run mode and says which one is on', async () => {
    const wrapper = mount(RunToggle, { props: { active: false } })
    expect(wrapper.attributes('aria-pressed')).toBe('false')
    expect(wrapper.text()).toContain('Correr')
    await wrapper.trigger('click')
    expect(wrapper.emitted('update:active')).toEqual([[true]])
    await wrapper.setProps({ active: true })
    expect(wrapper.attributes('aria-pressed')).toBe('true')
    expect(wrapper.classes()).toContain('wl-run--on')
    expect(wrapper.text()).toContain('Corriendo')
    await wrapper.trigger('click')
    expect(wrapper.emitted('update:active')).toEqual([[true], [false]])
  })
})
