// Home slots — Rancho
//
// Turns a (zone, slot) address into a tile. Each zone lists its homes from its
// focus outward: the first pass keeps homes two tiles apart (a lived-in but
// uncrowded ranch), the second fills the gaps, so a large community still fits
// without the map depending on today's member count.
//
// The lists are a pure function of the layout. When positions become
// persistent (RANCH-2) they are frozen, so editing the map cannot move anyone.

import { hash2 } from '../../wildlands/engine/noise'
import { ZONE_IDS, type ZoneId } from '../domain/zones'
import { ZONE_FOCUS } from './ranchLayout'
import { RANCH_SEED, type RanchMap } from './ranchMap'

export interface Tile {
  tx: number
  ty: number
}

export type ZoneSlots = Record<ZoneId, Tile[]>

/** Minimum Chebyshev distance between first-pass homes. */
export const SPACED = 2

export function buildSlots(map: RanchMap): ZoneSlots {
  const out = {} as ZoneSlots
  for (const zone of ZONE_IDS) {
    const z = ZONE_IDS.indexOf(zone)
    const focus = ZONE_FOCUS[zone]
    const candidates: { tile: Tile; order: number }[] = []
    for (let ty = 0; ty < map.h; ty++) {
      for (let tx = 0; tx < map.w; tx++) {
        const i = ty * map.w + tx
        if (map.zones[i] !== z || map.solid[i] || map.path[i] || map.reserved[i]) continue
        const order = Math.hypot(tx + 0.5 - focus.x, ty + 0.5 - focus.y) + hash2(tx, ty, RANCH_SEED + 97) * 2.5
        candidates.push({ tile: { tx, ty }, order })
      }
    }
    candidates.sort((a, b) => a.order - b.order || a.tile.ty - b.tile.ty || a.tile.tx - b.tile.tx)

    const near = new Uint8Array(map.w * map.h)
    const spaced: Tile[] = []
    const rest: Tile[] = []
    for (const { tile } of candidates) {
      if (near[tile.ty * map.w + tile.tx]) {
        rest.push(tile)
        continue
      }
      spaced.push(tile)
      for (let dy = -SPACED + 1; dy < SPACED; dy++) {
        for (let dx = -SPACED + 1; dx < SPACED; dx++) {
          const x = tile.tx + dx
          const y = tile.ty + dy
          if (map.inside(x, y)) near[y * map.w + x] = 1
        }
      }
    }
    out[zone] = [...spaced, ...rest]
  }
  return out
}

export function slotCapacity(slots: ZoneSlots): Record<ZoneId, number> {
  return Object.fromEntries(ZONE_IDS.map(zone => [zone, slots[zone].length])) as Record<ZoneId, number>
}
