// What can be asked of a battle (R32.3).
//
// A command is an **intention**, not a mutation: the caller never writes into
// `BattleState`. R30 already proved the shape — the client sends what it wants
// and the server derives the state — and R32.4 needs exactly this seam to move
// the engine behind the network without rewriting it.
//
// The four action commands do **not** execute on arrival. They set what the
// combatant will do when its Action Bar completes, which is what "spends an
// Action Window" means in a game with no turns (§27, §29): choosing to switch
// costs the same window that attacking would have. `ADVANCE_TIME` is the only
// command that resolves anything, and it is the only clock the rules have.
//
// A move selection **persists**: while it is selected the combatant keeps
// using it every window (approved auto-repeat, §12). A switch, an item and a
// capture are one-shot, and after they resolve the combatant falls back to the
// move it used last.

import type { BallSpec, ItemEffect } from './state'

export type BattleCommand =
  /** Select a move for the next Action Window, and for the ones after it. */
  | { readonly type: 'USE_MOVE'; readonly combatantId: string; readonly moveId: number }
  /** Bring in a benched Pokémon when this window completes. */
  | { readonly type: 'SWITCH'; readonly combatantId: string; readonly incomingId: string }
  /** Spend an Action Window on an item. R32.3 knows the effect, not the inventory. */
  | {
      readonly type: 'USE_ITEM'
      readonly combatantId: string
      readonly targetId: string
      readonly item: ItemEffect
    }
  /** Throw a ball at a wild target when this window completes. */
  | {
      readonly type: 'CAPTURE'
      readonly combatantId: string
      readonly targetId: string
      readonly ball: BallSpec
    }
  /** Forget what was selected and fall back to auto-repeat. */
  | { readonly type: 'CLEAR_SELECTION'; readonly combatantId: string }
  /**
   * Move the battle clock forward by whole milliseconds.
   *
   * The result does not depend on how the caller slices it: one call of
   * 5 000 ms and a hundred calls of 50 ms produce the same state and the same
   * events, because the engine advances to the next thing that happens rather
   * than to the end of the delta. That is what makes a client's animation
   * cadence and a server's tick rate interchangeable (R32.4).
   */
  | { readonly type: 'ADVANCE_TIME'; readonly deltaMs: number }

export type BattleCommandType = BattleCommand['type']
