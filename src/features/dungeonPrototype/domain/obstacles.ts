// What stands in your way, and what it takes to move it (D1.2.4 §1, §4 ·
// D1.2.4ter §1, §2, §4).
//
// Two kinds of thing block a dungeon, and both are **one tile**:
//
//   - a **block** in the mouth of an optional side room: a fallen trunk, a
//     rockfall, a crystal. One box, one swing, and the alcove behind it opens.
//   - the **scenery already lying around**: every solid prop standing on the
//     ground. If it shuts a way, it can be broken.
//
// D1.2.4ter §4 replaced the wall-to-wall barriers of D1.2.4 with these. A
// barrier that spans a gallery and then vanishes in one hit reads as a cheat;
// a single block you walk up to, cannot pass, and come back for reads as a
// door you have not earned yet.
//
// None of it is a resource. Clearing one gives nothing but the ground it was
// standing on, and Skills are untouched — the levels below are *read* from the
// production catalog so the numbers the dungeon quotes are the numbers the
// skill actually asks for.

import { isSolidProp, planDecor, type CaveStyle, type PropKind } from './decorPlan'
import { streamFor } from './rng'
import { isWalkable, WALKABLE, type Alcove, type FloorTiles, type TilePoint } from './tileKinds'
import type { DungeonTheme } from './tiers'

/** What it takes to clear one. */
export type ObstacleSkill = 'mine' | 'chop'

export type ObstacleKind = 'rockfall' | 'crystal' | 'roots' | 'timber'

/** The profession behind each skill, named the way the game names it. */
export const SKILL_PROFESSION: Readonly<Record<ObstacleSkill, string>> = {
  mine: 'Minería',
  chop: 'Talar',
}

export interface ObstacleDefinition {
  readonly kind: ObstacleKind
  readonly skill: ObstacleSkill
  readonly label: string
  /** Seconds of work. PLAYTEST PARAMETER. */
  readonly seconds: number
  /** The decor anchors this block is made of, for reading its level. */
  readonly anchors: readonly PropKind[]
}

export const OBSTACLES: Readonly<Record<ObstacleKind, ObstacleDefinition>> = {
  rockfall: { kind: 'rockfall', skill: 'mine', label: 'Derrumbe', seconds: 2.2, anchors: ['rock'] },
  crystal: { kind: 'crystal', skill: 'mine', label: 'Cristal', seconds: 2.8, anchors: ['crystal'] },
  roots: { kind: 'roots', skill: 'chop', label: 'Raíces', seconds: 2, anchors: ['tree'] },
  timber: { kind: 'timber', skill: 'chop', label: 'Tronco', seconds: 2.4, anchors: ['pine'] },
}

/** Which two a biome uses, so a glacier is not full of roots. */
const THEME_OBSTACLES: Readonly<Record<DungeonTheme, readonly ObstacleKind[]>> = {
  cave: ['rockfall', 'crystal'],
  mine: ['rockfall', 'timber'],
  glacier: ['crystal', 'rockfall'],
  forest: ['roots', 'timber'],
  volcano: ['rockfall', 'crystal'],
  ruin: ['rockfall', 'timber'],
  tower: ['crystal', 'rockfall'],
}

const CHOPPABLE: ReadonlySet<PropKind> = new Set<PropKind>(['tree', 'pine', 'bush'])

// ── What the profession asks for (D1.2.4ter §1) ─────────────────────────────

export interface SkillRequirement {
  readonly skill: ObstacleSkill
  /** 'Minería' / 'Tala'. */
  readonly profession: string
  /** The level the production catalog asks for on this kind of material. */
  readonly level: number
  /** The catalog resource the number comes from, so it can be checked. */
  readonly nodeId: string
}

/**
 * The Skills resources these materials belong to, copied from the production
 * catalog (`skills/domain/resources.ts`) rather than imported: the prototype
 * stays isolated. `obstacles.test.ts` is a test, so it may read the real
 * catalog — and it does, failing the day these numbers drift from it.
 */
interface CatalogNode {
  readonly id: string
  readonly profession: ObstacleSkill
  readonly anchors: readonly PropKind[]
  readonly requiredLevel: number
}

