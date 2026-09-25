// Guards the promises that make Skills safe to ship and usable from a server:
//
//   1. domain/ and service/ are plain TypeScript — no Vue, no DOM, no network,
//      no storage, no engine, no unseeded randomness — so WORLD-1 can run the
//      same rules server-side;
//   2. production code reaches the Skills layer only behind a build gate (DEV
//      or the playtest flag), so a normal production build carries none of it;
//   3. fishing is gone from the product source.

import { describe, expect, it } from 'vitest'

const ALL_SOURCES = import.meta.glob<string>('../../**/*.{ts,vue}', { query: '?raw', import: 'default', eager: true })

// Vite keys files under this folder as './…' and everything else as '../../…'.
// worldSkills (INTEGRATION-1) is the WORLD × SKILLS layer: it lives on the
// Skills side of the gate, reached only through SkillsWorldLayer (and bundled
// for the server), so it counts as Skills here.
const isSkills = (path: string) => path.startsWith('./') || path.startsWith('../../features/skills/') || path.startsWith('../worldSkills/') || path.startsWith('../../features/worldSkills/')
const isTest = (path: string) => path.endsWith('.test.ts')

/** Scans look for code, so comments are stripped first: prose may name what code must not do. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const imports = (source: string): string[] => [...source.matchAll(/(?:from\s+|import\()\s*'([^']+)'/g)].map(match => match[1])

/** Build-time constants Rollup folds, so a gated branch vanishes from a normal build. */
const BUILD_GATES = /import\.meta\.env\.DEV|isPlaytest/

describe('Skills isolation', () => {
  it('keeps domain/ and service/ server-portable', () => {
    const pure = Object.entries(ALL_SOURCES).filter(([path]) => (path.startsWith('./domain/') || path.startsWith('./service/')) && !isTest(path))
    expect(pure.length).toBeGreaterThan(10)
    for (const [path, source] of pure) {
      for (const spec of imports(source)) {
        expect(spec, `${path} imports ${spec}`).not.toMatch(/^vue|wildlands|supabase|colyseus|\/(scene|ui|components|local|localWorld)\//)
      }
      expect(code(source), path).not.toMatch(/\b(window|document|localStorage|sessionStorage|fetch)\b\s*[.(]|Math\.random/)
    }
  })

  it('is reached from production code only behind a build gate on the same line', () => {
    for (const [path, source] of Object.entries(ALL_SOURCES)) {
      if (isSkills(path) || isTest(path)) continue
      for (const line of code(source).split('\n')) {
        if (!line.includes('/skills/') && !line.includes('/worldSkills/')) continue
        expect(line, path).toMatch(/skills\/components\/SkillsWorldLayer\.vue/)
        expect(line, path).toMatch(BUILD_GATES)
      }
    }
  })

  it('has no fishing left in the product source', () => {
    for (const [path, source] of Object.entries(ALL_SOURCES)) {
      if (isTest(path)) continue
      expect(code(source), path).not.toMatch(/\bfishing\b|\bPesca\b|basic_rod|Fishing[A-Z]/)
    }
  })
})
