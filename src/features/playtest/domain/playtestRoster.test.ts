import { describe, expect, it } from 'vitest'
import { speciesById } from '../../dungeonPrototype/data/speciesFixtures'
import { moveById } from '../../dungeonPrototype/domain/moves'
import { MAX_PARTY } from '../../dungeonPrototype/domain/party'
import {
  STARTING_PARTY_SIZE, boxMembers, createRoster, findMember, healParty, isPartyFull, needsHealing,
  partyIssues, partyMembers, toBox, toParty, type PlaytestRoster,
} from './playtestRoster'

/** Moves everything it can out of the boxes and into the party. */
function fillParty(start: PlaytestRoster): PlaytestRoster {
  let roster = start
  for (const member of boxMembers(roster)) {
    const change = toParty(roster, member.instanceId)
    if (change.ok) roster = change.roster
  }
  return roster
}

describe('a fresh roster', () => {
  it('starts with a party you can play with and boxes worth opening', () => {
    const roster = createRoster()
    expect(partyMembers(roster)).toHaveLength(STARTING_PARTY_SIZE)
    expect(boxMembers(roster).length).toBeGreaterThan(0)
    expect(partyIssues(roster)).toEqual([])
  })

  it('is built only from species and moves the prototype actually has', () => {
    // The fixtures are forty-odd species, not the Pokédex. A blueprint asking
    // for one that is missing throws on the way in — which is exactly how the
    // first draft of this roster died.
    for (const member of createRoster().all) {
      expect(speciesById(member.speciesId), `species ${member.speciesId}`).not.toBeNull()
      expect(member.maxHp, member.instanceId).toBeGreaterThan(0)
      expect(member.hp).toBe(member.maxHp)
      for (const moveId of member.moves) {
        expect(moveById(moveId), `${member.instanceId} → ${moveId}`).toBeTruthy()
        expect(member.pp[moveId], `${member.instanceId} → ${moveId}`).toBeGreaterThan(0)
      }
    }
  })

  it('has no duplicates: a Pokémon is in the party or in a box, never both', () => {
    const roster = createRoster()
    const ids = roster.all.map(member => member.instanceId)
    expect(new Set(ids).size).toBe(ids.length)
    const inBoth = partyMembers(roster).filter(member => boxMembers(roster).includes(member))
    expect(inBoth).toEqual([])
  })
})

describe('moving Pokémon', () => {
  it('box → team, and team → box', () => {
    const roster = createRoster()
    const fromBox = boxMembers(roster)[0]
    const added = toParty(roster, fromBox.instanceId)
    expect(added.ok).toBe(true)
    if (!added.ok) return
    expect(partyMembers(added.roster)).toHaveLength(STARTING_PARTY_SIZE + 1)

    const removed = toBox(added.roster, fromBox.instanceId)
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    expect(partyMembers(removed.roster)).toHaveLength(STARTING_PARTY_SIZE)
  })

  it('refuses a seventh, and the party stays valid', () => {
    const full = fillParty(createRoster())
    expect(partyMembers(full)).toHaveLength(MAX_PARTY)
    expect(isPartyFull(full)).toBe(true)
    expect(partyIssues(full)).toEqual([])

    const seventh = boxMembers(full)[0]
    const refused = toParty(full, seventh.instanceId)
    expect(refused).toEqual({ ok: false, reason: 'full' })
  })

  it('refuses to add the same Pokémon twice', () => {
    const roster = createRoster()
    const inParty = partyMembers(roster)[0]
    expect(toParty(roster, inParty.instanceId)).toEqual({ ok: false, reason: 'already-in-party' })
  })

  it('refuses a Pokémon that is not yours', () => {
    expect(toParty(createRoster(), 'someone-elses-pokemon')).toEqual({ ok: false, reason: 'unknown' })
  })

  it('refuses to empty the party, which would be a player who cannot fight', () => {
    let roster = createRoster()
    for (const member of partyMembers(roster).slice(1)) {
      const change = toBox(roster, member.instanceId)
      if (change.ok) roster = change.roster
    }
    expect(partyMembers(roster)).toHaveLength(1)
    expect(toBox(roster, partyMembers(roster)[0].instanceId)).toEqual({ ok: false, reason: 'last-one' })
  })

  it('never lets a swap produce an invalid party, however fast it is done', () => {
    let roster = createRoster()
    // Alternate a send and a fetch a few dozen times, the way a tester will.
    for (let i = 0; i < 40; i++) {
      const out = partyMembers(roster)[0]
      const sent = toBox(roster, out.instanceId)
      if (sent.ok) roster = sent.roster
      const back = boxMembers(roster)[0]
      const fetched = toParty(roster, back.instanceId)
      if (fetched.ok) roster = fetched.roster
      expect(partyIssues(roster)).toEqual([])
      expect(roster.party.memberIds.length).toBeLessThanOrEqual(MAX_PARTY)
    }
    // Nothing was created or lost along the way.
    expect(roster.all).toHaveLength(createRoster().all.length)
  })
})

describe('the Centro Pokémon heal', () => {
  const hurt = (roster: PlaytestRoster): PlaytestRoster => ({
    ...roster,
    all: roster.all.map(member => member.instanceId === roster.party.memberIds[0]
      ? { ...member, hp: 1, status: 'burn' as const, pp: { ...member.pp, [member.moves[0]]: 0 } }
      : member),
  })

  it('brings HP, PP and status all the way back', () => {
    const roster = hurt(createRoster())
    expect(needsHealing(roster)).toBe(true)

    const healed = healParty(roster)
    const member = partyMembers(healed)[0]
    expect(member.hp).toBe(member.maxHp)
    expect(member.status).toBe('none')
    expect(member.pp[member.moves[0]]).toBeGreaterThan(0)
    expect(needsHealing(healed)).toBe(false)
  })

  it('revives a fainted member, because a centre that did not would baffle everyone', () => {
    const roster = createRoster()
    const fainted: PlaytestRoster = {
      ...roster,
      all: roster.all.map(member => member.instanceId === roster.party.memberIds[0] ? { ...member, hp: 0 } : member),
    }
    expect(partyMembers(healParty(fainted))[0].hp).toBeGreaterThan(0)
  })

  it('heals the party and leaves the boxes alone', () => {
    const roster = createRoster()
    const boxed = boxMembers(roster)[0]
    const damaged: PlaytestRoster = {
      ...roster,
      all: roster.all.map(member => member.instanceId === boxed.instanceId ? { ...member, hp: 1 } : member),
    }
    const healed = healParty(damaged)
    expect(findMember(healed, boxed.instanceId)?.hp).toBe(1)
  })

  it('is safe to press over and over', () => {
    const once = healParty(hurt(createRoster()))
    const twice = healParty(once)
    expect(twice.all.map(member => member.hp)).toEqual(once.all.map(member => member.hp))
    expect(twice.all).toHaveLength(once.all.length)
  })
})
