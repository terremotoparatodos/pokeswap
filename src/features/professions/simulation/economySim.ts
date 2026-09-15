// Economy stock-flow simulator — an iteration tool, not a balance authority.
//
// Every gathering action goes through the real domain resolver, so the
// simulator stays honest when formulas or catalog numbers change.

import { GATHERING_NODES } from '../domain/catalog/nodes'
import { ENERGY_CONFIG, PROFESSIONS } from '../domain/catalog/professions'
import { STRUCTURES, TOOLS } from '../domain/catalog/tools'
import { createToolInstance, repairTool, toolCondition, wearTool } from '../domain/durability'
import { maxEnergy } from '../domain/energy'
import { resolveGathering } from '../domain/gathering'
import { levelForXp, totalXpForLevel } from '../domain/progression'
import { createSeededRandom } from '../domain/rng'
import { PROFESSION_IDS, type EquippedTool, type GatheringNodeDefinition, type ItemId, type ProfessionId } from '../domain/types'
import { EconomyLedger, type ItemFlow } from './economyLedger'
import type { PlayerArchetype, SimulationConfig } from './scenarios'

/** Among unlocked nodes (highest level first) players split effort 50/30/20. */
const NODE_PREFERENCE = [0.5, 0.3, 0.2]
const MAX_ACTIONS_PER_SESSION = 5_000

interface SimPlayer {
  readonly profession: ProfessionId
  readonly archetype: PlayerArchetype
  xp: number
  energy: number
  tool: EquippedTool | null
  serial: number
}

export interface SimulationReport {
  readonly config: SimulationConfig
  readonly items: Record<ItemId, ItemFlow & { endStock: number }>
  readonly dailyStock: readonly Record<ItemId, number>[]
  readonly energy: { readonly available: number; readonly spent: number }
  readonly actions: number
  readonly gatheringHours: number
  readonly bareHandActions: number
  readonly durability: { readonly lost: number; readonly repairs: number; readonly toolsEquipped: number; readonly toolsRetired: number; readonly repairsUnaffordable: number }
  readonly levels: Record<ProfessionId, { readonly players: number; readonly average: number; readonly min: number; readonly max: number }>
  readonly totals: { readonly gathered: number; readonly transformed: number; readonly destroyed: number; readonly endStock: number; readonly shortage: number }
}

function assign<T extends { share: number }>(entries: readonly T[], index: number, count: number): T {
  const position = (index + 0.5) / count
  let cumulative = 0
  for (const entry of entries) {
    cumulative += entry.share
    if (position < cumulative) return entry
  }
  return entries[entries.length - 1]
}

