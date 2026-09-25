// In-memory reference adapters for the Skills ports.
//
// Two uses, both non-persistent: the tests, and the playtest client session
// whose banner already says progress is not saved. A production adapter must
// honour the same contract with a database transaction (see ports.ts,
// WorkLedger.commitSettlement).

import { SKILL_IDS, type SkillId } from '../domain/skills'
import type { AuthorizedWork, Clock, SkillProgressStore, WorkLedger, WorkSettlement } from './ports'

type XpTable = Record<SkillId, number>

const emptyXp = (): XpTable => Object.fromEntries(SKILL_IDS.map(id => [id, 0])) as XpTable

export interface MemorySkillsStore {
  readonly progress: SkillProgressStore
  readonly ledger: WorkLedger
  /** Item counts granted to a player through settlements. */
  inventoryOf(playerId: string): Readonly<Record<string, number>>
  /** Test/dev seeding only. Never reachable from a settlement path. */
  setXp(playerId: string, skillId: SkillId, xp: number): void
  /** How many settlements this store committed (for idempotency tests). */
  settlementCount(): number
}

export function createMemorySkillsStore(): MemorySkillsStore {
  const xp = new Map<string, XpTable>()
  const inventories = new Map<string, Record<string, number>>()
  const authorizations = new Map<string, AuthorizedWork>()
  const settlements = new Map<string, WorkSettlement>()

  const xpRow = (playerId: string): XpTable => {
    let row = xp.get(playerId)
    if (!row) xp.set(playerId, (row = emptyXp()))
    return row
  }

  const progress: SkillProgressStore = {
    xpOf: playerId => ({ ...xpRow(playerId) }),
  }

  const ledger: WorkLedger = {
    authorization: actionId => authorizations.get(actionId) ?? null,
    recordAuthorization: work => {
      if (authorizations.has(work.actionId) || settlements.has(work.actionId)) return false
      authorizations.set(work.actionId, work)
      return true
    },
    settlement: actionId => settlements.get(actionId) ?? null,
    // The "transaction": check-and-insert, XP and items together, or nothing.
    commitSettlement: settlement => {
      if (settlements.has(settlement.actionId)) return false
      settlements.set(settlement.actionId, settlement)
      authorizations.delete(settlement.actionId)
      const row = xpRow(settlement.playerId)
      row[settlement.skillId] += settlement.xpGained
      const bag = inventories.get(settlement.playerId) ?? {}
      for (const reward of settlement.rewards) bag[reward.itemId] = (bag[reward.itemId] ?? 0) + reward.quantity
      inventories.set(settlement.playerId, bag)
      return true
    },
  }

  return {
    progress,
    ledger,
    inventoryOf: playerId => ({ ...(inventories.get(playerId) ?? {}) }),
    setXp: (playerId, skillId, value) => { xpRow(playerId)[skillId] = Math.max(0, Math.floor(value)) },
    settlementCount: () => settlements.size,
  }
}

/** A clock tests and the playground can move by hand. */
export function createManualClock(start = 0): Clock & { advance(ms: number): void; set(ms: number): void } {
  let now = start
  return { now: () => now, advance: ms => { now += ms }, set: ms => { now = ms } }
}

export const systemClock: Clock = { now: () => Date.now() }
