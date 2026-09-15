// Local, non-persistent prototype session for R31-B.
//
// Pure reducer over R31-A contracts: every action goes through the real
// resolvers and catalog. It stands in for the future server authority only
// inside the prototype — nothing is saved, sent or granted.

import { ENERGY_CONFIG, PROFESSIONS } from '../domain/catalog/professions'
import { RECIPE_BY_ID } from '../domain/catalog/recipes'
import { TOOL_BY_ID } from '../domain/catalog/tools'
import { createToolInstance, repairTool, wearTool } from '../domain/durability'
import { createEnergyState, maxEnergy, regenerateEnergy, spendEnergy } from '../domain/energy'
import { previewGathering, resolveGathering, type GatheringCheck } from '../domain/gathering'
import { addItems, hasItems, removeItems } from '../domain/inventory'
import { chargeKey, consumeCharge, remainingCharges, type ChargeLedger } from '../domain/nodeDepletion'
import { resolveProcessing } from '../domain/processing'
import { levelForXp, totalXpForLevel } from '../domain/progression'
import { createSeededRandom } from '../domain/rng'
import {
  PROFESSION_IDS,
  type Biome, type EnergyState, type EquippedTool, type GatheringContext, type GatheringNodeDefinition, type GatheringResult,
  type Inventory, type ItemStack, type PokemonProfessionAffinity, type ProcessingRejection, type ProcessingResult,
  type ProfessionId, type ToolInstance, type ToolKind,
} from '../domain/types'
import { resolveNodeStatus, statusForRejection, type NodeStatus } from '../ui/nodeStatus'
import { findDemoWorker, workerAffinity, type DemoWorker } from './demoWorkers'

export const DEMO_USER_ID = 'demo-player'
export const DEMO_CAPACITY = 300

export interface DemoState {
  readonly now: number
  readonly xp: Readonly<Record<ProfessionId, number>>
  readonly energy: EnergyState
  readonly tools: Readonly<Partial<Record<ToolKind, ToolInstance>>>
  readonly inventory: Inventory
  readonly capacity: number
  /** Lead worker species per profession (party model is not approved yet). */
  readonly workers: Readonly<Record<ProfessionId, number | null>>
  readonly workerLevel: number
  readonly charges: ChargeLedger
  readonly rngSeed: number
}

export interface DemoNodeTarget {
  readonly nodeId: string
  readonly node: GatheringNodeDefinition
  readonly biome: Biome
}

const START_LEVELS: Readonly<Record<ProfessionId, number>> = { mining: 16, woodcutting: 9, fishing: 6, alchemy: 12 }
const START_WORKERS: Readonly<Record<ProfessionId, number>> = { mining: 68, woodcutting: 400, fishing: 9, alchemy: 242 }
const START_TOOLS: Readonly<Record<ToolKind, { itemId: string; wear: number }>> = {
  pickaxe: { itemId: 'iron_pickaxe', wear: 40 },
  axe: { itemId: 'stone_axe', wear: 20 },
  rod: { itemId: 'basic_rod', wear: 0 },
  sickle: { itemId: 'stone_sickle', wear: 45 },
}
const START_INVENTORY: Inventory = {
  stone: 12, coal: 4, iron_ore: 3, plank: 2, oran_berry: 5, medicinal_herb: 3, seaweed: 2, vial: 2, sitrus_berry: 1,
}

export function totalLevels(xp: Readonly<Record<ProfessionId, number>>): number {
  return PROFESSION_IDS.reduce((sum, id) => sum + levelForXp(xp[id]), 0)
}

export function createDemoState(now: number): DemoState {
  const xp = Object.fromEntries(PROFESSION_IDS.map(id => [id, totalXpForLevel(START_LEVELS[id])])) as Record<ProfessionId, number>
  const tools: Partial<Record<ToolKind, ToolInstance>> = {}
  for (const [kind, start] of Object.entries(START_TOOLS) as [ToolKind, { itemId: string; wear: number }][]) {
    tools[kind] = wearTool(createToolInstance(TOOL_BY_ID.get(start.itemId)!, `demo-${kind}`), start.wear)
  }
  return {
    now, xp, tools, inventory: START_INVENTORY, capacity: DEMO_CAPACITY, workers: START_WORKERS, workerLevel: 30,
    charges: new Map(), rngSeed: 31, energy: createEnergyState(maxEnergy(ENERGY_CONFIG, totalLevels(xp)), now),
  }
}

// ── Reads ───────────────────────────────────────────────────────────────────

export const demoLevel = (state: DemoState, profession: ProfessionId): number => levelForXp(state.xp[profession])
export const demoMaxEnergy = (state: DemoState): number => maxEnergy(ENERGY_CONFIG, totalLevels(state.xp))
export const itemCount = (inventory: Inventory): number => Object.values(inventory).reduce((sum, quantity) => sum + quantity, 0)
export const demoWorker = (state: DemoState, profession: ProfessionId): DemoWorker | null => findDemoWorker(state.workers[profession])

