// D1.2.2 §4, §17 — tap to walk there.
//
// The navigation itself is the overworld's (`engine/navigator.ts` over
// `engine/pathfinding.ts`); what is tested here is the wiring: that the dungeon
// gives it a truthful collision test, that a key press always wins over a tap
// route, that a fight stops the walking, and that sprinting changes pace and
// nothing else.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RUN_SPEED, WALK_SPEED } from '../../wildlands/engine/actors'
import { generateFloor } from '../domain/floorPlan'
import { buildFloorTiles, isWalkable, placeEntities, type FloorEntity, type FloorTiles } from '../domain/floorTiles'
import { planDecor, solidPropTiles } from '../domain/decorPlan'
import { dungeonProfile } from '../domain/tiers'
import { DungeonWorld } from './dungeonScene'

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    save: () => undefined, restore: () => undefined, beginPath: () => undefined,
    ellipse: () => undefined, arc: () => undefined, fill: () => undefined, stroke: () => undefined,
    drawImage: () => undefined, clearRect: () => undefined, fillRect: () => undefined,
    createPattern: () => ({ setTransform: () => undefined }),
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: () => undefined,
    getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  }) as unknown as CanvasRenderingContext2D)
})

const TRAINER = { down: [], up: [], left: [], right: [] } as never
const SEED = 6161

function build(): { tiles: FloorTiles; entities: FloorEntity[]; scene: DungeonWorld } {
  const plan = generateFloor(dungeonProfile(SEED, 'B', 'cave'), 3, [4, 7, 25])
  const tiles = buildFloorTiles(plan, 'cave', SEED)
  const entities = placeEntities(plan, tiles, SEED)
  return { tiles, entities, scene: new DungeonWorld(TRAINER, tiles, entities, tiles.entrance, SEED, 3) }
}

/** Runs frames until the player stops moving or the budget runs out. */
function settle(scene: DungeonWorld, tiles: FloorTiles, frames = 600): void {
  for (let i = 0; i < frames; i++) scene.update(1 / 60, tiles, null)
}

describe('what the dungeon tells the navigator', () => {
  it('reports a tile with a solid prop on it as solid (§5)', () => {
    const { tiles, scene } = build()
    const solid = solidPropTiles(planDecor(tiles, SEED + 3 * 97))
    const onGround = [...solid].map(key => key.split(':').map(Number))
      .filter(([x, y]) => isWalkable(tiles, x, y))
    expect(onGround.length).toBeGreaterThan(0)
    for (const [x, y] of onGround) expect(scene.area.isSolid(x, y)).toBe(true)
  })

  it('still reports plain floor as walkable', () => {
    const { tiles, scene } = build()
    expect(scene.area.isSolid(tiles.entrance.x, tiles.entrance.y)).toBe(false)
  })
})

describe('tap to move (§4)', () => {
  it('walks to a tile that is reachable', () => {
    const { tiles, scene } = build()
    const start = { x: scene.player.tx, y: scene.player.ty }
    const target = { tx: start.x + 4, ty: start.y }
    if (scene.area.isSolid(target.tx, target.ty)) return
    expect(scene.goTo({ tile: target, actor: null })).toBe(true)
    settle(scene, tiles)
    expect({ x: scene.player.tx, y: scene.player.ty }).toEqual({ x: target.tx, y: target.ty })
  })

  it('refuses a tile inside the rock', () => {
    const { tiles, scene } = build()
    // The rim of the map is always rock.
    expect(scene.goTo({ tile: { tx: 0, ty: 0 }, actor: null })).toBe(false)
    const before = { x: scene.player.tx, y: scene.player.ty }
    settle(scene, tiles, 60)
    expect({ x: scene.player.tx, y: scene.player.ty }).toEqual(before)
  })

  it('refuses a tap on nothing at all', () => {
    const { scene } = build()
    expect(scene.goTo({ tile: null, actor: null })).toBe(false)
  })

  it('stops the moment a direction is pressed (§4)', () => {
    const { tiles, scene } = build()
    const start = { x: scene.player.tx, y: scene.player.ty }
    const target = { tx: start.x, ty: start.y + 5 }
    if (scene.area.isSolid(target.tx, target.ty)) return
    scene.goTo({ tile: target, actor: null })
    for (let i = 0; i < 6; i++) scene.update(1 / 60, tiles, null)
    // A key arrives: the route is dropped and never resumes.
    scene.update(1 / 60, tiles, 'left')
    settle(scene, tiles, 200)
    expect({ x: scene.player.tx, y: scene.player.ty }).not.toEqual({ x: target.tx, y: target.ty })
  })

  it('does not walk while a fight is on (§4)', () => {
    const { tiles, entities, scene } = build()
    const foe = entities.find(entity => entity.kind === 'encounter' && !entity.isAlpha)!
    scene.openCombat(tiles, foe.id, [{ combatantId: 'ally-0', speciesId: 25 }])
    expect(scene.locked).toBe(true)

    const before = { x: scene.player.tx, y: scene.player.ty }
    expect(scene.goTo({ tile: { tx: before.x + 3, ty: before.y }, actor: null })).toBe(false)
    settle(scene, tiles, 120)
    expect({ x: scene.player.tx, y: scene.player.ty }).toEqual(before)
  })
})

describe('running (§3)', () => {
  it('changes the pace and nothing else', () => {
    const { tiles, scene } = build()
    scene.update(1 / 60, tiles, null, undefined, false)
    expect(scene.player.speed).toBe(WALK_SPEED)

    scene.update(1 / 60, tiles, null, undefined, true)
    expect(scene.player.speed).toBe(RUN_SPEED)
    expect(scene.player.running).toBe(true)
  })

  it('does not let a runner through anything a walker is stopped by', () => {
    const { tiles, scene } = build()
    const rules = scene.rules(tiles)
    for (let y = 0; y < tiles.height; y += 7) {
      for (let x = 0; x < tiles.width; x += 7) {
        const walking = rules.blocked(scene.player, x, y)
        scene.player.running = true
        expect(rules.blocked(scene.player, x, y)).toBe(walking)
        scene.player.running = false
      }
    }
  })
})
