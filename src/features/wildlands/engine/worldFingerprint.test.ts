// Frozen fingerprint of the procedural generator (WORLD-1).
//
// The realtime service validates resource nodes and wild spawns with the very
// same generator the browser draws, so the generator moved to a dependency-free
// module both sides import. These hashes were taken from the TypeScript
// generator at `playtest-0.2` (dc6dc70) *before* the move: any change to a
// biome, a terrain id or a decor pick anywhere in the sampled windows fails
// here. Never update them to make a refactor pass; a new value is a new world.

import { describe, expect, it } from 'vitest'
import { World } from './world'

function fingerprint(seed: number, x0: number, y0: number, size: number): string {
  const world = new World(seed)
  let h = 0x811c9dc5
  const mix = (value: number) => { h = Math.imul(h ^ value, 0x01000193) >>> 0 }
  const biomes = ['deep', 'ocean', 'beach', 'desert', 'grassland', 'forest', 'tundra']
  const decors = [null, 'cactus', 'rock', 'boulder', 'drybush', 'tree', 'pine', 'snowpine', 'bush', 'palm', 'icerock', 'searock', 'coral', 'shell', 'crystal']
  for (let ty = y0; ty < y0 + size; ty++) {
    for (let tx = x0; tx < x0 + size; tx++) {
      mix(world.tileTerrain(tx, ty))
      mix(biomes.indexOf(world.biomeAt(tx + 0.5, ty + 0.5)))
      mix(decors.indexOf(world.decorAt(tx, ty)))
    }
  }
  return h.toString(16)
}

describe('procedural world fingerprint', () => {
  it.each([
    [208, -5, -69, 'PRADERA_SPAWN'],
    [208, -220, -300, 'PRADERA_FAR'],
    [1, 0, 0, 'SEED_1'],
    [9001, 500, -500, 'SEED_9001'],
  ])('seed %i around (%i, %i) is unchanged', (seed, cx, cy, key) => {
    expect(fingerprint(seed, cx - 128, cy - 128, 256)).toBe(EXPECTED[key as keyof typeof EXPECTED])
  })
})

const EXPECTED = {
  PRADERA_SPAWN: 'f9432cc3',
  PRADERA_FAR: 'ae5b0cfa',
  SEED_1: '2be7d661',
  SEED_9001: '823f2b80',
}
