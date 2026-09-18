// The rules engine (R32.3).
//
//     reduceBattle(state, command, context) -> { state, events }
//
// One entry point, pure, with no other way in. The caller holds a state and a
// command and gets a new state and the events that explain it; it never
// reaches inside. That is the whole architectural decision, and it is what
// lets R32.4 put the same module behind a socket without rewriting it: the
// server runs the reducer, the client runs the reducer, and the only question
// left is whose answer counts.
//
// Two properties this file exists to guarantee:
//
//   **Nothing is mutated.** `state` comes back untouched — the same object —
//   whenever a command is refused. A caller can hold on to a state safely.
//
//   **The slicing does not matter.** `ADVANCE_TIME` advances to the next thing
//   that actually happens, not to the end of the delta, so 5 000 ms in one
//   call and a hundred calls of 50 ms produce the same state and the same
//   events. A client animating at 60 fps and a server ticking at 10 Hz agree.
//
// What is deliberately not here: no AI. A combatant with nothing selected
// falls back to what it used last and then to its first usable move (§12), and
// that fallback is a rule, not a decision. Whoever wants a wild Pokémon to
// play well sends it commands.

import { BATTLE_RULES_VERSION } from './version'
import { cooldownMs, msUntilReady } from './actionBar'
import { captureInputFor, resolveCapture } from './capture'
import type { BattleRulesCatalog } from './catalogView'
import type { BattleCommand } from './commands'
import { confusionSelfDamage } from './damage'
import type { BattleEvent } from './events'
import { executeMove, STRUGGLE_MOVE_NAME } from './moveEffects'
import { classifyMove } from './moveSupport'
import { drawChance } from './rng'
import type { BattleCombatant, BattleState, ItemEffect, SelectedAction } from './state'
import {
  activeCombatants, combatantOf, currentHpOf, freshRuntime, isCombatantFainted, opposingActive,
  sideOf, withRuntime,
} from './state'
import {
  applyDamage, applyHeal, applyRevive, emit, remainingPpOf, requireCombatant, restorePp,
  update, executableMoveIds, clearMajorStatus,
} from './transitions'
import type { Working } from './transitions'

export interface BattleContext {
  /** Read-only, shared, and the reason the state stays small. */
  readonly catalog: BattleRulesCatalog
}

export interface BattleTransition {
  readonly state: BattleState
  readonly events: readonly BattleEvent[]
}

/** How many boundaries one `ADVANCE_TIME` may cross before we call it a loop. */
const MAX_STEPS_PER_ADVANCE = 10000

export function reduceBattle(
  state: BattleState, command: BattleCommand, context: BattleContext,
): BattleTransition {
  const working: Working = { state, events: [], catalog: context.catalog, fainted: alreadyFainted(state) }

  const versionProblem = checkVersions(state, context)
  if (versionProblem) return reject(state, context, versionProblem)
  if (state.outcome.kind !== 'ongoing' && command.type !== 'ADVANCE_TIME') {
    return reject(state, context, 'the battle is over')
  }

  switch (command.type) {
    case 'ADVANCE_TIME': {
      if (!Number.isInteger(command.deltaMs) || command.deltaMs <= 0) {
        return reject(state, context, 'deltaMs must be a whole number of milliseconds above zero')
      }
      if (state.outcome.kind !== 'ongoing') return { state, events: [] }
      advanceTime(working, command.deltaMs)
      return { state: working.state, events: working.events }
    }
    case 'CLEAR_SELECTION': {
      const combatant = activeAndAlive(state, command.combatantId)
      if (!combatant) return reject(state, context, 'that Pokémon is not on the field')
      update(working, withRuntime(combatant, { selected: null }))
      return { state: working.state, events: working.events }
    }
    case 'USE_MOVE':
      return select(working, state, context, command.combatantId, () => {
        const combatant = activeAndAlive(state, command.combatantId)
        if (!combatant) return 'that Pokémon is not on the field'
        if (!combatant.instance.moves.some(slot => slot.moveId === command.moveId)) {
          return 'that Pokémon does not know that move'
        }
        if ((remainingPpOf(combatant, command.moveId, context.catalog) ?? 0) <= 0) return 'that move has no PP left'
        // Refused here rather than at the Action Window: a player who picks a
        // move these rules defer is told now, not in three seconds.
        const move = context.catalog.move(command.moveId)
        const verdict = move ? classifyMove(move) : null
        if (!verdict) return 'that move is not in the catalog'
        if (verdict.kind === 'deferred') return `these rules cannot run that move yet: ${verdict.reason}`
        return { kind: 'move', moveId: command.moveId }
      })
    case 'SWITCH': {
      const problem = switchProblem(state, command.combatantId, command.incomingId)
      if (problem) return reject(state, context, problem)
      const outgoing = combatantOf(state, command.combatantId)
      // A fainted Pokémon's bar will never fill again, so its replacement
      // cannot wait for an Action Window: it happens now.
      if (outgoing && isCombatantFainted(outgoing)) {
        performSwitch(working, command.combatantId, command.incomingId)
        checkOutcome(working)
        return { state: working.state, events: working.events }
      }
      return select(working, state, context, command.combatantId,
        () => ({ kind: 'switch', incomingId: command.incomingId }))
    }
    case 'USE_ITEM':
      return select(working, state, context, command.combatantId, () => {
        const user = activeAndAlive(state, command.combatantId)
        if (!user) return 'that Pokémon is not on the field'
        const target = combatantOf(state, command.targetId)
        if (!target || target.sideId !== user.sideId) return 'an item can only be used on your own team'
        const problem = itemProblem(command.item)
        if (problem) return problem
        return { kind: 'item', item: command.item, targetId: command.targetId }
      })
    case 'CAPTURE':
      return select(working, state, context, command.combatantId, () => {
        const user = activeAndAlive(state, command.combatantId)
        if (!user) return 'that Pokémon is not on the field'
        const target = combatantOf(state, command.targetId)
        if (!target) return 'there is nothing to capture'
        if (!target.wild) return 'only a wild Pokémon can be captured'
        if (target.sideId === user.sideId) return 'you cannot capture your own Pokémon'
        if (isCombatantFainted(target)) return 'a fainted Pokémon cannot be captured'
        return { kind: 'capture', targetId: command.targetId, ball: command.ball }
      })
    default:
      return reject(state, context, 'unknown command')
  }
}

