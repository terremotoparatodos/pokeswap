// Lifecycle of the population engine: activation, groups, retire, respawn,
// repeated evaluations, clock jumps, idle/dormant areas, identities.

import { describe, expect, it } from 'vitest'
import { createPopulation, retireEncounter, tickPopulation } from './engine'
import { encounterIdParts } from './ids'
import { publicArea } from './projection'
import { caveArea, caveNest, deps, gridGeometry, populationConfig, populationViolations, row, scripted, seeded } from './testing'
import type { PopulationConfig, PopulationEncounter, PopulationState, PopulationTickInput, RandomSource } from './types'

const AREA = 'cueva-inicial'
const T0 = 1_000_000
const geometry = () => gridGeometry()
const active = new Set([AREA])
const nobody = new Set<string>()

function create(config: PopulationConfig): PopulationState {
  const created = createPopulation(config, deps)
  if (!created.ok) throw new Error(JSON.stringify(created.issues))
  return created.state
}

function tick(state: PopulationState, config: PopulationConfig, now: number, random: RandomSource, areas: ReadonlySet<string> = active) {
  const input: PopulationTickInput = { now, activeAreas: areas, geometry, random }
  const result = tickPopulation(state, config, deps, input)
  if (!result.ok) throw new Error(result.reason)
  expect(populationViolations(result.state, config, geometry)).toEqual([])
  return result
}

const alive = (state: PopulationState): PopulationEncounter[] => Object.values(state.nests).flatMap(nest => nest.alive)

/** Activates and runs past the stagger, so every nest has had its first spawn attempt. */
function started(config: PopulationConfig, random: RandomSource = seeded(1)) {
  const first = tick(create(config), config, T0, random)
  return tick(first.state, config, T0 + 15_000, random)
}

