// @vitest-environment node
// Ecosystem boundaries (ECO-1, ECO-2A, ECO-2B), read from REAL import
// references (`testing/sourceImports.ts`), never from text patterns:
//
//   1. runtime modules are pure: encounters/ imports only itself; population/
//      only itself and encounters/; server/ only encounters/, population/ and
//      map/, plus exactly one data file (the battle catalog's species, which the
//      admission validates the catalog against — ECO-GAMEPLAY-1);
//      no clock, global randomness, timers or network; encounters/ never
//      mentions ownership;
//   2. nothing outside src/features/ecosystem imports the ecosystem modules or
//      the generated realtime bundles. The only allowed importers are the
//      module's own files and tests, three dev scripts and — ECO-GAMEPLAY-1 —
//      ONE realtime file: the experimental population adapter, which imports the
//      admission bundle only. The bundle generators reach their entries by path
//      (esbuild), not by import.
//
// Replaces encounters/isolation.test.ts and population/isolation.test.ts, whose
// text scan mistook fixture strings for imports.

import { describe, expect, it } from 'vitest'
// @ts-expect-error — Node built-ins, no Node types in the app's tsconfig (see praderaAudit.test.ts)
import { readdirSync, readFileSync, statSync } from 'node:fs'
// @ts-expect-error — idem
import { join, relative } from 'node:path'
// @ts-expect-error — idem
import { fileURLToPath } from 'node:url'
import { importSpecifiers, resolveSpecifier } from './testing/sourceImports'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const fwd = (path: string) => path.replace(/\\/g, '/')
const ECOSYSTEM = fwd(join(ROOT, 'src/features/ecosystem'))
const BUNDLE_DIR = fwd(join(ROOT, 'services/realtime/src/world/ecosystem'))

function filesUnder(dir: string, pattern: RegExp): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, pattern))
    else if (pattern.test(name)) out.push(fwd(path))
  }
  return out
}

const isRuntime = (file: string) => !/\.test\.ts$/.test(file) && !file.endsWith('/testing.ts')
const runtimeOf = (folder: string) => filesUnder(join(ECOSYSTEM, folder), /\.ts$/).filter(isRuntime)

/** Import violations of one runtime module: anything resolving outside the allowed folders/files, or a package. */
function importViolations(file: string, source: string, allowed: readonly string[], allowedFiles: readonly string[] = []): string[] {
  return importSpecifiers(file, source).filter(spec => {
    const target = resolveSpecifier(file, spec, ROOT)
    return target === null || !(allowed.some(folder => target.startsWith(`${ECOSYSTEM}/${folder}/`)) || allowedFiles.includes(target))
  })
}

/** ECO-GAMEPLAY-1: the admission validates the catalog against the battle catalog's species — this file only. */
const BATTLE_SPECIES = fwd(join(ROOT, 'src/features/battle/catalog/generated/core.json'))

const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
const IMPURE = /\b(Date\.now|new Date|Math\.random|performance\.now|setTimeout|setInterval|queueMicrotask|fetch|WebSocket|crypto\.getRandomValues)\b/
const OWNERSHIP = /\b(owner_?id|ownedIds|slots|pokemon_instances)\b/

/** Files (outside the ecosystem folder) that really import an ecosystem module or the generated bundle. */
/**
 * Tooling allowed to import the ecosystem from outside it, by exact file —
 * never a whole folder. Each entry is a dev script, not product code.
 */
const ALLOWED_OUTSIDE = new Set([
  fwd(join(ROOT, 'scripts/ecosystem/balance-1.ts')), // ECO-BALANCE-1 runner (dev-only study)
  fwd(join(ROOT, 'scripts/ecosystem/map-nests.ts')), // ECO-MAP-1 nest data generator (dev-only)
  fwd(join(ROOT, 'scripts/ecosystem/validate-inputs.ts')), // F6 offline gate; never a product entrypoint
  // ECO-GAMEPLAY-1: the experimental population adapter (dev-only mode, refused in production). It is the
  // ONLY product file allowed in, and only for the admission bundle (checked below).
  fwd(join(ROOT, 'services/realtime/src/world/ecoPopulation.js')),
])
const ADAPTER = fwd(join(ROOT, 'services/realtime/src/world/ecoPopulation.js'))
const ADMISSION_BUNDLE = `${BUNDLE_DIR}/admission.generated.js`

function outsideImporters(files: readonly string[], read: (file: string) => string): string[] {
  return files.filter(file => !file.startsWith(`${ECOSYSTEM}/`) && !ALLOWED_OUTSIDE.has(file) && importSpecifiers(file, read(file)).some(spec => {
    const target = resolveSpecifier(file, spec, ROOT)
    return target !== null && (target.startsWith(`${ECOSYSTEM}/`) || target.startsWith(`${BUNDLE_DIR}/`))
  }))
}

