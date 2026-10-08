// @vitest-environment node
// The admission bundle (ECO-GAMEPLAY-1): exactly what admissionRuntime.ts builds to, reproducible,
// loadable by plain Node, exposing only an ADMITTED population (never the bare engine), failing
// closed, and — once admitted — spawning only on verified geometry within every limit, with
// several individuals of a species, and respawning after a test retirement.

import { describe, expect, it } from 'vitest'
// @ts-expect-error — Node built-ins, no Node types in the app's tsconfig (see praderaAudit.test.ts)
import { spawnSync } from 'node:child_process'
// @ts-expect-error — idem
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
// @ts-expect-error — idem
import { tmpdir } from 'node:os'
// @ts-expect-error — idem
import { join } from 'node:path'
// @ts-expect-error — idem
import { execPath } from 'node:process'
// @ts-expect-error — idem
import { pathToFileURL } from 'node:url'
// @ts-expect-error — plain .mjs build script, no type declarations
import { OUTPUT, bundleAdmission, bundleStatus } from '../../../../scripts/integration/bundle-admission.mjs'
// @ts-expect-error — generated plain JS, no type declarations (the TS sources are the typed API)
import * as bundle from '../../../../services/realtime/src/world/ecosystem/admission.generated.js'
import generated from '../../../../services/realtime/src/world/ecosystem/admission.generated.js?raw'
// @ts-expect-error — plain JS module of the realtime world (authoritative layout versions)
import { layoutVersion } from '../../../../services/realtime/src/world/layoutVersion.js'
import * as source from './admissionRuntime'
import { PROVISIONAL_CAPACITY, proposedAreaConfig } from '../map/capacityProposal'
import { areaView } from '../map/geometry'
import { SNAPSHOT } from '../map/nestData'
import { FORBIDDEN_FLAGS } from '../map/nestValidation'
import { PROVISIONAL_IDLE, PROVISIONAL_RESPAWN } from '../population/config'
import { seeded } from '../population/testing'

type Api = typeof source
const unix = (text: string) => text.split('\r\n').join('\n')
const AREAS = Object.keys(SNAPSHOT.areas)
const layouts = (): Record<string, string> => Object.fromEntries(AREAS.map(id => [id, layoutVersion(id)]))
const admit = (api: Api, namespace = 'eco-test') => {
  const result = api.admitEcoPopulation({ namespace, currentLayouts: layouts() })
  if (!result.ok) throw new Error(JSON.stringify(result.issues))
  return result.population
}

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

