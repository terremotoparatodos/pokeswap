// ECO-BALANCE-1 — controlled comparison of nest pool / rarity configurations.
//
// Runs the REAL engine (`population/engine.ts`) over the REAL ECO-1 catalog.
// Configurations are external test data built here; nothing in the product
// catalog or engine changes. Variant B needs per-nest rarity shares, which the
// engine only reads per catalog zone, so B derives one extra *experimental*
// zone per nest pool with its shares DECLARED (see `declaredShares`) — the
// engine keeps refusing undeclared or invalid distributions.
//
// Held equal across variants: nest count (6), nest positions and tiles, area
// and nest limits, group cap, respawn policy/delay/jitter/retry, idle policy,
// duration, presence script and the demand (retirement opportunity) process.
// Only the nest POOL (which habitats) and/or the nest SHARES change.

import { ECO_1_ENCOUNTER_CATALOG } from '../encounters/initialCatalog'
import { ENCOUNTER_RARITIES, type EncounterCatalog, type EncounterEntry, type EncounterHabitat, type EncounterRarity, type EncounterZone } from '../encounters/types'
import { PROVISIONAL_IDLE, PROVISIONAL_RESPAWN } from '../population/config'
import { createPopulation, retireEncounter, tickPopulation } from '../population/engine'
import type { AreaGeometry, NestConfig, PopulationConfig, PopulationState, RandomSource, Tile } from '../population/types'
import { blockedTiles, GRID, type PreviewZoneId } from './scenarios'

export type Variant = 'A' | 'B' | 'C1' | 'C1b' | 'C2'

export const VARIANTS: Readonly<Record<Variant, string>> = {
  A: 'one habitat per nest; zone shares (empty-tier baseline)',
  B: 'same pools as A; per-nest shares declared over the tiers that have candidates',
  C1: 'compatible habitat groups per nest; zone shares',
  C1b: 'as C1, but every group holds a non-colony common (only the cave differs from C1)',
  C2: 'every zone habitat in every nest; zone shares',
}

const NESTS = 6
const AREA_MAX: Record<PreviewZoneId, number> = { 'pradera.abierta': 12, 'pradera.bosque': 8, 'cueva-inicial': 6 }

/** C1: groups of micro-habitats that plausibly share one patch of ground. Authored for this study. */
export const C1_GROUPS: Readonly<Record<PreviewZoneId, readonly (readonly EncounterHabitat[])[]>> = {
  'pradera.abierta': [['open-grass', 'tall-grass'], ['open-grass', 'grass-near-water']],
  'pradera.bosque': [['undergrowth', 'branches', 'foliage'], ['damp-clearing', 'clearing', 'conifers']],
  'cueva-inicial': [['cave-nook', 'cave-damp-corner'], ['cave-ceiling', 'cave-floor'], ['cave-rocky-floor', 'cave-dry-floor']],
}

/**
 * C1b: in the cave, C1's ceiling+floor nest has Zubat (group 2–3) as its only
 * common, so when the room left is 1 its common tier is empty. C1b pairs the
 * ceiling with rocky floor (Geodude 1–2). Other zones: identical to C1.
 */
export const C1B_GROUPS: Readonly<Record<PreviewZoneId, readonly (readonly EncounterHabitat[])[]>> = {
  ...C1_GROUPS,
  'cueva-inicial': [['cave-nook', 'cave-damp-corner'], ['cave-ceiling', 'cave-rocky-floor'], ['cave-floor', 'cave-dry-floor', 'cave-rocky-floor']],
}

export const zoneOf = (zoneId: PreviewZoneId): EncounterZone => ECO_1_ENCOUNTER_CATALOG.zones.find(z => z.id === zoneId)!
export const habitatsOf = (zoneId: PreviewZoneId): EncounterHabitat[] =>
  [...new Set(ECO_1_ENCOUNTER_CATALOG.entries.filter(e => e.zoneId === zoneId).map(e => e.habitat))]