export const QUOTED_NODES: readonly CatalogNode[] = [
  { id: 'stone_outcrop', profession: 'mine', anchors: ['rock'], requiredLevel: 1 },
  { id: 'coal_seam', profession: 'mine', anchors: ['rock', 'boulder'], requiredLevel: 10 },
  { id: 'iron_vein', profession: 'mine', anchors: ['boulder', 'icerock'], requiredLevel: 20 },
  { id: 'gold_vein', profession: 'mine', anchors: ['boulder', 'icerock'], requiredLevel: 35 },
  { id: 'crystal_cluster', profession: 'mine', anchors: ['crystal'], requiredLevel: 45 },
  { id: 'common_tree', profession: 'chop', anchors: ['tree'], requiredLevel: 1 },
  { id: 'pine_tree', profession: 'chop', anchors: ['pine'], requiredLevel: 12 },
  { id: 'hardwood_tree', profession: 'chop', anchors: ['tree'], requiredLevel: 25 },
]

/** Materials the catalog has no node of its own for, read as the nearest one. */
const ANCHOR_ALIAS: Partial<Record<PropKind, PropKind>> = { bush: 'tree' }

/**
 * The cheapest catalog node anchored to this material: the lowest level that
 * lets you work it at all. Read-only — nothing here writes to professions.
 */
function requirementOf(skill: ObstacleSkill, kinds: readonly PropKind[]): SkillRequirement {
  const anchors = kinds.map(kind => ANCHOR_ALIAS[kind] ?? kind)
  const node = QUOTED_NODES
    .filter(candidate => candidate.profession === skill
      && candidate.anchors.some(anchor => anchors.includes(anchor)))
    .sort((a, b) => a.requiredLevel - b.requiredLevel)[0]
  return {
    skill,
    profession: SKILL_PROFESSION[skill],
    level: node?.requiredLevel ?? 1,
    nodeId: node?.id ?? 'unknown',
  }
}

/** What a given block asks for. */
export const requirementForObstacle = (kind: ObstacleKind): SkillRequirement =>
  requirementOf(OBSTACLES[kind].skill, OBSTACLES[kind].anchors)

/** Which tool a solid prop asks for, or null when it is pure decoration. */
export function skillForProp(kind: PropKind): ObstacleSkill | null {
  if (!isSolidProp(kind)) return null
  return CHOPPABLE.has(kind) ? 'chop' : 'mine'
}

/** What a given piece of scenery asks for, or null when it is decoration. */
export function requirementForProp(kind: PropKind): SkillRequirement | null {
  const skill = skillForProp(kind)
  return skill ? requirementOf(skill, [kind]) : null
}

// ── Blocks in the mouth of an optional room (§2, §4) ────────────────────────

export interface FloorObstacle {
  readonly id: string
  readonly kind: ObstacleKind
  /** The one tile it stands on. */
  readonly at: TilePoint
  /** How much ground opens up behind it, so the prompt can be honest. */
  readonly opens: number
  cleared: boolean
}

const key = (point: TilePoint): string => `${point.x}:${point.y}`

/** Walkable tiles reachable on foot from `start`, treating `blocked` as rock. */
export function reachableFrom(tiles: FloorTiles, start: TilePoint, blocked: ReadonlySet<string>): Set<string> {
  const seen = new Set<string>([key(start)])
  const queue: TilePoint[] = [start]
  while (queue.length) {
    const at = queue.shift()!
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const next = { x: at.x + dx, y: at.y + dy }
      const id = key(next)
      if (seen.has(id) || blocked.has(id) || !isWalkable(tiles, next.x, next.y)) continue
      seen.add(id)
      queue.push(next)
    }
  }
  return seen
}

/**
 * One block per alcove mouth. Nothing is placed anywhere else: a block only
 * ever closes an optional room, never the way to the stairs (§2).
 */
