// @vitest-environment node
// ECO-1 boundaries, checked on the source text:
//   1. the catalog's runtime modules import nothing but each other (no Vue,
//      Colyseus, Supabase, Node built-ins, server files or session state), and
//      never read ownership;
//   2. no active code imports the catalog yet — it is not connected to the world.
// Each guard has a negative control proving it would fire.

import { describe, expect, it } from 'vitest'
// @ts-expect-error — Node built-ins, no Node types in the app's tsconfig (see praderaAudit.test.ts)
import { readdirSync, readFileSync, statSync } from 'node:fs'
// @ts-expect-error — idem
import { join, relative } from 'node:path'
// @ts-expect-error — idem
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const HERE = join(ROOT, 'src/features/ecosystem/encounters')

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
  [...source.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match => match[1] ?? match[2])

/** Violations of the domain rule in one runtime module's source. */
function domainViolations(source: string): string[] {
  const bad = importsOf(source).filter(spec => !/^\.\/[\w-]+$/.test(spec))
  const owner = /\b(owner_?id|ownedIds|slots|pokemon_instances)\b/.exec(source)
  return owner ? [...bad, `ownership: ${owner[0]}`] : bad
}

/** Files (outside the catalog) whose source imports it. */
function importersOfCatalog(files: readonly string[], read: (file: string) => string): string[] {
  return files.filter(file => importsOf(read(file)).some(spec => /ecosystem(\/encounters)?(\/|$)/.test(spec)))
}

const runtimeModules = filesUnder(HERE, /\.ts$/).filter(file => !/\.test\.ts$/.test(file) && !file.endsWith('testing.ts'))

describe('the encounter catalog is a pure domain module', () => {
  it('has runtime modules that import only each other and never read ownership', () => {
    expect(runtimeModules.length).toBeGreaterThanOrEqual(7)
    for (const file of runtimeModules) expect(domainViolations(readFileSync(file, 'utf8')), relative(ROOT, file)).toEqual([])
  })

  it('negative control: the guard flags Vue, Supabase, Node, server files and ownership', () => {
    expect(domainViolations("import { ref } from 'vue'")).toEqual(['vue'])
    expect(domainViolations("import { supabase } from '../../../lib/supabase'")).toEqual(['../../../lib/supabase'])
    expect(domainViolations("import { readFileSync } from 'node:fs'")).toEqual(['node:fs'])
    expect(domainViolations("import { CAVES } from '../../../../services/realtime/src/world/caves.js'")).toHaveLength(1)
    expect(domainViolations("const x = await import('@colyseus/sdk')")).toEqual(['@colyseus/sdk'])
    expect(domainViolations('const skip = ownedIds.has(id)')).toEqual(['ownership: ownedIds'])
  })
})

describe('the catalog is not connected to the world yet', () => {
  const active = [
    ...filesUnder(join(ROOT, 'src'), /\.(ts|vue|js)$/).filter(file => !file.startsWith(HERE)),
    ...filesUnder(join(ROOT, 'services'), /\.(js|mjs|ts)$/),
    ...filesUnder(join(ROOT, 'scripts'), /\.(js|mjs|ts)$/),
  ]

  it('no file outside the module imports it', () => {
    expect(active.length).toBeGreaterThan(100)
    expect(importersOfCatalog(active, file => readFileSync(file, 'utf8')).map(file => relative(ROOT, file))).toEqual([])
  })

  it('negative control: the guard finds an importer', () => {
    const fake = new Map([
      ['a.ts', "import { pickEncounter } from '../ecosystem/encounters/queries'"],
      ['b.vue', "import { ECO_1_ENCOUNTER_CATALOG } from '@/features/ecosystem/encounters/initialCatalog'"],
      ['c.ts', "import { wildRoster } from './wildPopulation.js'"],
    ])
    expect(importersOfCatalog([...fake.keys()], file => fake.get(file)!)).toEqual(['a.ts', 'b.vue'])
  })
})