/** Pool (habitat list) of each of the 6 nests, per variant. */
export function nestPools(zoneId: PreviewZoneId, variant: Variant): EncounterHabitat[][] {
  const habitats = habitatsOf(zoneId)
  const groups = variant === 'C1' ? C1_GROUPS[zoneId].map(g => [...g])
    : variant === 'C1b' ? C1B_GROUPS[zoneId].map(g => [...g])
      : variant === 'C2' ? [habitats] : habitats.map(h => [h])
  return Array.from({ length: NESTS }, (_, i) => groups[i % groups.length])
}

const poolEntries = (zoneId: PreviewZoneId, pool: readonly EncounterHabitat[]): EncounterEntry[] =>
  ECO_1_ENCOUNTER_CATALOG.entries.filter(e => e.zoneId === zoneId && pool.includes(e.habitat))

/**
 * B's declared shares: the zone's shares restricted to tiers that have a
 * candidate in the pool, rescaled to 100 and rounded to 2 decimals (the last
 * non-empty tier absorbs the rounding). Explicit data, not engine behaviour.
 */
export function declaredShares(zoneId: PreviewZoneId, pool: readonly EncounterHabitat[]): Record<EncounterRarity, number> {
  const zone = zoneOf(zoneId)
  const present = ENCOUNTER_RARITIES.filter(r => poolEntries(zoneId, pool).some(e => e.rarity === r))
  const total = present.reduce((s, r) => s + zone.rarityShares[r], 0)
  const out: Record<EncounterRarity, number> = { common: 0, uncommon: 0, rare: 0, very_rare: 0 }
  let used = 0
  present.forEach((r, i) => {
    out[r] = i === present.length - 1 ? Math.round((100 - used) * 100) / 100 : Math.round((zone.rarityShares[r] / total) * 10_000) / 100
    used += out[r]
  })
  return out
}

const derivedZoneId = (zoneId: PreviewZoneId, pool: readonly EncounterHabitat[]) => `${zoneId}~B~${pool.join('+')}`

/** The product catalog plus, for B, one experimental zone per distinct nest pool. Product data untouched. */
export function experimentCatalog(): EncounterCatalog {
  const zones: EncounterZone[] = []
  const entries: EncounterEntry[] = []
  for (const zoneId of ['pradera.abierta', 'pradera.bosque', 'cueva-inicial'] as PreviewZoneId[]) {
    const seen = new Set<string>()
    for (const pool of nestPools(zoneId, 'B')) {
      const id = derivedZoneId(zoneId, pool)
      if (seen.has(id)) continue
      seen.add(id)
      zones.push({ ...zoneOf(zoneId), id: id as EncounterZone['id'], rarityShares: declaredShares(zoneId, pool) })
      for (const e of poolEntries(zoneId, pool)) entries.push({ ...e, zoneId: id as EncounterZone['id'], id: `${id}:${e.speciesName}` })
    }
  }
  return { ...ECO_1_ENCOUNTER_CATALOG, zones: [...ECO_1_ENCOUNTER_CATALOG.zones, ...zones], entries: [...ECO_1_ENCOUNTER_CATALOG.entries, ...entries] }
}

/** Patch i of a 3 × 2 layout of 4 × 4 patches — identical for every variant. */
function patch(i: number): Tile[] {
  const x0 = 1 + (i % 3) * 6
  const y0 = 1 + Math.floor(i / 3) * 6
  const out: Tile[] = []
  for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) out.push({ tx: x0 + dx, ty: y0 + dy })
  return out
}