export function placeObstacles(tiles: FloorTiles, seed: number, floor: number, wanted = 4): FloorObstacle[] {
  const rng = streamFor(seed, 'obstacles', tiles.theme, floor)
  const kinds = THEME_OBSTACLES[tiles.theme]
  const out: FloorObstacle[] = []

  for (const alcove of (tiles.alcoves ?? []) as readonly Alcove[]) {
    if (out.length >= wanted) break
    if (!isWalkable(tiles, alcove.mouth.x, alcove.mouth.y)) continue
    // Never on the spawn or the stairs, however the floor came out.
    if (key(alcove.mouth) === key(tiles.entrance) || key(alcove.mouth) === key(tiles.exit)) continue
    // Sealing the mouth must leave the exit reachable. It always does — the
    // alcove was carved off the side — but this is the promise, so it is checked.
    const sealed = reachableFrom(tiles, tiles.entrance, new Set([key(alcove.mouth)]))
    if (!sealed.has(key(tiles.exit))) continue

    out.push({
      id: `f${floor}-obs${out.length}`,
      kind: kinds[rng.int(0, kinds.length - 1)],
      at: alcove.mouth,
      opens: alcove.tiles.length,
      cleared: false,
    })
  }
  return out
}

/** The tiles still sealed, for collision and for pathfinding. */
export const blockedByObstacles = (obstacles: readonly FloorObstacle[]): Set<string> =>
  new Set(obstacles.filter(obstacle => !obstacle.cleared).map(obstacle => key(obstacle.at)))

/** True when the exit can still be walked to with every block left in place. */
export function exitReachableWithout(tiles: FloorTiles, obstacles: readonly FloorObstacle[]): boolean {
  const reached = reachableFrom(tiles, tiles.entrance, blockedByObstacles(obstacles))
  return reached.has(key(tiles.exit))
}

export const isObstacleTile = (obstacles: readonly FloorObstacle[], x: number, y: number): boolean =>
  obstacles.some(obstacle => !obstacle.cleared && obstacle.at.x === x && obstacle.at.y === y)

// ── The scenery you can also clear (D1.2.4bis §1) ───────────────────────────

/** What the prompt calls it. */
const PROP_LABELS: Partial<Record<PropKind, string>> = {
  rock: 'Roca',
  boulder: 'Peñasco',
  crystal: 'Formación de cristal',
  icerock: 'Bloque de hielo',
  tree: 'Árbol',
  pine: 'Pino',
  bush: 'Matorral',
}

export interface MinableProp {
  readonly id: string
  readonly at: TilePoint
  readonly kind: PropKind
  readonly skill: ObstacleSkill
  readonly label: string
  readonly requirement: SkillRequirement
  cleared: boolean
}

/**
 * Every solid prop standing on the ground, as something you can work through.
 * The plan is the same deterministic one the renderer draws from, so what
 * blocks on screen is what the prompt offers to clear.
 */
export function minableProps(tiles: FloorTiles, seed: number, floor: number, style: CaveStyle = 'A'): MinableProp[] {
  return planDecor(tiles, seed + floor * 97, style)
    // Only what stands **on the ground**: a boulder drawn against a wall is
    // part of the wall, and breaking it would open nothing.
    .filter(prop => prop.solid && isWalkable(tiles, prop.tx, prop.ty))
    .map(prop => {
      const skill = skillForProp(prop.kind) ?? 'mine'
      return {
        id: `f${floor}-prop-${prop.tx}-${prop.ty}`,
        at: { x: prop.tx, y: prop.ty },
        kind: prop.kind,
        skill,
        label: PROP_LABELS[prop.kind] ?? (skill === 'chop' ? 'Maleza' : 'Roca'),
        requirement: requirementForProp(prop.kind) ?? requirementOf(skill, [prop.kind]),
        cleared: false,
      }
    })
}

/** The prop tiles still standing: what collision and pathfinding must refuse. */
export const blockedByProps = (props: readonly MinableProp[]): Set<string> =>
  new Set(props.filter(prop => !prop.cleared).map(prop => key(prop.at)))

/**
 * What this floor asks of your professions (§1): the highest level anything on
 * it needs, per skill. This is what the dungeon quotes before you go in.
 */
export function floorRequirements(
  obstacles: readonly FloorObstacle[], props: readonly MinableProp[],
): SkillRequirement[] {
  const best = new Map<ObstacleSkill, SkillRequirement>()
  const consider = (requirement: SkillRequirement): void => {
    const current = best.get(requirement.skill)
    if (!current || requirement.level > current.level) best.set(requirement.skill, requirement)
  }
  for (const obstacle of obstacles) consider(requirementForObstacle(obstacle.kind))
  for (const prop of props) consider(prop.requirement)
  return [...best.values()].sort((a, b) => b.level - a.level)
}

export { WALKABLE }
