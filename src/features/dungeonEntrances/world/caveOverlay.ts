// Drawing the caves.
//
// The engine owns one `SceneOverlay`, so this follows the same shape every
// profession overlay follows: a port for the things it needs to read, sprites
// depth-sorted with the rest of the scene, and canvas labels — never markup.
//
// It draws only. What a cave *is* comes from `entranceSpawns.ts`, and what
// happens when you use one belongs to the component that owns the entrance.

import { formatCountdown } from '../../dungeonPrototype/domain/dungeonSpawn'
import type { Area } from '../../wildlands/engine/area'
import { placedFeet, type PlacedObject } from '../../wildlands/engine/placedObjects'
import type { OverlayLabel, OverlaySprite, SceneOverlay } from '../../wildlands/engine/sceneOverlay'
import { TILE } from '../../wildlands/engine/world'
import { caveEntranceSprite, type CaveTone } from '../art/caveEntranceArt'
import type { AreaEntrance } from '../domain/entranceSpawns'

/** How close the player has to be for a cave to name itself, in tiles. */
const LABEL_RANGE = 7

export interface CaveOverlayPort {
  /** The caves of the area the player is in, with the placed object each one became. */
  entrances(): readonly { entrance: AreaEntrance; object: PlacedObject }[]
  player(): { tx: number; ty: number; areaId: string } | null
  tone(): CaveTone
  /** Milliseconds, for the countdown. Injected so a test can hold the clock still. */
  now(): number
}

export class CaveOverlay implements SceneOverlay {
  constructor(private readonly port: CaveOverlayPort) {}

  sprites(area: Area): readonly OverlaySprite[] {
    const sprite = caveEntranceSprite(this.port.tone())
    return this.port.entrances()
      .filter(({ object }) => object.areaId === area.id)
      .map(({ object }) => {
        const feet = placedFeet(object, TILE)
        return { wx: feet.x, wy: feet.y, sprite }
      })
  }

  labels(area: Area): readonly OverlayLabel[] {
    const player = this.port.player()
    if (!player || player.areaId !== area.id) return []
    const now = this.port.now()
    const out: OverlayLabel[] = []
    for (const { entrance, object } of this.port.entrances()) {
      if (object.areaId !== area.id) continue
      const { approach } = entrance.placement
      const distance = Math.max(Math.abs(approach.tx - player.tx), Math.abs(approach.ty - player.ty))
      if (distance > LABEL_RANGE) continue
      const feet = placedFeet(object, TILE)
      // Fades in as the player approaches, so six caves in view never shout at once.
      const alpha = distance <= 2 ? 1 : 1 - (distance - 2) / (LABEL_RANGE - 2 + 1)
      out.push({
        wx: feet.x,
        wy: feet.y,
        // Clear of the crown of the rock (CAVE_H), so the name never sits on it.
        lift: 62,
        text: `${entrance.definition.name} · ${formatCountdown(entrance.spawn, now)}`,
        color: '#ffd27a',
        alpha,
      })
    }
    return out
  }
}
