// @vitest-environment node
// ECO-CAPACITY-1 compatibility: without population zones, the new engine
// behaves exactly like the engine of the base commit. The baseline is the
// realtime bundle committed at 7739c4d (ECO-MAP-1), read from git — not a
// hand copy of the old code. Same configs, same clock, same random streams.
//
// The only allowed difference is diagnostic: an attempt the old engine
// reported as `empty-tier` may now read `no-room-for-group` (+ `limitedBy`)
// when the tier's only candidates needed a larger group than the room left.
// State, timing and random consumption must be identical.

import { describe, expect, it } from 'vitest'
// @ts-expect-error — Node built-ins, no Node types in the app's tsconfig (see praderaAudit.test.ts)
import { execFileSync } from 'node:child_process'
// @ts-expect-error — idem
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
// @ts-expect-error — idem
import { join } from 'node:path'
// @ts-expect-error — idem
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ECO_1_ENCOUNTER_CATALOG } from '../encounters/initialCatalog'
import { createPopulation, retireEncounter, tickPopulation } from './engine'
import { caveArea, caveNest, gridGeometry, populationConfig, row, seeded } from './testing'
import type { PopulationConfig, PopulationEvent, PopulationState } from './types'

const BASE = '7739c4d4c1dba59b8dca3b66f379dea18082d108'
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

interface EngineApi {
  createPopulation: typeof createPopulation
  tickPopulation: typeof tickPopulation
  retireEncounter: typeof retireEncounter
}

async function baseEngine(): Promise<{ api: EngineApi; dispose: () => void }> {
  mkdirSync(join(ROOT, 'node_modules', '.cache'), { recursive: true })
  const source = execFileSync('git', ['show', `${BASE}:services/realtime/src/world/ecosystem/encounters.generated.js`], { cwd: ROOT, encoding: 'utf8' })
  // Inside the project (Vite only loads files under its root), in an ignored cache folder; removed afterwards.
  const dir = mkdtempSync(join(ROOT, 'node_modules', '.cache', 'eco-capacity-baseline-'))
  const file = join(dir, 'base.mjs')
  writeFileSync(file, source)
  const api = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as EngineApi
  return { api, dispose: () => rmSync(dir, { recursive: true, force: true }) }
}

const asBase = (events: readonly PopulationEvent[]) => events.map(e => {
  if (e.type !== 'spawn-failed') return e
  const { limitedBy, ...rest } = e
  void limitedBy
  return rest.reason === 'no-room-for-group' ? { ...rest, reason: 'empty-tier' as const } : rest
})

function trace(api: EngineApi, config: PopulationConfig, seed: number, steps: number) {
  const random = seeded(seed)
  const created = api.createPopulation(config, { catalog: ECO_1_ENCOUNTER_CATALOG })
  if (!created.ok) throw new Error(JSON.stringify(created.issues))
  let state: PopulationState = created.state
  const log: unknown[] = []
  let now = 0
  for (let step = 0; step < steps; step++) {
    const active = new Set(step % 150 < 100 ? [config.areas[0].areaId] : [])
    const r = api.tickPopulation(state, config, { catalog: ECO_1_ENCOUNTER_CATALOG }, { now, activeAreas: active, geometry: () => gridGeometry([{ tx: 2, ty: 2 }]), random })
    if (!r.ok) throw new Error(r.reason)
    state = r.state
    log.push({ events: api === undefined ? [] : r.events })
    for (const e of Object.values(state.nests).flatMap(n => n.alive)) {
      if (random() < 0.3) {
        const out = api.retireEncounter(state, config, { encounterId: e.id, cause: 'defeated', now, random })
        if (out.ok) state = out.state
        log.push(out.ok ? out.dueAt : out.reason)
      }
    }
    now += 7_000
  }
  return { log, state }
}

const CONFIGS: Record<string, PopulationConfig> = {
  'cave, 3 nests, tight area (room-induced blocks happen)': populationConfig([caveArea([caveNest('a', row(1, 0, 6)), caveNest('b', row(2, 0, 6)), caveNest('c', row(3, 0, 6), { habitats: ['cave-ceiling'] })], { maxAlive: 4 })]),
  'cave, per-member + small group cap': populationConfig([caveArea([caveNest('a', row(1, 0, 9), { groupCap: 2, respawn: { policy: 'per-member', delayMs: 40_000, jitter: 0.2, retryMs: 9_000 } }), caveNest('b', [{ tx: 0, ty: 5 }])])]),
  'forest-like single nest, roomy area': populationConfig([{ ...caveArea([caveNest('f', row(1, 0, 3))]), maxAlive: 20 }]),
}

describe('without population zones the engine matches the base commit exactly', () => {
  it.each(Object.keys(CONFIGS))('%s — 3 seeds × 400 steps', async name => {
    const { api: base, dispose } = await baseEngine()
    try {
      const now = { createPopulation, tickPopulation, retireEncounter }
      for (const seed of [11, 22, 33]) {
        const a = trace(base, CONFIGS[name], seed, 400)
        const b = trace(now, CONFIGS[name], seed, 400)
        expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state))
        const bLog = b.log.map(x => (typeof x === 'object' && x !== null && 'events' in x ? { events: asBase((x as { events: PopulationEvent[] }).events) } : x))
        expect(JSON.stringify(bLog)).toBe(JSON.stringify(a.log))
      }
    } finally {
      dispose()
    }
  }, 60_000)

  it('the diagnostic refinement actually occurs in the tight config (it is not vacuous)', () => {
    const { log } = trace({ createPopulation, tickPopulation, retireEncounter }, CONFIGS['cave, 3 nests, tight area (room-induced blocks happen)'], 11, 400)
    const reasons = log.flatMap(x => (typeof x === 'object' && x !== null && 'events' in x ? (x as { events: PopulationEvent[] }).events : []))
      .filter(e => e.type === 'spawn-failed').map(e => (e as { reason: string }).reason)
    expect(reasons).toContain('no-room-for-group')
  })
})
