// The Pokémon a playtester has, their active party and their boxes.
//
// SESSION-ONLY, and that is a decision rather than a shortcut. The approved
// party contract (`pokemon/model/party.ts`) has no production consumer yet, and
// persistent ownership lives in `slots` behind Edge Functions. Writing a party
// into that would be a schema decision made at 3am for a two-hour playtest, so
// the playtest keeps its own roster in memory and touches nothing real.
//
// What it does **not** do is invent a second set of rules. Validation is the
// approved `validateParty`: at most six, no duplicates, nothing belonging to
// somebody else, no pending capture. The records are the Dungeon prototype's
// own `PokemonInstance`, because the Dungeon is what consumes them, and a third
// Pokémon model would be exactly the parallel model §39 forbids.

import { buildPokemon, DEFAULT_PARTY, type PartyBlueprint } from '../../dungeonPrototype/data/runFixtures'
import { clonePokemon, MAX_PARTY, type PokemonInstance } from '../../dungeonPrototype/domain/party'
import { moveById } from '../../dungeonPrototype/domain/moves'
import { addToParty, removeFromParty, validateParty, type ActiveParty } from '../../pokemon/model/party'

/** Whose roster this is. One playtester, one owner id; the value never leaves the tab. */
export const PLAYTEST_OWNER = 'playtest-player'

/**
 * PLAYTEST PARAMETER: four in the party, eight in the boxes.
 *
 * Four is enough to walk into a Dungeon without visiting the Centro Pokémon
 * first, and few enough that filling the party is a thing a tester actually
 * does — which is the behaviour we want to watch.
 */
export const STARTING_PARTY_SIZE = 4

/**
 * The bench: the approved six, plus more so the boxes are not a formality.
 *
 * Every species id here has to exist in the prototype's own fixtures — there
 * are forty-odd of them, not the full Pokédex. A test walks this list and
 * resolves each one, because the first draft cheerfully asked for Snorlax and
 * the roster exploded on the way in.
 */
const BOX_BLUEPRINTS: readonly PartyBlueprint[] = [
  { speciesId: 25, level: 24, moves: ['quickAttack', 'thunderWave', 'tackle', 'protect'] },
  { speciesId: 7, level: 25, moves: ['tackle', 'growl', 'protect', 'quickAttack'] },
  { speciesId: 95, level: 32, moves: ['bodySlam', 'tackle', 'protect', 'growl'] },
  { speciesId: 200, level: 28, moves: ['confuseRay', 'toxic', 'protect', 'tackle'] },
  { speciesId: 136, level: 29, moves: ['flamethrower', 'growl', 'tackle', 'protect'] },
  { speciesId: 471, level: 30, moves: ['iceBeam', 'quickAttack', 'protect', 'tackle'] },
]

export interface PlaytestRoster {
  /** Every Pokémon this playtester has, party and boxes together. */
  readonly all: readonly PokemonInstance[]
  readonly party: ActiveParty
}

export function createRoster(): PlaytestRoster {
  const blueprints = [...DEFAULT_PARTY, ...BOX_BLUEPRINTS]
  const all = blueprints.map((blueprint, index) => buildPokemon(blueprint, index))
  return {
    all,
    party: { ownerId: PLAYTEST_OWNER, memberIds: all.slice(0, STARTING_PARTY_SIZE).map(member => member.instanceId) },
  }
}

export const findMember = (roster: PlaytestRoster, instanceId: string): PokemonInstance | null =>
  roster.all.find(member => member.instanceId === instanceId) ?? null

/** In party order, so the list on screen matches the order they are sent out in. */
export const partyMembers = (roster: PlaytestRoster): PokemonInstance[] =>
  roster.party.memberIds.map(id => findMember(roster, id)).filter((member): member is PokemonInstance => !!member)

/** Everything that is not in the party. */
export const boxMembers = (roster: PlaytestRoster): PokemonInstance[] =>
  roster.all.filter(member => !roster.party.memberIds.includes(member.instanceId))

export const isPartyFull = (roster: PlaytestRoster): boolean => roster.party.memberIds.length >= MAX_PARTY

/**
 * Everything wrong with this roster's party, in plain sentences.
 *
 * Delegates to the approved checker rather than restating it. `state` is always
 * `owned` here: a playtest roster has no expedition-pending captures, because
 * nothing a Dungeon run produces is written back into it.
 */
