// Dungeon combat engine — R22 (R14 client-side slice).
//
// Pure functions: no side effects, no network, no persistent state.
// Results are advisory — the server caps XP/tokens before applying them
// (INV-DGN-1, INV-DGN-3). The client may never write XP or tokens directly.

export const DUNGEON_ENERGY_COST = 30

export interface CombatRound {
  round: number
  playerDamage: number
  enemyDamage:  number
  playerHpAfter: number
  enemyHpAfter:  number
}

export interface CombatSummary {
  won:          boolean
  rounds:       CombatRound[]
  xpEarned:     number  // advisory — server caps at 10 000
  tokensEarned: number  // advisory — server caps at 3 000 and daily remainder
}

const PLAYER_BASE_HP = 100
const ENEMY_BASE_HP  = 80
const MAX_ROUNDS     = 8

/**
 * Simulate a dungeon combat run for a Pokémon at the given level.
 * The result is cosmetic: it drives the UI animation and proposes the
 * advisory XP/token values sent to dungeon-reward.
 */
export function runCombat(playerLevel = 1): CombatSummary {
  let playerHp = PLAYER_BASE_HP + playerLevel * 5
  let enemyHp  = ENEMY_BASE_HP  + playerLevel * 3
  const maxEnemyHp = enemyHp
  const rounds: CombatRound[] = []

  for (let r = 1; r <= MAX_ROUNDS; r++) {
    const pDmg = Math.floor(Math.random() * 20 + playerLevel * 2 + 5)
    const eDmg = Math.floor(Math.random() * 15 + 5)
    enemyHp  = Math.max(0, enemyHp  - pDmg)
    playerHp = Math.max(0, playerHp - eDmg)
    rounds.push({
      round: r,
      playerDamage: pDmg,
      enemyDamage:  eDmg,
      playerHpAfter: playerHp,
      enemyHpAfter:  enemyHp,
    })
    if (enemyHp <= 0 || playerHp <= 0) break
  }

  const won = enemyHp <= 0
  const damageDealt = maxEnemyHp - enemyHp

  return {
    won,
    rounds,
    xpEarned:     won
      ? Math.min(500 + playerLevel * 10, 10_000)
      : Math.max(10, Math.floor(damageDealt / maxEnemyHp * 100)),
    tokensEarned: won
      ? Math.min(100 + playerLevel * 5, 3_000)
      : 0,
  }
}
