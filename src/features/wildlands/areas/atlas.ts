// Atlas — WildLands prototype
//
// Ciudad Corazón is the lobby; each of its five gates leads to a procedural
// world with its own seed and starting biome.

import { hearthomeDef } from './hearthome'
import { TownArea, type TownDef } from './townArea'
import { WildArea, type WorldDef } from './wildArea'
import type { Area, AreaId } from '../engine/area'

export const LOBBY_ID = 'ciudad-corazon'

export const WORLDS: readonly WorldDef[] = [
  { id: 'pradera', name: 'Pradera Brisa', seed: 208, prefer: ['grassland'] },
  { id: 'bosque', name: 'Bosque Umbrío', seed: 209, prefer: ['forest'] },
  { id: 'desierto', name: 'Desierto Ardiente', seed: 212, prefer: ['desert'] },
  { id: 'tundra', name: 'Tundra Helada', seed: 216, prefer: ['tundra'] },
  { id: 'costa', name: 'Costa Coral', seed: 220, prefer: ['beach'] },
]

export const HEARTHOME: TownDef = hearthomeDef(WORLDS, LOBBY_ID)

/** Builds (and caches) areas on demand; worlds are only generated when first visited. */
export class Atlas {
  private readonly areas = new Map<AreaId, Area>()

  get(id: AreaId): Area {
    let area = this.areas.get(id)
    if (!area) {
      if (id === LOBBY_ID) {
        area = new TownArea(HEARTHOME)
      } else {
        const def = WORLDS.find(w => w.id === id)
        if (!def) return this.get(LOBBY_ID)
        area = new WildArea(def, LOBBY_ID)
      }
      this.areas.set(id, area)
    }
    return area
  }

  static isKnown(id: string): boolean {
    return id === LOBBY_ID || WORLDS.some(w => w.id === id)
  }
}
