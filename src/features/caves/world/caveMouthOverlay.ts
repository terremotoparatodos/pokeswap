// Drawing the cave mouths (CAVES-2).
//
// Draws only, and only what `caves.js` says: one sprite per cave of the area,
// at the front-centre of its footprint, and a short canvas label when the
// player is near. The rock's collision is not here — it is the shared terrain
// (`isSolidAtArea`), which is why this overlay is installed in every build:
// a rock that collides must be seen.
//
// A closed entrance does nothing when touched. There is no modal and no
// travel until CAVES-3 opens the mouth.

import { CAVE_ENTRANCE, cavesIn, type Cave } from '../../../../services/realtime/src/world/caves.js'
import type { Area } from '../../wildlands/engine/area'
import type { OverlayLabel, OverlaySprite, SceneOverlay } from '../../wildlands/engine/sceneOverlay'
import { TILE } from '../../wildlands/engine/world'
import { caveEntranceSprite, toneForBiome } from '../art/caveEntranceArt'

/** How close the player has to be for a cave to name itself, in tiles. */
const LABEL_RANGE = 7

/** Palette per area, from the biome its arrival sits in. */
const BIOME_BY_AREA: Readonly<Record<string, string>> = {
  tundra: 'tundra', costa: 'beach', desierto: 'desert', pradera: 'grassland', bosque: 'forest',
}

export interface CaveMouthPort {
  player(): { tx: number; ty: number; areaId: string } | null
}

/**
 * Where the art's feet go: the middle of the front row, two pixels above its
 * bottom edge — the front-centre rule `placedFeet` applies to placed objects.
 */
export function caveFeet(cave: Cave): { readonly x: number; readonly y: number } {
  return { x: (cave.anchor.tx + cave.width / 2) * TILE, y: cave.anchor.ty * TILE + TILE - 2 }
}

export function caveLabel(cave: Cave): string {
  return cave.entrance === CAVE_ENTRANCE.OPEN ? 'Cueva' : 'Cueva · próximamente'
}

export class CaveMouthOverlay implements SceneOverlay {
  constructor(private readonly port: CaveMouthPort) {}

  sprites(area: Area): readonly OverlaySprite[] {
    const sprite = caveEntranceSprite(toneForBiome(BIOME_BY_AREA[area.id] ?? 'grassland'))
    return cavesIn(area.id).map(cave => {
      const feet = caveFeet(cave)
      return { wx: feet.x, wy: feet.y, sprite }
    })
  }

  labels(area: Area): readonly OverlayLabel[] {
    const player = this.port.player()
    if (!player || player.areaId !== area.id) return []
    const out: OverlayLabel[] = []
    for (const cave of cavesIn(area.id)) {
      const distance = Math.max(Math.abs(cave.approach.tx - player.tx), Math.abs(cave.approach.ty - player.ty))
      if (distance > LABEL_RANGE) continue
      const feet = caveFeet(cave)
      out.push({
        wx: feet.x,
        wy: feet.y,
        // Clear of the crown of the rock (CAVE_H), so the name never sits on it.
        lift: 62,
        text: caveLabel(cave),
        color: '#ffd27a',
        // Fades in as the player approaches.
        alpha: distance <= 2 ? 1 : 1 - (distance - 2) / (LABEL_RANGE - 1),
      })
    }
    return out
  }
}