describe('the committed admission bundle', () => {
  it('is up to date with src/features/ecosystem, and a source change makes it stale', async () => {
    const fresh = await bundleAdmission()
    expect(unix(generated) === fresh).toBe(true)
    expect(await bundleStatus(fresh, OUTPUT)).toBe('fresh')
    const drifted = await bundleAdmission({ plugins: [rewrite('map/capacityLimits.ts', 'maxAlive: 18', 'maxAlive: 19')] })
    expect(drifted).not.toBe(fresh)
  }, 30_000)

  it('is reproducible, with no imports, absolute paths or timestamps', async () => {
    expect(await bundleAdmission()).toBe(await bundleAdmission())
    expect(generated).not.toMatch(/^import |require\(/m)
    expect(generated).not.toMatch(/(?:^|["'\s(])[A-Za-z]:[\\/]|\/Users\/|\/home\//m)
    expect(generated).not.toMatch(/\b20\d\d-\d\d-\d\dT\d\d:/)
  }, 30_000)

  it('exports only the admission: never the bare engine', () => {
    expect(Object.keys(bundle).sort()).toEqual(['ECO_ADMISSION_API', 'ECO_ADMISSION_AREAS', 'admitEcoPopulation'])
    expect(bundle.ECO_ADMISSION_AREAS).toEqual(AREAS)
    expect(Object.isFrozen(bundle.ECO_ADMISSION_AREAS)).toBe(true)
    expect(Object.keys(bundle).sort()).toEqual(Object.keys(source).sort())
    expect(bundle.ECO_ADMISSION_API).toBe(1)
    for (const engine of ['createPopulation', 'tickPopulation', 'retireEncounter', 'createValidatedPopulation']) expect(bundle).not.toHaveProperty(engine)
    const population = admit(bundle as Api)
    expect(Object.keys(population).sort()).toEqual(['areaIds', 'areaOf', 'exists', 'retire', 'tick', 'view'])
    expect(Object.isFrozen(population)).toBe(true)
  })

  it('loads in a bare Node process, from outside the repository, and admits against the real layouts', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'eco-admission-'))
    try {
      const script = `const m = await import(${JSON.stringify(pathToFileURL(OUTPUT).href)});`
        + `const r = m.admitEcoPopulation({ namespace: 'eco-node', currentLayouts: ${JSON.stringify(layouts())} });`
        + "console.log(process.version, r.ok && r.population.areaIds.join(','))"
      const run = spawnSync(execPath, ['--input-type=module', '-e', script], { cwd, encoding: 'utf8' })
      expect(run.status, run.stderr).toBe(0)
      expect(run.stdout.trim()).toMatch(/^v\d+\.\d+\.\d+ pradera,cueva-inicial$/)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})

describe('fails closed: no admitted population without the gate', () => {
  const cases: [string, unknown][] = [
    ['an invalid namespace', { namespace: 'Eco:bad', currentLayouts: layouts() }],
    ['a missing namespace', { currentLayouts: layouts() }],
    ['an altered layout version', { namespace: 'eco-test', currentLayouts: { ...layouts(), pradera: '1.000000000000' } }],
    ['a missing area', { namespace: 'eco-test', currentLayouts: { pradera: layoutVersion('pradera') } }],
    ['an extra area', { namespace: 'eco-test', currentLayouts: { ...layouts(), 'ciudad-corazon': 'x' } }],
    ['no layouts', { namespace: 'eco-test', currentLayouts: {} }],
  ]
  it.each(cases)('%s', (_name, input) => {
    for (const api of [source, bundle] as Api[]) {
      const result = api.admitEcoPopulation(input as never)
      expect(result.ok).toBe(false)
      expect(result).not.toHaveProperty('population')
    }
  })
})

/** Runs an admitted population with both areas active; returns every view seen. */
function run(api: Api, steps: number, random = seeded(20261007)) {
  const population = admit(api)
  const views: Record<string, ReturnType<typeof population.view>>[] = []
  let now = 1_000_000
  for (let i = 0; i < steps; i++) {
    const r = population.tick({ now, random, activeAreas: new Set(AREAS) })
    if (!r.ok) throw new Error(r.reason)
    views.push(Object.fromEntries(AREAS.map(areaId => [areaId, population.view(areaId)])))
    now += 1_000
  }
  return { population, views, now, random }
}

describe('an admitted population', () => {
  const candidates = new Map(AREAS.flatMap(areaId => proposedAreaConfig(areaId, PROVISIONAL_RESPAWN, PROVISIONAL_IDLE).nests.map(nest => [`${areaId}/${nest.id}`, new Set(nest.tiles.map(t => `${t.tx},${t.ty}`))])))
  const zoneOf = new Map(AREAS.flatMap(areaId => proposedAreaConfig(areaId, PROVISIONAL_RESPAWN, PROVISIONAL_IDLE).nests.map(nest => [`${areaId}/${nest.id}`, nest.populationZoneId ?? null])))

  it('spawns only on its nest\'s verified candidate tiles, free of every forbidden flag, one encounter per tile', () => {
    const { views } = run(source, 120)
    let seen = 0
    for (const view of views) {
      for (const areaId of AREAS) {
        const geometry = areaView(SNAPSHOT, areaId)!
        const tiles = new Set<string>()
        for (const encounter of view[areaId].encounters) {
          const [, , nestId] = encounter.id.split(':')
          const key = `${encounter.tile.tx},${encounter.tile.ty}`
          expect(candidates.get(`${areaId}/${nestId}`)?.has(key), `${encounter.id} at ${key}`).toBe(true)
          const flags = geometry.flags(encounter.tile.tx, encounter.tile.ty)
          expect(FORBIDDEN_FLAGS.filter(flag => flags.has(flag))).toEqual([])
          expect(tiles.has(key)).toBe(false)
          tiles.add(key)
          seen++
        }
      }
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('never exceeds the area and zone maxima (provisional capacity)', () => {
    const { views } = run(source, 300)
    let peak = 0
    for (const view of views) {
      for (const areaId of AREAS) {
        const encounters = view[areaId].encounters
        expect(encounters.length).toBeLessThanOrEqual(PROVISIONAL_CAPACITY[areaId].maxAlive)
        peak = Math.max(peak, encounters.length)
        for (const zone of PROVISIONAL_CAPACITY[areaId].zones) {
          if (zone.maxAlive === undefined) continue
          const inZone = encounters.filter(e => zoneOf.get(`${areaId}/${e.id.split(':')[2]}`) === zone.id)
          expect(inZone.length).toBeLessThanOrEqual(zone.maxAlive)
        }
      }
    }
    expect(peak).toBeGreaterThan(1)
  })

  it('shows several individuals of one species, each with its own id; ids carry no species and no owner', () => {
    const { views } = run(source, 60)
    const last = views[views.length - 1].pradera.encounters
    const bySpecies = new Map<number, string[]>()
    for (const e of last) bySpecies.set(e.speciesId, [...(bySpecies.get(e.speciesId) ?? []), e.id])
    const repeated = [...bySpecies.values()].filter(ids => ids.length >= 2)
    expect(repeated.length).toBeGreaterThan(0)
    for (const ids of repeated) expect(new Set(ids).size).toBe(ids.length)
    for (const e of last) {
      const parts = e.id.split(':')
      expect(parts).toHaveLength(5)
      expect(parts[0]).toBe('eco-test')
      expect(Object.keys(e).sort()).toEqual(['groupId', 'id', 'speciesId', 'tile'])
    }
  })

  it('a test retirement removes the encounter for everyone and the nest respawns after its provisional delay', () => {
    const { population, now: start, random } = run(source, 30)
    const group = population.view('pradera').encounters[0].groupId
    const members = population.view('pradera').encounters.filter(e => e.groupId === group)
    const now = start
    for (const member of members) {
      expect(population.retire({ encounterId: member.id, now, random })).toEqual({ ok: true, areaId: 'pradera' })
      expect(population.retire({ encounterId: member.id, now, random })).toEqual({ ok: false, reason: 'not-alive' })
    }
    const nest = group.split(':')[2]
    const alive = () => population.view('pradera').encounters.filter(e => e.id.split(':')[2] === nest)
    expect(alive()).toEqual([])
    const generation = Number(group.split(':')[3])
    // per-group policy: one delay of 75 s ± 20 %, then the attempt (retries every 15 s if blocked).
    let respawnedAt: number | null = null
    for (let t = now + 1_000; t <= now + 200_000 && respawnedAt === null; t += 1_000) {
      population.tick({ now: t, random, activeAreas: new Set(AREAS) })
      if (alive().length > 0) respawnedAt = t
    }
    expect(respawnedAt).not.toBeNull()
    expect(respawnedAt! - now).toBeGreaterThanOrEqual(PROVISIONAL_RESPAWN.delayMs * (1 - PROVISIONAL_RESPAWN.jitter))
    expect(alive().every(e => Number(e.id.split(':')[3]) > generation)).toBe(true)
  })

  it('rejects a retirement or tick that goes back in time, and unknown or foreign ids', () => {
    const { population, now, random } = run(source, 20)
    const id = population.view('pradera').encounters[0].id
    expect(population.retire({ encounterId: id, now: now - 60_000, random })).toEqual({ ok: false, reason: 'clock-regressed' })
    expect(population.tick({ now: now - 60_000, random, activeAreas: new Set(AREAS) })).toEqual({ ok: false, reason: 'clock-regressed' })
    expect(population.retire({ encounterId: id.replace(/^eco-test/, 'eco-other'), now, random })).toEqual({ ok: false, reason: 'not-alive' })
    expect(population.areaOf(id)).toBe('pradera')
    expect(population.areaOf(id.replace(/^eco-test/, 'eco-other'))).toBeNull()
    expect(population.areaOf('not-an-id')).toBeNull()
  })

  it('exists: the exact individual, shown or hidden; never a merely well-formed id (ECO-GAMEPLAY-2)', () => {
    const { population, now, random } = run(source, 20)
    const [target, other] = population.view('pradera').encounters
    const [ns, area, nest, generation, member] = target.id.split(':')
    expect(population.exists(target.id)).toBe(true)
    expect(population.exists([ns, area, nest, Number(generation) + 100, member].join(':'))).toBe(false)
    expect(population.exists(target.id.replace(/^eco-test/, 'eco-other'))).toBe(false)
    expect(population.exists('not-an-id')).toBe(false)
    expect(population.retire({ encounterId: target.id, now, random }).ok).toBe(true)
    expect(population.exists(target.id)).toBe(false)
    // idle: hidden but kept; dormant: cleared
    population.tick({ now: now + 1_000, random, activeAreas: new Set() })
    expect(population.view('pradera').encounters).toEqual([])
    expect(population.exists(other.id)).toBe(true)
    let t = now + 1_000
    for (; t < now + PROVISIONAL_IDLE.dormantAfterMs + 5_000; t += 1_000) population.tick({ now: t, random, activeAreas: new Set() })
    expect(population.exists(other.id)).toBe(false)
  })

  it('an area without viewers stops being simulated: a viewer sees nothing, not an empty world', () => {
    const { population, now, random } = run(source, 20)
    expect(population.view('pradera').simulated).toBe(true)
    let t = now
    for (; t < now + PROVISIONAL_IDLE.dormantAfterMs + 5_000; t += 1_000) population.tick({ now: t, random, activeAreas: new Set() })
    expect(population.view('pradera')).toEqual({ simulated: false, encounters: [] })
  })

  it('the bundle evolves exactly like the sources', () => {
    const trace = (api: Api) => JSON.stringify(run(api, 200).views)
    expect(trace(bundle as Api)).toBe(trace(source))
  })
})