export function demoAffinity(state: DemoState, profession: ProfessionId): PokemonProfessionAffinity | null {
  const worker = demoWorker(state, profession)
  return worker ? workerAffinity(worker, profession, state.workerLevel) : null
}

export function demoTool(state: DemoState, profession: ProfessionId): EquippedTool | null {
  const instance = state.tools[PROFESSIONS[profession].toolKind]
  const definition = instance ? TOOL_BY_ID.get(instance.itemId) : undefined
  return instance && definition ? { definition, instance } : null
}

/** Moves the demo clock forward and regenerates energy lazily, like the future server. */
export function syncDemoClock(state: DemoState, now: number): DemoState {
  if (now <= state.now) return state
  return { ...state, now, energy: regenerateEnergy(state.energy, ENERGY_CONFIG, now, demoMaxEnergy(state)) }
}

function gatheringContext(state: DemoState, target: DemoNodeTarget, random: () => number): GatheringContext {
  const profession = target.node.profession
  const affinity = demoAffinity(state, profession)
  return {
    node: target.node, professionLevel: demoLevel(state, profession), tool: demoTool(state, profession),
    bonuses: affinity?.bonuses ?? {}, access: affinity?.access ?? [], homeBiomes: affinity?.homeBiomes ?? [],
    biome: target.biome, availableEnergy: state.energy.current, rested: state.energy.rested > 0,
    energyConfig: ENERGY_CONFIG, random,
  }
}

export interface NodeInspection {
  readonly check: GatheringCheck
  readonly remainingCharges: number
  readonly respawnInSeconds: number
  readonly freeCapacity: number
  /** Worst case for inventory space: max roll plus the extra unit. */
  readonly maxUnits: number
}

export function inspectDemoNode(state: DemoState, target: DemoNodeTarget): NodeInspection {
  const { node } = target
  const remaining = remainingCharges(state.charges, target.nodeId, DEMO_USER_ID, node, state.now)
  const charge = state.charges.get(chargeKey(target.nodeId, DEMO_USER_ID))
  return {
    check: previewGathering(gatheringContext(state, target, () => 0)),
    remainingCharges: remaining,
    respawnInSeconds: remaining < node.personalCharges && charge
      ? Math.max(0, Math.ceil((charge.startedAt + node.respawnSeconds * 1000 - state.now) / 1000))
      : 0,
    freeCapacity: Math.max(0, state.capacity - itemCount(state.inventory)),
    maxUnits: node.drops.primary.max + 1,
  }
}

export function demoNodeStatus(state: DemoState, target: DemoNodeTarget): NodeStatus {
  return resolveNodeStatus({ ...inspectDemoNode(state, target), phase: 'idle' })
}

// ── Actions ─────────────────────────────────────────────────────────────────

export type GatheringSuccess = Extract<GatheringResult, { ok: true }>

export type DemoGatherOutcome =
  | { readonly ok: true; readonly state: DemoState; readonly result: GatheringSuccess; readonly leveledUp: boolean; readonly toolBroke: boolean }
  | { readonly ok: false; readonly state: DemoState; readonly status: NodeStatus }

export function gatherDemo(state: DemoState, target: DemoNodeTarget): DemoGatherOutcome {
  const status = demoNodeStatus(state, target)
  if (status !== 'available') return { ok: false, state, status }
  const result = resolveGathering(gatheringContext(state, target, createSeededRandom(state.rngSeed)))
  if (!result.ok) return { ok: false, state, status: statusForRejection(result.reason) }
  const spent = spendEnergy(state.energy, result.energySpent)
  if (!spent) return { ok: false, state, status: 'no_energy' }

  const profession = target.node.profession
  const kind = PROFESSIONS[profession].toolKind
  const tool = state.tools[kind]
  const worn = tool ? wearTool(tool, result.durabilityLoss) : undefined
  const charged = consumeCharge(state.charges, target.nodeId, DEMO_USER_ID, target.node, state.now)
  const next: DemoState = {
    ...state,
    energy: spent.state,
    tools: worn ? { ...state.tools, [kind]: worn } : state.tools,
    inventory: addItems(state.inventory, [...result.drops, ...result.rareDrops]),
    charges: charged?.ledger ?? state.charges,
    xp: { ...state.xp, [profession]: state.xp[profession] + result.xp },
    rngSeed: state.rngSeed + 1,
  }
  return {
    ok: true, state: next, result,
    leveledUp: demoLevel(next, profession) > demoLevel(state, profession),
    toolBroke: !!tool && tool.durability > 0 && worn?.durability === 0,
  }
}

