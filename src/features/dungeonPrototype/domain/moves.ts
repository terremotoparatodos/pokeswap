// Move families, and how a turn-based move becomes a realtime one (D2).
//
// The catalog below is deliberately small: nine real moves chosen because each
// one represents a family the engine has to be able to express. The point of
// this file is the **schema**, not the roster — filling in hundreds of moves is
// a data problem (see BATTLE_DATA_GAP_REPORT.md), not an engine problem.
//
// PROTOTYPE ASSUMPTION — the realtime translation:
//
//  - the Action Bar replaces turn order, so `priority` no longer decides who
//    goes first. It becomes an **early release**: a priority-1 move fires when
//    the bar reaches 85 % instead of 100 %, which keeps Quick Attack's identity
//    (it lands before the other one is ready) without a turn queue;
//  - `recharge` (Hyper Beam) makes the next bar start empty *and* skips one
//    action: the cost is a whole cycle of doing nothing;
//  - Protect becomes a short invulnerability window with the usual diminishing
//    returns on consecutive use;
//  - everything else — power, accuracy, category, PP, secondary chance, stat
//    stages — keeps its normal meaning.

import type { PokemonTypeName } from './party'

export type MoveCategory = 'physical' | 'special' | 'status'
export type MoveFamily =
  | 'damage' | 'damage+status' | 'status' | 'priority' | 'protect' | 'buff' | 'debuff' | 'recharge'

export type StatKey = 'attack' | 'defense' | 'spAttack' | 'spDefense' | 'speed'

export interface StatChange {
  readonly stat: StatKey
  /** Stages, as in the games: −6…+6. */
  readonly stages: number
  /** 'self' or 'target'. */
  readonly on: 'self' | 'target'
}

export interface MoveDefinition {
  readonly id: string
  readonly name: string
  readonly type: PokemonTypeName
  readonly category: MoveCategory
  readonly family: MoveFamily
  /** null for status moves. */
  readonly power: number | null
  /** 0–100, or null for moves that never miss. */
  readonly accuracy: number | null
  readonly pp: number
  /** Turn-based priority, translated to an early bar release. */
  readonly priority: number
  readonly inflicts?: { readonly status: 'burn' | 'paralysis' | 'poison' | 'sleep'; readonly chance: number }
  readonly statChanges?: readonly StatChange[]
  /** Seconds of invulnerability for protect-like moves. */
  readonly protectSeconds?: number
  /** True when the user loses the following action. */
  readonly recharges?: boolean
  readonly description: string
}

export const MOVES: Readonly<Record<string, MoveDefinition>> = {
  tackle: {
    id: 'tackle', name: 'Placaje', type: 'normal', category: 'physical', family: 'damage',
    power: 40, accuracy: 100, pp: 35, priority: 0,
    description: 'Daño físico simple: la línea base contra la que se comparan las demás familias.',
  },
  flamethrower: {
    id: 'flamethrower', name: 'Lanzallamas', type: 'fire', category: 'special', family: 'damage+status',
    power: 90, accuracy: 100, pp: 15, priority: 0,
    inflicts: { status: 'burn', chance: 0.1 },
    description: 'Daño especial con efecto secundario: prueba el cálculo especial y el estado por probabilidad.',
  },
  thunderWave: {
    id: 'thunderWave', name: 'Onda Trueno', type: 'electric', category: 'status', family: 'status',
    power: null, accuracy: 90, pp: 20, priority: 0,
    inflicts: { status: 'paralysis', chance: 1 },
    description: 'Estado puro: no hace daño y en realtime su valor es frenar la barra del rival.',
  },
  quickAttack: {
    id: 'quickAttack', name: 'Ataque Rápido', type: 'normal', category: 'physical', family: 'priority',
    power: 40, accuracy: 100, pp: 30, priority: 1,
    description: 'Prioridad: se libera al 85 % de la barra, así que gana los intercambios ajustados.',
  },
  protect: {
    id: 'protect', name: 'Protección', type: 'normal', category: 'status', family: 'protect',
    power: null, accuracy: null, pp: 10, priority: 4,
    protectSeconds: 1.6,
    description: 'Ventana de invulnerabilidad corta; usarla dos veces seguidas la hace mucho menos fiable.',
  },
  swordsDance: {
    id: 'swordsDance', name: 'Danza Espada', type: 'normal', category: 'status', family: 'buff',
    power: null, accuracy: null, pp: 20, priority: 0,
    statChanges: [{ stat: 'attack', stages: 2, on: 'self' }],
    description: 'Buff propio: cuesta una ventana de acción y se paga en los ciclos siguientes.',
  },
  growl: {
    id: 'growl', name: 'Gruñido', type: 'normal', category: 'status', family: 'debuff',
    power: null, accuracy: 100, pp: 40, priority: 0,
    statChanges: [{ stat: 'attack', stages: -1, on: 'target' }],
    description: 'Debuff al rival: la familia que hay que poder expresar para tanquear a un Alpha.',
  },
  bodySlam: {
    id: 'bodySlam', name: 'Golpe Cuerpo', type: 'normal', category: 'physical', family: 'damage+status',
    power: 85, accuracy: 100, pp: 15, priority: 0,
    inflicts: { status: 'paralysis', chance: 0.3 },
    description: 'Daño físico con estado frecuente: el caso en que el estado importa más que el daño.',
  },
  hyperBeam: {
    id: 'hyperBeam', name: 'Rayo Carga', type: 'normal', category: 'special', family: 'recharge',
    power: 150, accuracy: 90, pp: 5, priority: 0, recharges: true,
    description: 'Mucho daño a cambio de perder la ventana siguiente: el coste es tiempo, no PP.',
  },
}

export const MOVE_IDS = Object.keys(MOVES)

export const moveById = (id: string): MoveDefinition | null => MOVES[id] ?? null

/** How full the bar must be for this move to fire. Priority releases it early. */
export const releaseThreshold = (move: MoveDefinition): number =>
  Math.max(0.5, 1 - Math.max(0, move.priority) * 0.15)

/** Up to four moves, as the UI shows them. */
export const movesOf = (ids: readonly string[]): MoveDefinition[] =>
  ids.map(moveById).filter((move): move is MoveDefinition => move !== null).slice(0, 4)
