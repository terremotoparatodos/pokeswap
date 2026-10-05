// The simulator's controller drives the real engine reproducibly: a scripted
// scenario (initial population → retirement → respawn → empty area → return)
// and each control's contract.

import { describe, expect, it } from 'vitest'
import { compareSetups, runSession } from './compare'
import { defaultParams, type PreviewZoneId } from './scenarios'
import {
  advance, aliveEncounters, createSim, repeatEvaluation, resetSim, retire, setForcedInactive, setPlayers, viewOf,
  type SimSetup, type SimState,
} from './simulator'

const last = (s: SimState) => s.log[s.log.length - 1]
const setup = (over: Partial<SimSetup> = {}): SimSetup => ({ zoneId: 'cueva-inicial', layout: 'mixed', seed: 42, params: defaultParams('cueva-inicial'), ...over })
function sim(over: Partial<SimSetup> = {}): SimState {
  const created = createSim(setup(over))
  if (!created.ok) throw new Error(JSON.stringify(created.issues))
  return created.sim
}

describe('reproducible scenario', () => {
  it('initial population → retirement → respawn → empty area → return', () => {
    // t = 0: the area wakes up staggered, nothing yet.
    let s = sim()
    expect(viewOf(s).status).toBe('active')
    expect(viewOf(s).alive).toBe(0)
    // +15 s: every nest has had its first spawn.
    s = advance(s, 15_000)
    const initial = aliveEncounters(s)
    expect(initial.length).toBeGreaterThan(0)
    expect(viewOf(s).alive).toBeLessThanOrEqual(viewOf(s).areaMax)
    // Retire a whole group: its nest schedules a respawn 75 s ± 20 % later.
    const nestId = initial[0].nestId
    for (const e of initial.filter(x => x.nestId === nestId)) s = retire(s, e.id, 'defeated')
    const nest = viewOf(s).nests.find(n => n.id === nestId)!
    expect(nest.alive).toBe(0)
    expect(nest.dueIn).toBeGreaterThanOrEqual(60_000)
    expect(nest.dueIn).toBeLessThanOrEqual(90_000)
    // Before the due time nothing comes back; after it, the nest is repopulated with a new generation.
    s = advance(s, nest.dueIn! - 1)
    expect(viewOf(s).nests.find(n => n.id === nestId)!.alive).toBe(0)
    s = advance(s, 1)
    const back = viewOf(s).nests.find(n => n.id === nestId)!
    expect(back.generation).toBe(2)
    // Everyone leaves: idle (kept, not simulated), then dormant after 5 min (cleared).
    s = advance(setPlayers(s, 0), 1_000)
    expect([viewOf(s).status, viewOf(s).simulated]).toEqual(['idle', false])
    s = advance(s, 300_000)
    expect(viewOf(s).status).toBe('dormant')
    expect(aliveEncounters(s)).toEqual([])
    // A player returns: the area refills, staggered, with fresh identities.
    s = advance(setPlayers(s, 1), 1_000)
    expect(aliveEncounters(s)).toEqual([])
    s = advance(s, 15_000)
    const refilled = aliveEncounters(s)
    expect(refilled.length).toBeGreaterThan(0)
    expect(refilled.some(e => initial.some(i => i.id === e.id))).toBe(false)
  })

  it('reset replays the same run, and the same actions give the same states', () => {
    const script = (start: SimState) => {
      let s = advance(start, 15_000)
      const [first] = aliveEncounters(s)
      s = retire(s, first.id, 'fled')
      return advance(s, 90_000)
    }
    const a = sim()
    const b = resetSim(advance(a, 500_000))
    expect(b).toEqual(a)
    expect(script(b)).toEqual(script(a))
    const species = (seed: number) => aliveEncounters(advance(sim({ seed }), 15_000)).map(e => `${e.nestId}#${e.speciesId}@${e.tile.tx},${e.tile.ty}`)
    expect(species(7)).toEqual(species(7))
    expect(species(7)).not.toEqual(species(8))
  })
})

