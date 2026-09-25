import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import ChatPanel from './ChatPanel.vue'
import { useChat } from '../state/useChat'

// MOBILE-1: the button that opens the chat closes it; × and Escape are alternatives.
describe('ChatPanel open and close', () => {
  afterEach(() => { useChat().open.value = false })

  const tab = (wrapper: ReturnType<typeof mount>) => wrapper.get('.ch-tab')

  it('toggles from the same button, which shows when the chat is open', async () => {
    const wrapper = mount(ChatPanel)
    expect(wrapper.find('.ch-panel').exists()).toBe(false)
    await tab(wrapper).trigger('click')
    expect(wrapper.find('.ch-panel').exists()).toBe(true)
    expect(tab(wrapper).attributes('aria-expanded')).toBe('true')
    expect(tab(wrapper).classes()).toContain('ch-tab--on')
    await tab(wrapper).trigger('click')
    expect(wrapper.find('.ch-panel').exists()).toBe(false)
    expect(tab(wrapper).attributes('aria-expanded')).toBe('false')
    wrapper.unmount()
  })

  it('also closes from × and from Escape in the box, and tells the host', async () => {
    const wrapper = mount(ChatPanel)
    await tab(wrapper).trigger('click')
    await wrapper.get('.ch-x').trigger('click')
    expect(wrapper.find('.ch-panel').exists()).toBe(false)

    // A connected player, so the box is enabled.
    const chat = useChat()
    chat.attach(() => {})
    chat.sink.setAccess('player')
    await tab(wrapper).trigger('click')
    await wrapper.get('.ch-input').trigger('keydown', { key: 'Escape' })
    chat.attach(null)
    expect(wrapper.find('.ch-panel').exists()).toBe(false)
    expect(wrapper.emitted('open')?.map(([open]) => open)).toEqual([false, true, false, true, false])
    wrapper.unmount()
  })

  it('closes when the host asks', async () => {
    const wrapper = mount(ChatPanel)
    await tab(wrapper).trigger('click')
    ;(wrapper.vm as unknown as { close: () => void }).close()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.ch-panel').exists()).toBe(false)
    wrapper.unmount()
  })
})
