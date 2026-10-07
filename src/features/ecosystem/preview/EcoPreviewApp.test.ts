// The simulator view forwards its controls to the controller and shows the
// result. Mounted with the real engine; no network, no API.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import EcoPreviewApp from './EcoPreviewApp.vue'

afterEach(() => vi.restoreAllMocks())

const text = (w: ReturnType<typeof mount>, sel: string) => w.get(`[data-test="${sel}"]`).text()

describe('EcoPreviewApp', () => {
  it('labels itself as a simulation and starts the cave at t = 0', () => {
    const w = mount(EcoPreviewApp)
    expect(text(w, 'banner')).toMatch(/SIMULACIÓN LOCAL/)
    expect(text(w, 'clock')).toMatch(/^t = 0\.0 s/)
    expect(text(w, 'status')).toMatch(/active/)
    expect(w.findAll('[data-test="nest-row"]').length).toBe(4)
  })

  it('advances the clock, populates the grid, repeats without change, retires and resets', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const w = mount(EcoPreviewApp)
    await w.get('[data-test="advance-15"]').trigger('click')
    expect(text(w, 'clock')).toMatch(/^t = 15\.0 s/)
    const population = text(w, 'population')
    expect(w.findAll('[data-test="encounter"]').length).toBeGreaterThan(0)

    await w.get('[data-test="repeat"]').trigger('click')
    expect(text(w, 'clock')).toMatch(/^t = 15\.0 s · evaluaciones 3/)
    expect(text(w, 'population')).toBe(population)

    await w.findAll('[data-test="encounter"]')[0].trigger('click')
    expect(text(w, 'selection')).toMatch(/especie #\d+/)
    await w.get('[data-test="retire-defeated"]').trigger('click')
    expect(text(w, 'log')).toMatch(/retirado \(defeated, simulado\)/)

    await w.get('[data-test="reset"]').trigger('click')
    expect(text(w, 'clock')).toMatch(/^t = 0\.0 s · evaluaciones 1/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('switches habitat and empties the area when forced inactive long enough', async () => {
    const w = mount(EcoPreviewApp)
    await w.get('[data-test="zone"]').setValue('pradera.bosque')
    expect(w.findAll('[data-test="nest-row"]').length).toBe(4)
    await w.get('[data-test="advance-15"]').trigger('click')
    await w.get('[data-test="inactive"]').setValue(true)
    await w.get('[data-test="advance-1"]').trigger('click')
    expect(text(w, 'status')).toMatch(/idle .*no simulada/)
    await w.get('[data-test="advance-300"]').trigger('click')
    expect(text(w, 'status')).toMatch(/dormant/)
    expect(w.findAll('[data-test="encounter"]').length).toBe(0)
  })

  it('shows a configuration error instead of running an invalid setup', async () => {
    const w = mount(EcoPreviewApp)
    await w.get('[data-test="param-retryMs"]').setValue(0)
    expect(text(w, 'error')).toMatch(/invalid-respawn/)
  })

  it('compares two configurations', async () => {
    const w = mount(EcoPreviewApp)
    await w.get('[data-test="compare"]').trigger('click')
    expect(text(w, 'comparison')).toMatch(/Encuentros nacidos/)
  })
})

describe('EcoPreviewApp · real map proposal', () => {
  it('switches to the real map, labels it as a proposal, inspects a nest and advances the clock', async () => {
    const w = mount(EcoPreviewApp)
    await w.get('[data-test="layout"]').setValue('real-map')
    expect(text(w, 'banner')).toMatch(/PROPUESTA DE DESARROLLO/)
    expect(w.findAll('[data-test="nest-row"]').length).toBe(3)
    expect(text(w, 'notes')).toMatch(/mapa real cueva-inicial/)
    await w.findAll('[data-test="nest-tile"]')[0].trigger('click')
    expect(text(w, 'nest-detail')).toMatch(/casillas candidatas/)
    await w.get('[data-test="advance-15"]').trigger('click')
    expect(w.findAll('[data-test="encounter"]').length).toBeGreaterThan(0)
    expect(w.findAll('[data-test="zone-row"]').length).toBe(1) // the cave: one zone
    await w.get('[data-test="zone"]').setValue('pradera.bosque')
    // ECO-CAPACITY-1: the whole Pradera area (5 + 2 nests) with its two population zones.
    expect(w.findAll('[data-test="nest-row"]').length).toBe(7)
    expect(w.findAll('[data-test="zone-row"]').map(r => r.text())).toEqual([expect.stringMatching(/^abierta.*12/), expect.stringMatching(/^bosque.*6/)])
    expect(text(w, 'notes')).toMatch(/restricción: \d+ casillas transitables en el bosque/)
  })
})
