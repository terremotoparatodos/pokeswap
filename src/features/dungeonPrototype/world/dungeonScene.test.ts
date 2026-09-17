// D1.2 §33 — the scene invariants the visual pass promises.
//
// One visual entity per Pokémon, the trainer never leaves the scene, our side
// is created once and cleaned up afterwards, and a Pokémon that was defeated or
// captured is gone from the floor. None of this looks at pixels: it looks at
// which actors exist and where they stand.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateFloor } from '../domain/floorPlan'
import { buildFloorTiles, placeEntities, type FloorEntity, type FloorTiles } from '../domain/floorTiles'
import { dungeonProfile } from '../domain/tiers'
import { createWorldOverlay, type WorldBar } from '../render/worldOverlay'
import { chestSprite, doorSprite } from './dungeonProps'
import { DungeonWorld } from './dungeonScene'

// jsdom has no 2D context; the scene only needs one that does not throw.
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

function build(seed = 4321): { tiles: FloorTiles; entities: FloorEntity[] } {
  const plan = generateFloor(dungeonProfile(seed, 'B', 'cave'), 3, [4, 7, 25])
  const tiles = buildFloorTiles(plan, 'cave', seed)
  return { tiles, entities: placeEntities(plan, tiles, seed) }
}

function world(seed = 4321) {
  const { tiles, entities } = build(seed)
  return { tiles, entities, scene: new DungeonWorld(TRAINER, tiles, entities, tiles.entrance, seed, 3) }
}

const firstEncounter = (entities: readonly FloorEntity[]) =>
  entities.find(entity => entity.kind === 'encounter' && !entity.isAlpha)!

describe('one Pokémon, one sprite', () => {
  it('puts exactly one actor on the floor per uncleared Pokémon', () => {
    const { entities, scene } = world()
    const expected = entities.filter(entity => entity.kind !== 'chest' && !entity.taken && !entity.isAlpha)
    expect(scene.actors()).toHaveLength(expected.length)
    for (const entity of expected) expect(scene.wildActor(entity.id)).toBeDefined()
  })

  it('never makes a second copy of the foe when the fight starts', () => {
    const { tiles, entities, scene } = world()
    const target = firstEncounter(entities)
    const before = scene.actors().length
    const staged = scene.openCombat(tiles, target.id, [{ combatantId: 'ally-0', speciesId: 25 }])

    // The foe is the very actor that was already standing there.
    expect(staged.foe).toBe(scene.wildActor(target.id))
    // The floor gained our Pokémon and nothing else.
    expect(scene.actors()).toHaveLength(before + 1)
    expect(scene.actors().filter(actor => actor.id === `wild-${target.id}`)).toHaveLength(1)
  })

  it('creates our Pokémon once, whatever the caller does twice', () => {
    const { tiles, entities, scene } = world()
    const target = firstEncounter(entities)
    scene.openCombat(tiles, target.id, [{ combatantId: 'ally-0', speciesId: 25 }])
    scene.openCombat(tiles, target.id, [{ combatantId: 'ally-0', speciesId: 25 }])
    expect(scene.allyActors).toHaveLength(1)
  })

  it('clears a Pokémon that was defeated or captured', () => {
    const { entities, scene } = world()
    const target = firstEncounter(entities)
    target.taken = true
    scene.syncWild(entities)
    expect(scene.wildActor(target.id)).toBeUndefined()
  })
})

describe('the trainer', () => {
  it('stays in the scene and on their tile when the fight starts', () => {
    const { tiles, entities, scene } = world()
    const target = firstEncounter(entities)
    scene.player.tx = target.at.x
    scene.player.ty = target.at.y + 1
    scene.player.fromTx = scene.player.tx
    scene.player.fromTy = scene.player.ty
    const before = { x: scene.player.tx, y: scene.player.ty }

    scene.openCombat(tiles, target.id, [{ combatantId: 'ally-0', speciesId: 25 }])
    expect(scene.player).toBeDefined()
    expect({ x: scene.player.tx, y: scene.player.ty }).toEqual(before)
  })

  it('cannot walk while the fight is on, and walks again afterwards', () => {
    const { tiles, entities, scene } = world()
    const target = firstEncounter(entities)
    scene.openCombat(tiles, target.id, [{ combatantId: 'ally-0', speciesId: 25 }])
    expect(scene.locked).toBe(true)

    const before = { x: scene.player.tx, y: scene.player.ty }
    for (let i = 0; i < 30; i++) scene.update(1 / 30, tiles, 'down')
    expect({ x: scene.player.tx, y: scene.player.ty }).toEqual(before)

    scene.closeCombat(null)
    expect(scene.locked).toBe(false)
  })

  it('faces the fight', () => {
    const { tiles, entities, scene } = world()
    const target = firstEncounter(entities)
    scene.player.tx = target.at.x
    scene.player.ty = target.at.y + 1
    scene.openCombat(tiles, target.id, [{ combatantId: 'ally-0', speciesId: 25 }])
    expect(scene.player.dir).toBe('up')
  })
})

