// Boss Skills: the Alpha's own kit (D1 §44–§46).
//
// APPROVED: the Alpha's ordinary moves still come from the Pokémon system, but
// an Alpha also has **Boss Skills** — WildLands moves that are not in the ORAS
// catalog and that no player Pokémon can ever learn. They are where the group
// mechanics live, so they are the one place AoE exists in v1.
//
// APPROVED shape: dangerous skills **telegraph** before they land, and the
// telegraph must leave room for a decision — Protect, switch, heal, or take it.
// This is not a dodge game: there is no free movement to sidestep with.
//
// PLAYTEST PARAMETER: every number, and how many skills each tier gets.

import type { DungeonTier } from './tiers'

export type BossSkillShape =
  | 'all'          // every ally
  | 'single'       // the current main target
  | 'split'        // several impacts spread over the allies
  | 'marked'       // a marked zone: whoever is in it
  | 'self'         // the Alpha itself

export interface BossSkill {
  readonly id: string
  readonly name: string
  readonly shape: BossSkillShape
  /** Seconds of warning before it resolves. 0 = no telegraph (only for weak ones). */
  readonly telegraphSeconds: number
  /** Multiplier over the Alpha's normal hit. null for skills that deal no damage. */
  readonly damage: number | null
  /** Seconds before the Alpha may use a Boss Skill again. */
  readonly cooldownSeconds: number
  /** What it does besides damage, for the engine and the UI. */
  readonly effect?:
    | { readonly kind: 'debuff'; readonly stat: 'attack' | 'defense' | 'spAttack' | 'spDefense' | 'speed'; readonly stages: number }
    | { readonly kind: 'status'; readonly status: 'burn' | 'paralysis' | 'poison' | 'freeze' | 'confusion'; readonly chance: number }
    | { readonly kind: 'cooldown'; readonly multiplier: number; readonly seconds: number }
    | { readonly kind: 'enrage'; readonly damageBonus: number }
  readonly description: string
}

/** The ten the brief asked for. Names are ours; none exist in ORAS. */
export const BOSS_SKILLS: Readonly<Record<string, BossSkill>> = {
  alphaWave: {
    id: 'alphaWave', name: 'Onda Alfa', shape: 'all', telegraphSeconds: 1.6, damage: 0.8,
    cooldownSeconds: 14,
    description: 'Pulso que alcanza a todos los aliados. El telegraph da tiempo justo a Protección.',
  },
  quake: {
    id: 'quake', name: 'Sacudida Total', shape: 'all', telegraphSeconds: 2.2, damage: 1.1,
    cooldownSeconds: 20,
    description: 'Impacto general fuerte y bien anunciado: el momento de decidir si escudás o curás.',
  },
  roar: {
    id: 'roar', name: 'Rugido Desmoralizante', shape: 'all', telegraphSeconds: 1.2, damage: null,
    cooldownSeconds: 18, effect: { kind: 'debuff', stat: 'attack', stages: -1 },
    description: 'Debuff grupal de Ataque, con el piso de ×0,5 del sistema.',
  },
  voidPulse: {
    id: 'voidPulse', name: 'Pulso Vacío', shape: 'all', telegraphSeconds: 1.8, damage: 0.7,
    cooldownSeconds: 16, effect: { kind: 'status', status: 'confusion', chance: 0.35 },
    description: 'Pulso especial que además confunde: la confusión convive con el estado principal.',
  },
  crush: {
    id: 'crush', name: 'Aplastar', shape: 'single', telegraphSeconds: 1.4, damage: 1.8,
    cooldownSeconds: 12,
    description: 'Golpe demoledor a un solo objetivo. Sin salpicadura: v1 no tiene fuego amigo.',
  },
  alphaQuake: {
    id: 'alphaQuake', name: 'Terremoto Alfa', shape: 'all', telegraphSeconds: 2.6, damage: 1.4,
    cooldownSeconds: 26,
    description: 'El más lento y el más duro. Si no reaccionás, duele de verdad.',
  },
  dangerZone: {
    id: 'dangerZone', name: 'Zona de Peligro', shape: 'marked', telegraphSeconds: 2.8, damage: 1.6,
    cooldownSeconds: 22,
    description: 'Marca a un aliado; el golpe cae sobre él. El telegraph pide cambiarlo o escudarlo.',
  },
  scatter: {
    id: 'scatter', name: 'Impactos Dispersos', shape: 'split', telegraphSeconds: 1.6, damage: 0.6,
    cooldownSeconds: 15,
    description: 'Varios impactos repartidos: castiga a los grupos grandes sin castigar al solitario.',
  },
  slowField: {
    id: 'slowField', name: 'Campo Denso', shape: 'all', telegraphSeconds: 1.4, damage: null,
    cooldownSeconds: 24, effect: { kind: 'cooldown', multiplier: 1.5, seconds: 8 },
    description: 'Sube el cooldown de todos durante unos segundos: el equivalente grupal de la parálisis.',
  },
  enrage: {
    id: 'enrage', name: 'Furia Alfa', shape: 'self', telegraphSeconds: 2, damage: null,
    cooldownSeconds: 40, effect: { kind: 'enrage', damageBonus: 1.25 },
    description: 'Fase: el Alpha se potencia. Anuncia el cambio de ritmo de la pelea.',
  },
}

