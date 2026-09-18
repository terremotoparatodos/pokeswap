// The City Mapping Lab is a development tool: reachable at /dev/city-lab in
// DEV, absent from production, and unable to write, persist or talk to
// anything outside the browser tab.

import { describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { routes } from '../../app/router/routes'

const view = { default: { template: '<div />' } }
vi.mock('../wildlands/components/WildlandsView.vue', () => view)
vi.mock('./components/CityLabView.vue', () => view)

const ALL = import.meta.glob<string>('../../**/*.{ts,vue}', { query: '?raw', import: 'default', eager: true })
const isLab = (path: string) => path.startsWith('./') || path.startsWith('../../features/cityLab/')
const own = Object.entries(ALL).filter(([path]) => isLab(path) && !path.endsWith('.test.ts'))
const outside = Object.entries(ALL).filter(([path]) => !isLab(path) && !path.endsWith('.test.ts'))

describe('/dev/city-lab', () => {
  it('opens as a standalone dev page', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/dev/city-lab')
    expect(router.currentRoute.value.name).toBe('dev-city-lab')
    expect(router.currentRoute.value.meta.standalone).toBe(true)
  })

  it('is registered only behind import.meta.env.DEV, so production never bundles it', () => {
    const source = ALL['../../app/router/routes.ts']
    const line = source.split('\n').find(text => text.includes('cityLab: LazyView'))
    expect(line).toContain('import.meta.env.DEV')
    expect(source).toMatch(/\.\.\.\(cityLab\s*\r?\n\s*\?\s*\[\{ path: '\/dev\/city-lab'/)
  })
})

describe('isolation', () => {
  it('has sources to scan', () => {
    expect(own.length).toBeGreaterThan(15)
  })

  it('has no production consumer: only the DEV route imports it', () => {
    for (const [path, source] of outside) {
      if (path === '../../app/router/routes.ts') continue
      expect(source, path).not.toMatch(/cityLab/)
    }
  })

  it('never talks to the network, Supabase, Colyseus or the server', () => {
    for (const [path, source] of own) {
      expect(source, path).not.toMatch(/supabase|colyseus|fetch\(|\.rpc\(|WebSocket|XMLHttpRequest|v-html|innerHTML/)
    }
  })

  it('touches no R32, battle, authority, persistence or multiplayer module', () => {
    for (const [path, source] of own) {
      const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m => m[1])
      for (const spec of imports) {
        expect(spec, `${path} → ${spec}`).not.toMatch(/battle|pokemonModel|authority|multiplayer|lobby\/api|shared\/api|professions|dungeon/i)
        if (spec.includes('/wildlands/')) {
          // Read-only consumer of the engine, the town definition, the player roster and the feature names.
          expect(spec, `${path} → ${spec}`).toMatch(/\/wildlands\/(engine\/|areas\/(atlas|townArea)$|identity\/playerCharacters$|lobby\/features$)/)
        }
      }
    }
  })

  it('uses localStorage only for the LOCAL DRAFT', () => {
    for (const [path, source] of own) {
      // Real use, not a mention in a comment.
      if (/window\.localStorage|\blocalStorage\.(getItem|setItem|removeItem)/.test(source)) expect(path, path).toMatch(/state\/useCityLab\.ts$/)
    }
  })
})