export function experimentConfig(zoneId: PreviewZoneId, variant: Variant, seed: number): PopulationConfig {
  const nests: NestConfig[] = nestPools(zoneId, variant).map((pool, i) => ({
    id: `n${i + 1}`,
    zoneId: (variant === 'B' ? derivedZoneId(zoneId, pool) : zoneId) as NestConfig['zoneId'],
    habitats: pool, tiles: patch(i), maxAlive: 3, groupCap: 3,
    respawn: { ...PROVISIONAL_RESPAWN },
  }))
  return { namespace: `bal-${seed}`, areas: [{ areaId: zoneOf(zoneId).areaId, maxAlive: AREA_MAX[zoneId], idle: { ...PROVISIONAL_IDLE }, nests }] }
}

export const GEOMETRY: AreaGeometry = (() => {
  const blocked = new Set(blockedTiles().map(t => `${t.tx},${t.ty}`))
  return { isOpenTile: (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < GRID.width && ty < GRID.height && !blocked.has(`${tx},${ty}`) }
})()

// ── Scenarios (HYPOTHESES, not measured combat rates) ─────────────────────

export interface Scenario {
  readonly id: 'empty-return' | 'low' | 'medium' | 'high'
  readonly players: number
  /** Retirement opportunities per player per minute while present. */
  readonly perPlayerPerMinute: number
  /** Minutes [from, to) with nobody in the area. */
  readonly absent: readonly [number, number] | null
}

export const SCENARIOS: readonly Scenario[] = [
  { id: 'empty-return', players: 1, perPlayerPerMinute: 1, absent: [10, 25] },
  { id: 'low', players: 2, perPlayerPerMinute: 1, absent: null },
  { id: 'medium', players: 5, perPlayerPerMinute: 1.5, absent: null },
  { id: 'high', players: 15, perPlayerPerMinute: 2, absent: null },
]

/** mulberry32 over an explicit seed. */
function mulberry(seed: number): RandomSource {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface RunMetrics {
  readonly encounters: number
  readonly groups: number
  readonly failures: Readonly<Record<string, number>>
  readonly attempts: number
  readonly meanAlive: number
  /** Fraction of active-area samples with no encounter alive. */
  readonly emptyFraction: number
  readonly opportunitiesPlanned: number
  readonly retiredDone: number
  readonly retiredPerPlayer: number
  readonly bySpecies: Readonly<Record<string, number>>
  readonly byRarity: Readonly<Record<EncounterRarity, number>>
  /** Spawn groups (appearances) per rarity: the unit the tier shares apply to. */
  readonly groupsByRarity: Readonly<Record<EncounterRarity, number>>
  /** Encounters born per nest id. */
  readonly byNest: Readonly<Record<string, number>>
}

export const STEP_MS = 5_000

/**
 * Two independent random streams per seed:
 *   - engine stream  (seed): ticks and respawn jitter — its consumption differs
 *     between variants (an empty-tier attempt draws 2 numbers, a spawn more);
 *   - demand stream (seed ^ K): how many opportunities each step brings and which
 *     living encounter each one takes — identical in count across variants, so
 *     every variant faces the same planned demand.
 * Same (zone, variant, scenario, minutes, seed) → identical metrics.
 */
export function runOnce(zoneId: PreviewZoneId, variant: Variant, scenario: Scenario, minutes: number, seed: number, catalog = experimentCatalog()): RunMetrics {
  const config = experimentConfig(zoneId, variant, seed)
  const deps = { catalog }
  const created = createPopulation(config, deps)
  if (!created.ok) throw new Error(`config ${zoneId}/${variant}: ${created.issues.map(i => i.code).join(', ')}`)
  let state: PopulationState = created.state
  const engine = mulberry(seed)
  const demand = mulberry(seed ^ 0x5bd1e995)
  const areaId = config.areas[0].areaId
  const failures: Record<string, number> = {}
  const bySpecies: Record<string, number> = {}
  const byRarity: Record<EncounterRarity, number> = { common: 0, uncommon: 0, rare: 0, very_rare: 0 }
  const groupsByRarity: Record<EncounterRarity, number> = { common: 0, uncommon: 0, rare: 0, very_rare: 0 }
  const byNest: Record<string, number> = Object.fromEntries(config.areas[0].nests.map(n => [n.id, 0]))
  const names = new Map(catalog.entries.map(e => [e.id, e.speciesName]))
  let encounters = 0, groups = 0, attempts = 0, aliveSum = 0, activeSamples = 0, emptySamples = 0, planned = 0, done = 0
  let carry = 0
  const steps = Math.round((minutes * 60_000) / STEP_MS)
  for (let i = 1; i <= steps; i++) {
    const now = i * STEP_MS
    const minute = now / 60_000
    const away = scenario.absent !== null && minute > scenario.absent[0] && minute <= scenario.absent[1]
    const r = tickPopulation(state, config, deps, { now, activeAreas: new Set(away ? [] : [areaId]), geometry: () => GEOMETRY, random: engine })
    if (!r.ok) throw new Error(r.reason)
    state = r.state
    for (const event of r.events) {
      if (event.type === 'spawned') {
        attempts++
        groups++
        groupsByRarity[event.encounters[0].rarity]++
        for (const e of event.encounters) {
          encounters++
          byRarity[e.rarity]++
          byNest[e.nestId]++
          const name = names.get(e.entryId) ?? String(e.speciesId)
          bySpecies[name] = (bySpecies[name] ?? 0) + 1
        }
      } else if (event.type === 'spawn-failed') {
        attempts++
        failures[event.reason] = (failures[event.reason] ?? 0) + 1
      }
    }
    if (!away) {
      carry += (scenario.players * scenario.perPlayerPerMinute * STEP_MS) / 60_000
      const opportunities = Math.floor(carry)
      carry -= opportunities
      for (let k = 0; k < opportunities; k++) {
        planned++
        const pick = demand()
        const alive = Object.values(state.nests).flatMap(n => n.alive)
        if (alive.length === 0) continue
        const target = alive[Math.min(alive.length - 1, Math.floor(pick * alive.length))]
        const out = retireEncounter(state, config, { encounterId: target.id, cause: 'defeated', now, random: engine })
        if (out.ok) { state = out.state; done++ }
      }
      const alive = Object.values(state.nests).reduce((s, n) => s + n.alive.length, 0)
      aliveSum += alive
      activeSamples++
      if (alive === 0) emptySamples++
    }
  }
  return {
    encounters, groups, failures, attempts, meanAlive: activeSamples ? aliveSum / activeSamples : 0,
    emptyFraction: activeSamples ? emptySamples / activeSamples : 0, opportunitiesPlanned: planned, retiredDone: done,
    retiredPerPlayer: done / scenario.players, bySpecies, byRarity, groupsByRarity, byNest,
  }
}

// ── Analytic area mix (per spawn attempt, before limits and timing) ───────

/**
 * Expected tier of a SUCCESSFUL attempt, averaged over the 6 nests with equal
 * attempt counts, and the probability that an attempt fails with empty-tier.
 * Real attempt counts differ per nest (failures retry every 15 s; successes
 * wait for retirement), which is why the simulation is still needed.
 */
export function analyticMix(zoneId: PreviewZoneId, variant: Variant): { emptyTier: number; mix: Record<EncounterRarity, number> } {
  const mix: Record<EncounterRarity, number> = { common: 0, uncommon: 0, rare: 0, very_rare: 0 }
  let empty = 0
  for (const pool of nestPools(zoneId, variant)) {
    const shares = variant === 'B' ? declaredShares(zoneId, pool) : zoneOf(zoneId).rarityShares
    for (const r of ENCOUNTER_RARITIES) {
      const p = shares[r] / 100 / NESTS
      if (poolEntries(zoneId, pool).some(e => e.rarity === r)) mix[r] += p
      else empty += p
    }
  }
  const ok = 1 - empty
  for (const r of ENCOUNTER_RARITIES) mix[r] = ok > 0 ? mix[r] / ok : 0
  return { emptyTier: empty, mix }
}
