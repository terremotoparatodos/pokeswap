import type { AuthorityEventEnvelope, ClientBattleSnapshot } from '../../../../src/features/battle/authority'
import type { EcoBattleOutcome, EcoPublicBattle, EcoPublicCombatant, EcoPublicEventEnvelope } from './worldProtocol.js'

// ECO-BATTLE-SPECTATORS-1: types of the public battle view's projection (ecoBattlePublic.js).

export declare const PUBLIC_COMBATANTS: readonly ['player-0', 'wild-0']
export declare const PUBLIC_EVENT_FIELDS: Readonly<Record<string, readonly string[]>>
export declare function publicCombatant(view: unknown): EcoPublicCombatant | null
export declare function publicEvents(envelopes: readonly AuthorityEventEnvelope[] | null | undefined): EcoPublicEventEnvelope[]
export declare function publicBattleView(input: {
  readonly battleId: string
  readonly encounterId: string
  readonly areaId: string
  readonly seq: number
  readonly stage: EcoPublicBattle['stage']
  readonly snapshot: ClientBattleSnapshot | Record<string, unknown> | null
  readonly connected: boolean
  readonly events?: readonly AuthorityEventEnvelope[] | null
  readonly ended?: EcoBattleOutcome | null
}): EcoPublicBattle
