import { describe, expect, it } from 'vitest'
import { advance, type Actor } from '../../wildlands/engine/actors'
import type { RanchResident } from '../domain/membership'
import { createMockSnapshot } from '../data/mockSnapshot'
import { RanchMap } from './ranchMap'
import { createInhabitants, inhabitantRules, ROAM, THINK_MAX, THINK_MIN, thinkInhabitant } from './residents'
import { buildSlots, slotCapacity } from './slots'

const map = new RanchMap()
const slots = buildSlots(map)
const snapshot = createMockSnapshot(120, slotCapacity(slots), new Date('2026-09-01T00:00:00Z'))

function lives(residents: readonly RanchResident[] = snapshot.residents) {
  return createInhabitants(residents, slots, 0)
}

/** Runs the ranch for `seconds`, returning how many steps each inhabitant took. */
function live(seconds: number): { steps: number[]; actors: Actor[] } {
  const inhabitants = lives()
  const rules = inhabitantRules(map, () => false)
  const steps = inhabitants.map(() => 0)
  const at = inhabitants.map(life => `${life.actor.tx},${life.actor.ty}`)
  const dt = 1 / 30
  for (let t = 0; t < seconds; t += dt) {
    inhabitants.forEach((life, i) => {
      advance(life.actor, dt)
      thinkInhabitant(life, t, rules)
      const now = `${life.actor.tx},${life.actor.ty}`
      if (now !== at[i]) {
        at[i] = now
        steps[i]++
      }
    })
  }
  return { steps, actors: inhabitants.map(life => life.actor) }
}

describe('inhabitants', () => {
  it('gives everyone with a home a starting tile', () => {
    const inhabitants = lives()
    expect(inhabitants).toHaveLength(snapshot.residents.length)
    for (const life of inhabitants) {
      expect(map.isHabitable(life.actor.tx, life.actor.ty)).toBe(true)
    }
  })

  it('spreads the first decisions across the whole think window', () => {
    const times = lives().map(life => life.actor.nextThink)
    expect(Math.min(...times)).toBeGreaterThanOrEqual(THINK_MIN)
    expect(Math.max(...times)).toBeLessThanOrEqual(THINK_MAX)
    // Not everyone at once: the spread is wider than a single second.
    expect(Math.max(...times) - Math.min(...times)).toBeGreaterThan(5)
  })

  it('stays calm: a minute is a handful of steps, not constant walking', () => {
    const { steps } = live(60)
    const average = steps.reduce((a, b) => a + b, 0) / steps.length
    expect(average).toBeGreaterThan(0.5)
    expect(average).toBeLessThan(10)
  })

  it('never wanders far from home or out of its zone', () => {
    const inhabitants = lives()
    const homes = inhabitants.map(life => map.zoneAt(life.actor.homeTx, life.actor.homeTy))
    const { actors } = live(180)
    actors.forEach((actor, i) => {
      expect(Math.abs(actor.tx - actor.homeTx), `${actor.id} x`).toBeLessThanOrEqual(ROAM + 1)
      expect(Math.abs(actor.ty - actor.homeTy), `${actor.id} y`).toBeLessThanOrEqual(ROAM + 1)
      expect(map.zoneAt(actor.tx, actor.ty), `${actor.id} zona`).toBe(homes[i])
    })
  })

  it('never steps onto a path, water or a prop', () => {
    const { actors } = live(120)
    for (const actor of actors) expect(map.isHabitable(actor.tx, actor.ty), actor.id).toBe(true)
  })

  it('is deterministic: the same ranch behaves the same way twice', () => {
    const first = live(45).actors.map(a => `${a.tx},${a.ty},${a.dir}`)
    const again = live(45).actors.map(a => `${a.tx},${a.ty},${a.dir}`)
    expect(again).toEqual(first)
  })

  it('refuses a step onto a tile someone else holds', () => {
    const rules = inhabitantRules(map, (tx, ty) => tx === 1 && ty === 1)
    const life = lives()[0]
    expect(rules.occupied(1, 1, life.actor)).toBe(true)
    expect(rules.occupied(2, 1, life.actor)).toBe(false)
  })
})
