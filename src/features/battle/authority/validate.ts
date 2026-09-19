// Where untrusted stops (R32.4).
//
// Everything above this file is `unknown`: a JSON blob a socket handed us,
// written by code we do not control, on a machine we do not control, by
// someone who may be reading our source. Everything below it is a typed
// `TransportAction`. The only way across is this function, and it is a
// **whitelist**: every field of the result is copied out by name.
//
//     const action = payload as TransportAction   // never
//
// A cast is a promise the compiler believes and the network does not keep. The
// whitelist also settles §29's "client-supplied damage/RNG is ignored" without
// a single branch about it: a payload carrying `damage`, `seed`, `cursor`,
// `serverTimeMs` or `revision` validates to exactly the same action as the
// same payload without them, because nothing reads those names.
//
// This file is **pure and context-free**: shape only. Whether the sender
// commands that combatant, whether the target exists, whether the battle is
// over — all of that needs the battle and lives in `authority.ts`. Keeping
// them apart means the shape checks are testable without a battle at all, and
// R30's `protocol/messages.js` is the same idea one release earlier.

import { parseActionId } from './actionId'
import type { BattleIntent, BattleIntentItem, RejectionReason, TransportAction } from './protocol'
import { REJECTION } from './protocol'

export type ValidationResult =
  | { readonly ok: true; readonly action: TransportAction }
  | { readonly ok: false; readonly reason: RejectionReason; readonly detail: string }

/** Ids are short opaque strings. A megabyte of them is not an id, it is a payload. */
const MAX_ID_LENGTH = 128

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readId = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH ? value : null

/**
 * A catalog id: a whole number inside a sane range.
 *
 * `Number.isSafeInteger` alone would accept `1e15`, and a bound alone would
 * accept `4.5`. Both, plus the sign, is what keeps a negative move id, a
 * `NaN`, an `Infinity` and a float out of the rules — where a lookup would
 * simply miss and the failure would surface three layers away.
 */
const readCatalogId = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 1_000_000
    ? value
    : null

const fail = (reason: RejectionReason, detail: string): ValidationResult =>
  ({ ok: false, reason, detail })

function readItem(value: unknown): BattleIntentItem | null {
  if (!isRecord(value)) return null
  const itemId = readId(value.itemId)
  if (!itemId) return null
  if (value.moveId === undefined) return { itemId }
  const moveId = readCatalogId(value.moveId)
  return moveId === null ? null : { itemId, moveId }
}

function readIntent(value: unknown): BattleIntent | 'malformed' | 'unknown' {
  if (!isRecord(value)) return 'malformed'
  const combatantId = readId(value.combatantId)
  switch (value.kind) {
    case 'useMove': {
      const moveId = readCatalogId(value.moveId)
      if (!combatantId || moveId === null) return 'malformed'
      if (value.targetId === undefined) return { kind: 'useMove', combatantId, moveId }
      const targetId = readId(value.targetId)
      return targetId ? { kind: 'useMove', combatantId, moveId, targetId } : 'malformed'
    }
    case 'switch': {
      const incomingId = readId(value.incomingId)
      if (!combatantId || !incomingId) return 'malformed'
      return { kind: 'switch', combatantId, incomingId }
    }
    case 'useItem': {
      const targetId = readId(value.targetId)
      const item = readItem(value.item)
      if (!combatantId || !targetId || !item) return 'malformed'
      return { kind: 'useItem', combatantId, targetId, item }
    }
    case 'capture': {
      const targetId = readId(value.targetId)
      const ballId = readId(value.ballId)
      if (!combatantId || !targetId || !ballId) return 'malformed'
      return { kind: 'capture', combatantId, targetId, ballId }
    }
    case 'clearSelection': {
      if (!combatantId) return 'malformed'
      return { kind: 'clearSelection', combatantId }
    }
    default:
      // Including `advanceTime`, which a client may not ask for at any price:
      // the clock is the server's (`clock.ts`).
      return typeof value.kind === 'string' ? 'unknown' : 'malformed'
  }
}

/**
 * Reads a submission off the wire.
 *
 * Order matters for the diagnostics, not for safety: the `actionId` is read
 * first so a rejection can name the action a client is asking about, even when
 * the rest of the payload is rubbish.
 */
export function validateTransportAction(payload: unknown): ValidationResult {
  if (!isRecord(payload)) return fail(REJECTION.INVALID_SCHEMA, 'payload is not an object')
  if (!parseActionId(payload.actionId)) {
    return fail(REJECTION.INVALID_ACTION_ID, 'actionId must be "<controllerId>:<sequence>"')
  }
  const actionId = payload.actionId as string

  const battleId = readId(payload.battleId)
  if (!battleId) return fail(REJECTION.INVALID_SCHEMA, 'battleId is missing or not an id')

  const catalogVersion = readId(payload.catalogVersion)
  const battleRulesVersion = readId(payload.battleRulesVersion)
  if (!catalogVersion || !battleRulesVersion) {
    return fail(REJECTION.INVALID_SCHEMA, 'both versions must travel with every action')
  }

  const intent = readIntent(payload.intent)
  if (intent === 'unknown') return fail(REJECTION.UNKNOWN_ACTION, 'this server does not know that intent')
  if (intent === 'malformed') return fail(REJECTION.INVALID_SCHEMA, 'the intent is not well formed')

  return { ok: true, action: { actionId, battleId, catalogVersion, battleRulesVersion, intent } }
}
