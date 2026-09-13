// useDungeon — R22
//
// State machine for a single dungeon run.
// Phase transitions: idle → starting → combat → submitting → result → idle
//
// Server boundary (INV-DGN-1, INV-DGN-3):
//   startDungeon  — deducts energy atomically; must succeed before combat begins.
//   finishRun     — submits advisory XP/tokens; server caps and applies them.
//   The client never writes energy, XP, or tokens directly.

import { ref, readonly } from 'vue'
import { startDungeon, submitDungeonReward } from '../api/dungeonApi'
import type { CombatSummary } from '../engine/combat'

export type DungeonPhase = 'idle' | 'starting' | 'combat' | 'submitting' | 'result'

export interface DungeonResult {
  combat:         CombatSummary
  newXp:          number
  newLevel:       number
  leveledUp:      boolean
  tokensAwarded:  number
  newBalance:     number
}

const _phase            = ref<DungeonPhase>('idle')
const _pokemonId        = ref<number | null>(null)
const _remainingEnergy  = ref<number | null>(null)
const _combat           = ref<CombatSummary | null>(null)
const _result           = ref<DungeonResult | null>(null)
const _error            = ref<string | null>(null)

export function useDungeon() {
  // DGN-2: deduct energy server-side before the client begins combat.
  async function enterDungeon(pokemonId: number): Promise<void> {
    _phase.value   = 'starting'
    _error.value   = null
    _combat.value  = null
    _result.value  = null
    try {
      const { remaining_energy } = await startDungeon(pokemonId)
      _pokemonId.value       = pokemonId
      _remainingEnergy.value = remaining_energy
      _phase.value           = 'combat'
    } catch (e) {
      _error.value = e instanceof Error ? e.message : 'Error al entrar al dungeon'
      _phase.value = 'idle'
    }
  }

  // Called by the view after combat simulation completes.
  // DGN-1: submits advisory XP/tokens — server caps and applies atomically.
  async function finishRun(summary: CombatSummary): Promise<void> {
    if (!_pokemonId.value) return
    _combat.value = summary
    _phase.value  = 'submitting'
    _error.value  = null
    try {
      const reward = await submitDungeonReward({
        pokemon_id:    _pokemonId.value,
        xp_earned:     summary.xpEarned,
        tokens_earned: summary.tokensEarned,
      })
      _result.value = {
        combat:        summary,
        newXp:         reward.new_xp,
        newLevel:      reward.new_level,
        leveledUp:     reward.leveled_up,
        tokensAwarded: reward.tokens_awarded,
        newBalance:    reward.new_balance,
      }
      _phase.value  = 'result'
    } catch (e) {
      _error.value = e instanceof Error ? e.message : 'Error al guardar resultado'
      _phase.value = 'combat'
    }
  }

  function reset(): void {
    _phase.value           = 'idle'
    _pokemonId.value       = null
    _remainingEnergy.value = null
    _combat.value          = null
    _result.value          = null
    _error.value           = null
  }

  return {
    phase:           readonly(_phase),
    pokemonId:       readonly(_pokemonId),
    remainingEnergy: readonly(_remainingEnergy),
    combat:          readonly(_combat),
    result:          readonly(_result),
    error:           readonly(_error),
    enterDungeon,
    finishRun,
    reset,
  }
}

export function _resetDungeonState(): void {
  _phase.value           = 'idle'
  _pokemonId.value       = null
  _remainingEnergy.value = null
  _combat.value          = null
  _result.value          = null
  _error.value           = null
}
