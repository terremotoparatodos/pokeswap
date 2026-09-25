// The Skills session over the shared world (INTEGRATION-1).
//
// Replaces the pre-WORLD local session: every answer here is the server's.
//   XP, materials, the Pokémon roster  ← player:state (read server-side at join)
//   node state (depleted, working)     ← the WORLD mirror
//   begin a job                        → world:work intent; the server decides
//   the result                         ← world:work:done (one settlement, persisted)
// The client only shows. It cannot grant itself XP, items or levels: it never
// sends any, and the numbers it shows are the ones the server committed.

import type { PlayerStateMessage, WorkDone } from '../../../../services/realtime/src/world/worldProtocol.js'
import { MATERIAL_BY_ID } from '../../skills/domain/materials'
import type { SkillId } from '../../skills/domain/skills'
import { levelForXp } from '../../skills/domain/xpCurve'
import type { Unlock } from '../../skills/domain/roadmap'
import type { SettleResult } from '../../skills/service/skillsService'
import type { WorkerRef } from '../../skills/ui/workerRef'
import type { SkillsSession } from '../../skills/ui/skillsSession'
import type { SharedWorld } from '../../world/state/sharedWorld'

export type { SessionBegin, SkillsSession } from '../../skills/ui/skillsSession'

/** Player-facing words for WORLD's refusals. SKILLS' own refusals arrive with their message. */
const REFUSAL: Readonly<Record<string, string>> = {
  busy: 'Otro Pokémon ya está trabajando acá.',
  depleted: 'Agotado. Vuelve en un rato.',
  'too-far': 'Acercate un poco más.',
  'wrong-area': 'Eso está en otra zona.',
  'not-owner': 'Ese Pokémon no es tuyo.',
  'actor-busy': 'Ya estás trabajando en algo.',
  'pokemon-busy': 'Ese Pokémon ya está trabajando.',
  'in-flight': 'Esperá la respuesta anterior.',
  'duplicate-request': 'Ese pedido ya se envió.',
  'world-loading': 'El mundo todavía se está cargando.',
  'skills-unavailable': 'Skills no está disponible en este servidor.',
  'not-your-plot': 'Esa parcela es de otro jugador.',
  'already-tended': 'Ya cuidaste este cultivo.',
  'choose-crop': 'Elegí qué plantar.',
  'unknown-node': 'Esto no se puede trabajar.',
  unavailable: 'El servidor no respondió. Probá de nuevo.',
  offline: 'Sin conexión con el mundo.',
  timeout: 'El servidor no respondió. Probá de nuevo.',
  disconnected: 'Se cortó la conexión.',
}

export const refusalText = (reason: string, message?: string): string => message ?? REFUSAL[reason] ?? 'No se pudo trabajar.'

interface Summary {
  skillId: SkillId
  xpGained: number
  xpAfter: number
  rewards: { itemId: string; quantity: number; bonus: boolean }[]
  levelBefore: number
  levelAfter: number
  levelUpLine: string | null
  unlocks: Unlock[]
}

export function createWorldSkillsSession(world: SharedWorld, clock: () => number = () => world.serverNow() ?? Date.now()): SkillsSession {
  let xp: Record<SkillId, number> = { woodcutting: 0, mining: 0, farming: 0 }
  let materials: Record<string, number> = {}
  let roster: WorkerRef[] | null = null
  const results = new Map<string, SettleResult | null>()
  const listeners = new Set<() => void>()
  const emit = () => { for (const listener of listeners) listener() }

  world.onPlayerState((state: PlayerStateMessage) => {
    xp = { woodcutting: 0, mining: 0, farming: 0, ...state.xp } as Record<SkillId, number>
    materials = { ...state.materials }
    roster = state.pokemon.map(pokemon => ({ instanceId: String(pokemon.instanceId), speciesId: pokemon.speciesId }))
    emit()
  })
  world.onWorkDone((done: WorkDone) => {
    if (!done.ok) { results.set(done.actionId, null); emit(); return }
    const summary = done.summary as Summary | undefined
    if (!summary || !summary.skillId || !('xpGained' in summary)) { results.set(done.actionId, null); emit(); return }
    xp = { ...xp, [summary.skillId]: summary.xpAfter }
    for (const reward of summary.rewards) materials = { ...materials, [reward.itemId]: (materials[reward.itemId] ?? 0) + reward.quantity }
    results.set(done.actionId, {
      status: 'settled',
      settlement: {
        actionId: done.actionId, playerId: world.playerData?.playerId ?? '', skillId: summary.skillId, outcome: 'completed',
        xpGained: summary.xpGained, rewards: summary.rewards.filter(reward => MATERIAL_BY_ID.has(reward.itemId)) as never,
        levelBefore: summary.levelBefore, levelAfter: summary.levelAfter, xpAfter: summary.xpAfter, settledAt: clock(), rulesVersion: '',
      },
      unlocks: summary.unlocks, levelUpLine: summary.levelUpLine,
    })
    emit()
  })

  return {
    xp: () => xp,
    inventory: () => materials,
    workers: () => roster,
    nodeState(nodeId, resource) {
      const node = world.resources.node(nodeId)
      if (node?.state === 'depleted') {
        return { status: 'depleted', remainingCharges: 0, respawnInSeconds: Math.max(0, Math.ceil(((node.respawnAt ?? 0) - clock()) / 1000)) }
      }
      if (levelForXp(xp[resource.skill] ?? 0) < resource.requiredLevel) return { status: 'locked_level', remainingCharges: 1, respawnInSeconds: 0 }
      return { status: 'available', remainingCharges: 1, respawnInSeconds: 0 }
    },
    async begin(nodeId, worker, cropId = null) {
      const reply = await world.requestWork(nodeId, Number(worker.instanceId), cropId)
      if (!reply.ok) return { allowed: false, message: refusalText(reply.reason, reply.message) }
      return { allowed: true, actionId: reply.actionId, durationMs: reply.endsAt - reply.startedAt }
    },
    result: actionId => (results.has(actionId) ? results.get(actionId)! : undefined),
    cancel: actionId => world.cancelWork(actionId),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
