// R31 economy simulator CLI.
//
//   npm run sim:economy -- --scenario base --players 100 --days 7
//   npm run sim:economy -- --scenario mining-only --level 20 --tool 2 --json
//
// Flags: --scenario <name> --players <n> --days <n> --seed <n> --level <n>
//        --tool <0-3> --profession <id> --no-repair --no-pokemon --json

import { runEconomySimulation } from '../src/features/professions/simulation/economySim'
import { formatReport } from '../src/features/professions/simulation/report'
import { SCENARIOS, type SimulationConfig } from '../src/features/professions/simulation/scenarios'
import { PROFESSION_IDS, type ProfessionId, type Tier } from '../src/features/professions/domain/types'

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const option = (name: string) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}
const integer = (name: string, fallback: number) => {
  const raw = option(name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} must be a non-negative integer`)
  return value
}

const scenarioName = option('scenario') ?? 'base'
const base = SCENARIOS[scenarioName]
if (!base) throw new Error(`Unknown scenario "${scenarioName}". Available: ${Object.keys(SCENARIOS).join(', ')}`)

const profession = option('profession') as ProfessionId | undefined
if (profession && !PROFESSION_IDS.includes(profession)) throw new Error(`Unknown profession "${profession}"`)
const tool = integer('tool', base.startingToolTier)
if (tool > 3) throw new Error('--tool must be 0-3')

const config: SimulationConfig = {
  ...base,
  players: integer('players', base.players),
  days: integer('days', base.days),
  seed: integer('seed', base.seed),
  startingLevel: Math.max(1, integer('level', base.startingLevel)),
  startingToolTier: tool as 0 | Tier,
  repairTools: flag('no-repair') ? false : base.repairTools,
  pokemonBonuses: flag('no-pokemon') ? {} : base.pokemonBonuses,
  professionShare: profession
    ? Object.fromEntries(PROFESSION_IDS.map(id => [id, id === profession ? 1 : 0])) as Record<ProfessionId, number>
    : base.professionShare,
}

const report = runEconomySimulation(config)
console.log(flag('json') ? JSON.stringify(report, null, 2) : formatReport(report))
