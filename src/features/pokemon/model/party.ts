// The active party (R32.2).
//
// APPROVED (A-1): at most six Pokémon, and the same six serve exploration,
// combat, dungeons and professions — a worker must belong to the active party.
//
// The party is a list of **ids**, not of Pokémon: copying six whole records
// into the player would give two places to update the same thing. Whoever owns
// the collection resolves the ids when it needs the records.

export const MAX_PARTY_SIZE = 6

export interface ActiveParty {
  readonly ownerId: string
  readonly memberIds: readonly string[]
}

/** What the collection must answer for a party to be checkable. */
export interface PartyMemberView {
  ownerId: string | null
  state: 'owned' | 'expeditionPending'
}

export interface PartyCheckInput {
  readonly party: ActiveParty
  /** The instance behind each id, or null when it does not exist. */
  member(instanceId: string): PartyMemberView | null
}

/** Everything wrong with a party, in plain sentences; empty means it is sound. */
export function validateParty({ party, member }: PartyCheckInput): string[] {
  const issues: string[] = []
  if (party.memberIds.length > MAX_PARTY_SIZE) {
    issues.push(`a party holds at most ${MAX_PARTY_SIZE} Pokémon, not ${party.memberIds.length}`)
  }
  const seen = new Set<string>()
  for (const id of party.memberIds) {
    if (seen.has(id)) issues.push(`${id} is in the party twice`)
    seen.add(id)
    const entry = member(id)
    if (!entry) { issues.push(`${id} is not a Pokémon of this collection`); continue }
    if (entry.ownerId !== party.ownerId) issues.push(`${id} belongs to someone else`)
    // A capture that has not survived the dungeon yet is not the player's, so
    // it cannot be fielded as one of their six (I-1).
    if (entry.state === 'expeditionPending') issues.push(`${id} is still a pending capture`)
  }
  return issues
}

export const isValidParty = (input: PartyCheckInput): boolean => validateParty(input).length === 0

/** Whether a Pokémon may be sent to work a profession: it must be in the party (A-1). */
export const canWork = (party: ActiveParty, instanceId: string): boolean =>
  party.memberIds.includes(instanceId)

/** Adds a Pokémon to the party if there is room and it is not already there. */
export function addToParty(party: ActiveParty, instanceId: string): ActiveParty {
  if (party.memberIds.includes(instanceId) || party.memberIds.length >= MAX_PARTY_SIZE) return party
  return { ...party, memberIds: [...party.memberIds, instanceId] }
}

export function removeFromParty(party: ActiveParty, instanceId: string): ActiveParty {
  if (!party.memberIds.includes(instanceId)) return party
  return { ...party, memberIds: party.memberIds.filter(id => id !== instanceId) }
}
