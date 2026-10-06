// @vitest-environment node
// The realtime bundle (ECO-2B) is exactly what the reviewed TypeScript builds
// to, behaves identically, is reproducible, and its --check never writes.

import { describe, expect, it } from 'vitest'
// @ts-expect-error — Node built-ins, no Node types in the app's tsconfig (see praderaAudit.test.ts)
import { spawnSync } from 'node:child_process'
// @ts-expect-error — idem
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
// @ts-expect-error — idem
import { tmpdir } from 'node:os'
// @ts-expect-error — idem
import { join } from 'node:path'
// @ts-expect-error — idem
import { execPath } from 'node:process'
// @ts-expect-error — idem
import { fileURLToPath, pathToFileURL } from 'node:url'
// @ts-expect-error — plain .mjs build script, no type declarations
import { OUTPUT, bundleEncounters, bundleStatus } from '../../../../scripts/integration/bundle-encounters.mjs'
// @ts-expect-error — generated plain JS, no type declarations (the TS sources are the typed API)
import * as bundle from '../../../../services/realtime/src/world/ecosystem/encounters.generated.js'
import generated from '../../../../services/realtime/src/world/ecosystem/encounters.generated.js?raw'
import core from '../../battle/catalog/generated/core.json'
import { lookupFromSpeciesList } from '../encounters/testing'
import * as source from './encounterRuntime'
import { caveArea, caveNest, gridGeometry, populationConfig, row, seeded } from '../population/testing'
import type { EncounterCatalog } from '../encounters/types'
import type { PopulationConfig, PopulationState } from '../population/types'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
const SCRIPT = join(ROOT, 'scripts/integration/bundle-encounters.mjs')
const unix = (text: string) => text.split('\r\n').join('\n')
const lookup = lookupFromSpeciesList(core.species)
type Api = typeof source

/** An esbuild plugin that rewrites one source file in memory (drift tests). */
function rewrite(fileSuffix: string, from: string, to: string) {
  return {
    name: 'rewrite',
    setup(b: { onLoad: (o: { filter: RegExp }, cb: (args: { path: string }) => { contents: string; loader: string }) => void }) {
      b.onLoad({ filter: /\.ts$/ }, args => {
        const text: string = readFileSync(args.path, 'utf8')
        if (!args.path.replace(/\\/g, '/').endsWith(fileSuffix)) return { contents: text, loader: 'ts' }
        if (!text.includes(from)) throw new Error(`rewrite target not found in ${fileSuffix}`)
        return { contents: text.replace(from, to), loader: 'ts' }
      })
    },
  }
}

const runScript = (...args: string[]) => spawnSync(execPath, [SCRIPT, ...args], { cwd: ROOT, encoding: 'utf8' })