// ── Guards ──────────────────────────────────────────────────────────────────

function checkVersions(state: BattleState, context: BattleContext): string | null {
  if (state.battleRulesVersion !== BATTLE_RULES_VERSION) {
    return `battle rules ${state.battleRulesVersion}, this build runs ${BATTLE_RULES_VERSION}`
  }
  if (state.catalogVersion !== context.catalog.catalogVersion) {
    return `catalog ${state.catalogVersion}, this build has ${context.catalog.catalogVersion}`
  }
  return null
}

/**
 * A refused command. The state comes back **by reference**, so a caller that
 * compares with `===` sees that nothing happened, and the rejection is still
 * an event rather than a silent no-op.
 */
function reject(state: BattleState, _context: BattleContext, reason: string): BattleTransition {
  return {
    state,
    events: [{ type: 'COMMAND_REJECTED', reason, seq: state.eventSeq, atMs: state.timeMs }],
  }
}

const alreadyFainted = (state: BattleState): Set<string> =>
  new Set(Object.values(state.combatants).filter(isCombatantFainted).map(c => c.combatantId))

function activeAndAlive(state: BattleState, combatantId: string): BattleCombatant | null {
  const combatant = combatantOf(state, combatantId)
  if (!combatant) return null
  const side = sideOf(state, combatant.sideId)
  if (!side?.activeIds.includes(combatantId)) return null
  return isCombatantFainted(combatant) ? null : combatant
}

function switchProblem(state: BattleState, combatantId: string, incomingId: string): string | null {
  const outgoing = combatantOf(state, combatantId)
  if (!outgoing) return 'that Pokémon is not in this battle'
  const side = sideOf(state, outgoing.sideId)
  if (!side?.activeIds.includes(combatantId)) return 'that Pokémon is not on the field'
  const incoming = combatantOf(state, incomingId)
  if (!incoming || incoming.sideId !== outgoing.sideId) return 'that Pokémon is not on your team'
  if (side.activeIds.includes(incomingId)) return 'that Pokémon is already on the field'
  if (isCombatantFainted(incoming)) return 'a fainted Pokémon cannot be sent in'
  return null
}

function itemProblem(item: ItemEffect): string | null {
  if (item.kind === 'healHp' && !(item.amount > 0)) return 'an item must heal something'
  if (item.kind === 'restorePp' && !(item.amount > 0)) return 'an item must restore something'
  if (item.kind === 'revive' && !(item.hpFraction > 0)) return 'a revive must restore some HP'
  return null
}

