// What stands on the floor, and whether you can walk through it (D1.2.2 §5, §8).
//
// The playtest found rocks you could walk over. The cause was structural: the
// dungeon drew props but never told the collision layer they were there, so a
// boulder was scenery. This module is the single answer to "what is on this
// tile and does it block", and it is pure — no canvas, no sprites — so the
// tests can read it directly.
//
// The rule is the one the feedback asked for: **what looks like it blocks,
// blocks**. A boulder, a tree, a big crystal formation: solid. A torch on the
// wall, a shell, a piece of coral: decoration.

import { hash2 } from '../../wildlands/engine/noise'
import { isSolidDecor, type DecorKind } from '../../wildlands/engine/world'
import { isWalkable, openWidth, PATH_WIDTH, tileAt, WALKABLE, type FloorTiles } from './tileKinds'
import type { DungeonTheme } from './tiers'

/** A wall torch has no `DecorKind`: the engine has no such prop. */
export type PropKind = DecorKind | 'torch'

export interface PlannedProp {
  readonly tx: number
  readonly ty: number
  readonly kind: PropKind
  /** True when the player cannot walk onto this tile. */
  readonly solid: boolean
  /** Lights the scene (the renderer registers it as a lamp). */
  readonly light: boolean
}

/**
 * Props the overworld treats as scenery but a cave does not. A crystal in
 * WildLands is a pickup you walk over; in a dungeon it is a formation the size
 * of a person, so here it blocks.
 */
const SOLID_IN_CAVE: ReadonlySet<PropKind> = new Set<PropKind>(['crystal'])

/** Props that never block, whatever the engine says. */
const NEVER_SOLID: ReadonlySet<PropKind> = new Set<PropKind>(['torch', 'shell', 'coral'])

export function isSolidProp(kind: PropKind): boolean {
  if (NEVER_SOLID.has(kind)) return false
  if (SOLID_IN_CAVE.has(kind)) return true
  return isSolidDecor(kind as DecorKind)
}

/** Which props each biome scatters on its walls and on its biome patches. */
export const THEME_PROPS: Readonly<Record<DungeonTheme, { wall: readonly DecorKind[]; accent: readonly DecorKind[] }>> = {
  cave: { wall: ['rock', 'boulder'], accent: ['crystal', 'rock'] },
  mine: { wall: ['rock', 'boulder'], accent: ['rock', 'boulder'] },
  glacier: { wall: ['icerock', 'rock'], accent: ['crystal', 'icerock'] },
  forest: { wall: ['rock', 'bush'], accent: ['pine', 'tree', 'bush'] },
  volcano: { wall: ['rock', 'boulder'], accent: ['boulder'] },
  ruin: { wall: ['rock', 'boulder'], accent: ['crystal', 'rock'] },
  tower: { wall: ['rock', 'boulder'], accent: ['crystal'] },
}

/**
 * Style B (D1.2.2 §8): the same floor, dressed. It adds nothing to the walls'
 * geometry and never touches a tile a party needs, so navigation is identical —
 * it only reads denser at the edges and gives the room some depth.
 */
export type CaveStyle = 'A' | 'B'

/**
 * A prop may only stand on walkable ground when there is room to spare: never
 * in a pass, never on the stairs or a bridge, never on the spawn or the exit.
 */
function canOccupy(tiles: FloorTiles, tx: number, ty: number): boolean {
  const kind = tileAt(tiles, tx, ty)
  if (!WALKABLE.has(kind) || kind === 'stairs' || kind === 'bridge') return false
  if (tx === tiles.entrance.x && ty === tiles.entrance.y) return false
  if (tx === tiles.exit.x && ty === tiles.exit.y) return false
  return openWidth(tiles, tx, ty) > PATH_WIDTH.main
}

/** How many walkable neighbours a rock tile has: only edges are ever seen. */
function facesFloor(tiles: FloorTiles, tx: number, ty: number): boolean {
  return isWalkable(tiles, tx, ty + 1) || isWalkable(tiles, tx, ty - 1)
    || isWalkable(tiles, tx - 1, ty) || isWalkable(tiles, tx + 1, ty)
}

export function planDecor(tiles: FloorTiles, seed: number, style: CaveStyle = 'A'): PlannedProp[] {
  const theme = THEME_PROPS[tiles.theme]
  const out: PlannedProp[] = []
  const push = (tx: number, ty: number, kind: PropKind, light = false): void => {
    out.push({ tx, ty, kind, solid: isSolidProp(kind), light })
  }
  const dense = style === 'B'

  for (let ty = 0; ty < tiles.height; ty++) {
    for (let tx = 0; tx < tiles.width; tx++) {
      const kind = tileAt(tiles, tx, ty)

      if (kind === 'rock') {
        if (!facesFloor(tiles, tx, ty)) continue
        const roll = hash2(tx, ty, seed + 11)
        // A torch needs floor in front of it so its light lands somewhere.
        if (isWalkable(tiles, tx, ty + 1) && roll < 0.1 && hash2(tx, ty, seed + 12) < 0.5) {
          push(tx, ty, 'torch', true)
          continue
        }
        if (roll < (dense ? 0.78 : 0.55)) {
          const list = theme.wall
          push(tx, ty, list[Math.floor(hash2(tx, ty, seed + 13) * list.length)])
        }
        continue
      }

      // Biome patches carry the biome's own props — but only where a party
      // still has room to walk around them.
      if (kind === 'accent' && hash2(tx, ty, seed + 21) < 0.55 && canOccupy(tiles, tx, ty)) {
        const list = theme.accent
        push(tx, ty, list[Math.floor(hash2(tx, ty, seed + 22) * list.length)])
        continue
      }

      // Style B only: a few formations just off the edge of the room, on ground
      // wide enough that nothing narrows below a main route.
      if (dense && WALKABLE.has(kind) && hash2(tx, ty, seed + 31) < 0.06 && canOccupy(tiles, tx, ty)) {
        const nearWall = !isWalkable(tiles, tx - 2, ty) || !isWalkable(tiles, tx + 2, ty)
          || !isWalkable(tiles, tx, ty - 2) || !isWalkable(tiles, tx, ty + 2)
        if (!nearWall) continue
        const list = theme.wall
        push(tx, ty, list[Math.floor(hash2(tx, ty, seed + 32) * list.length)])
      }
    }
  }
  return out
}

/** The tiles a party cannot walk onto because something solid is standing there. */
export function solidPropTiles(props: readonly PlannedProp[]): Set<string> {
  const out = new Set<string>()
  for (const prop of props) if (prop.solid) out.add(`${prop.tx}:${prop.ty}`)
  return out
}
