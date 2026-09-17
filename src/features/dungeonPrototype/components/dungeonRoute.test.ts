// The prototype must be reachable in development and invisible in production,
// and it must not drag the legacy dungeon system in with it.

import { describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { routes } from '../../../app/router/routes'

const view = { default: { template: '<div />' } }
vi.mock('../../wildlands/components/WildlandsView.vue', () => view)
vi.mock('./DungeonPrototypeView.vue', () => view)

describe('/dev/dungeon', () => {
  it('opens as a standalone dev page', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/dev/dungeon')
    const route = router.currentRoute.value
    expect(route.name).toBe('dev-dungeon')
    expect(route.matched).toHaveLength(1)
    expect(route.meta.standalone).toBe(true)
  })

  it('is registered behind the same DEV guard as the profession playground', () => {
    const sources = import.meta.glob('../../../app/router/routes.ts', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>
    const source = Object.values(sources)[0]
    expect(source).toBeTruthy()
    const line = source.split('\n').find((text: string) => text.includes('dungeonPrototype: LazyView'))
    expect(line).toBeDefined()
    expect(line).toContain('import.meta.env.DEV')
    // A production build evaluates the guard to null and never registers the path.
    expect(source).toMatch(/\.\.\.\(dungeonPrototype\s*\r?\n\s*\?\s*\[\{ path: '\/dev\/dungeon'/)
  })
})

describe('clean slate', () => {
  const files = import.meta.glob('../**/*.{ts,vue}', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>

  it('never imports anything from the legacy dungeon feature', () => {
    for (const [path, source] of Object.entries(files)) {
      expect(source, path).not.toMatch(/from\s+['"][^'"]*features\/dungeon\//)
      expect(source, path).not.toMatch(/import\(['"][^'"]*features\/dungeon\//)
    }
  })

  it('does not reach into other product features for its data', () => {
    for (const [path, source] of Object.entries(files)) {
      const imports = [...source.matchAll(/from\s+['"](\.\.[^'"]*)['"]/g)].map(match => match[1])
      for (const specifier of imports) {
        // Only the router test may look outside; everything else stays inside
        // the prototype namespace.
        if (path.includes('dungeonRoute.test')) continue
        expect(specifier.includes('/features/'), `${path} → ${specifier}`).toBe(false)
      }
    }
  })
})
