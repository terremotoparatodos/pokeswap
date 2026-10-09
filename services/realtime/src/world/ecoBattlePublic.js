/**
 * ECO-BATTLE-SPECTATORS-1 (EXPERIMENTAL, development sandbox only): what the OTHER players of an
 * area may know of a test battle. docs/design/ECO_BATTLE_SPECTATORS_PROPOSAL.md is the proposal.
 *
 * Pure. Every field is copied by name from an explicit whitelist — the snapshot and the events the
 * owner receives are never forwarded whole. What never leaves through here: moves, PP, the owner's
 * selection, every stat but HP and Speed, stages but Speed, joinAck, controller and player ids,
 * action ids and results, and any event type not listed in PUBLIC_EVENT_FIELDS.
 */

/** The two combatants of an ECO test battle (the synthetic player side and the wild one). */
export const PUBLIC_COMBATANTS = Object.freeze(['player-0', 'wild-0'])

/** Event types a spectator draws, and the only fields of each that are sent. */
export const PUBLIC_EVENT_FIELDS = Object.freeze({
  MOVE_USED: Object.freeze(['combatantId', 'moveId', 'targetId', 'hits']),
  MOVE_MISSED: Object.freeze(['combatantId', 'moveId']),
  DAMAGE: Object.freeze(['combatantId', 'sourceId', 'amount', 'remainingHp', 'critical', 'effectiveness', 'hit', 'cause']),
  HEAL: Object.freeze(['combatantId', 'amount', 'remainingHp', 'cause']),
  STATUS_APPLIED: Object.freeze(['combatantId', 'status', 'sourceId']),
  CONFUSION_APPLIED: Object.freeze(['combatantId']),
  PROTECT_GAINED: Object.freeze(['combatantId']),
  PROTECT_BLOCKED: Object.freeze(['combatantId']),
  FAINTED: Object.freeze(['combatantId']),
})

/** The rules values the action bar reads (all public constants of the rules), by name. */
const ACTION_BAR_FIELDS = Object.freeze(['baseSeconds', 'referenceSpeed', 'minSeconds', 'maxSeconds', 'paralysisMultiplier'])
const STAT_STAGE_FIELDS = Object.freeze(['minStage', 'maxStage'])

const pick = (source, fields) => {
  const out = {}
  for (const field of fields) if (source?.[field] !== undefined) out[field] = source[field]
  return out
}

/** One combatant as a spectator sees it: who it is, its HP, status and action bar inputs. */
export function publicCombatant(view) {
  if (!view || typeof view !== 'object') return null
  return {
    speciesId: view.instance?.speciesId ?? null,
    level: view.level ?? null,
    maxHp: view.stats?.hp ?? null,
    currentHp: view.condition?.currentHp ?? view.stats?.hp ?? null,
    majorStatus: view.condition?.majorStatus ?? 'none',
    confused: (view.runtime?.confusionRemainingMs ?? 0) > 0,
    spe: view.stats?.spe ?? null,
    speStage: view.runtime?.stages?.spe ?? 0,
    actionElapsedMs: view.runtime?.actionElapsedMs ?? 0,
    cooldownMultiplier: view.runtime?.cooldownMultiplier ?? 1,
  }
}

/** The events a spectator draws, each reduced to its whitelisted fields; the rest are dropped. */
export function publicEvents(envelopes) {
  const out = []
  for (const envelope of envelopes ?? []) {
    const fields = PUBLIC_EVENT_FIELDS[envelope?.event?.type]
    if (!fields || !Number.isSafeInteger(envelope.sequence)) continue
    out.push({ sequence: envelope.sequence, event: { type: envelope.event.type, ...pick(envelope.event, fields) } })
  }
  return out
}

/**
 * The public view of one battle. `seq`: this battle's public stream counter (strictly increasing per
 * battle; a spectator drops anything at or below the last it took). `snapshot`: the owner's client
 * snapshot, read field by field. `stage`: the server's tiles of the owner and of the wild one when
 * the battle was reserved.
 */
export function publicBattleView({ battleId, encounterId, areaId, seq, stage, snapshot, connected, events = null, ended = null }) {
  const combatants = {}
  for (const id of PUBLIC_COMBATANTS) {
    const view = publicCombatant(snapshot?.combatants?.[id])
    if (view) combatants[id] = view
  }
  const config = snapshot?.config
  return {
    battleId, encounterId, areaId, seq,
    stage: {
      owner: { tx: stage.owner.tx, ty: stage.owner.ty }, wild: { tx: stage.wild.tx, ty: stage.wild.ty },
      // ECO-BATTLE-SCENE-1: the player's Pokémon's tile and both facings, decided by the server.
      ...(stage.pokemon ? { pokemon: { tx: stage.pokemon.tx, ty: stage.pokemon.ty }, pokemonFacing: stage.pokemonFacing, wildFacing: stage.wildFacing } : {}),
    },
    revision: snapshot?.revision ?? 0,
    timeMs: snapshot?.timeMs ?? 0,
    connected: connected === true,
    config: {
      actionBar: pick(config?.actionBar, ACTION_BAR_FIELDS),
      // Stage → multiplier: only small integer stages with numeric values.
      statStages: {
        ...pick(config?.statStages, STAT_STAGE_FIELDS),
        multiplierByStage: Object.fromEntries(Object.entries(config?.statStages?.multiplierByStage ?? {}).filter(([stage, value]) => /^-?\d$/.test(stage) && typeof value === 'number')),
      },
    },
    combatants,
    ...(events ? { events: publicEvents(events) } : {}),
    ...(ended ? { ended: { outcome: ended } } : {}),
  }
}