/** Shared shape of the four action commands: validate, then set the selection. */
function select(
  working: Working,
  state: BattleState,
  context: BattleContext,
  combatantId: string,
  decide: () => SelectedAction | string,
): BattleTransition {
  const outcome = decide()
  if (typeof outcome === 'string') return reject(state, context, outcome)
  const combatant = combatantOf(state, combatantId)
  if (!combatant) return reject(state, context, 'that Pokémon is not in this battle')
  update(working, withRuntime(combatant, { selected: outcome }))
  return { state: working.state, events: working.events }
}

// ── The clock ───────────────────────────────────────────────────────────────

function advanceTime(working: Working, deltaMs: number): void {
  let left = deltaMs
  let steps = 0
  resolveDue(working)
  while (left > 0 && working.state.outcome.kind === 'ongoing' && steps < MAX_STEPS_PER_ADVANCE) {
    steps += 1
    const step = Math.min(left, nextBoundaryMs(working))
    tickClock(working, step)
    left -= step
    resolveDue(working)
  }
}

/** How long until the next thing happens, in ms. At least 1, so time always moves. */
function nextBoundaryMs(working: Working): number {
  const config = working.state.config
  let soonest = Number.POSITIVE_INFINITY
  for (const combatant of activeCombatants(working.state)) {
    if (isCombatantFainted(combatant)) continue
    const status = combatant.condition.majorStatus
    if (status === 'sleep') soonest = Math.min(soonest, combatant.runtime.sleepRemainingMs)
    else soonest = Math.min(soonest, msUntilReady(combatant, config))
    if (combatant.runtime.confusionRemainingMs > 0) {
      soonest = Math.min(soonest, combatant.runtime.confusionRemainingMs)
    }
    if (status === 'poison' || status === 'badlyPoisoned') {
      soonest = Math.min(soonest, Math.max(0, combatant.runtime.nextPoisonTickMs - working.state.timeMs))
    }
  }
  return Number.isFinite(soonest) ? Math.max(1, Math.ceil(soonest)) : Number.POSITIVE_INFINITY
}

/**
 * Moves every clock forward by `step`, and nothing else: no action resolves
 * here. Separating the two is what makes the engine indifferent to how the
 * caller slices its deltas.
 */
function tickClock(working: Working, step: number): void {
  working.state = { ...working.state, timeMs: working.state.timeMs + step }
  for (const snapshot of activeCombatants(working.state)) {
    const combatant = requireCombatant(working, snapshot.combatantId)
    if (!combatant || isCombatantFainted(combatant)) continue

    if (combatant.runtime.confusionRemainingMs > 0) {
      const left = Math.max(0, combatant.runtime.confusionRemainingMs - step)
      update(working, withRuntime(combatant, { confusionRemainingMs: left }))
      if (left === 0) emit(working, { type: 'CONFUSION_ENDED', combatantId: combatant.combatantId })
    }

    const current = requireCombatant(working, snapshot.combatantId)
    if (!current) continue
    if (current.condition.majorStatus === 'sleep') {
      // Sleep eats Action Windows: the bar does not move at all while it lasts.
      const left = Math.max(0, current.runtime.sleepRemainingMs - step)
      update(working, withRuntime(current, { sleepRemainingMs: left }))
      if (left === 0) clearMajorStatus(working, current.combatantId)
      continue
    }
    update(working, withRuntime(current, { actionElapsedMs: current.runtime.actionElapsedMs + step }))
  }
}

/**
 * Everything that is due at the current instant.
 *
 * Residual damage first, then Action Windows. The order matters when both land
 * on the same millisecond, and it is fixed so a replay cannot disagree: poison
 * that would faint a Pokémon takes it out before it gets to act.
 */
function resolveDue(working: Working): void {
  const config = working.state.config
  for (const snapshot of activeCombatants(working.state)) {
    let combatant = requireCombatant(working, snapshot.combatantId)
    if (!combatant) continue
    const status = combatant.condition.majorStatus
    if (status !== 'poison' && status !== 'badlyPoisoned') continue
    let guard = 0
    while (
      combatant && !isCombatantFainted(combatant)
      && working.state.timeMs >= combatant.runtime.nextPoisonTickMs
      && guard++ < 1000
    ) {
      update(working, withRuntime(combatant, {
        nextPoisonTickMs: combatant.runtime.nextPoisonTickMs + config.status.poisonTickMs,
      }))
      const damage = Math.max(1, Math.floor(combatant.stats.hp * config.status.poisonFraction))
      applyDamage(working, combatant.combatantId, damage, 'status', { status })
      combatant = requireCombatant(working, snapshot.combatantId)
    }
  }
  // The battle can already be over here: residual damage that faints the last
  // Pokémon standing ends it before anybody gets an Action Window.
  checkOutcome(working)

  for (const snapshot of activeCombatants(working.state)) {
    if (working.state.outcome.kind !== 'ongoing') return
    const combatant = requireCombatant(working, snapshot.combatantId)
    if (!combatant || isCombatantFainted(combatant)) continue
    if (combatant.condition.majorStatus === 'sleep') continue
    if (combatant.runtime.actionElapsedMs < cooldownMs(combatant, config)) continue
    resolveActionWindow(working, combatant.combatantId)
    // Checked after every window, not once at the end of the delta: otherwise a
    // battle decided mid-delta would keep resolving actions, and then the same
    // battle would differ depending on how the caller sliced its clock.
    checkOutcome(working)
  }
}

