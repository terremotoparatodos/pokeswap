// Mock server — Rancho (RANCH-1)
//
// Plays the part of the future backend: takes normalized memberships in
// arrival order and assigns what the server will own in RANCH-2 — internal
// id, first-seen date, random species and a (zone, slot) home — then returns
// the same snapshot shape the real one will. The page never assigns anything
// itself; it only renders what a snapshot says.

import { cleanDisplayName, parseSnapshot, type NormalizedMembership, type RanchSnapshot } from '../domain/membership'
import { hashString } from '../domain/seededRandom'
import { RANDOM_POOL } from '../domain/species'
import { assignHomes, type ZoneId } from '../domain/zones'
import { mockMemberships } from './mockMembers'

const DAY = 86_400_000
/** How far back the oldest mock member "arrived". */
const HISTORY_DAYS = 730

/** Stand-ins for admin overrides: the two examples from the brief. */
const SPECIES_OVERRIDES: Record<string, number> = {
  'twitch:41000001': 258, // Terremotito123 → Mudkip
  'youtube:UCjuanPerez0000000000001': 197, // JuanPerez → Umbreon
}

const key = (m: NormalizedMembership) => `${m.platform}:${m.platformUserId}`

/** The random roll the server will make once per new member (never on the client). */
function rollSpecies(member: NormalizedMembership): number {
  return SPECIES_OVERRIDES[key(member)] ?? RANDOM_POOL[hashString(`species:${key(member)}`) % RANDOM_POOL.length]
}

/** Member i arrived before member i + 1; the oldest two years ago. Day-aligned so reloads agree. */
function firstSeen(i: number, today: number): string {
  const daysAgo = Math.round(HISTORY_DAYS * Math.exp(-i / 400))
  const hour = hashString(`hour:${i}`) % 24
  return new Date(today - daysAgo * DAY + hour * 3_600_000).toISOString()
}

export function createMockSnapshot(
  count: number,
  capacity: Readonly<Record<ZoneId, number>>,
  now: Date = new Date(),
): RanchSnapshot {
  const members = mockMemberships(count)
  const ids = members.map((_, i) => `r${i.toString(36)}`)
  const homes = assignHomes(ids, capacity)
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const residents = members.flatMap((member, i) => {
    const home = homes.get(ids[i])
    if (!home) return []
    return [{
      id: ids[i],
      platform: member.platform,
      displayName: cleanDisplayName(member.displayName),
      speciesId: rollSpecies(member),
      shiny: false,
      zone: home.zone,
      slot: home.slot,
      firstSeenAt: firstSeen(i, today),
      memberSince: member.memberSince,
      tenureMonths: member.tenureMonths,
      tier: member.tier,
    }]
  })
  // Same validation path a fetched snapshot will take.
  return parseSnapshot({ version: 1, generatedAt: new Date(today).toISOString(), residents })
}
