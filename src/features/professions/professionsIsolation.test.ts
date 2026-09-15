import { describe, expect, it } from 'vitest'

const ALL_SOURCES = import.meta.glob<string>('../../**/*.{ts,vue}', { query: '?raw', import: 'default', eager: true })

// Vite keys files under this folder as './…' and everything else as '../../…'.
const isProfessions = (path: string) => path.startsWith('./') || path.startsWith('../../features/professions/')
const isTest = (path: string) => path.endsWith('.test.ts')

describe('R31 professions isolation', () => {
  const ownSources = Object.entries(ALL_SOURCES).filter(([path]) => isProfessions(path) && !isTest(path))

  it('has sources to scan', () => {
    expect(ownSources.length).toBeGreaterThan(10)
  })

  it('has no persistence, network, realtime, DOM or unseeded randomness', () => {
    for (const [path, source] of ownSources) {
      expect(source, path).not.toMatch(/supabase|colyseus|from 'vue'|localStorage|sessionStorage|fetch\(|\.rpc\(|document\.|window\.|Math\.random|innerHTML/)
    }
  })

  it('imports other features only through pure world helpers', () => {
    for (const [path, source] of ownSources) {
      const imports = [...source.matchAll(/from '([^']+)'/g)].map(match => match[1])
      for (const specifier of imports.filter(entry => entry.includes('/features/') || /^(\.\.\/){2,}/.test(entry))) {
        expect(specifier, path).toMatch(/\/wildlands\/engine\/(world|noise)$/)
      }
    }
  })

  it('is not reachable from the production app yet', () => {
    for (const [path, source] of Object.entries(ALL_SOURCES)) {
      if (isProfessions(path)) continue
      expect(source, path).not.toMatch(/features\/professions|\.\.\/professions\//)
    }
  })
})