// ── One Action Window ───────────────────────────────────────────────────────

function resolveActionWindow(working: Working, combatantId: string): void {
  const combatant = requireCombatant(working, combatantId)
  if (!combatant) return
  emit(working, { type: 'ACTION_READY', combatantId })
  // The window is spent the moment it opens, whatever it ends up being used
  // for, and the multiplier the last action left behind is spent with it.
  update(working, withRuntime(combatant, { actionElapsedMs: 0, cooldownMultiplier: 1 }))

  if (resolveConfusion(working, combatantId)) return

  const current = requireCombatant(working, combatantId)
  if (!current) return
  const selected = current.runtime.selected

  if (selected && selected.kind !== 'move') {
    update(working, withRuntime(current, { selected: null }))
    if (selected.kind === 'switch') {
      emit(working, { type: 'ACTION_STARTED', combatantId, action: 'switch' })
      performSwitch(working, combatantId, selected.incomingId)
    } else if (selected.kind === 'item') {
      emit(working, { type: 'ACTION_STARTED', combatantId, action: 'item' })
      performItem(working, combatantId, selected.targetId, selected.item)
    } else {
      emit(working, { type: 'ACTION_STARTED', combatantId, action: 'capture' })
      performCapture(working, combatantId, selected.targetId, selected.ball)
    }
    return
  }

  const choice = chooseMove(working, combatantId, selected?.kind === 'move' ? selected.moveId : null)
  if (!choice) return
  emit(working, { type: 'ACTION_STARTED', combatantId, action: choice.struggle ? 'struggle' : 'move' })
  executeMove(working, combatantId, choice.moveId, choice.struggle)
}

/**
 * A confused Pokémon may spend its window hitting itself instead (§26).
 * Confusion sits beside a major status: a burnt, confused Pokémon is both.
 */
function resolveConfusion(working: Working, combatantId: string): boolean {
  const combatant = requireCombatant(working, combatantId)
  if (!combatant || combatant.runtime.confusionRemainingMs <= 0) return false
  const roll = drawChance(working.state.rng, working.state.config.confusion.selfHitChance)
  working.state = { ...working.state, rng: roll.rng }
  if (!roll.value) return false
  applyDamage(working, combatantId, confusionSelfDamage(combatant, working.state.config), 'confusion')
  return true
}

/**
 * The approved fallback chain (§12, §22): what is selected, then what it used
 * last, then its first move with PP, and when every slot is empty, Struggle.
 *
 * A selected move that has run out of PP falls through instead of stalling the
 * fight — a Pokémon always does something.
 */
function chooseMove(
  working: Working, combatantId: string, selectedMoveId: number | null,
): { moveId: number; struggle: boolean } | null {
  const combatant = requireCombatant(working, combatantId)
  if (!combatant) return null
  // PP **and** a rule that can run it. A move R32.3 defers is not a move this
  // Pokémon can use, and treating it as one would leave it standing there with
  // a full bar every single window.
  const usable = executableMoveIds(combatant, working.catalog)

  if (selectedMoveId !== null && usable.includes(selectedMoveId)) {
    return { moveId: selectedMoveId, struggle: false }
  }
  const last = combatant.runtime.lastMoveId
  if (last !== null && usable.includes(last)) return { moveId: last, struggle: false }
  if (usable.length > 0) return { moveId: usable[0], struggle: false }

  const struggle = working.catalog.moveNamed(STRUGGLE_MOVE_NAME)
  if (!struggle) return null
  return { moveId: struggle.id, struggle: true }
}

// ── The three non-move actions ──────────────────────────────────────────────

/**
 * Approved switch rules (§27): the outgoing Pokémon keeps its condition — HP,
 * PP, major status — and loses every temporary thing it had. The incoming one
 * keeps its own condition and starts its Action Bar at zero.
 */
