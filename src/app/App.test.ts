import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import { createRouter, createMemoryHistory } from 'vue-router'
import App from './App.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div class="lobby" />' } },
      { path: '/map', component: { template: '<div class="map" />' }, meta: { standalone: true } },
    ],
  })
}

describe('App', () => {
  it('renders the lobby without the old nav bar', async () => {
    const router = makeRouter()
    const wrapper = mount(App, { global: { plugins: [router] } })
    await router.isReady()
    expect(wrapper.find('.lobby').exists()).toBe(true)
    expect(wrapper.find('.app-nav').exists()).toBe(false)
    expect(wrapper.find('.app-back').exists()).toBe(false)
  })

  it('offers a way back to the city on standalone pages', async () => {
    const router = makeRouter()
    await router.push('/map')
    const wrapper = mount(App, { global: { plugins: [router] } })
    await router.isReady()
    expect(wrapper.find('.map').exists()).toBe(true)
    expect(wrapper.find('.app-back').attributes('href')).toBe('/')
  })
})
