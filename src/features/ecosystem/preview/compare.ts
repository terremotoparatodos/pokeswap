// Headless comparison of two simulator setups (ECO-PREVIEW-1). Runs the real
// engine through the same scripted session — same seed, same presence
// pattern, same retirement rate — and reports what each configuration produced.
// The published catalog is never changed: only SimParams/layout differ.

import { advance, aliveEncounters, createSim, retire, setPlayers, type SimSetup, type SimState } from './simulator'

export interface SessionScript {
  readonly minutes: number
  readonly stepMs: number
  /** Chance that each living encounter is (simulatedly) retired at each step. */
  readonly retireChance: number
  /** Minutes [from, to) during which nobody is in the area. */
  readonly absent?: readonly [number, number]
}

export interface SimMetrics {
  readonly evaluations: number
  readonly encountersBorn: number
  readonly retired: number
  readonly failures: Readonly<Record<string, number>>
  readonly meanAlive: number
  readonly maxAlive: number
  readonly bySpecies: Readonly<Record<number, number>>
  readonly dormancies: number
}

export const DEFAULT_SESSION: SessionScript = { minutes: 30, stepMs: 5_000, retireChance: 0.08, absent: [12, 19] }

/** Deterministic helper RNG for the retirement decisions (separate from the engine's). */
function decisions(seed: number): () => number {
  let s = (seed ^ 0x9e3779b9) >>> 0
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}

export function runSession(setup: SimSetup, script: SessionScript = DEFAULT_SESSION): SimMetrics {
  const created = createSim(setup)
  if (!created.ok) throw new Error(`invalid setup: ${created.issues.map(i => i.code).join(', ')}`)
  let sim: SimState = created.sim
  const decide = decisions(setup.seed)
  let aliveSum = 0
  let maxAlive = 0
  let retired = 0
  let born = 0
  let dormancies = 0
  const failures: Record<string, number> = {}
  const bySpecies: Record<number, number> = {}
  const count = (state: SimState) => {
    for (const event of state.lastEvents) {
      if (event.type === 'spawned') for (const e of event.encounters) { born++; bySpecies[e.speciesId] = (bySpecies[e.speciesId] ?? 0) + 1 }
      else if (event.type === 'spawn-failed') failures[event.reason] = (failures[event.reason] ?? 0) + 1
      else if (event.to === 'dormant') dormancies++
    }
  }
  count(sim)
  const steps = Math.floor((script.minutes * 60_000) / script.stepMs)
  for (let i = 0; i < steps; i++) {
    const minute = (sim.now + script.stepMs) / 60_000
    const away = script.absent !== undefined && minute >= script.absent[0] && minute < script.absent[1]
    sim = advance(setPlayers(sim, away ? 0 : 1), script.stepMs)
    count(sim)
    for (const encounter of aliveEncounters(sim)) {
      if (!away && decide() < script.retireChance) {
        sim = retire(sim, encounter.id, 'defeated')
        retired++
      }
    }
    const alive = aliveEncounters(sim).length
    aliveSum += alive
    maxAlive = Math.max(maxAlive, alive)
  }
  return { evaluations: sim.evaluations, encountersBorn: born, retired, failures, meanAlive: steps ? aliveSum / steps : 0, maxAlive, bySpecies, dormancies }
}

export function compareSetups(a: SimSetup, b: SimSetup, script: SessionScript = DEFAULT_SESSION): { readonly a: SimMetrics; readonly b: SimMetrics } {
  return { a: runSession(a, script), b: runSession(b, script) }
}
