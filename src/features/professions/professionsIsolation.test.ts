import { describe, expect, it } from 'vitest'

const ALL_SOURCES = import.meta.glob<string>('../../**/*.{ts,vue}', { query: '?raw', import: 'default', eager: true })

// Vite keys files under this folder as './…' and everything else as '../../…'.
const isProfessions = (path: string) => path.startsWith('./') || path.startsWith('../../features/professions/')
const isTest = (path: string) => path.endsWith('.test.ts')
const isComponent = (path: string) => path.startsWith('./components/')

/**
 * The only production files allowed to reference this feature, and only
 * behind an `import.meta.env.DEV` guard on the same line (R31-B).
 */
const DEV_ENTRY_POINTS = ['../../app/router/routes.ts', '../wildlands/components/WildlandsView.vue']

/** WildLands engine modules each layer may use. The engine never imports professions. */
const ENGINE_ALLOWED: readonly [prefix: string, modules: RegExp][] = [
  ['./art/', /\/wildlands\/engine\/(noise|pixels|props|sprite)$/],
  ['./mining/', /\/wildlands\/engine\/(world|area|chunks|characters|sceneOverlay|game)$/],
  ['./overworld/', /\/wildlands\/engine\/(world|characters|sceneOverlay)$/],
  ['./components/', /\/wildlands\/engine\/(world|noise|characters|game)$/],
  ['./', /\/wildlands\/engine\/(world|noise)$/],
]

/** Vue is allowed in components and in the two composables that wrap pure state. */
const VUE_ALLOWED = ['./demo/useProfessionDemo.ts', './mining/useMiningController.ts']
/** Files that instantiate the game engine (dev-only field lab). */
const ENGINE_VALUE_IMPORT = ['./components/playground/MiningFieldLab.vue']

describe('R31 professions isolation', () => {
  const ownSources = Object.entries(ALL_SOURCES).filter(([path]) => isProfessions(path) && !isTest(path))

  it('has sources to scan', () => {
    expect(ownSources.length).toBeGreaterThan(40)
  })

  it('never persists, fetches or talks to realtime services', () => {
    for (const [path, source] of ownSources) {
      expect(source, path).not.toMatch(/supabase|colyseus|localStorage|sessionStorage|fetch\(|\.rpc\(|innerHTML|v-html/)
    }
  })

  it('keeps domain, simulation, art, mining runtime and demo state free of DOM globals and unseeded randomness', () => {
    for (const [path, source] of ownSources.filter(([path]) => !isComponent(path))) {
      expect(source, path).not.toMatch(/from 'vue-router'|document\.|window\.|Math\.random/)
      if (!VUE_ALLOWED.includes(path)) expect(source, path).not.toMatch(/from 'vue'/)
    }
  })

  it('imports the WildLands engine only through the modules allowed for each layer', () => {
    for (const [path, source] of ownSources) {
      const allowed = ENGINE_ALLOWED.find(([prefix]) => path.startsWith(prefix))![1]
      const imports = [...source.matchAll(/from '([^']+)'/g)].map(match => match[1])
      for (const specifier of imports.filter(entry => entry.includes('/wildlands/') || /\/(features|app|shared)\//.test(entry))) {
        expect(specifier, path).toMatch(allowed)
      }
    }
  })

  it('only type-imports the game engine, except the dev field lab', () => {
    for (const [path, source] of ownSources) {
      if (ENGINE_VALUE_IMPORT.includes(path)) continue
      for (const line of source.split('\n').filter(entry => /from '[^']*\/wildlands\/engine\/game'/.test(entry))) {
        expect(line, path).toMatch(/^import type /)
      }
    }
  })

  it('keeps the engine independent from professions', () => {
    for (const [path, source] of Object.entries(ALL_SOURCES).filter(([path]) => path.startsWith('../wildlands/engine/'))) {
      expect(source, path).not.toMatch(/from '[^']*professions/)
    }
  })

  it('is reachable from the app only through development-only entry points', () => {
    for (const [path, source] of Object.entries(ALL_SOURCES)) {
      // Tests (e.g. routes.test.ts mocking the playground) are not shipped code.
      if (isProfessions(path) || isTest(path)) continue
      const references = source.split('\n').filter(line => /features\/professions|\.\.\/professions\//.test(line))
      if (!DEV_ENTRY_POINTS.includes(path)) {
        expect(references, path).toEqual([])
        continue
      }
      expect(references.length, path).toBeGreaterThan(0)
      for (const line of references) expect(line, path).toMatch(/import\.meta\.env\.DEV/)
    }
  })
})