describe('the committed bundle', () => {
  it('is up to date with src/features/ecosystem', async () => {
    expect(unix(generated) === (await bundleEncounters())).toBe(true)
    expect(await bundleStatus(await bundleEncounters(), OUTPUT)).toBe('fresh')
  })

  it('has no imports, no absolute paths, no timestamps', () => {
    expect(generated).not.toMatch(/^import |require\(/m)
    // Provenance URLs (https://...) are portable, not Windows drive paths.
    const absolutePath = /(?:^|["'\s(])[A-Za-z]:[\\/]|\/Users\/|\/home\//m
    expect('"C:\\private\\source.ts"').toMatch(absolutePath)
    expect('"https://raw.githubusercontent.com/PokeAPI/pokeapi"').not.toMatch(absolutePath)
    expect(generated).not.toMatch(absolutePath)
    expect(generated).not.toMatch(/\b20\d\d-\d\d-\d\dT\d\d:/)
  })

  it('two consecutive generations are identical', async () => {
    expect(await bundleEncounters()).toBe(await bundleEncounters())
  })

  it('exports exactly the runtime entry surface', () => {
    expect(Object.keys(bundle).sort()).toEqual(Object.keys(source).sort())
    expect(bundle.ENCOUNTER_RUNTIME_API).toBe(2)
  })

  it('loads in a bare Node process, from outside the repository, with no frontend dependency', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'eco-bundle-'))
    try {
      const script = `const m = await import(${JSON.stringify(pathToFileURL(OUTPUT).href)});`
        + "const r = m.pickEncounter(m.ECO_1_ENCOUNTER_CATALOG, 'cueva-inicial', { tierRoll: 0, entryRoll: 0 });"
        + 'console.log(process.version, r.ok && r.entry.id)'
      const run = spawnSync(execPath, ['--input-type=module', '-e', script], { cwd, encoding: 'utf8' })
      expect(run.status, run.stderr).toBe(0)
      expect(run.stdout.trim()).toMatch(/^v\d+\.\d+\.\d+ cueva-inicial:zubat$/)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})

describe('parity: the bundle behaves exactly like the sources', () => {
  it('both surfaces enforce the audit contracts, beyond merely agreeing with each other', () => {
    for (const api of [source, bundle] as Api[]) {
      const catalog = api.ECO_1_ENCOUNTER_CATALOG
      const shares = { ...catalog, zones: catalog.zones.map(z => ({ ...z, rarityShares: { common: 35, uncommon: 12, rare: 2.75, very_rare: 0.25 } })) }
      const overflow = { ...catalog, entries: catalog.entries.map(e => ({ ...e, weight: Number.MAX_VALUE })) }
      for (const invalid of [shares, overflow]) {
        expect(api.pickEncounter(invalid, 'cueva-inicial', { tierRoll: 0, entryRoll: 0 })).toEqual({ ok: false, reason: 'invalid-distribution' })
        expect(api.zoneDistribution(invalid, 'cueva-inicial')).toBeNull()
      }
      const noCategories = { ...catalog, categories: [], excludedCategories: [] }
      expect(api.ordinaryEncounterExclusion(noCategories, 150)).toBe('legendary')
      expect(api.ordinaryEncounterExclusion(noCategories, 151)).toBe('mythical')
      expect(api.validateEncounterCatalog(noCategories, lookup).ok).toBe(false)

      const config = populationConfig([caveArea([caveNest('zero', row(0, 0, 8), { habitats: ['cave-nook'], respawn: { policy: 'per-member', delayMs: 0, jitter: 0, retryMs: 1 } })], { idle: { dormantAfterMs: 300_000, staggerMinMs: 0, staggerMaxMs: 0 } })])
      const deps = { catalog }
      const input = (now: number) => ({ now, random: () => 0, geometry: () => gridGeometry(), activeAreas: new Set(['cueva-inicial']) })
      const created = api.createPopulation(config, deps)
      if (!created.ok) throw new Error('valid zero config rejected')
      const first = api.tickPopulation(created.state, config, deps, input(0))
      if (!first.ok) throw new Error(first.reason)
      const id = Object.values(first.state.nests).flatMap(n => n.alive)[0].id
      const retire = { encounterId: id, cause: 'defeated' as const, now: 100, random: () => 0 }
      expect(api.retireEncounter(first.state, { ...config, namespace: 'other' }, retire)).toEqual({ ok: false, reason: 'namespace-mismatch', state: first.state })
      const retired = api.retireEncounter(first.state, config, retire)
      if (!retired.ok) throw new Error(retired.reason)
      expect(api.tickPopulation(retired.state, config, deps, input(99))).toEqual({ ok: false, reason: 'clock-regressed', state: retired.state })
      expect(api.retireEncounter(retired.state, config, { ...retire, now: 99 })).toEqual({ ok: false, reason: 'not-alive', state: retired.state })
      const same = api.tickPopulation(retired.state, config, deps, input(100))
      expect(same.state).toEqual(retired.state)
      const next = api.tickPopulation(same.state, config, deps, input(100.001))
      expect(Object.values(next.state.nests).flatMap(n => n.alive)).toHaveLength(1)
    }
  })

  it('ships the same catalog and validates it the same way', () => {
    expect(JSON.stringify(bundle.ECO_1_ENCOUNTER_CATALOG)).toBe(JSON.stringify(source.ECO_1_ENCOUNTER_CATALOG))
    expect(bundle.validateEncounterCatalog(bundle.ECO_1_ENCOUNTER_CATALOG, lookup)).toEqual(source.validateEncounterCatalog(source.ECO_1_ENCOUNTER_CATALOG, lookup))
    const broken = (api: Api) => ({ ...api.ECO_1_ENCOUNTER_CATALOG, entries: api.ECO_1_ENCOUNTER_CATALOG.entries.map((e, i) => (i === 0 ? { ...e, weight: -1 } : e)) })
    expect(bundle.validateEncounterCatalog(broken(bundle), lookup)).toEqual(source.validateEncounterCatalog(broken(source), lookup))
  })

  it('picks the same encounter for the same tickets, everywhere', () => {
    const results = (api: Api) => {
      const out: string[] = []
      for (const zone of api.ECO_1_ENCOUNTER_CATALOG.zones) {
        for (let i = 0; i < 400; i++) for (let j = 0; j < 20; j++) {
          const r = api.pickEncounter(api.ECO_1_ENCOUNTER_CATALOG, zone.id, { tierRoll: i / 400, entryRoll: j / 20 })
          out.push(r.ok ? r.entry.id : r.reason)
        }
      }
      return out
    }
    expect(results(bundle)).toEqual(results(source))
    expect(new Set(results(source)).size).toBe(35) // every entry reachable on this grid
  })

  it('answers invalid distributions and emptied pools the same way', () => {
    const variants = (api: Api): EncounterCatalog[] => {
      const c = api.ECO_1_ENCOUNTER_CATALOG
      return [
        { ...c, zones: c.zones.map(z => ({ ...z, rarityShares: { common: 0, uncommon: 0, rare: 0, very_rare: 0 } })) },
        { ...c, entries: c.entries.map(e => ({ ...e, weight: Number.NaN })) },
        { ...c, entries: c.entries.map(e => ({ ...e, speciesId: 150 })) },
      ]
    }
    const answers = (api: Api) => variants(api).flatMap(c => c.zones.map(z => {
      const r = api.pickEncounter(c, z.id, { tierRoll: 0.5, entryRoll: 0.5 })
      return r.ok ? r.entry.id : r.reason
    }))
    expect(answers(bundle)).toEqual(answers(source))
    expect(new Set(answers(source))).toEqual(new Set(['invalid-distribution', 'empty-tier']))
  })

  it('evolves the same population through the same ticks and retirements', () => {
    const config: PopulationConfig = populationConfig([caveArea([caveNest('a', row(1, 0, 6)), caveNest('b', row(2, 0, 6)), caveNest('c', row(3, 0, 6), { respawn: { policy: 'per-member', delayMs: 40_000, jitter: 0.2, retryMs: 9_000 } })], { maxAlive: 6 })])
    const trace = (api: Api) => {
      const random = seeded(31337)
      const created = api.createPopulation(config, { catalog: api.ECO_1_ENCOUNTER_CATALOG })
      if (!created.ok) throw new Error('config')
      let state: PopulationState = created.state
      const log: string[] = []
      let now = 0
      for (let step = 0; step < 300; step++) {
        const areas = new Set(step % 120 < 60 ? ['cueva-inicial'] : []) // 60 steps × 7 s away > 5 min: reaches dormant
        const r = api.tickPopulation(state, config, { catalog: api.ECO_1_ENCOUNTER_CATALOG }, { now, activeAreas: areas, geometry: () => gridGeometry([{ tx: 2, ty: 2 }]), random })
        if (!r.ok) throw new Error(r.reason)
        state = r.state
        log.push(JSON.stringify(r.events))
        for (const enc of Object.values(state.nests).flatMap(n => n.alive)) {
          if (random() < 0.25) {
            const out = api.retireEncounter(state, config, { encounterId: enc.id, cause: 'defeated', now, random })
            log.push(out.ok ? `retired ${out.retired.id} due ${out.dueAt}` : out.reason)
            if (out.ok) state = out.state
          }
        }
        log.push(JSON.stringify(api.publicArea(state, 'cueva-inicial')))
        now += 7_000
      }
      return { log, state: JSON.stringify(state) }
    }
    const a = trace(source)
    const b = trace(bundle)
    expect(b.log).toEqual(a.log)
    expect(b.state).toBe(a.state)
    expect(a.log.join('\n')).toMatch(/"type":"spawned"/)
    expect(a.log.join('\n')).toMatch(/"to":"dormant"/)
  })
})

describe('drift and --check', () => {
  it('a changed catalog entry or engine rule makes the committed bundle stale', async () => {
    const entry = await bundleEncounters({ plugins: [rewrite('encounters/initialCatalog.ts', "'pidgey', 16, 'common', 28", "'pidgey', 16, 'common', 29")] })
    const rule = await bundleEncounters({ plugins: [rewrite('population/engine.ts', 'nestState.dueAt = now + nest.respawn.retryMs', 'nestState.dueAt = now + nest.respawn.retryMs + 1')] })
    for (const fresh of [entry, rule]) {
      expect(fresh).not.toBe(unix(generated))
      expect(await bundleStatus(fresh, OUTPUT)).toBe('stale')
    }
  })

  it('--check fails on a missing or stale file and never writes; passes on a fresh one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eco-check-'))
    try {
      const missing = join(dir, 'missing.js')
      const r1 = runScript('--check', '--output', missing)
      expect([r1.status, r1.stderr.trim()]).toEqual([1, 'encounters.generated.js is missing: run node scripts/integration/bundle-encounters.mjs'])
      expect(existsSync(missing)).toBe(false)

      const stale = join(dir, 'stale.js')
      writeFileSync(stale, '// stale\n')
      const r2 = runScript('--check', '--output', stale)
      expect(r2.status).toBe(1)
      expect(readFileSync(stale, 'utf8')).toBe('// stale\n')

      const fresh = join(dir, 'fresh.js')
      writeFileSync(fresh, readFileSync(OUTPUT, 'utf8'))
      expect(runScript('--check', '--output', fresh).status).toBe(0)
      expect(runScript('--check').status).toBe(0) // the committed artefact
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('writing twice gives the same bytes, equal to the committed bundle', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eco-write-'))
    try {
      const out = join(dir, 'bundle.js')
      expect(runScript('--output', out).status).toBe(0)
      const first = readFileSync(out, 'utf8')
      expect(runScript('--output', out).status).toBe(0)
      expect(readFileSync(out, 'utf8')).toBe(first)
      expect(first).toBe(unix(generated))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
