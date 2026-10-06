// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error — Node built-ins are outside frontend declarations
import { execFileSync } from 'node:child_process'
// @ts-expect-error — idem
import { mkdirSync, writeFileSync } from 'node:fs'
// @ts-expect-error — idem
import { join } from 'node:path'
// @ts-expect-error — idem
import { env } from 'node:process'
// @ts-expect-error — idem
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as source from './engine'
import { caveArea, caveNest, populationConfig, row, deps, gridGeometry } from './testing'
import type { PopulationConfig, PopulationState, RespawnPolicy } from './types'

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url))
let api: Pick<typeof source, 'createPopulation' | 'tickPopulation' | 'retireEncounter'> = source
if (env.ECO_AUDIT_BASE === 'fa14ab2') {
  const cache = join(ROOT, 'node_modules/.cache/ecosystem-audit')
  mkdirSync(cache, { recursive: true })
  const file = join(cache, 'fa14ab2-zero-delay.mjs')
  writeFileSync(file, execFileSync('git', ['show', 'fa14ab2cb99c6d80725a57ea7a109607a03c8ef2:services/realtime/src/world/ecosystem/encounters.generated.js'], { cwd: ROOT }))
  api = await import(/* @vite-ignore */ pathToFileURL(file).href)
}
const input = (now: number, random = () => 0) => ({ now, random, activeAreas: new Set(['cueva-inicial']), geometry: () => gridGeometry() })
const alive = (state: PopulationState) => Object.values(state.nests).flatMap(n => n.alive)
function start(policy: RespawnPolicy) {
  const config: PopulationConfig = populationConfig([caveArea([caveNest('zero', row(0, 0, 8), { habitats: ['cave-nook'], respawn: { policy, delayMs: 0, jitter: 0, retryMs: 1 } })], { idle: { dormantAfterMs: 300_000, staggerMinMs: 0, staggerMaxMs: 0 } })])
  const created = api.createPopulation(config, deps)
  if (!created.ok) throw new Error('zero must remain valid')
  const result = api.tickPopulation(created.state, config, deps, input(0))
  if (!result.ok) throw new Error(result.reason)
  expect(alive(result.state)).toHaveLength(1)
  return { config, state: result.state }
}

describe('F8 approved zero-delay contract', () => {
  it('F8 repeating an instant cannot top up again or consume RNG', () => {
    const { config, state } = start('per-member')
    const random = vi.fn(() => 0)
    const repeated = api.tickPopulation(state, config, deps, input(0, random))
    expect(repeated.state).toEqual(state)
    expect(random).not.toHaveBeenCalled()
    if (repeated.ok) expect(repeated.events).toEqual([])
  })
  it.each(['per-group', 'per-member'] as const)('F8 %s immediate respawn after retire waits for a strictly newer instant', policy => {
    const { config, state } = start(policy)
    const retired = api.retireEncounter(state, config, { encounterId: alive(state)[0].id, cause: 'defeated', now: 0, random: () => 0 })
    if (!retired.ok) throw new Error(retired.reason)
    const random = vi.fn(() => 0)
    const same = api.tickPopulation(retired.state, config, deps, input(0, random))
    expect(alive(same.state)).toHaveLength(0)
    expect(same.state).toEqual(retired.state)
    expect(random).not.toHaveBeenCalled()
    const next = api.tickPopulation(same.state, config, deps, input(0.001))
    expect(alive(next.state)).toHaveLength(1) // no imposed minimum duration
  })
})