export const partyIssues = (roster: PlaytestRoster): string[] => validateParty({
  party: roster.party,
  member: instanceId => findMember(roster, instanceId)
    ? { ownerId: PLAYTEST_OWNER, state: 'owned' as const }
    : null,
})

export type RosterChange =
  | { readonly ok: true; readonly roster: PlaytestRoster }
  | { readonly ok: false; readonly reason: 'unknown' | 'full' | 'already-in-party' | 'not-in-party' | 'last-one' }

/** Box → team. Refused when the party is full, which is the rule worth feeling. */
export function toParty(roster: PlaytestRoster, instanceId: string): RosterChange {
  if (!findMember(roster, instanceId)) return { ok: false, reason: 'unknown' }
  if (roster.party.memberIds.includes(instanceId)) return { ok: false, reason: 'already-in-party' }
  if (isPartyFull(roster)) return { ok: false, reason: 'full' }
  return { ok: true, roster: { ...roster, party: addToParty(roster.party, instanceId) } }
}

/**
 * Team → box. The last one cannot leave: a party of zero is a player who walks
 * into a Dungeon with nothing and loses instantly, which reads as a bug.
 */
export function toBox(roster: PlaytestRoster, instanceId: string): RosterChange {
  if (!roster.party.memberIds.includes(instanceId)) return { ok: false, reason: 'not-in-party' }
  if (roster.party.memberIds.length <= 1) return { ok: false, reason: 'last-one' }
  return { ok: true, roster: { ...roster, party: removeFromParty(roster.party, instanceId) } }
}

/**
 * Full heal of the active party: HP, PP and major status.
 *
 * This is `PokemonConditionState.HEALTHY` said in the prototype's vocabulary —
 * full HP, every move at full PP, no status — because the prototype's records
 * are what the Dungeon runs on. Fainted members come back too: a Centro Pokémon
 * that refused to revive would be a Centro Pokémon nobody understands.
 *
 * PLAYTEST RULE: free, and with no cooldown. We are testing navigation and
 * combat, not an economy of healing.
 */
export function healParty(roster: PlaytestRoster): PlaytestRoster {
  const healed = new Set(roster.party.memberIds)
  return {
    ...roster,
    all: roster.all.map(member => {
      if (!healed.has(member.instanceId)) return member
      const next = clonePokemon(member)
      next.hp = next.maxHp
      next.status = 'none'
      next.sleepFor = 0
      next.confusedFor = 0
      for (const moveId of next.moves) next.pp[moveId] = moveById(moveId)?.pp ?? next.pp[moveId] ?? 0
      return next
    }),
  }
}

/**
 * Writes the wear of an expedition back onto the roster.
 *
 * `startPlay` clones whatever party it is given, so a Dungeon run never
 * scribbles on these records — which is correct, and also means attrition
 * would vanish the moment you walked out. This is the one seam where it comes
 * back: HP, PP and status, matched by instance id.
 *
 * Deliberately **only** condition. A run can capture Pokémon, and those are
 * expedition loot the prototype holds in memory with no server behind them
 * (DUNGEON_PROTOTYPE_INTEGRATION.md §4, I-1). Letting a client-side capture
 * add a Pokémon to a roster would be granting an asset from client logic, so
 * it does not, and the Dungeon says as much in its own header.
 */
export function applyExpedition(roster: PlaytestRoster, party: readonly PokemonInstance[]): PlaytestRoster {
  const worn = new Map(party.map(member => [member.instanceId, member]))
  return {
    ...roster,
    all: roster.all.map(member => {
      const after = worn.get(member.instanceId)
      if (!after) return member
      const next = clonePokemon(member)
      next.hp = Math.max(0, Math.min(next.maxHp, after.hp))
      next.status = after.status
      next.sleepFor = after.sleepFor
      next.confusedFor = after.confusedFor
      for (const moveId of next.moves) {
        if (typeof after.pp[moveId] === 'number') next.pp[moveId] = Math.max(0, after.pp[moveId])
      }
      return next
    }),
  }
}

/** True when anything in the party would benefit from a visit. */
export const needsHealing = (roster: PlaytestRoster): boolean =>
  partyMembers(roster).some(member =>
    member.hp < member.maxHp
    || member.status !== 'none'
    || member.moves.some(moveId => (member.pp[moveId] ?? 0) < (moveById(moveId)?.pp ?? 0)))
