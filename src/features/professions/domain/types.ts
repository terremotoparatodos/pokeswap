// Profession & resource economy contracts — R31 foundation.
//
// Three layers, kept separate on purpose:
//   Definition  static catalog data, versioned in code (…Definition, …Profile)
//   State       what a future server authority persists (…State, …Instance)
//   Runtime     values that exist only while one action resolves (…Context, …Result)
//
// Nothing in the live app imports this feature yet. Persistent economy state
// must become server-authoritative before it ships (AGENTS.md §2, §8, §17).

import type { Biome, DecorKind } from '../../wildlands/engine/world'

export type { Biome }

// ── Identifiers ─────────────────────────────────────────────────────────────

export const PROFESSION_IDS = ['mining', 'woodcutting', 'fishing', 'alchemy'] as const
export type ProfessionId = (typeof PROFESSION_IDS)[number]

/** Catalog key of any item (resource, refined good, tool, consumable, structure). */
export type ItemId = string

export const POKEMON_TYPES = [
  'normal', 'fire', 'water', 'grass', 'electric', 'ice', 'fighting', 'poison', 'ground',
  'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
] as const
export type PokemonType = (typeof POKEMON_TYPES)[number]

export const STAT_KEYS = ['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed'] as const
export type StatKey = (typeof STAT_KEYS)[number]

/** [hp, attack, defense, specialAttack, specialDefense, speed] — legacy STATS_DB order. */
export type BaseStatTuple = readonly [number, number, number, number, number, number]

// ── Bonus axes ──────────────────────────────────────────────────────────────

/**
 * Independent niches a Pokémon can contribute to. Values are fractions
 * (0.12 = +12 %), except `rareFind` and `detection`, which multiply a base.
 */
export const PROFESSION_TRAITS = [
  'speed', 'yield', 'energySaving', 'rareFind', 'quality', 'toolCare',
  'critical', 'detection', 'processing', 'biomeMastery', 'safety',
] as const
export type ProfessionTrait = (typeof PROFESSION_TRAITS)[number]
export type TraitBonuses = Readonly<Partial<Record<ProfessionTrait, number>>>

/** Binary capabilities that open optional nodes; never required by the core loop. */
export const ACCESS_TAGS = ['hardRock', 'deepWater', 'frozenGround'] as const
export type AccessTag = (typeof ACCESS_TAGS)[number]

// ── Items ───────────────────────────────────────────────────────────────────

export type ItemKind = 'raw' | 'refined' | 'tool' | 'consumable' | 'structure'
export type ItemTag =
  | 'metal' | 'fuel' | 'mineral' | 'wood' | 'berry' | 'herb' | 'aquatic'
  | 'pveDrop' | 'rare' | 'container' | 'construction' | 'component'
export type Tier = 1 | 2 | 3

export interface ItemDefinition {
  readonly id: ItemId
  readonly name: string
  readonly kind: ItemKind
  readonly tier: Tier
  readonly tags: readonly ItemTag[]
  /** Profession that primarily brings it into the economy, if any. */
  readonly profession: ProfessionId | null
}

export interface ItemStack {
  readonly itemId: ItemId
  readonly quantity: number
}

// ── Professions ─────────────────────────────────────────────────────────────

export interface ProfessionMilestone {
  readonly level: number
  readonly description: string
}

export interface SpecializationStub {
  readonly id: string
  readonly name: string
  readonly unlockLevel: number
  /** Specializations are designed, not implemented, in R31. */
  readonly status: 'future'
}

export interface ProfessionDefinition {
  readonly id: ProfessionId
  readonly name: string
  readonly description: string
  readonly maxLevel: number
  /** Tool used by this profession's gathering nodes. */
  readonly toolKind: ToolKind
  /** Traits the affinity profile favours; used for UI hints and tests. */
  readonly signatureTraits: readonly ProfessionTrait[]
  /** Perks not already implied by node/recipe/tool level requirements. */
  readonly milestones: readonly ProfessionMilestone[]
  readonly specializations: readonly SpecializationStub[]
}

// ── Gathering nodes ─────────────────────────────────────────────────────────

/** World feature that can host a node: an existing decor kind or a terrain edge. */
export type NodeAnchor = DecorKind | 'shore' | 'tallGrass'

