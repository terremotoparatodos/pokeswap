// What the Skills UI needs from a session (INTEGRATION-1).
//
// The UI draws and asks; the session answers. Since INTEGRATION-1 the only
// implementation is the shared-world one (src/features/worldSkills/client),
// where every answer is the server's: the pre-WORLD local session was retired.

import type { ResourceDefinition } from '../domain/resources'
import type { SkillId } from '../domain/skills'
import type { NodeState } from '../scene/nodeTarget'
import type { SettleResult } from '../service/skillsService'
import type { WorkerRef } from './workerRef'

export type SessionBegin =
  // SKILLS PROB-2: no duration. The server alone knows when the action ends;
  // `startedAt` (server clock) only puts the animation on the shared beat.
  | { readonly allowed: true; readonly actionId: string; readonly startedAt: number }
  | { readonly allowed: false; readonly message: string }

export interface SkillsSession {
  xp(): Readonly<Record<SkillId, number>>
  inventory(): Readonly<Record<string, number>>
  /** The player's own Pokémon, from the server. Null until the server has said. */
  workers(): readonly WorkerRef[] | null
  nodeState(nodeId: string, resource: ResourceDefinition): NodeState
  begin(nodeId: string, worker: WorkerRef, cropId?: string | null): Promise<SessionBegin>
  /** undefined: still running; null: it ended without a reward. */
  result(actionId: string): SettleResult | null | undefined
  cancel(actionId: string): void
  subscribe(listener: () => void): () => void
}
