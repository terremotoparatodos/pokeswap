// One gathering action, resolved as a pure function.
//
// Intended to run inside the server authority (R32+): it validates the
// request and produces the result. It never mutates state; the caller commits
// energy, durability, XP and items together, atomically.

import { PROFESSIONS } from './catalog/professions'
import { BARE_HANDS_SPEED_MULTIPLIER } from './catalog/tools'
import { toolCondition } from './durability'
import { actionEnergyCost } from './energy'
import { actionXp, levelEfficiency } from './progression'
import { randomInt } from './rng'
import type { GatheringContext, GatheringResult, ItemStack } from './types'

const MAX_EXTRA_UNIT_CHANCE = 0.6
const MAX_RARE_MULTIPLIER = 3
const MIN_ACTION_TIME_RATIO = 0.4

const round2 = (value: number): number => Math.round(value * 100) / 100

export function resolveGathering(context: GatheringContext): GatheringResult {
  const { node, tool, bonuses, random } = context

  if (context.professionLevel < node.requiredLevel) return { ok: false, reason: 'level_too_low' }
  if (!node.biomes.includes(context.biome)) return { ok: false, reason: 'wrong_biome' }
  if (node.requiredAccess && !context.access.includes(node.requiredAccess)) return { ok: false, reason: 'access_required' }
  const usableTool = tool && tool.definition.kind === PROFESSIONS[node.profession].toolKind ? tool : null
  if (!usableTool && node.minToolTier > 0) return { ok: false, reason: 'tool_required' }
  if (usableTool && toolCondition(usableTool.instance, usableTool.definition) !== 'ok') return { ok: false, reason: 'tool_broken' }
  if (usableTool && usableTool.definition.tier < node.minToolTier) return { ok: false, reason: 'tool_tier_too_low' }

  const efficiency = levelEfficiency(context.professionLevel, node.requiredLevel)
  const energySpent = actionEnergyCost(node.energyCost, bonuses.energySaving ?? 0, efficiency.energy, context.energyConfig)
  if (energySpent > context.availableEnergy) return { ok: false, reason: 'insufficient_energy' }

  const toolSpeed = usableTool ? usableTool.definition.speedMultiplier : BARE_HANDS_SPEED_MULTIPLIER
  const actionSeconds = round2(Math.max(
    node.baseActionSeconds * MIN_ACTION_TIME_RATIO,
    node.baseActionSeconds * toolSpeed * (1 - (bonuses.speed ?? 0)) * (1 - efficiency.speed),
  ))

  const critical = random() < (bonuses.critical ?? 0)
  const home = context.homeBiomes.includes(context.biome)
  const extraChance = Math.min(MAX_EXTRA_UNIT_CHANCE,
    (bonuses.yield ?? 0) + (usableTool?.definition.yieldBonus ?? 0) + efficiency.yield + (home ? bonuses.biomeMastery ?? 0 : 0))

  const { primary } = node.drops
  let primaryUnits = randomInt(random, primary.min, primary.max)
  if (random() < extraChance) primaryUnits += 1
  if (critical) primaryUnits *= 2

  const drops: ItemStack[] = [{ itemId: primary.itemId, quantity: primaryUnits }]
  const rareDrops: ItemStack[] = []
  const rareMultiplier = Math.min(MAX_RARE_MULTIPLIER, (1 + (bonuses.rareFind ?? 0)) * efficiency.rareMultiplier)
  for (const entry of node.drops.secondary) {
    const chance = entry.rare ? entry.chance * rareMultiplier : entry.chance
    if (random() >= chance) continue
    const stack = { itemId: entry.itemId, quantity: randomInt(random, entry.min, entry.max) }
    ;(entry.rare ? rareDrops : drops).push(stack)
  }

  let fineUnits = 0
  for (let unit = 0; unit < primaryUnits; unit++) if (random() < (bonuses.quality ?? 0)) fineUnits++

  let durabilityLoss = 0
  if (usableTool) {
    const points = node.tier > usableTool.definition.tier ? 2 : 1
    for (let point = 0; point < points; point++) if (random() >= (bonuses.toolCare ?? 0)) durabilityLoss++
  }

  return {
    ok: true,
    drops,
    rareDrops,
    fineUnits,
    critical,
    energySpent,
    actionSeconds,
    xp: actionXp(node.xp, context.professionLevel, node.requiredLevel, context.rested, context.energyConfig.restedXpBonus),
    durabilityLoss,
  }
}
