// What a battle says happened (R32.3).
//
// Events are the engine's **output contract**. A HUD, a log, an animation, a
// server relaying to clients and a test all read these and nothing else — in
// particular, nobody parses a sentence. The prototype logged Spanish strings
// and every consumer ended up matching on them; that is the mistake this
// replaces. Wording belongs to the UI, which R32.3 does not have.
//
// Plain data, JSON-safe, and every event carries `seq` and `atMs` so a stream
// can be ordered, deduplicated and compared to another run byte for byte.
// Deterministic replay is asserted on *events*, not only on the final state:
// two runs that end the same way having told different stories are not the
// same battle.

import type { MajorStatus } from '../../pokemon/model'
import type { BallSpec, ItemEffect, StageKey } from './state'

interface EventBase {
  readonly seq: number
  readonly atMs: number
}

/** Why a move did not run. Never a silent no-op. */
export type MoveRefusal =
  | { readonly kind: 'noPp' }
  | { readonly kind: 'unknownMove' }
  | { readonly kind: 'notLearnt' }
  | { readonly kind: 'deferred'; readonly reason: string }
  | { readonly kind: 'noTarget' }

export type BattleEvent =
  /** A combatant's Action Bar filled: it is about to act. */
  | (EventBase & { readonly type: 'ACTION_READY'; readonly combatantId: string })
  /** What it decided to do, after the selection and the fallbacks. */
  | (EventBase & {
      readonly type: 'ACTION_STARTED'
      readonly combatantId: string
      readonly action: 'move' | 'switch' | 'item' | 'capture' | 'struggle'
    })
  | (EventBase & {
      readonly type: 'MOVE_USED'
      readonly combatantId: string
      readonly moveId: number
      readonly targetId: string | null
      readonly hits: number
    })
  | (EventBase & { readonly type: 'MOVE_MISSED'; readonly combatantId: string; readonly moveId: number })
  | (EventBase & {
      readonly type: 'MOVE_REFUSED'
      readonly combatantId: string
      readonly moveId: number
      readonly refusal: MoveRefusal
    })
  | (EventBase & {
      readonly type: 'DAMAGE'
      readonly combatantId: string
      readonly sourceId: string | null
      readonly amount: number
      readonly remainingHp: number
      readonly critical: boolean
      /** 0, 0.25, 0.5, 1, 2 or 4. */
      readonly effectiveness: number
      /** Which hit of a multi-hit move this was; 1 for a single hit. */
      readonly hit: number
      readonly cause: 'move' | 'recoil' | 'confusion' | 'status'
    })
  | (EventBase & {
      readonly type: 'HEAL'
      readonly combatantId: string
      readonly amount: number
      readonly remainingHp: number
      readonly cause: 'move' | 'drain' | 'item'
    })
  | (EventBase & {
      readonly type: 'PP_CHANGED'
      readonly combatantId: string
      readonly moveId: number
      readonly remaining: number
      readonly max: number
    })
  | (EventBase & {
      readonly type: 'STATUS_APPLIED'
      readonly combatantId: string
      readonly status: MajorStatus
      readonly sourceId: string | null
    })
  | (EventBase & {
      readonly type: 'STATUS_FAILED'
      readonly combatantId: string
      readonly status: MajorStatus | 'confusion'
      readonly reason: 'alreadyHasMajorStatus' | 'alreadyConfused' | 'missed' | 'fainted'
    })
  | (EventBase & {
      readonly type: 'STATUS_TICK'
      readonly combatantId: string
      readonly status: MajorStatus
      readonly damage: number
      readonly remainingHp: number
    })
  | (EventBase & { readonly type: 'STATUS_ENDED'; readonly combatantId: string; readonly status: MajorStatus })
  | (EventBase & { readonly type: 'CONFUSION_APPLIED'; readonly combatantId: string; readonly durationMs: number })
  | (EventBase & { readonly type: 'CONFUSION_SELF_HIT'; readonly combatantId: string; readonly damage: number })
  | (EventBase & { readonly type: 'CONFUSION_ENDED'; readonly combatantId: string })
  | (EventBase & { readonly type: 'PROTECT_GAINED'; readonly combatantId: string; readonly charges: number })
  | (EventBase & {
      readonly type: 'PROTECT_BLOCKED'
      readonly combatantId: string
      readonly sourceId: string
      readonly moveId: number
      readonly chargesLeft: number
    })
  /** The last charge went: the shield is down and the next cooldown is longer. */
  | (EventBase & { readonly type: 'PROTECT_EXPIRED'; readonly combatantId: string })
  | (EventBase & {
      readonly type: 'STAT_STAGE_CHANGED'
      readonly combatantId: string
      readonly stat: StageKey
      readonly delta: number
      readonly stage: number
    })
  | (EventBase & {
      readonly type: 'SWITCHED'
      readonly sideId: string
      readonly outgoingId: string
      readonly incomingId: string
    })
  | (EventBase & {
      readonly type: 'ITEM_USED'
      readonly combatantId: string
      readonly targetId: string
      readonly item: ItemEffect
      readonly worked: boolean
    })
  | (EventBase & {
      readonly type: 'CAPTURE_ATTEMPT'
      readonly combatantId: string
      readonly targetId: string
      readonly ball: BallSpec
      readonly chance: number
      readonly shakes: number
    })
  | (EventBase & { readonly type: 'CAPTURE_SUCCESS'; readonly targetId: string })
  | (EventBase & { readonly type: 'CAPTURE_FAILED'; readonly targetId: string })
  | (EventBase & { readonly type: 'FAINTED'; readonly combatantId: string })
  | (EventBase & { readonly type: 'BATTLE_ENDED'; readonly winningSideId: string | null; readonly reason: 'faint' | 'capture' })
  /** A command the rules would not take. The state is returned untouched. */
  | (EventBase & { readonly type: 'COMMAND_REJECTED'; readonly reason: string })

export type BattleEventType = BattleEvent['type']