export interface DropEntry {
  readonly itemId: ItemId
  readonly chance: number
  readonly min: number
  readonly max: number
  /** Rare entries scale with `rareFind` and level instead of flat chance. */
  readonly rare?: boolean
}

export interface ResourceDropTable {
  /** Always rolled once per successful action. */
  readonly primary: DropEntry
  readonly secondary: readonly DropEntry[]
}

export interface GatheringNodeDefinition {
  readonly id: string
  readonly profession: ProfessionId
  readonly name: string
  readonly tier: Tier
  readonly requiredLevel: number
  readonly energyCost: number
  readonly baseActionSeconds: number
  readonly xp: number
  /** 0 = bare hands allowed (slow, no wear); otherwise minimum tool tier. */
  readonly minToolTier: 0 | Tier
  readonly requiredAccess: AccessTag | null
  readonly anchors: readonly NodeAnchor[]
  readonly biomes: readonly Biome[]
  /** Distance ring from the world origin (0 = spawn ring). */
  readonly minZone: number
  readonly spawnWeight: number
  /** Actions one player may perform before the node is depleted for them. */
  readonly personalCharges: number
  readonly respawnSeconds: number
  readonly drops: ResourceDropTable
}

// ── Tools & durability ──────────────────────────────────────────────────────

export type ToolKind = 'pickaxe' | 'axe' | 'rod' | 'sickle'

export interface ToolDefinition {
  readonly itemId: ItemId
  readonly kind: ToolKind
  readonly tier: Tier
  readonly requiredLevel: number
  readonly maxDurability: number
  /** Multiplies action time (lower is faster). */
  readonly speedMultiplier: number
  /** Added to the extra-unit chance. */
  readonly yieldBonus: number
  /** Materials for a repair from 0 to full; scaled by missing durability. */
  readonly repairMaterials: readonly ItemStack[]
  /** Fraction of the original max durability lost on each repair. */
  readonly maxDurabilityLossPerRepair: number
  /** Below this fraction of the original max, the tool is retired. */
  readonly retireBelowRatio: number
}

/** Persistent state of one crafted tool. */
export interface ToolInstance {
  readonly instanceId: string
  readonly itemId: ItemId
  readonly durability: number
  readonly maxDurability: number
  readonly repairs: number
}

export type ToolCondition = 'ok' | 'broken' | 'retired'

// ── Recipes, structures, consumables ────────────────────────────────────────

export type StationKind = 'workbench' | 'smelter' | 'alchemyTable' | 'campfire'
export type RecipeCategory = 'refining' | 'toolCrafting' | 'alchemy' | 'construction'

export interface RecipeDefinition {
  readonly id: string
  readonly profession: ProfessionId
  readonly category: RecipeCategory
  readonly requiredLevel: number
  readonly inputs: readonly ItemStack[]
  readonly outputs: readonly ItemStack[]
  readonly baseSeconds: number
  readonly xp: number
  /** null = no station (built in place). Towns provide slower public stations. */
  readonly station: StationKind | null
}

export interface StructureDefinition {
  readonly itemId: ItemId
  readonly station: StationKind
  readonly maxCondition: number
  /** Condition lost per day the structure is used (never while the owner is away). */
  readonly decayPerActiveDay: number
  /** Materials that restore `restoresCondition` points. */
  readonly maintenance: readonly ItemStack[]
  readonly restoresCondition: number
  readonly effects: {
    readonly processingSpeed?: number
    readonly energyRegenBonus?: number
  }
}

export type ConsumableEffect = 'heal' | 'revive' | 'restorePp' | 'restoreEnergy'

export interface ConsumableDefinition {
  readonly itemId: ItemId
  readonly effect: ConsumableEffect
  readonly value: number
  readonly context: 'pve' | 'gathering'
}

// ── Energy ──────────────────────────────────────────────────────────────────

export interface EnergyConfig {
  readonly baseMax: number
  /** +bonus max energy for every `per` total profession levels. */
  readonly maxBonus: { readonly per: number; readonly bonus: number; readonly cap: number }
  readonly regenPerHour: number
  /** Regeneration that overflows a full bar is banked as rested (XP only). */
  readonly restedCap: number
  readonly restedXpBonus: number
  /** Energy restorable by consumables per UTC day. */
  readonly consumableDailyCap: number
  /** Floor for all energy cost reductions combined. */
  readonly minCostRatio: number
}

