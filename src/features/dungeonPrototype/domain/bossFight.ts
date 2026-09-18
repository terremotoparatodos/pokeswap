// The Alpha's controller: normal moves plus Boss Skills, with telegraphs (D1 §44–§46).
//
// The battle engine knows nothing about bosses. This drives one from outside,
// which keeps the Alpha's kit — the one place AoE exists in v1 — out of the
// ordinary Pokémon rules.

import {
  actorById, livingActors, log, type BattleActor, type BattleState,
} from './battle'
import { applyStage } from './damage'
import { damage as dealDamage, isFainted } from './party'
import {
  createBossKit, targetsFor, type BossKitState, type BossSkill,
} from './bossSkills'

export interface BossController {
  readonly kit: BossKitState
  /** Called on every battle tick, after the engine's own tick. */
  update(battle: BattleState, dt: number): void
}

/** How hard one Boss Skill hits, as a fraction of the Alpha's own scale. */
const skillDamage = (boss: BattleActor, skill: BossSkill, bonus: number): number => {
  if (skill.damage === null) return 0
  const level = boss.combatant.pokemon.level
  // PLAYTEST PARAMETER: a flat level-scaled hit, so a Boss Skill reads as its
  // own thing rather than as another move of the species.
  return Math.max(1, Math.round(level * 1.6 * skill.damage * bonus))
}

function resolveSkill(battle: BattleState, boss: BattleActor, kit: BossKitState): void {
  const telegraph = kit.telegraph
  if (!telegraph) return
  kit.telegraph = null
  battle.telegraph = null
  const { skill } = telegraph

  if (skill.effect?.kind === 'enrage') {
    kit.damageBonus *= skill.effect.damageBonus
    log(battle, boss.id, 'boss', `${skill.name}: el Alpha se enfurece`)
    return
  }
  if (skill.effect?.kind === 'cooldown') {
    kit.allyCooldown = { multiplier: skill.effect.multiplier, until: battle.seconds + skill.effect.seconds }
    log(battle, boss.id, 'boss', `${skill.name}: cooldown aliado ×${skill.effect.multiplier}`)
    return
  }

  for (const actorId of telegraph.targets) {
    const target = actorById(battle, actorId)
    if (!target || isFainted(target.combatant.pokemon)) continue
    // Protect absorbs a Boss Skill exactly like any other offensive action.
    if (target.shield > 0) {
      target.shield -= 1
      log(battle, target.id, 'boss', `Protección absorbió ${skill.name} (${target.shield} restantes)`)
      continue
    }
    const hit = skillDamage(boss, skill, kit.damageBonus)
    if (hit > 0) {
      dealDamage(target.combatant.pokemon, hit)
      boss.damageDealt += hit
      log(battle, target.id, 'boss', `${skill.name}: ${hit} de daño`)
    }
    if (skill.effect?.kind === 'debuff') {
      target.combatant = {
        ...target.combatant,
        stages: applyStage(target.combatant.stages, skill.effect.stat, skill.effect.stages),
      }
    }
    if (skill.effect?.kind === 'status' && battle.rng.next() < skill.effect.chance) {
      const pokemon = target.combatant.pokemon
      if (skill.effect.status === 'confusion') {
        if (pokemon.confusedFor <= 0) pokemon.confusedFor = 8
      } else if (pokemon.status === 'none') {
        pokemon.status = skill.effect.status
      }
    }
  }
}

function startSkill(battle: BattleState, boss: BattleActor, kit: BossKitState, skill: BossSkill): void {
  const allies = livingActors(battle, 'ally').map(actor => actor.id)
  if (!allies.length && skill.shape !== 'self') return
  const targets = targetsFor(skill.shape, allies, allies[0] ?? null, (min, max) => battle.rng.int(min, max))
  kit.telegraph = { skill, resolvesAt: battle.seconds + skill.telegraphSeconds, targets }
  battle.telegraph = {
    skillId: skill.id, name: skill.name, endsAt: battle.seconds + skill.telegraphSeconds,
  }
  kit.nextSkillAt = battle.seconds + skill.telegraphSeconds + skill.cooldownSeconds
  log(battle, boss.id, 'boss', `⚠ ${skill.name} (${skill.telegraphSeconds}s)`)
}

/**
 * Creates the controller. `bossActorId` is the Alpha's actor in the battle.
 *
 * The Alpha keeps attacking with its ordinary moves through the normal engine;
 * this only layers the Boss Skills on top, one at a time, always announced.
 */
export function createBossController(
  bossActorId: string, skills: readonly BossSkill[], firstSkillAt = 6,
): BossController {
  const kit = createBossKit(skills, firstSkillAt)
  return {
    kit,
    update(state: BattleState): void {
      const boss = actorById(state, bossActorId)
      if (!boss || state.outcome !== 'ongoing' || isFainted(boss.combatant.pokemon)) {
        kit.telegraph = null
        state.telegraph = null
        return
      }
      if (kit.allyCooldown.until && state.seconds >= kit.allyCooldown.until) {
        kit.allyCooldown = { multiplier: 1, until: 0 }
      }
      if (kit.telegraph) {
        if (state.seconds >= kit.telegraph.resolvesAt) resolveSkill(state, boss, kit)
        return
      }
      if (!kit.skills.length || state.seconds < kit.nextSkillAt) return
      const skill = kit.skills[Math.floor(state.seconds) % kit.skills.length]
      startSkill(state, boss, kit, skill)
    },
  }
}

/** The multiplier `slowField` imposes on every ally's cooldown right now. */
export const allyCooldownMultiplier = (kit: BossKitState, seconds: number): number =>
  seconds < kit.allyCooldown.until ? kit.allyCooldown.multiplier : 1
