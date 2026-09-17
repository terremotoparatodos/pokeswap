// Move families, and how a turn-based move becomes a realtime one (D0, revised
// for D1 §18–§24).
//
// Ruleset: ORAS / Generation VI (APPROVED). The roster below is small on
// purpose — twelve real moves, one per family the engine has to express. The
// deliverable is the **schema**; filling in hundreds of moves is a data
// problem (BATTLE_DATA_GAP_REPORT.md), not an engine one.
//
// The realtime translation, all APPROVED in D1:
//
//  - the Action Bar replaces turn order, so `priority` is not an ordering any
//    more: a priority move **halves the next cooldown** (§22);
//  - a recharge move **doubles the next cooldown** instead of skipping a turn
//    (§23);
//  - Protect raises a shield that absorbs the next **two offensive actions**
//    and doubles the user's next cooldown (§24);
//  - a spread move (Earthquake, Surf) is **single target in v1** (§18): no
//    friendly fire, no multi-target for the player;
//  - PP, power, accuracy, category, crits, STAB and secondary chances keep
//    their usual meaning.

import type { PokemonTypeName } from './party'

export type MoveCategory = 'physical' | 'special' | 'status'
export type MoveFamily =
  | 'damage' | 'damage+status' | 'status' | 'priority' | 'protect' | 'buff' | 'debuff' | 'recharge'

export type StatKey = 'attack' | 'defense' | 'spAttack' | 'spDefense' | 'speed'

/** Confusion is listed here but is not a major status; see `party.ts`. */
export type InflictedStatus = 'burn' | 'paralysis' | 'poison' | 'freeze' | 'sleep' | 'confusion'

export interface StatChange {
  readonly stat: StatKey
  readonly stages: number
  readonly on: 'self' | 'target'
}

export interface MoveDefinition {
  readonly id: string
  readonly name: string
  readonly type: PokemonTypeName
  readonly category: MoveCategory
  readonly family: MoveFamily
  readonly power: number | null
  readonly accuracy: number | null
  readonly pp: number
  readonly priority: number
  readonly inflicts?: { readonly status: InflictedStatus; readonly chance: number }
  readonly statChanges?: readonly StatChange[]
  /** Offensive actions the shield absorbs, for protect-like moves. */
  readonly protectCharges?: number
  readonly recharges?: boolean
  /** True in ORAS; **single target in PokeSwap v1**. Kept so the data stays honest. */
  readonly spreadInOras?: boolean
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
    description: 'Daño especial con efecto secundario: quema, que en v1 significa Ataque ×0,5.',
  },
  iceBeam: {
    id: 'iceBeam', name: 'Rayo Hielo', type: 'ice', category: 'special', family: 'damage+status',
    power: 90, accuracy: 100, pp: 10, priority: 0,
    inflicts: { status: 'freeze', chance: 0.1 },
    description: 'Congelación adaptada a realtime: no paraliza al Pokémon, le baja el Ataque Especial a la mitad.',
  },
  thunderWave: {
    id: 'thunderWave', name: 'Onda Trueno', type: 'electric', category: 'status', family: 'status',
    power: null, accuracy: 90, pp: 20, priority: 0,
    inflicts: { status: 'paralysis', chance: 1 },
    description: 'Estado puro: en realtime su valor es duplicar el cooldown del rival.',
  },
  toxic: {
    id: 'toxic', name: 'Tóxico', type: 'poison', category: 'status', family: 'status',
    power: null, accuracy: 90, pp: 10, priority: 0,
    inflicts: { status: 'poison', chance: 1 },
    description: 'Veneno: daño residual en su propio reloj, no atado a la velocidad.',
  },
  confuseRay: {
    id: 'confuseRay', name: 'Rayo Confuso', type: 'ghost', category: 'status', family: 'status',
    power: null, accuracy: 100, pp: 10, priority: 0,
    inflicts: { status: 'confusion', chance: 1 },
    description: 'Confusión: no ocupa el slot de estado principal y convive con quemadura o veneno.',
  },
  quickAttack: {
    id: 'quickAttack', name: 'Ataque Rápido', type: 'normal', category: 'physical', family: 'priority',
    power: 40, accuracy: 100, pp: 30, priority: 1,
    description: 'Prioridad: el próximo cooldown se reduce a la mitad, así que encadena rápido.',
  },
  protect: {
    id: 'protect', name: 'Protección', type: 'normal', category: 'status', family: 'protect',
    power: null, accuracy: null, pp: 10, priority: 4, protectCharges: 2,
    description: 'Escudo para las próximas dos acciones ofensivas recibidas; a cambio, tu próximo cooldown se duplica.',
  },
  swordsDance: {
    id: 'swordsDance', name: 'Danza Espada', type: 'normal', category: 'status', family: 'buff',
    power: null, accuracy: null, pp: 20, priority: 0,
    statChanges: [{ stat: 'attack', stages: 2, on: 'self' }],
    description: 'Buff propio hasta el tope de ×2. Cuesta una ventana de acción.',
  },
  growl: {
    id: 'growl', name: 'Gruñido', type: 'normal', category: 'status', family: 'debuff',
    power: null, accuracy: 100, pp: 40, priority: 0,
    statChanges: [{ stat: 'attack', stages: -1, on: 'target' }],
    description: 'Debuff al rival, con piso en ×0,5.',
  },
  bodySlam: {
    id: 'bodySlam', name: 'Golpe Cuerpo', type: 'normal', category: 'physical', family: 'damage+status',
    power: 85, accuracy: 100, pp: 15, priority: 0,
    inflicts: { status: 'paralysis', chance: 0.3 },
    description: 'Daño físico con parálisis frecuente: el estado importa más que el daño.',
  },
  earthquake: {
    id: 'earthquake', name: 'Terremoto', type: 'ground', category: 'physical', family: 'damage',
    power: 100, accuracy: 100, pp: 10, priority: 0, spreadInOras: true,
    description: 'En ORAS golpea a todos; en PokeSwap v1 es objetivo único, sin fuego amigo.',
  },
  hyperBeam: {
    id: 'hyperBeam', name: 'Rayo Carga', type: 'normal', category: 'special', family: 'recharge',
    power: 150, accuracy: 90, pp: 5, priority: 0, recharges: true,
    description: 'Mucho daño a cambio de duplicar el cooldown siguiente: el coste es tiempo, no PP.',
  },
}

export const MOVE_IDS = Object.keys(MOVES)

export const moveById = (id: string): MoveDefinition | null => MOVES[id] ?? null

/** APPROVED (D1 §18): every move resolves against exactly one target in v1. */
export const isSingleTargetInV1 = (): true => true

/** Up to four moves, as the UI shows them. */
export const movesOf = (ids: readonly string[]): MoveDefinition[] =>
  ids.map(moveById).filter((move): move is MoveDefinition => move !== null).slice(0, 4)

/** A move counts as offensive — and so is absorbed by Protect — when it can hurt. */
export const isOffensive = (move: MoveDefinition): boolean =>
  move.power !== null || move.family === 'status' || move.family === 'debuff'
