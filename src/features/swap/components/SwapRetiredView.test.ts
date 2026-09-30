import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SwapRetiredView from './SwapRetiredView.vue'
import source from './SwapRetiredView.vue?raw'
import { SWAP_RETIRED_NOTICE } from '../retired'

describe('SwapRetiredView', () => {
  it('says Swap is retired and what the building will host, with nothing to press', () => {
    const wrapper = mount(SwapRetiredView)
    expect(wrapper.text()).toBe(SWAP_RETIRED_NOTICE)
    expect(SWAP_RETIRED_NOTICE).toMatch(/intercambio fue retirado/)
    expect(SWAP_RETIRED_NOTICE).toMatch(/huevos e incubación/)
    expect(wrapper.findAll('button, form, input, a')).toHaveLength(0)
  })

  it('imports nothing that could reach a backend or a store', () => {
    const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map(match => match[1])
    expect(imports).toEqual(['../retired'])
  })
})
