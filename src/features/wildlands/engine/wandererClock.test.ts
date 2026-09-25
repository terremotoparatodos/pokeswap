// WORLD-1: populace actors never walk on local simulation. Two clients agree
// before the server clock arrives (everyone frozen on the same tiles) and after
// (everyone on the same shared patrol).

import { describe, expect, it } from 'vitest'
import { Population } from './population'
import { driveWanderer } from './patrolMotion'
import { World } from './world'
import type { SharedPopulace } from './area'

function client() {
  let serverNow: number | null = null
  const shared: SharedPopulace = {
    serverNow: () => serverNow,
    wildRoster: () => null,
    walkable: (_habitat, tx, ty) => !world.isSolid(tx, ty) && !world.isWater(tx, ty),
  }
  const world = new World(208)
  const population = new Population(world, [], [])
  population.share(shared)
  const frame = (at: number | null) => {
    serverNow = at
    population.update(-5, -69)
    for (const actor of population.actors) driveWanderer(actor, serverNow)
  }
  const poses = () => population.actors
    .map(a => `${a.id}@${a.fromTx},${a.fromTy}>${a.tx},${a.ty}:${a.progress.toFixed(3)}:${a.dir}`)
    .sort()
  return { population, frame, poses }
}

describe('wanderers and the server clock', () => {
  it('before the clock, two clients do not diverge: every NPC stays on its deterministic tile', () => {
    const a = client()
    const b = client()
    a.frame(null)
    const start = a.poses()
    expect(start.length).toBeGreaterThan(0)
    // Many frames, and a different number on each client: nobody moves.
    for (let i = 0; i < 300; i++) a.frame(null)
    for (let i = 0; i < 17; i++) b.frame(null)
    expect(a.poses()).toEqual(start)
    expect(b.poses()).toEqual(start)
    expect(a.population.actors.every(actor => actor.tx === actor.homeTx && actor.ty === actor.homeTy && actor.progress === 1)).toBe(true)
  })

  it('after the clock, both compute the same patrol, and it moves', () => {
    const a = client()
    const b = client()
    a.frame(null)
    for (let i = 0; i < 40; i++) b.frame(null) // B waited longer for the clock: irrelevant
    let moved = false
    const start = a.poses()
    for (let t = 1_727_000_000_000; t < 1_727_000_090_000; t += 250) {
      a.frame(t)
      b.frame(t)
      expect(a.poses()).toEqual(b.poses())
      if (a.poses().join() !== start.join()) moved = true
    }
    expect(moved).toBe(true)
    expect(a.population.actors.every(actor => actor.patrol)).toBe(true)
  })
})