describe('activation and groups', () => {
  const config = populationConfig([caveArea([caveNest('n1', row(1, 0, 9)), caveNest('n2', row(2, 0, 9))])])

  it('a dormant area wakes up staggered: nothing at the first tick, spawns within the stagger window', () => {
    const first = tick(create(config), config, T0, seeded(1))
    expect(first.events).toEqual([{ type: 'area-status', areaId: AREA, from: 'dormant', to: 'active', cleared: [] }])
    expect(alive(first.state)).toEqual([])
    for (const nest of Object.values(first.state.nests)) expect(nest.dueAt).toBeGreaterThanOrEqual(T0 + 5_000)
    const later = tick(first.state, config, T0 + 15_000, seeded(2))
    expect(later.events.filter(e => e.type === 'spawned' || e.type === 'spawn-failed')).toHaveLength(2)
  })

  it('a group is several encounters with their own identity, same group, distinct tiles', () => {
    // Zubat (common, group 2–3) is the first common entry: tier roll 0, entry roll 0, size roll .99 → 3.
    const one = populationConfig([caveArea([caveNest('n1', row(1, 0, 9))])])
    const woken = tick(create(one), one, T0, scripted(0))
    const spawned = tick(woken.state, one, T0 + 5_000, scripted(0, 0, 0.99, 0, 0, 0))
    const zubats = alive(spawned.state)
    expect(zubats.map(e => e.speciesId)).toEqual([41, 41, 41])
    expect(new Set(zubats.map(e => e.id)).size).toBe(3)
    expect(new Set(zubats.map(e => e.groupId))).toEqual(new Set([`test-epoch-1:${AREA}:n1:1`]))
    expect(zubats.map(e => e.member)).toEqual([0, 1, 2])
    expect(new Set(zubats.map(e => `${e.tile.tx},${e.tile.ty}`)).size).toBe(3)
    expect(zubats.every(e => e.familyId === 41 && e.groupSize === 3 && e.generation === 1)).toBe(true)
  })

  it('two encounters of the same species coexist across nests', () => {
    const both = scripted(0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    const woken = tick(create(config), config, T0, scripted(0))
    const spawned = tick(woken.state, config, T0 + 5_000, both)
    const zubats = alive(spawned.state).filter(e => e.speciesId === 41)
    expect(new Set(zubats.map(e => e.nestId))).toEqual(new Set(['n1', 'n2']))
  })
})

describe('retire and respawn', () => {
  const config = populationConfig([caveArea([caveNest('n1', row(1, 0, 9))])])

  it('retiring twice changes nothing the second time: no second respawn, no reset', () => {
    const { state } = started(config)
    const [first] = alive(state)
    const once = retireEncounter(state, config, { encounterId: first.id, cause: 'defeated', now: T0 + 20_000, random: scripted(0.5) })
    expect(once.ok).toBe(true)
    if (!once.ok) return
    const twice = retireEncounter(once.state, config, { encounterId: first.id, cause: 'captured', now: T0 + 30_000, random: scripted(0.5) })
    expect(twice).toEqual({ ok: false, reason: 'not-alive', state: once.state })
    expect(retireEncounter(state, config, { encounterId: 'nonsense', cause: 'fled', now: T0 + 20_000, random: scripted(0.5) }).ok).toBe(false)
    expect(retireEncounter(state, config, { encounterId: first.id.replace('test-epoch-1', 'other'), cause: 'fled', now: T0 + 20_000, random: scripted(0.5) }).ok).toBe(false)
  })

  it('per group: the nest respawns once its whole group is gone, at the due time — not before, once after', () => {
    let { state } = started(config)
    const group = alive(state)
    let dueAt: number | null = null
    let now = T0 + 20_000
    for (const encounter of group) {
      const r = retireEncounter(state, config, { encounterId: encounter.id, cause: 'defeated', now, random: scripted(0.5) })
      if (!r.ok) throw new Error(r.reason)
      state = r.state
      dueAt = r.dueAt
      now += 1_000
    }
    expect(dueAt).toBe(T0 + 20_000 + (group.length - 1) * 1_000 + 75_000) // jitter 0 in the fixture
    const before = tick(state, config, dueAt! - 1, seeded(9))
    expect(alive(before.state)).toEqual([])
    const at = tick(before.state, config, dueAt!, seeded(9))
    expect(at.events.map(e => e.type)).toEqual(['spawned'])
    const after = tick(at.state, config, dueAt! + 60_000, seeded(9))
    expect(after.events).toEqual([])
    expect(alive(after.state)).toEqual(alive(at.state))
  })

  it('per group: retiring one of several members schedules nothing yet', () => {
    const { state } = started(populationConfig([caveArea([caveNest('n1', row(1, 0, 9))])]), scripted(0, 0, 0, 0.99, 0, 0, 0))
    expect(alive(state).length).toBeGreaterThan(1)
    const r = retireEncounter(state, config, { encounterId: alive(state)[0].id, cause: 'fled', now: T0 + 20_000, random: scripted(0.5) })
    expect(r.ok && r.dueAt).toBe(null)
  })

  it('per member: the first retirement schedules a top-up; later ones never push it back', () => {
    const perMember = populationConfig([caveArea([caveNest('n1', row(1, 0, 9), { respawn: { policy: 'per-member', delayMs: 60_000, jitter: 0, retryMs: 15_000 } })])])
    let { state } = started(perMember, scripted(0, 0, 0, 0.99, 0, 0, 0))
    const [a, b] = alive(state)
    const first = retireEncounter(state, perMember, { encounterId: a.id, cause: 'defeated', now: T0 + 20_000, random: scripted(0.5) })
    if (!first.ok) throw new Error(first.reason)
    const second = retireEncounter(first.state, perMember, { encounterId: b.id, cause: 'defeated', now: T0 + 50_000, random: scripted(0.5) })
    if (!second.ok) throw new Error(second.reason)
    expect(first.dueAt).toBe(T0 + 80_000)
    expect(second.dueAt).toBe(T0 + 80_000)
    state = tick(second.state, perMember, T0 + 80_000, scripted(0, 0, 0.99, 0, 0)).state
    expect(alive(state).length).toBeLessThanOrEqual(3)
    expect(alive(state).length).toBeGreaterThan(alive(second.state).length)
  })
})

describe('evaluation is idempotent in time', () => {
  const config = populationConfig([caveArea([caveNest('n1', row(1, 0, 9)), caveNest('n2', row(2, 0, 9))])])

  it('a second tick at the same instant creates nothing, resets nothing, advances no generation', () => {
    const { state } = started(config)
    const again = tick(state, config, T0 + 15_000, seeded(77))
    expect(again.events).toEqual([])
    expect(again.state.nests).toEqual(state.nests)
  })

  it('also after a failed attempt: the retry is scheduled once, not re-rolled', () => {
    const blocked = { ...config, areas: [{ ...config.areas[0], maxAlive: 1 }] }
    const { state, events } = started(blocked)
    const failed = events.filter(e => e.type === 'spawn-failed')
    expect(failed).toHaveLength(1)
    const again = tick(state, blocked, T0 + 15_000, seeded(78))
    expect(again.events).toEqual([])
    expect(again.state.nests).toEqual(state.nests)
  })

  it('a huge clock jump makes at most one attempt per nest, then waits', () => {
    let { state } = started(config)
    for (const encounter of alive(state)) {
      const r = retireEncounter(state, config, { encounterId: encounter.id, cause: 'defeated', now: T0 + 20_000, random: scripted(0.5) })
      if (r.ok) state = r.state
    }
    const jump = tick(state, config, T0 + 30 * 24 * 3_600_000, seeded(5))
    expect(jump.events.filter(e => e.type === 'spawned' || e.type === 'spawn-failed')).toHaveLength(2)
    expect(Object.values(jump.state.nests).map(n => n.generation)).toEqual(Object.values(state.nests).map(n => n.generation + 1))
  })

  it('refuses a clock that goes backwards, for ticks and retirements', () => {
    const { state } = started(config)
    expect(tickPopulation(state, config, deps, { now: T0, activeAreas: active, geometry, random: seeded(1) })).toEqual({ ok: false, reason: 'clock-regressed', state })
    const [first] = alive(state)
    expect(retireEncounter(state, config, { encounterId: first.id, cause: 'defeated', now: T0, random: seeded(1) })).toEqual({ ok: false, reason: 'clock-regressed', state })
  })

  it('is reproducible and never mutates its input', () => {
    const run = () => started(config, seeded(123)).state
    expect(run()).toEqual(run())
    const { state } = started(config)
    const snapshot = JSON.stringify(state)
    tick(state, config, T0 + 200_000, seeded(4), nobody)
    retireEncounter(state, config, { encounterId: alive(state)[0].id, cause: 'defeated', now: T0 + 20_000, random: seeded(4) })
    expect(JSON.stringify(state)).toBe(snapshot)
  })

  it('refuses a random source outside [0, 1)', () => {
    const woken = tick(create(config), config, T0, scripted(0))
    expect(() => tickPopulation(woken.state, config, deps, { now: T0 + 15_000, activeAreas: active, geometry, random: scripted(1) })).toThrow(RangeError)
    expect(() => tickPopulation(woken.state, config, deps, { now: T0 + 15_000, activeAreas: active, geometry, random: scripted(Number.NaN) })).toThrow(RangeError)
  })
})

describe('empty area', () => {
  const config = populationConfig([caveArea([caveNest('n1', row(1, 0, 9))])])

  it('idle keeps its encounters but is not simulated; a quick return resumes them', () => {
    const { state } = started(config)
    const left = tick(state, config, T0 + 20_000, seeded(1), nobody)
    expect(left.events).toEqual([{ type: 'area-status', areaId: AREA, from: 'active', to: 'idle', cleared: [] }])
    expect(publicArea(left.state, AREA)).toEqual({ simulated: false, encounters: [] })
    const back = tick(left.state, config, T0 + 60_000, seeded(1))
    expect(alive(back.state)).toEqual(alive(state))
    expect(publicArea(back.state, AREA).simulated).toBe(true)
  })

  it('long absence → dormant: encounters cleared, nothing accumulates; return refills with fresh ids after a stagger', () => {
    const { state } = started(config)
    const before = alive(state).map(e => e.id)
    let s = tick(state, config, T0 + 20_000, seeded(1), nobody).state
    s = tick(s, config, T0 + 100_000, seeded(1), nobody).state
    expect(alive(s).map(e => e.id)).toEqual(before) // idle: kept, not simulated
    const dormant = tick(s, config, T0 + 330_000, seeded(1), nobody)
    expect(dormant.events).toEqual([{ type: 'area-status', areaId: AREA, from: 'idle', to: 'dormant', cleared: before }])
    s = dormant.state
    expect(alive(s)).toEqual([])
    const dayLater = tick(s, config, T0 + 86_400_000, seeded(1), nobody)
    expect(dayLater.events).toEqual([])
    expect(alive(dayLater.state)).toEqual([])
    s = dayLater.state
    expect(s.nests[`${AREA}/n1`].generation).toBe(1)
    const back = tick(s, config, T0 + 90_000_000, seeded(1))
    expect(alive(back.state)).toEqual([])
    const refilled = tick(back.state, config, T0 + 90_000_000 + 15_000, seeded(1))
    expect(alive(refilled.state).every(e => e.generation === 2 && !before.includes(e.id))).toBe(true)
    expect(alive(refilled.state).length).toBeGreaterThan(0)
  })

  it('"not simulated" is not "all defeated": an active area with every encounter retired is simulated and empty', () => {
    let { state } = started(config)
    for (const encounter of alive(state)) {
      const r = retireEncounter(state, config, { encounterId: encounter.id, cause: 'defeated', now: T0 + 20_000, random: scripted(0.5) })
      if (r.ok) state = r.state
    }
    expect(publicArea(state, AREA)).toEqual({ simulated: true, encounters: [] })
    expect(state.areas[AREA].status).toBe('active')
  })
})

describe('identities and generations', () => {
  const config = populationConfig([caveArea([caveNest('n1', row(1, 0, 9)), caveNest('n2', row(2, 0, 9))])])

  it('never reuses an id over many cycles; generations only grow', () => {
    const random = seeded(2024)
    let { state } = started(config, random)
    let now = T0 + 15_000
    const seen = new Set(alive(state).map(e => e.id))
    let lastGen = Object.values(state.nests).map(n => n.generation)
    for (let cycle = 0; cycle < 200; cycle++) {
      now += 10_000
      for (const encounter of alive(state)) {
        if (random() < 0.5) continue
        const r = retireEncounter(state, config, { encounterId: encounter.id, cause: 'defeated', now, random })
        if (r.ok) state = r.state
      }
      now += 80_000
      const r = tick(state, config, now, random)
      state = r.state
      for (const e of r.events) if (e.type === 'spawned') for (const born of e.encounters) {
        expect(seen.has(born.id), born.id).toBe(false)
        seen.add(born.id)
      }
      const gens = Object.values(state.nests).map(n => n.generation)
      gens.forEach((g, i) => expect(g).toBeGreaterThanOrEqual(lastGen[i]))
      lastGen = gens
    }
    expect(seen.size).toBeGreaterThan(100)
  })

  it('ids carry their namespace; another namespace yields other ids; a mismatched state is refused', () => {
    const a = started(config, seeded(1)).state
    const otherConfig = { ...config, namespace: 'test-epoch-2' }
    const b = started(otherConfig, seeded(1)).state
    expect(alive(a).map(e => encounterIdParts(e.id)!.namespace)).toEqual(alive(a).map(() => 'test-epoch-1'))
    expect(alive(b).map(e => e.id).some(id => alive(a).some(e => e.id === id))).toBe(false)
    expect(tickPopulation(a, otherConfig, deps, { now: T0 + 20_000, activeAreas: active, geometry, random: seeded(1) })).toEqual({ ok: false, reason: 'namespace-mismatch', state: a })
  })
})
