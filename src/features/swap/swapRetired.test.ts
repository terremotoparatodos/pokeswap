// SWAP RETIRE-2: Swap is gone from the client for good. (Vite's glob leaves
// this file out of its own listing.)
//
//   1. no product source calls `pokeswap-swap` or `skip_swap_cooldown`, or
//      reads Swap's history or cooldown;
//   2. features/swap holds the retirement notice and nothing else;
//   3. a direct /swap in the normal build shows that notice and touches no
//      backend; in the playtest build it lands in the town.

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import type { Component } from 'vue'

const backend = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), from: vi.fn() }))
vi.mock('../../shared/api/supabase', () => ({
  supabase: { rpc: backend.rpc, from: backend.from, functions: { invoke: backend.invoke } },
}))
vi.mock('../wildlands/components/WildlandsView.vue', () => ({ default: { template: '<div><router-view /></div>' } }))

import { buildRoutes, routes } from '../../app/router/routes'
import SwapRetiredView from './components/SwapRetiredView.vue'
import { SWAP_RETIRED_NOTICE } from './retired'

const ALL_SOURCES = import.meta.glob<string>('../../**/*.{ts,vue}', { query: '?raw', import: 'default', eager: true })
const SWAP_FILES = import.meta.glob<string>('./**/*', { query: '?raw', import: 'default', eager: true })

const isTest = (path: string) => /\.test\.ts$/.test(path)
/** Prose may name what the code must not do, so comments are stripped first. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '')

beforeEach(() => vi.clearAllMocks())

describe('Swap retired from the client', () => {
  it('never calls pokeswap-swap or skip_swap_cooldown, nor reads Swap history or cooldown', () => {
    const product = Object.entries(ALL_SOURCES).filter(([path]) => !isTest(path))
    expect(product.length).toBeGreaterThan(100)
    for (const [path, source] of product) {
      const body = code(source)
      expect(body, path).not.toMatch(/pokeswap-swap|skip_swap_cooldown/)
      expect(body, path).not.toMatch(/\.from\(\s*['"]swap_history['"]/)
      // The schema mirror keeps describing the live table and column; nothing uses them.
      if (!path.endsWith('shared/types/database.ts')) expect(body, path).not.toMatch(/swap_cooldown_until|SwapHistoryEntry/)
    }
  })

  it('keeps only the retirement notice in features/swap', () => {
    expect(Object.keys(SWAP_FILES).sort()).toEqual([
      './components/SwapRetiredView.test.ts',
      './components/SwapRetiredView.vue',
      './retired.ts',
    ])
  })

  it('no longer promises Swap anywhere a player reads', () => {
    for (const [path, source] of Object.entries(ALL_SOURCES)) {
      if (isTest(path)) continue
      expect(code(source), path).not.toMatch(/Hacer Swap|Ir a Swap|Hacé un swap|se hacen los Swaps|próximo swap|Swap en Silph|Queda cerrado durante el playtest/i)
    }
  })
})

describe('a direct /swap link', () => {
  it('in the normal build shows the notice and calls no backend', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/swap')
    const route = router.currentRoute.value
    expect(route.name).toBe('swap')
    expect(route.meta.panelTitle).toBe('Silph Co.')

    // vue-router swaps the lazy loader for what it loaded once the navigation resolves.
    const view = route.matched[1].components?.default as Component
    expect(view).toBe(SwapRetiredView)

    const wrapper = mount(view)
    await flushPromises()
    expect(wrapper.text()).toBe(SWAP_RETIRED_NOTICE)
    expect(wrapper.findAll('button, form, a')).toHaveLength(0)
    expect(backend.rpc).not.toHaveBeenCalled()
    expect(backend.invoke).not.toHaveBeenCalled()
    expect(backend.from).not.toHaveBeenCalled()
  })

  it('in the playtest build lands in the town and loads no view', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: buildRoutes(null) })
    for (const path of ['/swap', '/swap?pokemon_given_id=25', '/swap/skip']) {
      await router.push(path)
      expect(router.currentRoute.value.name, path).toBe('lobby')
      expect(router.currentRoute.value.matched, path).toHaveLength(1)
    }
    expect(router.hasRoute('swap')).toBe(false)
  })

  it('in the normal build, a deeper /swap path is not a trade either', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/swap/skip')
    expect(router.currentRoute.value.name).toBe('lobby')
  })
})