function performSwitch(working: Working, outgoingId: string, incomingId: string): void {
  const outgoing = requireCombatant(working, outgoingId)
  const incoming = requireCombatant(working, incomingId)
  if (!outgoing || !incoming) return
  const side = sideOf(working.state, outgoing.sideId)
  if (!side) return

  update(working, { ...outgoing, runtime: freshRuntime(outgoing.instance.formId) })
  const poisoned = incoming.condition.majorStatus === 'poison' || incoming.condition.majorStatus === 'badlyPoisoned'
  update(working, {
    ...incoming,
    runtime: {
      ...freshRuntime(incoming.instance.formId),
      actionElapsedMs: working.state.config.switching.incomingStartsAtZeroBar ? 0 : incoming.runtime.actionElapsedMs,
      sleepRemainingMs: incoming.condition.majorStatus === 'sleep' ? working.state.config.status.sleepMs : 0,
      nextPoisonTickMs: poisoned ? working.state.timeMs + working.state.config.status.poisonTickMs : 0,
    },
  })
  working.state = {
    ...working.state,
    sides: working.state.sides.map(entry => entry.sideId === side.sideId
      ? { ...entry, activeIds: entry.activeIds.map(id => (id === outgoingId ? incomingId : id)) }
      : entry),
  }
  emit(working, { type: 'SWITCHED', sideId: side.sideId, outgoingId, incomingId })
}

function performItem(working: Working, userId: string, targetId: string, item: ItemEffect): void {
  let worked = false
  if (item.kind === 'healHp') worked = applyHeal(working, targetId, item.amount, 'item') > 0
  else if (item.kind === 'restorePp') worked = restorePp(working, targetId, item.moveId, item.amount) > 0
  else worked = applyRevive(working, targetId, item.hpFraction)
  emit(working, { type: 'ITEM_USED', combatantId: userId, targetId, item, worked })
}

/**
 * A throw. R32.3 answers **whether the ball worked** and nothing else: there
 * is no ownership here, no instance is created and nothing is persisted. What
 * happens to a caught Pokémon is I-1, and it belongs to the server.
 */
function performCapture(
  working: Working, userId: string, targetId: string, ball: { id: string; bonus: number },
): void {
  const target = requireCombatant(working, targetId)
  if (!target) return
  const catchRate = working.catalog.catchRate(target.instance.speciesId) ?? 255
  const result = resolveCapture(
    captureInputFor(target, catchRate, ball), working.state.config, working.state.rng,
  )
  working.state = { ...working.state, rng: result.rng }
  emit(working, {
    type: 'CAPTURE_ATTEMPT', combatantId: userId, targetId, ball, chance: result.chance, shakes: result.shakes,
  })
  if (!result.captured) {
    emit(working, { type: 'CAPTURE_FAILED', targetId })
    return
  }
  emit(working, { type: 'CAPTURE_SUCCESS', targetId })
  working.state = { ...working.state, outcome: { kind: 'captured', combatantId: targetId } }
  emit(working, {
    type: 'BATTLE_ENDED',
    winningSideId: combatantOf(working.state, userId)?.sideId ?? null,
    reason: 'capture',
  })
}

// ── Outcome ─────────────────────────────────────────────────────────────────

/**
 * A side is out when everybody on it has fainted — bench included. Whoever is
 * left wins. Nothing here sends in a replacement: a side with a fainted active
 * and a healthy bench is still in the battle, and putting somebody on the
 * field is a command, not a rule.
 */
function checkOutcome(working: Working): void {
  if (working.state.outcome.kind !== 'ongoing') return
  const standing = working.state.sides.filter(side => side.partyIds.some(id => {
    const combatant = combatantOf(working.state, id)
    return combatant ? !isCombatantFainted(combatant) : false
  }))
  if (standing.length > 1) return
  const winner = standing[0]?.sideId ?? null
  working.state = {
    ...working.state,
    outcome: winner ? { kind: 'decided', winningSideId: winner } : { kind: 'decided', winningSideId: '' },
  }
  emit(working, { type: 'BATTLE_ENDED', winningSideId: winner, reason: 'faint' })
}

// ── Small helpers a caller wants and should not re-derive ───────────────────

/** The enemy a combatant would hit right now, under the 1-vs-1 baseline. */
export const currentTargetOf = (state: BattleState, combatantId: string): BattleCombatant | null =>
  opposingActive(state, combatantId)

/** HP, for a HUD that should not have to know that `null` means full. */
export const hpOf = currentHpOf