describe('runtime modules are pure', () => {
  const cases: [string, string[], string[]][] = [
    ['encounters', ['encounters'], []], ['population', ['population', 'encounters'], []],
    ['server', ['encounters', 'population', 'map'], [BATTLE_SPECIES]], ['map', ['map', 'encounters', 'population'], []],
  ]

  it.each(cases)('%s imports only %j (+ %j)', (folder, allowed, files) => {
    const runtime = runtimeOf(folder)
    expect(runtime.length).toBeGreaterThan(0)
    for (const file of runtime) expect(importViolations(file, readFileSync(file, 'utf8'), allowed, files), relative(ROOT, file)).toEqual([])
  })

  it('the battle-catalog allowance is one file for server/ only, not the battle folder', () => {
    const entry = `${ECOSYSTEM}/server/admissionRuntime.ts`
    expect(importViolations(entry, "import { species } from '../../battle/catalog/generated/core.json'", ['encounters', 'population', 'map'], [BATTLE_SPECIES])).toEqual([])
    expect(importViolations(entry, "import { x } from '../../battle/catalog/other.json'", ['encounters', 'population', 'map'], [BATTLE_SPECIES])).toEqual(['../../battle/catalog/other.json'])
    expect(importViolations(`${ECOSYSTEM}/population/engine.ts`, "import { species } from '../../battle/catalog/generated/core.json'", ['population', 'encounters'])).toEqual(['../../battle/catalog/generated/core.json'])
  })

  it('no clock, global randomness, timers or network in any runtime module; no ownership in the catalog', () => {
    for (const folder of ['encounters', 'population', 'server', 'map']) {
      for (const file of runtimeOf(folder)) expect(IMPURE.exec(code(readFileSync(file, 'utf8')))?.[0], relative(ROOT, file)).toBeUndefined()
    }
    for (const file of runtimeOf('encounters')) expect(OWNERSHIP.exec(readFileSync(file, 'utf8'))?.[0], relative(ROOT, file)).toBeUndefined()
  })
})

describe('the dev simulator (preview/) stays local', () => {
  // Allowed: the engine and catalog, Vue, and the engine's sprite URL helper. The Vite config may import Vite itself.
  const PREVIEW_PACKAGES = new Set(['vue', 'vite', '@vitejs/plugin-vue', 'node:url'])
  const SPRITES = fwd(join(ROOT, 'src/features/wildlands/engine/characters'))
  const previewViolations = (file: string, source: string) => importSpecifiers(file, source).filter(spec => {
    const target = resolveSpecifier(file, spec, ROOT)
    if (target === null) return !PREVIEW_PACKAGES.has(spec)
    return !(target === SPRITES || ['preview', 'encounters', 'population', 'map'].some(folder => target.startsWith(`${ECOSYSTEM}/${folder}/`)))
  })
  const NETWORK = /\b(fetch|WebSocket|XMLHttpRequest|EventSource|supabase|colyseus|localStorage|sessionStorage)\b/i

  it('imports only the engine, the catalog, Vue and the sprite helper; no network, storage or credentials', () => {
    const files = filesUnder(join(ECOSYSTEM, 'preview'), /\.(ts|vue|mjs)$/).filter(isRuntime)
    expect(files.length).toBeGreaterThanOrEqual(6)
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      expect(previewViolations(file, source), relative(ROOT, file)).toEqual([])
      expect(NETWORK.exec(code(source))?.[0], relative(ROOT, file)).toBeUndefined()
    }
  })

  it('negative control: flags the realtime bundle, Supabase and a fetch', () => {
    const app = `${ECOSYSTEM}/preview/EcoPreviewApp.vue`
    expect(previewViolations(app, "<script setup lang=\"ts\">import { tickPopulation } from '../../../../services/realtime/src/world/ecosystem/encounters.generated.js'</script>")).toHaveLength(1)
    expect(previewViolations(app, "<script setup lang=\"ts\">import { supabase } from '../../../shared/supabase'</script>")).toHaveLength(1)
    expect(previewViolations(app, "<script setup lang=\"ts\">import { createClient } from '@supabase/supabase-js'</script>")).toEqual(['@supabase/supabase-js'])
    expect(NETWORK.exec(code('await fetch("/api/encounters")'))?.[0]).toBe('fetch')
  })
})

