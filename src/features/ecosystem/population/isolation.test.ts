// @vitest-environment node
// ECO-2A boundaries, on the source text:
//   1. runtime modules import only each other and the ECO-1 catalog, and use no
//      clock, global randomness, timers or network;
//   2. nothing outside src/features/ecosystem imports the engine yet.
// Each guard has a negative control.

import { describe, expect, it } from 'vitest'
// @ts-expect-error — Node built-ins, no Node types in the app's tsconfig (see praderaAudit.test.ts)
import { readdirSync, readFileSync, statSync } from 'node:fs'
// @ts-expect-error — idem
import { join, relative } from 'node:path'
// @ts-expect-error — idem
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const ECOSYSTEM = join(ROOT, 'src/features/ecosystem')
const HERE = join(ECOSYSTEM, 'population')

function filesUnder(dir: string, pattern: RegExp): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, pattern))
    else if (pattern.test(name)) out.push(path)
  }
  return out
}

const importsOf = (source: string): string[] =>
  [...source.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1] ?? m[2])

/** Violations of the engine's purity rule in one runtime module's source (comments stripped). */
function engineViolations(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const bad = importsOf(code).filter(spec => !/^\.\/[\w-]+$/.test(spec) && !/^\.\.\/encounters\/[\w-]+$/.test(spec) && spec !== '../encounters/types')
  const impure = /\b(Date\.now|new Date|Math\.random|performance\.now|setTimeout|setInterval|queueMicrotask|fetch|WebSocket|crypto\.getRandomValues)\b/.exec(code)
  return impure ? [...bad, `impure: ${impure[0]}`] : bad
}

function importersOfEngine(files: readonly string[], read: (file: string) => string): string[] {
  return files.filter(file => importsOf(read(file)).some(spec => /ecosystem\/population|(^|\/)population\/(engine|config|projection|ids|types)$/.test(spec)))
}

const runtime = filesUnder(HERE, /\.ts$/).filter(f => !/\.test\.ts$/.test(f) && !f.endsWith('testing.ts'))

describe('the population engine is a pure domain module', () => {
  it('imports only itself and the ECO-1 catalog; no clock, randomness, timers or network', () => {
    expect(runtime.length).toBe(5)
    for (const file of runtime) expect(engineViolations(readFileSync(file, 'utf8')), relative(ROOT, file)).toEqual([])
  })

  it('negative control: the guard flags each forbidden thing', () => {
    expect(engineViolations("import { Room } from 'colyseus'")).toEqual(['colyseus'])
    expect(engineViolations("import { x } from '../../wildlands/engine/game'")).toEqual(['../../wildlands/engine/game'])
    expect(engineViolations("import { wildRoster } from '../../../../services/realtime/src/world/wildPopulation.js'")).toHaveLength(1)
    expect(engineViolations('const t = Date.now()')).toEqual(['impure: Date.now'])
    expect(engineViolations('const r = Math.random()')).toEqual(['impure: Math.random'])
    expect(engineViolations('setTimeout(respawn, 75000)')).toEqual(['impure: setTimeout'])
    expect(engineViolations('// Date.now is forbidden here')).toEqual([])
  })
})

describe('the engine is not connected to anything yet', () => {
  const active = [
    ...filesUnder(join(ROOT, 'src'), /\.(ts|vue|js)$/).filter(file => !file.startsWith(ECOSYSTEM)),
    ...filesUnder(join(ROOT, 'services'), /\.(js|mjs|ts)$/),
    ...filesUnder(join(ROOT, 'scripts'), /\.(js|mjs|ts)$/),
  ]

  it('no file outside src/features/ecosystem imports it', () => {
    expect(active.length).toBeGreaterThan(100)
    expect(importersOfEngine(active, file => readFileSync(file, 'utf8')).map(f => relative(ROOT, f))).toEqual([])
  }, 30_000) // a cold file-system cache once took 6.8 s here: a timeout must never pass for a verdict

  it('negative control: the guard finds an importer', () => {
    // Specs are assembled at runtime: written literally, they would trip ECO-1's own source scan,
    // which also reads fixture strings in sibling tests (reported in ECO_2A_REPORT.md, not changed here).
    const eco = ['eco', 'system'].join('')
    const fake = new Map([
      ['worldRoom.js', `import { tickPopulation } from '../../../src/features/${eco}/population/engine'`],
      ['view.vue', `import { publicArea } from '@/features/${eco}/population/projection'`],
      ['other.ts', `import { pickEncounter } from '../${eco}/encounters/queries'`],
    ])
    expect(importersOfEngine([...fake.keys()], f => fake.get(f)!)).toEqual(['worldRoom.js', 'view.vue'])
  })
})