export function runEconomySimulation(config: SimulationConfig): SimulationReport {
  const random = createSeededRandom(config.seed)
  const ledger = new EconomyLedger()
  const professionEntries = PROFESSION_IDS.map(id => ({ id, share: config.professionShare[id] }))
  const counters = { energyAvailable: 0, energySpent: 0, actions: 0, seconds: 0, bare: 0, lost: 0, repairs: 0, equipped: 0, retired: 0, unaffordable: 0 }
  const carry = new Map<string, number>()
  const dailyStock: Record<ItemId, number>[] = []

  const toolFor = (profession: ProfessionId, tier: number) => TOOLS.find(tool => tool.kind === PROFESSIONS[profession].toolKind && tool.tier === tier)

  const players: SimPlayer[] = Array.from({ length: config.players }, (_, index) => {
    const profession = assign(professionEntries, index, config.players).id
    const starter = config.startingToolTier ? toolFor(profession, config.startingToolTier) : undefined
    return {
      profession,
      archetype: assign(config.archetypes, (index * 7919) % config.players, config.players),
      xp: totalXpForLevel(config.startingLevel),
      energy: 0,
      tool: starter ? { definition: starter, instance: createToolInstance(starter, 'starter') } : null,
      serial: 0,
    }
  })

  const usableTool = (player: SimPlayer) =>
    player.tool && toolCondition(player.tool.instance, player.tool.definition) === 'ok' ? player.tool : null

  const equip = (player: SimPlayer, tier: number): boolean => {
    const definition = toolFor(player.profession, tier)
    if (!definition || !ledger.acquire([{ itemId: definition.itemId, quantity: 1 }], 'equipped')) return false
    player.tool = { definition, instance: createToolInstance(definition, `t${++player.serial}`) }
    counters.equipped++
    return true
  }

  const maintainTool = (player: SimPlayer, level: number, allowUpgrade: boolean): void => {
    if (player.tool && toolCondition(player.tool.instance, player.tool.definition) !== 'ok') {
      const outcome = config.repairTools ? repairTool(player.tool.instance, player.tool.definition) : null
      if (outcome?.ok && ledger.acquire(outcome.cost, 'repair')) {
        player.tool = { ...player.tool, instance: outcome.instance }
        counters.repairs++
        return
      }
      if (outcome?.ok) counters.unaffordable++
      const tier = player.tool.definition.tier
      if (!outcome?.ok) {
        counters.retired++
        player.tool = null
      }
      if (config.craftTools) for (let t = tier; t >= 1 && !usableTool(player); t--) equip(player, t)
      return
    }
    if (!allowUpgrade || !config.craftTools) return
    const current = player.tool?.definition.tier ?? 0
    for (let tier = 3; tier > current; tier--) {
      if ((toolFor(player.profession, tier)?.requiredLevel ?? Infinity) <= level && equip(player, tier)) return
    }
  }

  const chooseNode = (player: SimPlayer, level: number): GatheringNodeDefinition | null => {
    const tier = usableTool(player)?.definition.tier ?? 0
    const unlocked = GATHERING_NODES
      .filter(node => node.profession === player.profession && node.requiredLevel <= level)
      .filter(node => node.requiredAccess === null || config.access.includes(node.requiredAccess))
      .filter(node => node.minToolTier === 0 || tier >= node.minToolTier)
      .sort((a, b) => b.requiredLevel - a.requiredLevel)
      .slice(0, NODE_PREFERENCE.length)
    if (!unlocked.length) return null
    const weights = NODE_PREFERENCE.slice(0, unlocked.length)
    let roll = random() * weights.reduce((sum, weight) => sum + weight, 0)
    for (let i = 0; i < unlocked.length; i++) if ((roll -= weights[i]) < 0) return unlocked[i]
    return unlocked[unlocked.length - 1]
  }

  const runSession = (player: SimPlayer): void => {
    let seconds = player.archetype.gatheringMinutesPerSession * 60
    maintainTool(player, levelForXp(player.xp), true)
    for (let i = 0; i < MAX_ACTIONS_PER_SESSION && seconds > 0; i++) {
      const level = levelForXp(player.xp)
      maintainTool(player, level, false)
      const node = chooseNode(player, level)
      if (!node) return
      const tool = usableTool(player)
      const result = resolveGathering({
        node, professionLevel: level, tool, bonuses: config.pokemonBonuses, access: config.access, homeBiomes: [],
        biome: node.biomes[0], availableEnergy: player.energy, rested: false, energyConfig: ENERGY_CONFIG, random,
      })
      if (!result.ok) return
      player.energy -= result.energySpent
      player.xp += result.xp
      seconds -= result.actionSeconds
      counters.energySpent += result.energySpent
      counters.seconds += result.actionSeconds
      counters.actions++
      for (const stack of [...result.drops, ...result.rareDrops]) ledger.add(stack.itemId, stack.quantity, 'gathered')
      if (tool) {
        player.tool = { ...tool, instance: wearTool(tool.instance, result.durabilityLoss) }
        counters.lost += result.durabilityLoss
      } else {
        counters.bare++
      }
    }
  }

  /** Converts fractional per-day rates into whole units without losing the remainder. */
  const units = (key: string, amount: number): number => {
    const total = (carry.get(key) ?? 0) + amount
    const whole = Math.floor(total)
    carry.set(key, total - whole)
    return whole
  }

  for (let day = 0; day < config.days; day++) {
    for (const player of players) {
      const { sessionsPerDay } = player.archetype
      for (let session = 0; session < sessionsPerDay; session++) {
        const max = maxEnergy(ENERGY_CONFIG, levelForXp(player.xp) + PROFESSION_IDS.length - 1)
        const regen = day === 0 && session === 0 ? max : ENERGY_CONFIG.regenPerHour * (24 / sessionsPerDay) * (1 + config.regenBonus)
        const before = player.energy
        player.energy = Math.min(max, player.energy + regen)
        counters.energyAvailable += player.energy - before
        runSession(player)
      }
    }
    for (const [itemId, rate] of Object.entries(config.pveDropsPerPlayerDay)) ledger.add(itemId, units(`drop:${itemId}`, rate * config.players), 'pveDropped')
    for (const [itemId, rate] of Object.entries(config.demandPerPlayerDay)) ledger.consume(itemId, units(`demand:${itemId}`, rate * config.players), 'consumption')
    for (const structure of STRUCTURES) {
      const owners = (config.structureOwnership[structure.itemId] ?? 0) * config.players
      const restores = units(`maintain:${structure.itemId}`, (owners * structure.decayPerActiveDay) / structure.restoresCondition)
      for (let i = 0; i < restores; i++) ledger.acquire(structure.maintenance, 'maintenance')
    }
    dailyStock.push(Object.fromEntries(config.trackItems.map(itemId => [itemId, ledger.stockOf(itemId)])))
  }

  const items = ledger.snapshot()
  const sum = (pick: (flow: ItemFlow & { endStock: number }) => number) => Object.values(items).reduce((total, flow) => total + pick(flow), 0)
  const levels = Object.fromEntries(PROFESSION_IDS.map(profession => {
    const values = players.filter(player => player.profession === profession).map(player => levelForXp(player.xp))
    return [profession, {
      players: values.length,
      average: values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : 0,
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 0,
    }]
  })) as SimulationReport['levels']

  return {
    config,
    items,
    dailyStock,
    energy: { available: Math.round(counters.energyAvailable), spent: Math.round(counters.energySpent) },
    actions: counters.actions,
    gatheringHours: Math.round(counters.seconds / 36) / 100,
    bareHandActions: counters.bare,
    durability: { lost: counters.lost, repairs: counters.repairs, toolsEquipped: counters.equipped, toolsRetired: counters.retired, repairsUnaffordable: counters.unaffordable },
    levels,
    totals: {
      gathered: sum(flow => flow.gathered + flow.pveDropped),
      transformed: sum(flow => flow.craftingInput),
      destroyed: sum(flow => flow.repair + flow.maintenance + flow.consumption) + counters.retired,
      endStock: sum(flow => flow.endStock),
      shortage: sum(flow => flow.shortage),
    },
  }
}
