// Co-op rules for one expedition (D1 §37–§41).
//
// APPROVED, all of it:
//  - normal combats are **personal**: the Pokémon one member engages is busy
//    for everyone else, who keep exploring and fighting their own;
//  - only the Alpha is cooperative content;
//  - the Floor Key belongs to the **expedition**, not to a player: whoever
//    finds it unlocks the exit for the group;
//  - nobody is teleported: advancing a floor asks for a **ready check**;
//  - retreating is **individual** — you leave with your loot, the rest carry on;
//  - a player whose six Pokémon are down is out of the fight but does not end
//    the expedition; teammates may still revive them while they are inside;
//  - the global wipe is only when **every remaining member** has nothing left.
//
// No networking: the other players are local slots. SERVER AUTHORITY: all of
// it, eventually — especially the ready check and the shared key.

import { isFainted, type PokemonInstance } from './party'

export type MemberStatus = 'exploring' | 'inCombat' | 'downed' | 'retreated'
export type ReadyState = 'ready' | 'busy' | 'notReady'

export interface CoopMember {
  readonly playerId: string
  readonly name: string
  status: MemberStatus
  ready: ReadyState
  party: PokemonInstance[]
  /** Items this member found; loot is per player even inside a shared run. */
  loot: Record<string, number>
}

export const MAX_PLAYERS = 4

export const createMember = (playerId: string, name: string, party: PokemonInstance[]): CoopMember => ({
  playerId, name, status: 'exploring', ready: 'notReady', party, loot: {},
})

/** A member can still act while at least one of their six can fight. */
export const canFight = (member: CoopMember): boolean =>
  member.status !== 'retreated' && member.party.some(pokemon => !isFainted(pokemon))

/** Still inside: not retreated, whatever shape they are in. */
export const isInside = (member: CoopMember): boolean => member.status !== 'retreated'

/** APPROVED: out of the fight, not out of the expedition. */
export function syncDowned(members: readonly CoopMember[]): void {
  for (const member of members) {
    if (member.status === 'retreated') continue
    if (!canFight(member)) member.status = 'downed'
    else if (member.status === 'downed') member.status = 'exploring'
  }
}

/**
 * APPROVED: the run ends only when **every member still inside** has no usable
 * Pokémon. One player going down does not end anyone else's expedition.
 */
export function isGlobalWipe(members: readonly CoopMember[]): boolean {
  const inside = members.filter(isInside)
  return inside.length > 0 && inside.every(member => !canFight(member))
}

// ── Ready check ────────────────────────────────────────────────────────────

export interface ReadyCheck {
  readonly requestedBy: string
  readonly floor: number
  readonly responses: Readonly<Record<string, ReadyState>>
}

export function startReadyCheck(members: readonly CoopMember[], requestedBy: string, floor: number): ReadyCheck {
  const responses: Record<string, ReadyState> = {}
  for (const member of members) {
    if (!isInside(member)) continue
    // Whoever asked is ready by definition; someone mid-fight reads as busy.
    responses[member.playerId] = member.playerId === requestedBy
      ? 'ready'
      : member.status === 'inCombat' ? 'busy' : 'notReady'
  }
  return { requestedBy, floor, responses }
}

export const respond = (check: ReadyCheck, playerId: string, state: ReadyState): ReadyCheck =>
  playerId in check.responses ? { ...check, responses: { ...check.responses, [playerId]: state } } : check

/** Everyone still inside has to say yes; nobody is dragged through the door. */
export const everyoneReady = (check: ReadyCheck): boolean =>
  Object.values(check.responses).length > 0 && Object.values(check.responses).every(state => state === 'ready')

export const pendingMembers = (check: ReadyCheck): string[] =>
  Object.entries(check.responses).filter(([, state]) => state !== 'ready').map(([playerId]) => playerId)

// ── Individual retreat ─────────────────────────────────────────────────────

export interface RetreatResult {
  readonly members: readonly CoopMember[]
  /** What that member walked out with. */
  readonly extracted: Readonly<Record<string, number>>
  /** True when the expedition still has someone inside. */
  readonly expeditionContinues: boolean
}

export function retreatMember(members: readonly CoopMember[], playerId: string): RetreatResult {
  const target = members.find(member => member.playerId === playerId)
  if (!target || target.status === 'retreated') {
    return { members, extracted: {}, expeditionContinues: members.some(isInside) }
  }
  const extracted = { ...target.loot }
  const next = members.map(member => (member.playerId === playerId
    ? { ...member, status: 'retreated' as MemberStatus, loot: {} }
    : member))
  return { members: next, extracted, expeditionContinues: next.some(isInside) }
}

// ── Personal combat ────────────────────────────────────────────────────────

/**
 * APPROVED: a normal encounter belongs to whoever started it. This is the
 * co-op reading of the reservation contract in `occupancy.ts` — teammates are
 * not pulled in and see the Pokémon as busy.
 */
export const canJoinNormalCombat = (): false => false

export interface ActiveAllySlot {
  readonly playerId: string
  readonly count: number
}

/**
 * APPROVED (§36): one player brings two active Pokémon, two to four bring one
 * each, and never more than four allies on screen.
 */
export function activeSlots(members: readonly CoopMember[]): ActiveAllySlot[] {
  const inside = members.filter(member => isInside(member) && canFight(member))
  if (inside.length === 0) return []
  if (inside.length === 1) return [{ playerId: inside[0].playerId, count: 2 }]
  return inside.slice(0, MAX_PLAYERS).map(member => ({ playerId: member.playerId, count: 1 }))
}

export const totalActiveAllies = (members: readonly CoopMember[]): number =>
  activeSlots(members).reduce((sum, slot) => sum + slot.count, 0)
