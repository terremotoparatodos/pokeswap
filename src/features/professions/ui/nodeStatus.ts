// Node interaction states shown by the UI, derived from R31-A checks.
//
// The resolver reports one rejection at a time. The UI also needs states the
// resolver does not know about (personal depletion, inventory space and the
// local action timeline), so they are merged here in a fixed priority.

import { PROFESSIONS } from '../domain/catalog/professions'
import type { GatheringCheck } from '../domain/gathering'
import type { AccessTag, GatheringNodeDefinition, GatheringRejection, ToolKind } from '../domain/types'

export type NodeStatus =
  | 'available' | 'in_progress' | 'cooldown' | 'success' | 'rare_drop'
  | 'locked_level' | 'locked_access' | 'wrong_biome'
  | 'no_tool' | 'tool_tier' | 'tool_broken'
  | 'no_energy' | 'depleted' | 'inventory_full'

/** Local action timeline of the prototype (server timing in R32+). */
export type NodePhase = 'idle' | 'working' | 'cooldown' | 'success' | 'rare'

export type StatusTone = 'ready' | 'busy' | 'good' | 'rare' | 'blocked' | 'warn'

const REJECTION_STATUS: Readonly<Record<GatheringRejection, NodeStatus>> = {
  level_too_low: 'locked_level',
  wrong_biome: 'wrong_biome',
  access_required: 'locked_access',
  tool_required: 'no_tool',
  tool_broken: 'tool_broken',
  tool_tier_too_low: 'tool_tier',
  insufficient_energy: 'no_energy',
}

export function statusForRejection(reason: GatheringRejection): NodeStatus {
  return REJECTION_STATUS[reason]
}

export interface NodeStatusInput {
  readonly check: GatheringCheck
  readonly remainingCharges: number
  /**
   * The guaranteed part of the reward fits the inventory (R31-C1 slots and
   * stacks). Extra units that do not fit go to a visible pending pouch.
   */
  readonly inventoryFits: boolean
  readonly phase: NodePhase
}

/**
 * Priority: timeline → hard requirements (level, biome, access, tool) →
 * personal depletion → inventory space → energy. Energy is last because the
 * other blockers are more useful to know about first.
 */
export function resolveNodeStatus(input: NodeStatusInput): NodeStatus {
  switch (input.phase) {
    case 'working': return 'in_progress'
    case 'success': return 'success'
    case 'rare': return 'rare_drop'
    case 'cooldown': return 'cooldown'
    case 'idle': break
  }
  if (!input.check.ok && input.check.reason !== 'insufficient_energy') return statusForRejection(input.check.reason)
  if (input.remainingCharges <= 0) return 'depleted'
  if (!input.inventoryFits) return 'inventory_full'
  if (!input.check.ok) return 'no_energy'
  return 'available'
}

export const ACCESS_LABEL: Readonly<Record<AccessTag, string>> = {
  hardRock: 'Roca dura: Roca, Tierra, Acero o Lucha con Ataque 80+',
  deepWater: 'Aguas profundas: Agua con PS 50+',
  frozenGround: 'Suelo helado: Hielo, Fuego o Acero',
}

export const TOOL_KIND_LABEL: Readonly<Record<ToolKind, string>> = { pickaxe: 'pico', axe: 'hacha', rod: 'caña', sickle: 'hoz' }
/** Spanish agreement per tool noun ("un hacha" keeps "un" before stressed a-). */
const TOOL_GRAMMAR: Readonly<Record<ToolKind, { article: string; broken: string; it: string }>> = {
  pickaxe: { article: 'un', broken: 'roto', it: 'Reparalo' },
  axe: { article: 'un', broken: 'rota', it: 'Reparala' },
  rod: { article: 'una', broken: 'rota', it: 'Reparala' },
  sickle: { article: 'una', broken: 'rota', it: 'Reparala' },
}

export function formatCountdown(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

export interface StatusContext {
  readonly node: GatheringNodeDefinition
  readonly level: number
  readonly respawnInSeconds: number
  readonly energyNeeded: number | null
  readonly energyHave: number
}

export interface NodeStatusView {
  readonly tone: StatusTone
  readonly title: string
  readonly detail: string
  /** The primary action button is enabled. */
  readonly canAct: boolean
}

export function describeNodeStatus(status: NodeStatus, context: StatusContext): NodeStatusView {
  const { node } = context
  const profession = PROFESSIONS[node.profession]
  const tool = TOOL_KIND_LABEL[profession.toolKind]
  switch (status) {
    case 'available': return { tone: 'ready', title: 'Listo para recolectar', detail: '', canAct: true }
    case 'in_progress': return { tone: 'busy', title: 'Recolectando…', detail: '', canAct: false }
    case 'cooldown': return { tone: 'busy', title: 'Recuperando el ritmo', detail: 'Pausa breve entre acciones', canAct: false }
    case 'success': return { tone: 'good', title: 'Recolección completada', detail: '', canAct: false }
    case 'rare_drop': return { tone: 'rare', title: '¡Hallazgo raro!', detail: '', canAct: false }
    case 'locked_level': return { tone: 'blocked', title: `Requiere ${profession.name} Nv. ${node.requiredLevel}`, detail: `Tenés Nv. ${context.level}`, canAct: false }
    case 'locked_access': return {
      tone: 'blocked', title: 'Tu Pokémon no puede llegar', detail: node.requiredAccess ? ACCESS_LABEL[node.requiredAccess] : '', canAct: false,
    }
    case 'wrong_biome': return { tone: 'blocked', title: 'No crece en este bioma', detail: '', canAct: false }
    case 'no_tool': return { tone: 'blocked', title: `Necesitás ${TOOL_GRAMMAR[profession.toolKind].article} ${tool}`, detail: `Tier ${node.minToolTier} o superior`, canAct: false }
    case 'tool_tier': return { tone: 'blocked', title: `Tu ${tool} no alcanza`, detail: `Tier ${node.minToolTier} o superior`, canAct: false }
    case 'tool_broken': return { tone: 'warn', title: `Tu ${tool} está ${TOOL_GRAMMAR[profession.toolKind].broken}`, detail: `${TOOL_GRAMMAR[profession.toolKind].it} para seguir`, canAct: false }
    case 'no_energy': return {
      tone: 'warn', title: 'Te falta energía',
      detail: context.energyNeeded === null ? `Tenés ${Math.floor(context.energyHave)}` : `Necesitás ${context.energyNeeded}; tenés ${Math.floor(context.energyHave)}`,
      canAct: false,
    }
    case 'depleted': return { tone: 'warn', title: 'Agotado para vos', detail: `Se recupera en ${formatCountdown(context.respawnInSeconds)}`, canAct: false }
    case 'inventory_full': return { tone: 'warn', title: 'Inventario lleno', detail: 'Liberá espacio para seguir', canAct: false }
  }
}