export const BOSS_SKILL_IDS = Object.keys(BOSS_SKILLS)

export const bossSkillById = (id: string): BossSkill | null => BOSS_SKILLS[id] ?? null

/** PLAYTEST PARAMETER (§45): how many skills an Alpha of each tier carries. */
export const SKILLS_PER_TIER: Readonly<Record<DungeonTier, { min: number; max: number }>> = {
  D: { min: 1, max: 1 },
  C: { min: 1, max: 2 },
  B: { min: 2, max: 2 },
  A: { min: 2, max: 3 },
  S: { min: 3, max: 4 },
}

/**
 * The kit for one Alpha. Deterministic from the seed, so the same boss always
 * brings the same skills — a player can learn the fight.
 *
 * `Furia Alfa` is reserved for the tiers that get three or more, because a
 * phase change only reads as one when there is enough fight left around it.
 */
export function bossKitFor(tier: DungeonTier, pick: (min: number, max: number) => number,
  shuffle: <T>(items: readonly T[]) => T[]): BossSkill[] {
  const range = SKILLS_PER_TIER[tier]
  const count = pick(range.min, range.max)
  const pool = BOSS_SKILL_IDS.filter(id => (id === 'enrage' ? count >= 3 : true))
  return shuffle(pool).slice(0, count).map(id => BOSS_SKILLS[id])
}

// ── Runtime state ──────────────────────────────────────────────────────────

export interface TelegraphState {
  readonly skill: BossSkill
  /** Battle seconds at which it resolves. */
  readonly resolvesAt: number
  /** Ally actor ids it will hit, decided when the telegraph starts. */
  readonly targets: readonly string[]
}

export interface BossKitState {
  readonly skills: readonly BossSkill[]
  /** Battle seconds until the Alpha may start another skill. */
  nextSkillAt: number
  telegraph: TelegraphState | null
  /** Set by `enrage`. */
  damageBonus: number
  /** Set by `slowField`: multiplier and when it ends. */
  allyCooldown: { multiplier: number; until: number }
}

export const createBossKit = (skills: readonly BossSkill[], firstSkillAt = 6): BossKitState => ({
  skills, nextSkillAt: firstSkillAt, telegraph: null, damageBonus: 1,
  allyCooldown: { multiplier: 1, until: 0 },
})

/** Which allies a skill hits, given its shape. */
export function targetsFor(shape: BossSkillShape, allyIds: readonly string[], mainTargetId: string | null,
  pickIndex: (min: number, max: number) => number): string[] {
  if (shape === 'self') return []
  if (shape === 'all') return [...allyIds]
  if (shape === 'single') return mainTargetId ? [mainTargetId] : allyIds.slice(0, 1)
  if (shape === 'marked') return allyIds.length ? [allyIds[pickIndex(0, allyIds.length - 1)]] : []
  // 'split': half of them, at least one.
  return allyIds.slice(0, Math.max(1, Math.ceil(allyIds.length / 2)))
}