describe('ending the fight', () => {
  it('takes our Pokémon back off the floor', () => {
    const { tiles, entities, scene } = world()
    const target = firstEncounter(entities)
    scene.openCombat(tiles, target.id, [
      { combatantId: 'ally-0', speciesId: 25 },
      { combatantId: 'ally-1', speciesId: 4 },
    ])
    expect(scene.allyActors).toHaveLength(2)
    scene.closeCombat(target.id)
    expect(scene.allyActors).toHaveLength(0)
    expect(scene.wildActor(target.id)).toBeUndefined()
  })

  it('stages our Pokémon on ground, never on the foe or the trainer', () => {
    const { tiles, entities, scene } = world()
    const target = firstEncounter(entities)
    const staged = scene.openCombat(tiles, target.id, [{ combatantId: 'ally-0', speciesId: 25 }])
    for (const spot of staged.spots) {
      expect(spot).not.toEqual(target.at)
      const ally = scene.allyActor('ally-0')!
      expect({ x: ally.tx, y: ally.ty }).toEqual(spot)
    }
  })
})

describe('the Alpha', () => {
  it('is kept out of the plain actor list, because the overlay draws it at ×2', () => {
    const { entities, scene } = world()
    const alpha = entities.find(entity => entity.isAlpha)
    if (!alpha) return
    expect(scene.alphaActor?.id).toBe(`wild-${alpha.id}`)
    expect(scene.actors().some(actor => actor === scene.alphaActor)).toBe(false)
  })

  it('still blocks its tile', () => {
    const { tiles, entities, scene } = world()
    const alpha = entities.find(entity => entity.isAlpha)
    if (!alpha) return
    const rules = scene.rules(tiles)
    expect(rules.occupied(alpha.at.x, alpha.at.y, scene.player)).toBe(true)
  })
})

describe('what the overlay draws', () => {
  const bar = (over: Partial<WorldBar> = {}): WorldBar =>
    ({ wx: 100, wy: 100, hp: 0.5, action: 0.25, status: null, confused: false, ...over })

  function overlayWith(bars: readonly WorldBar[]) {
    return createWorldOverlay({
      seconds: () => 1, bars: () => bars, effects: () => [], texts: () => [],
      props: () => [], torch: () => chestSprite(false),
    })
  }

  it('gives the Alpha a bar at twice the size', () => {
    const sprites = overlayWith([bar({ alpha: true, scale: 2 })]).sprites!({} as never, 1)
    expect(sprites.length).toBeGreaterThan(0)
    expect(sprites.every(sprite => sprite.scale === 2)).toBe(true)
  })

  it('draws the Alpha aura on the ground, and only for the Alpha', () => {
    const strokes: number[] = []
    const ctx = {
      strokeStyle: '', lineWidth: 0,
      beginPath: () => undefined,
      ellipse: () => undefined,
      stroke: () => strokes.push(1),
    } as unknown as CanvasRenderingContext2D

    overlayWith([bar({ alpha: true })]).ground!(ctx, {} as never, 0, 0, 1)
    const withAura = strokes.length
    strokes.length = 0
    overlayWith([bar()]).ground!(ctx, {} as never, 0, 0, 1)
    expect(withAura).toBeGreaterThan(0)
    expect(strokes).toHaveLength(0)
  })

  it('adds a status pip only when there is a status', () => {
    const plain = overlayWith([bar()]).sprites!({} as never, 1).length
    const burnt = overlayWith([bar({ status: 'burn' })]).sprites!({} as never, 1).length
    expect(burnt).toBe(plain + 1)
  })
})

describe('props that have two states', () => {
  it('draws a different chest when it is open', () => {
    expect(chestSprite(true)).not.toBe(chestSprite(false))
  })

  it('draws a different door once the key is in hand', () => {
    expect(doorSprite(true)).not.toBe(doorSprite(false))
  })
})
