// Ranch zones and home assignment — Rancho
//
// Every inhabitant lives in a zone and holds one numbered slot of it. The pair
// (zone, slot) is the persistent "address": the map turns it into a tile, so a
// member finds their Pokémon in the same spot day after day.
//
// `assignHomes` is the rule the server will run when it first sees a member
// (RANCH-2). It is pure and prefix-stable: processing members in arrival order,
// a newcomer never moves anyone who arrived before.

import { unitHash } from './seededRandom'

export const ZONE_IDS = ['casa', 'prado', 'lago', 'bosque', 'flores', 'rocas', 'corrales', 'descanso'] as const
export type ZoneId = (typeof ZONE_IDS)[number]

export interface ZoneInfo {
  /** Name shown on the map and in the card. */
  name: string
  /** "Vive …" phrase for the card. */
  where: string
  /** Share of newcomers that prefer this zone (sums to 1). */
  share: number
}

export const ZONES: Record<ZoneId, ZoneInfo> = {
  casa: { name: 'La Casa', where: 'junto a la casa', share: 0.08 },
  prado: { name: 'El Prado', where: 'en el prado', share: 0.2 },
  lago: { name: 'El Lago', where: 'a orillas del lago', share: 0.14 },
  bosque: { name: 'El Bosque', where: 'en el bosque', share: 0.13 },
  flores: { name: 'El Jardín', where: 'entre las flores del jardín', share: 0.13 },
  rocas: { name: 'Las Rocas', where: 'entre las rocas', share: 0.1 },
  corrales: { name: 'Los Corrales', where: 'en los corrales', share: 0.12 },
  descanso: { name: 'El Descanso', where: 'en la zona de descanso', share: 0.1 },
}

export function isZoneId(value: unknown): value is ZoneId {
  return typeof value === 'string' && (ZONE_IDS as readonly string[]).includes(value)
}

export interface Home {
  zone: ZoneId
  slot: number
}

/** Zone a member prefers, from a hash of their internal id weighted by `share`. */
export function preferredZone(id: string): ZoneId {
  let u = unitHash(`zone:${id}`)
  for (const zone of ZONE_IDS) {
    u -= ZONES[zone].share
    if (u < 0) return zone
  }
  return ZONE_IDS[ZONE_IDS.length - 1]
}

/**
 * Homes for members in arrival order. Each takes the next free slot of its
 * preferred zone; a full zone sends them to the zone with most room left.
 * Members beyond the total capacity get no home (and are not drawn).
 */
export function assignHomes(ids: readonly string[], capacity: Readonly<Record<ZoneId, number>>): Map<string, Home> {
  const used = Object.fromEntries(ZONE_IDS.map(z => [z, 0])) as Record<ZoneId, number>
  const homes = new Map<string, Home>()
  for (const id of ids) {
    let zone = preferredZone(id)
    if (used[zone] >= capacity[zone]) {
      let best: ZoneId | null = null
      for (const z of ZONE_IDS) {
        const room = capacity[z] - used[z]
        if (room > 0 && (best === null || room > capacity[best] - used[best])) best = z
      }
      if (best === null) continue
      zone = best
    }
    homes.set(id, { zone, slot: used[zone]++ })
  }
  return homes
}