export type DemoCraftOutcome =
  | { readonly ok: true; readonly state: DemoState; readonly result: Extract<ProcessingResult, { ok: true }>; readonly leveledUp: boolean }
  | { readonly ok: false; readonly state: DemoState; readonly reason: ProcessingRejection | 'unknown_recipe' | 'inventory_full' }

export function craftDemo(state: DemoState, recipeId: string, quantity: number): DemoCraftOutcome {
  const recipe = RECIPE_BY_ID.get(recipeId)
  if (!recipe) return { ok: false, state, reason: 'unknown_recipe' }
  const affinity = demoAffinity(state, recipe.profession)
  const result = resolveProcessing({
    recipe, professionLevel: demoLevel(state, recipe.profession), inventory: state.inventory, quantity,
    processingBonus: affinity?.bonuses.processing ?? 0, station: 'public', stationSpeedBonus: 0,
    random: createSeededRandom(state.rngSeed),
  })
  if (!result.ok) return { ok: false, state, reason: result.reason }
  const net = itemCount(Object.fromEntries(result.produced.map(stack => [stack.itemId, stack.quantity])))
    - itemCount(Object.fromEntries(result.consumed.map(stack => [stack.itemId, stack.quantity])))
  if (itemCount(state.inventory) + net > state.capacity) return { ok: false, state, reason: 'inventory_full' }
  const next: DemoState = {
    ...state,
    inventory: addItems(removeItems(state.inventory, result.consumed)!, result.produced),
    xp: { ...state.xp, [recipe.profession]: state.xp[recipe.profession] + result.xp },
    rngSeed: state.rngSeed + 1,
  }
  return { ok: true, state: next, result, leveledUp: demoLevel(next, recipe.profession) > demoLevel(state, recipe.profession) }
}

export type DemoRepairOutcome =
  | { readonly ok: true; readonly state: DemoState; readonly cost: readonly ItemStack[] }
  | { readonly ok: false; readonly state: DemoState; readonly reason: 'no_tool' | 'not_damaged' | 'worn_out' | 'missing_materials'; readonly cost: readonly ItemStack[] }

export function repairDemoTool(state: DemoState, profession: ProfessionId): DemoRepairOutcome {
  const tool = demoTool(state, profession)
  if (!tool) return { ok: false, state, reason: 'no_tool', cost: [] }
  const outcome = repairTool(tool.instance, tool.definition)
  if (!outcome.ok) return { ok: false, state, reason: outcome.reason, cost: [] }
  if (!hasItems(state.inventory, outcome.cost)) return { ok: false, state, reason: 'missing_materials', cost: outcome.cost }
  return {
    ok: true,
    cost: outcome.cost,
    state: { ...state, inventory: removeItems(state.inventory, outcome.cost)!, tools: { ...state.tools, [tool.definition.kind]: outcome.instance } },
  }
}

// ── Playground controls ─────────────────────────────────────────────────────

export function setDemoLevel(state: DemoState, profession: ProfessionId, level: number): DemoState {
  return { ...state, xp: { ...state.xp, [profession]: totalXpForLevel(level) } }
}

export function setDemoEnergy(state: DemoState, current: number, rested = state.energy.rested): DemoState {
  const clamped = Math.max(0, Math.min(demoMaxEnergy(state), current))
  return { ...state, energy: { ...state.energy, current: clamped, rested: Math.max(0, rested), updatedAt: state.now } }
}

export function equipDemoTool(state: DemoState, kind: ToolKind, itemId: string | null): DemoState {
  const definition = itemId ? TOOL_BY_ID.get(itemId) : undefined
  const tools = { ...state.tools }
  if (definition && definition.kind === kind) tools[kind] = createToolInstance(definition, `demo-${kind}-${state.rngSeed}`)
  else delete tools[kind]
  return { ...state, tools }
}

export function setDemoDurability(state: DemoState, kind: ToolKind, durability: number): DemoState {
  const tool = state.tools[kind]
  if (!tool) return state
  return { ...state, tools: { ...state.tools, [kind]: { ...tool, durability: Math.max(0, Math.min(tool.maxDurability, Math.round(durability))) } } }
}

export function setDemoWorker(state: DemoState, profession: ProfessionId, speciesId: number | null): DemoState {
  return { ...state, workers: { ...state.workers, [profession]: speciesId } }
}

export function setDemoWorkerLevel(state: DemoState, level: number): DemoState {
  return { ...state, workerLevel: Math.max(1, Math.min(100, Math.round(level))) }
}

export function setDemoInventory(state: DemoState, inventory: Inventory): DemoState {
  return { ...state, inventory }
}

/** Uses every personal charge of a node, to preview the depleted state. */
export function depleteDemoNode(state: DemoState, target: DemoNodeTarget): DemoState {
  let charges = state.charges
  for (;;) {
    const next = consumeCharge(charges, target.nodeId, DEMO_USER_ID, target.node, state.now)
    if (!next) return { ...state, charges }
    charges = next.ledger
  }
}