/** Persistent, lazily regenerated (same pattern as slots.energy + energy_updated_at). */
export interface EnergyState {
  readonly current: number
  readonly rested: number
  readonly updatedAt: number
  readonly consumableRestoredToday: number
  /** UTC day (YYYY-MM-DD) that `consumableRestoredToday` belongs to. */
  readonly consumableDay: string
}

// ── Player state ────────────────────────────────────────────────────────────

export interface PlayerProfessionState {
  readonly profession: ProfessionId
  readonly xp: number
}

/** Inventory counts by item id. A future server table, never browser storage. */
export type Inventory = Readonly<Record<ItemId, number>>

// ── Pokémon affinity ────────────────────────────────────────────────────────

/**
 * Everything the affinity formula may read. `nature` and `abilityId` do not
 * exist in the live data model (FACT, R31 inspection); they are reserved so a
 * future instance model can plug in without changing the formula's signature.
 */
export interface PokemonProfessionInput {
  readonly speciesId: number
  readonly type1: string
  readonly type2: string | null
  /** From pokemon_xp.level (per user + species). */
  readonly level: number
  readonly baseStats: BaseStatTuple | null
  readonly nature?: string | null
  readonly abilityId?: string | null
}

type TraitWeights = Readonly<Partial<Record<ProfessionTrait, number>>>

export interface AccessRule {
  readonly tag: AccessTag
  readonly anyType: readonly PokemonType[]
  readonly minStat?: { readonly stat: StatKey; readonly value: number }
}

export interface AffinityProfile {
  readonly profession: ProfessionId
  readonly typeWeights: Readonly<Partial<Record<PokemonType, TraitWeights>>>
  readonly statWeights: Readonly<Partial<Record<StatKey, TraitWeights>>>
  /** Bonus magnitude when a Pokémon's whole budget goes to one trait. */
  readonly traitScale: TraitWeights
  readonly traitCap: TraitWeights
  readonly accessRules: readonly AccessRule[]
}

export interface SpeciesOverride {
  readonly speciesId: number
  readonly profession: ProfessionId
  /** Added to the raw weights before normalisation — never a final bonus. */
  readonly rawBoost: TraitWeights
  readonly reason: string
}

export interface PokemonProfessionAffinity {
  readonly speciesId: number
  readonly profession: ProfessionId
  /** 0..1 — how naturally suited the species is, before level scaling. */
  readonly fit: number
  readonly bonuses: TraitBonuses
  readonly access: readonly AccessTag[]
  readonly archetype: ProfessionTrait
  /** Biomes where `biomeMastery` applies. */
  readonly homeBiomes: readonly Biome[]
}

// ── Runtime: gathering & processing ─────────────────────────────────────────

export interface EquippedTool {
  readonly definition: ToolDefinition
  readonly instance: ToolInstance
}

export interface GatheringContext {
  readonly node: GatheringNodeDefinition
  readonly professionLevel: number
  readonly tool: EquippedTool | null
  /** Already aggregated by whichever party model is approved (see POKEMON_PROFESSION_SYSTEM.md). */
  readonly bonuses: TraitBonuses
  readonly access: readonly AccessTag[]
  readonly homeBiomes: readonly Biome[]
  readonly biome: Biome
  readonly availableEnergy: number
  readonly rested: boolean
  readonly energyConfig: EnergyConfig
  readonly random: () => number
}

export type GatheringRejection =
  | 'level_too_low' | 'tool_required' | 'tool_tier_too_low' | 'tool_broken'
  | 'access_required' | 'wrong_biome' | 'insufficient_energy'

export type GatheringResult =
  | {
      readonly ok: true
      readonly drops: readonly ItemStack[]
      readonly rareDrops: readonly ItemStack[]
      readonly fineUnits: number
      readonly critical: boolean
      readonly energySpent: number
      readonly actionSeconds: number
      readonly xp: number
      readonly durabilityLoss: number
    }
  | { readonly ok: false; readonly reason: GatheringRejection }

export type ProcessingRejection = 'level_too_low' | 'missing_inputs' | 'invalid_quantity'

export type ProcessingResult =
  | {
      readonly ok: true
      readonly consumed: readonly ItemStack[]
      readonly produced: readonly ItemStack[]
      readonly savedInputs: number
      readonly seconds: number
      readonly xp: number
    }
  | { readonly ok: false; readonly reason: ProcessingRejection }
