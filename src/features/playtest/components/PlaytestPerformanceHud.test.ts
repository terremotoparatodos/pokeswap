import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PlaytestPerformanceHud from './PlaytestPerformanceHud.vue'

describe('PlaytestPerformanceHud', () => {
  it('shows client fps, frame cost and an honest unavailable network sample', () => {
    const wrapper = mount(PlaytestPerformanceHud, { props: { fps: 47, frameMs: 18.25 } })
    expect(wrapper.text()).toContain('47 FPS')
    expect(wrapper.text()).toContain('18.3 ms frame')
    expect(wrapper.text()).toContain('… red')
    wrapper.unmount()
  })
})
