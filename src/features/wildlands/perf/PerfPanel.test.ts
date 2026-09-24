import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PerfPanel from './PerfPanel.vue'
import type { PerfSession } from './perfSession'

// MOBILE-1: on a phone the capture panel is a single bar, and stays usable.
function session() {
  const report = () => ({
    cadence: { observedHz: 60, nominalHz: 60 }, intervalMs: { p50: 16.7, p95: 16.7, p99: 16.8 }, latePercent: 0, over50ms: 0,
    unevenPercent: 0, stalledFrames: 0, lifecycle: { maxConcurrent: 0 }, motion: { snaps: 0, stopAndGo: 0 },
    sprites: { fallbackToSheet: 0, sheetToFallback: 0 },
  })
  const s = {
    isRecording: false,
    start: vi.fn(() => { s.isRecording = true }),
    stop: vi.fn(() => { s.isRecording = false }),
    export: vi.fn(() => ({ tool: 'test' })),
    pacing: { report }, motion: { report }, remote: { report },
  }
  return s
}
const phone = (matches: boolean) => {
  localStorage.clear()
  window.matchMedia = ((query: string) => ({ matches, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
}

describe('PerfPanel on a phone', () => {
  afterEach(() => vi.useRealTimers())

  it('starts folded, opens to start a capture, and keeps Detener in the bar while recording', async () => {
    phone(true)
    const s = session()
    const wrapper = mount(PerfPanel, { props: { session: s as unknown as PerfSession } })
    expect(wrapper.find('.pp--bar').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Iniciar')

    await wrapper.get('.pp-fold').trigger('click')
    const start = wrapper.findAll('button').find(b => b.text() === 'Iniciar')!
    await start.trigger('click')
    expect(s.start).toHaveBeenCalledOnce()

    await wrapper.get('.pp-fold').trigger('click')
    expect(wrapper.find('.pp--bar').exists()).toBe(true)
    const stop = wrapper.findAll('button').find(b => b.text() === 'Detener')!
    await stop.trigger('click')
    expect(s.stop).toHaveBeenCalledOnce()
    expect(wrapper.findAll('button').some(b => b.text() === 'Enviar a PC')).toBe(true)
    wrapper.unmount()
  })

  it('starts open on a desktop', () => {
    phone(false)
    const wrapper = mount(PerfPanel, { props: { session: session() as unknown as PerfSession } })
    expect(wrapper.find('.pp--bar').exists()).toBe(false)
    expect(wrapper.text()).toContain('Iniciar')
    wrapper.unmount()
  })
})