describe('nothing outside the ecosystem imports it or its bundle', () => {
  it('scans src, services and scripts', () => {
    const files = [
      ...filesUnder(join(ROOT, 'src'), /\.(ts|vue|js|mjs)$/),
      ...filesUnder(join(ROOT, 'services'), /\.(js|mjs|ts)$/),
      ...filesUnder(join(ROOT, 'scripts'), /\.(js|mjs|ts)$/),
    ]
    expect(files.length).toBeGreaterThan(100)
    expect(outsideImporters(files, file => readFileSync(file, 'utf8')).map(file => relative(ROOT, file))).toEqual([])
  }, 30_000) // a cold file-system cache once took 6.8 s: a timeout must never stand in for a verdict

  it('the experimental adapter reaches the ecosystem only through the admission bundle', () => {
    const targets = (source: string) => importSpecifiers(ADAPTER, source).map(spec => resolveSpecifier(ADAPTER, spec, ROOT))
      .filter((target): target is string => target !== null && (target.startsWith(`${ECOSYSTEM}/`) || target.startsWith(`${BUNDLE_DIR}/`)))
    expect(targets(readFileSync(ADAPTER, 'utf8'))).toEqual([ADMISSION_BUNDLE])
    // negative controls: the bare-engine bundle or a source module would be flagged
    expect(targets("import { tickPopulation } from './ecosystem/encounters.generated.js'")).not.toEqual([ADMISSION_BUNDLE])
    expect(targets("import { createPopulation } from '../../../../src/features/ecosystem/population/engine'")).not.toEqual([ADMISSION_BUNDLE])
  })
})

describe('negative controls: the guards see real imports and only real imports', () => {
  const world = fwd(join(ROOT, 'services/realtime/src/world'))
  const wildlands = fwd(join(ROOT, 'src/features/wildlands'))
  const own = `${ECOSYSTEM}/population/engine.ts`
  const scan = (sources: Record<string, string>) => outsideImporters(Object.keys(sources), file => sources[file]).map(file => file.split('/').pop())

  it('counts static imports, type imports, re-exports, dynamic imports and require', () => {
    expect(scan({
      [`${world}/static.js`]: "import { tickPopulation } from './ecosystem/encounters.generated.js'",
      [`${world}/reexport.js`]: "export * from '../../../../src/features/ecosystem/population/engine'",
      [`${world}/dynamic.js`]: "const m = await import('./ecosystem/encounters.generated.js')",
      [`${world}/required.js`]: "const m = require('./ecosystem/encounters.generated.js')",
      [`${wildlands}/Alias.vue`]: `<template><div/></template>
<script setup lang="ts">
import type { EncounterEntry } from '@/features/ecosystem/encounters/types'
</script>`,
      [`${world}/unrelated.js`]: "import { wildRoster } from './wildPopulation.js'",
      [fwd(join(ROOT, 'scripts/ecosystem/balance-1.ts'))]: "import { runOnce } from '../../src/features/ecosystem/preview/balance'",
      [fwd(join(ROOT, 'scripts/ecosystem/other.ts'))]: "import { runOnce } from '../../src/features/ecosystem/preview/balance'",
    })).toEqual(['static.js', 'reexport.js', 'dynamic.js', 'required.js', 'Alias.vue', 'other.ts']) // the allowance is one file, not the folder
  })

  it('ignores fixture strings, comments and template text', () => {
    expect(scan({
      [`${world}/fixture.js`]: "const fixture = \"import { pickEncounter } from '../ecosystem/encounters/queries'\"",
      [`${world}/comment.js`]: "// import { tickPopulation } from './ecosystem/encounters.generated.js'",
      [`${wildlands}/Template.vue`]: `<template><p>import x from '@/features/ecosystem/population/engine'</p></template>
<script setup lang="ts">
const a = 1
</script>`,
    })).toEqual([])
  })

  it('allows the module to import itself, and flags a forbidden runtime import', () => {
    expect(outsideImporters([own], () => "import { pickEncounter } from '../encounters/queries'")).toEqual([])
    expect(importViolations(own, "import { ref } from 'vue'", ['population', 'encounters'])).toEqual(['vue'])
    expect(importViolations(own, "import { x } from '../../wildlands/engine/game'", ['population', 'encounters'])).toEqual(['../../wildlands/engine/game'])
    expect(importViolations(own, "import { y } from '../server/encounterRuntime'", ['population', 'encounters'])).toEqual(['../server/encounterRuntime'])
    expect(importViolations(own, "const s = 'import { ref } from \"vue\"'", ['population', 'encounters'])).toEqual([])
    expect(IMPURE.exec(code('const t = Date.now()'))?.[0]).toBe('Date.now')
    expect(IMPURE.exec(code('// Date.now is forbidden here'))).toBeNull()
  })
})
