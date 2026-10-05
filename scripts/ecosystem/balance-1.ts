// ECO-BALANCE-1 runner. Reproducible, summaries only (no per-tick logs).
//
//   node node_modules/vite-node/vite-node.mjs scripts/ecosystem/balance-1.ts -- [outDir]
//
// Writes <outDir>/summary.json and <outDir>/summary.md (default:
// docs/design/eco-balance-1). Same code + same seeds → byte-identical files.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { analyticMix, declaredShares, experimentCatalog, nestPools, runOnce, SCENARIOS, VARIANTS, type RunMetrics, type Variant } from '../../src/features/ecosystem/preview/balance'
import type { PreviewZoneId } from '../../src/features/ecosystem/preview/scenarios'

const ZONES: PreviewZoneId[] = ['pradera.abierta', 'pradera.bosque', 'cueva-inicial']
const VARIANT_IDS = Object.keys(VARIANTS) as Variant[]
const SEEDS = Array.from({ length: 20 }, (_, i) => 1001 + i)
const DURATIONS = [30, 120]
const RARITIES = ['common', 'uncommon', 'rare', 'very_rare'] as const

const r2 = (x: number) => Math.round(x * 100) / 100
const r3 = (x: number) => Math.round(x * 1000) / 1000
function stats(values: number[]) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length)
  return { mean: r2(mean), sd: r2(sd), min: r2(Math.min(...values)), max: r2(Math.max(...values)) }
}

type Stat = { mean: number; sd: number; min: number; max: number }
interface ResultRow {
  zone: string; variant: string; scenario: string; minutes: number; players: number; seeds: number
  encounters: Stat; attempts: Stat; failures: Record<string, Stat>; meanAlive: Stat; emptyFraction: Stat
  opportunitiesPlanned: Stat; retiredDone: Stat; retiredPerPlayer: Stat
  rarityShare: Record<string, Stat>; groupRarityShare: Record<string, Stat>
  speciesShare: Record<string, number>; nestShare: Record<string, Stat>; deadNests: string[]
}

const outDir = process.argv.slice(2).find(a => a !== '--') ?? 'docs/design/eco-balance-1'
const catalog = experimentCatalog()
const results: ResultRow[] = []

for (const zone of ZONES) for (const variant of VARIANT_IDS) for (const scenario of SCENARIOS) for (const minutes of DURATIONS) {
  const runs: RunMetrics[] = SEEDS.map(seed => runOnce(zone, variant, scenario, minutes, seed, catalog))
  const pick = (f: (m: RunMetrics) => number) => stats(runs.map(f))
  const total = (m: RunMetrics) => Math.max(1, m.encounters)
  const failureKinds = [...new Set(runs.flatMap(m => Object.keys(m.failures)))].sort()
  const species = [...new Set(runs.flatMap(m => Object.keys(m.bySpecies)))].sort()
  const nests = Object.keys(runs[0].byNest)
  results.push({
    zone, variant, scenario: scenario.id, minutes, players: scenario.players, seeds: SEEDS.length,
    encounters: pick(m => m.encounters),
    attempts: pick(m => m.attempts),
    failures: Object.fromEntries(failureKinds.map(k => [k, pick(m => m.failures[k] ?? 0)])),
    meanAlive: pick(m => m.meanAlive),
    emptyFraction: pick(m => m.emptyFraction),
    opportunitiesPlanned: pick(m => m.opportunitiesPlanned),
    retiredDone: pick(m => m.retiredDone),
    retiredPerPlayer: pick(m => m.retiredPerPlayer),
    rarityShare: Object.fromEntries(RARITIES.map(r => [r, pick(m => (100 * m.byRarity[r]) / total(m))])),
    groupRarityShare: Object.fromEntries(RARITIES.map(r => [r, pick(m => (100 * m.groupsByRarity[r]) / Math.max(1, m.groups))])),
    speciesShare: Object.fromEntries(species.map(s => [s, r2(runs.reduce((a, m) => a + (100 * (m.bySpecies[s] ?? 0)) / total(m), 0) / runs.length)])),
    nestShare: Object.fromEntries(nests.map(n => [n, pick(m => (100 * m.byNest[n]) / total(m))])),
    /** Nests that produced nothing in at least 80 % of the seeds. */
    deadNests: nests.filter(n => runs.filter(m => m.byNest[n] === 0).length >= 0.8 * runs.length),
  })
}

const design = ZONES.flatMap(zone => VARIANT_IDS.map(variant => ({
  zone, variant,
  pools: nestPools(zone, variant).map(p => p.join('+')),
  shares: variant === 'B' ? nestPools(zone, variant).map(p => declaredShares(zone, p)) : 'zone shares 70/24/5.5/0.5',
  analytic: (() => { const a = analyticMix(zone, variant); return { emptyTier: r3(a.emptyTier), mix: Object.fromEntries(RARITIES.map(r => [r, r3(a.mix[r])])) } })(),
})))

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ seeds: SEEDS, durations: DURATIONS, scenarios: SCENARIOS, design, results }) + '\n')

// Compact markdown tables (mean ± sd over 20 seeds).
const lines: string[] = ['# ECO-BALANCE-1 — resultados resumidos', '', 'Media ± desvío sobre 20 semillas (1001–1020). Generado por `scripts/ecosystem/balance-1.ts`.', '']
const pm = (s: { mean: number; sd: number }) => `${s.mean} ± ${s.sd}`
for (const minutes of DURATIONS) {
  lines.push(`## ${minutes} min`, '', '| Zona | Var. | Escenario | Encuentros | empty-tier | otros fallos | Vivos medios | % tiempo vacío | Retiradas (plan → hechas) | Por jugador | % individuos c/u/r/mr | % apariciones c/u/r/mr | Nidos muertos |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const r of results.filter(x => x.minutes === minutes)) {
    const fails = r.failures
    const other = Object.entries(fails).filter(([k]) => k !== 'empty-tier').map(([k, v]) => `${k} ${v.mean}`).join(', ') || '—'
    const rs = RARITIES.map(k => r.rarityShare[k].mean).join(' / ')
    const gs = RARITIES.map(k => r.groupRarityShare[k].mean).join(' / ')
    lines.push(`| ${r.zone} | ${r.variant} | ${r.scenario} | ${pm(r.encounters)} | ${fails['empty-tier']?.mean ?? 0} | ${other} | ${pm(r.meanAlive)} | ${r2(100 * r.emptyFraction.mean)} | ${r.opportunitiesPlanned.mean} → ${r.retiredDone.mean} | ${r.retiredPerPlayer.mean} | ${rs} | ${gs} | ${r.deadNests.join(', ') || '—'} |`)
  }
  lines.push('')
}
writeFileSync(join(outDir, 'summary.md'), lines.join('\n') + '\n')
console.log(`wrote ${results.length} result rows for ${ZONES.length} zones × ${VARIANT_IDS.length} variants × ${SCENARIOS.length} scenarios × ${DURATIONS.length} durations × ${SEEDS.length} seeds`)
