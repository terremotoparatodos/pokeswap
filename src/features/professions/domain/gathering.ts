// One gathering action, resolved as a pure function.
//
// Intended to run inside the server authority (R32+): it validates the
// request and produces the result. It never mutates state; the caller commits
// energy, durability, XP and items together, atomically.
//
// R31-B: validation and every deterministic value live in previewGathering, so
// a UI can show exact costs and odds without re-implementing the formula.

import { PROFESSIONS } from './catalog/professions'
import { BARE_HANDS_SPEED_MULTIPLIER } from './catalog/tools'
import { toolCondition } from './durability'
import { actionEnergyCost } from './energy'
import { actionXp, levelEfficiency } from './progression'
import { randomInt } from './rng'
import type { GatheringContext, GatheringRejection, GatheringResult, ItemId, ItemStack } from './types'

const MAX_EXTRA_UNIT_CHANCE = 0.6
const MAX_RARE_MULTIPLIER = 3
const MIN_ACTION_TIME_RATIO = 0.4

const round2 = (value: number): number => Math.round(value * 100) / 100

export interface GatheringDropOdds {
  readonly itemId: ItemId
  /** Final chance after rareFind and level scaling. */
  readonly chance: number
  readonly min: number
  readonly max: number
  readonly rare: boolean
}

/** Everything about an action that does not depend on the dice. */
export interface GatheringPreview {
  readonly energySpent: number
  readonly actionSeconds: number
  readonly xp: number
  readonly primaryItemId: ItemId
  readonly minUnits: number
  readonly maxUnits: number
  readonly extraUnitChance: number
  readonly criticalChance: number
  readonly qualityChance: number
  /** Durability points at stake before toolCare rolls. */
  readonly durabilityPoints: number
  readonly toolCareChance: number
  readonly secondary: readonly GatheringDropOdds[]
  readonly bareHands: boolean
}

export type GatheringCheck =
  | { readonly ok: true; readonly preview: GatheringPreview }
  | { readonly ok: false; readonly reason: GatheringRejection }

export function previewGathering(context: GatheringContext): GatheringCheck {
  const { node, tool, bonuses } = context

  // Written as !(a >= b) so a NaN level or energy fails closed instead of passing.
  if (!(context.professionLevel >= node.requiredLevel)) return { ok: false, reason: 'level_too_low' }
  if (!node.biomes.includes(context.biome)) return { ok: false, reason: 'wrong_biome' }
  if (node.requiredAccess && !context.access.includes(node.requiredAccess)) return { ok: false, reason: 'access_required' }
  const usableTool = tool && tool.definition.kind === PROFESSIONS[node.profession].toolKind ? tool : null
  if (!usableTool && node.minToolTier > 0) return { ok: false, reason: 'tool_required' }
  if (usableTool && toolCondition(usableTool.instance, usableTool.definition) !== 'ok') return { ok: false, reason: 'tool_broken' }
  if (usableTool && usableTool.definition.tier < node.minToolTier) return { ok: false, reason: 'tool_tier_too_low' }

  const efficiency = levelEfficiency(context.professionLevel, node.requiredLevel)
  const energySpent = actionEnergyCost(node.energyCost, bonuses.energySaving ?? 0, efficiency.energy, context.energyConfig)
  if (!(energySpent <= context.availableEnergy)) return { ok: false, reason: 'insufficient_energy' }

  const toolSpeed = usableTool ? usableTool.definition.speedMultiplier : BARE_HANDS_SPEED_MULTIPLIER
  const home = context.homeBiomes.includes(context.biome)
  const rareMultiplier = Math.min(MAX_RARE_MULTIPLIER, (1 + (bonuses.rareFind ?? 0)) * efficiency.rareMultiplier)
  const { primary } = node.drops

  return {
    ok: true,
    preview: {
      energySpent,
      actionSeconds: round2(Math.max(
        node.baseActionSeconds * MIN_ACTION_TIME_RATIO,
        node.baseActionSeconds * toolSpeed * (1 - (bonuses.speed ?? 0)) * (1 - efficiency.speed),
      )),
      xp: actionXp(node.xp, context.professionLevel, node.requiredLevel, context.rested, context.energyConfig.restedXpBonus),
      primaryItemId: primary.itemId,
      minUnits: primary.min,
      maxUnits: primary.max,
      extraUnitChance: Math.min(MAX_EXTRA_UNIT_CHANCE,
        (bonuses.yield ?? 0) + (usableTool?.definition.yieldBonus ?? 0) + efficiency.yield + (home ? bonuses.biomeMastery ?? 0 : 0)),
      criticalChance: bonuses.critical ?? 0,
      qualityChance: bonuses.quality ?? 0,
      durabilityPoints: usableTool ? (node.tier > usableTool.definition.tier ? 2 : 1) : 0,
      toolCareChance: bonuses.toolCare ?? 0,
      secondary: node.drops.secondary.map(entry => ({
        itemId: entry.itemId,
        chance: entry.rare ? entry.chance * rareMultiplier : entry.chance,
        min: entry.min,
        max: entry.max,
        rare: entry.rare === true,
      })),
      bareHands: !usableTool,
    },
  }
}

export function resolveGathering(context: GatheringContext): GatheringResult {
  const check = previewGathering(context)
  if (!check.ok) return { ok: false, reason: check.reason }
  const { preview } = check
  const { random } = context
  const { primary } = context.node.drops

  const critical = random() < preview.criticalChance
  let primaryUnits = randomInt(random, primary.min, primary.max)
  if (random() < preview.extraUnitChance) primaryUnits += 1
  if (critical) primaryUnits *= 2

  const drops: ItemStack[] = [{ itemId: primary.itemId, quantity: primaryUnits }]
  const rareDrops: ItemStack[] = []
  for (const odds of preview.secondary) {
    if (random() >= odds.chance) continue
    const stack = { itemId: odds.itemId, quantity: randomInt(random, odds.min, odds.max) }
    ;(odds.rare ? rareDrops : drops).push(stack)
  }

  let fineUnits = 0
  for (let unit = 0; unit < primaryUnits; unit++) if (random() < preview.qualityChance) fineUnits++

  let durabilityLoss = 0
  for (let point = 0; point < preview.durabilityPoints; point++) if (random() >= preview.toolCareChance) durabilityLoss++

  return {
    ok: true,
    drops,
    rareDrops,
    fineUnits,
    critical,
    energySpent: preview.energySpent,
    actionSeconds: preview.actionSeconds,
    xp: preview.xp,
    durabilityLoss,
  }
}