describe('controls', () => {
  it('repeat evaluation changes nothing in the population and does not move the clock', () => {
    const s = advance(sim(), 15_000)
    const r = repeatEvaluation(s)
    expect(r.population).toEqual(s.population)
    expect(r.now).toBe(s.now)
    expect(r.evaluations).toBe(s.evaluations + 1)
    expect(last(r)).toMatch(/repetir evaluación: sin cambios/)
  })

  it('retire is simulated and idempotent: a second retire of the same id has no effect', () => {
    let s = advance(sim(), 15_000)
    const [first] = aliveEncounters(s)
    s = retire(s, first.id, 'captured')
    const again = retire(s, first.id, 'captured')
    expect(again.population).toEqual(s.population)
    expect(last(again)).toMatch(/not-alive \(sin efecto\)/)
    expect(last(s)).toMatch(/retirado \(captured, simulado\)/)
  })

  it('presence and forced inactivity take effect at the next evaluation', () => {
    let s = advance(sim(), 15_000)
    s = setForcedInactive(s, true)
    expect(viewOf(s).status).toBe('active')
    s = repeatEvaluation(s)
    expect(viewOf(s).status).toBe('idle')
    s = repeatEvaluation(setForcedInactive(setPlayers(s, 3), false))
    expect(viewOf(s).status).toBe('active')
    expect(setPlayers(s, -2).players).toBe(0)
  })

  it('refuses a non-positive clock step and reports an invalid configuration', () => {
    expect(() => advance(sim(), 0)).toThrow(RangeError)
    const bad = createSim(setup({ params: { ...defaultParams('cueva-inicial'), retryMs: 0 } }))
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.issues.map(i => i.code)).toContain('invalid-respawn')
  })

  it('the view respects the grid and the limits, and draws nothing on blocked tiles', () => {
    for (const zoneId of ['pradera.abierta', 'pradera.bosque', 'cueva-inicial'] as PreviewZoneId[]) {
      let s = sim({ zoneId, params: defaultParams(zoneId) })
      for (let i = 0; i < 40; i++) s = advance(s, 15_000)
      const v = viewOf(s)
      expect(v.cells).toHaveLength(18 * 12)
      expect(v.cells.filter(c => c.encounter && (c.blocked || !c.nestId))).toEqual([])
      expect(v.alive).toBeLessThanOrEqual(v.areaMax)
      for (const n of v.nests) expect(n.alive).toBeLessThanOrEqual(n.max)
    }
  })
})

describe('comparison', () => {
  it('is deterministic and shows what a configuration change does, without touching the catalog', () => {
    const a = setup()
    const b = setup({ layout: 'by-habitat' })
    expect(compareSetups(a, b)).toEqual(compareSetups(a, b))
    const { a: ma, b: mb } = compareSetups(a, b)
    expect(ma.encountersBorn).toBeGreaterThan(0)
    expect(ma.dormancies).toBe(1) // the default session leaves the area for 7 minutes
    // One nest per habitat: nests without a common entry fail with empty-tier instead of borrowing one.
    expect(mb.failures['empty-tier'] ?? 0).toBeGreaterThan(ma.failures['empty-tier'] ?? 0)
  })

  it('per-member keeps the cave fuller than per-group', () => {
    const perGroup = runSession(setup())
    const perMember = runSession(setup({ params: { ...defaultParams('cueva-inicial'), policy: 'per-member' } }))
    expect(perMember.meanAlive).toBeGreaterThan(perGroup.meanAlive)
  })
})

describe('real map (ECO-MAP-1 proposal)', () => {
  const real = (zoneId: PreviewZoneId) => sim({ zoneId, layout: 'real-map', params: defaultParams(zoneId) })

  it('builds each area from the real snapshot and the proposed nests', () => {
    const counts = (['pradera.abierta', 'pradera.bosque', 'cueva-inicial'] as PreviewZoneId[]).map(z => real(z).scenario.config.areas[0].nests.length)
    expect(counts).toEqual([5, 2, 3])
    for (const zoneId of ['pradera.abierta', 'pradera.bosque', 'cueva-inicial'] as PreviewZoneId[]) {
      const s = real(zoneId)
      const b = s.scenario.bounds
      expect(s.scenario.kinds).toHaveLength(b.maxTy - b.minTy + 1)
      for (const row of s.scenario.kinds!) expect(row).toHaveLength(b.maxTx - b.minTx + 1)
      expect(s.scenario.notes[0]).toMatch(/PROPUESTA DE DESARROLLO · mapa real .* \(layout 1\.[0-9a-f]{12}\)/)
      expect(s.log[0]).toMatch(/PROPUESTA, mapa real/)
    }
    expect(real('pradera.bosque').scenario.notes.join('\n')).toMatch(/300 casillas transitables en el bosque; sólo 13 quedan libres/)
  })

  it('places encounters with the real engine only on proposed candidate tiles, never on blocked, water, portal or work tiles', () => {
    for (const zoneId of ['pradera.abierta', 'pradera.bosque', 'cueva-inicial'] as PreviewZoneId[]) {
      let s = real(zoneId)
      for (let i = 0; i < 30; i++) s = advance(s, 20_000)
      const v = viewOf(s)
      const withEncounter = v.cells.filter(c => c.encounter)
      expect(withEncounter.length, zoneId).toBeGreaterThan(0)
      for (const c of withEncounter) {
        expect(c.nestId, `${zoneId} ${c.tx},${c.ty}`).not.toBeNull()
        expect('#~pPRwu='.includes(c.kind), `${zoneId} ${c.tx},${c.ty} kind ${c.kind}`).toBe(false)
      }
      expect(v.alive).toBeLessThanOrEqual(v.areaMax)
    }
  })

  it('leaves the synthetic grid as it was', () => {
    const s = sim()
    expect(s.scenario.bounds).toEqual({ minTx: 0, minTy: 0, maxTx: 17, maxTy: 11 })
    expect(s.scenario.kinds).toBeNull()
    expect(s.setup.layout).toBe('mixed')
    expect(defaultParams('cueva-inicial')).toEqual({ policy: 'per-group', delayMs: 75_000, jitter: 0.2, retryMs: 15_000, dormantAfterMs: 300_000, staggerMinMs: 5_000, staggerMaxMs: 15_000, areaMaxAlive: 6, nestMaxAlive: 3, groupCap: 3 })
  })
})
