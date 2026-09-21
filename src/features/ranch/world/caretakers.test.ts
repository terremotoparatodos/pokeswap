import { describe, expect, it } from 'vitest'
import { caretakerRoutes, caretakerRules, createCaretakers, tickCaretaker } from './caretakers'
import { RanchMap } from './ranchMap'

const map = new RanchMap()
const rules = caretakerRules(map)

describe('Guti and Sky', () => {
  it('are the only two people on the ranch', () => {
    const routes = caretakerRoutes()
    expect(routes.map(route => route.name)).toEqual(['Guti', 'Sky'])
  })

  it('start on walkable ground and only visit walkable stops', () => {
    for (const caretaker of createCaretakers(caretakerRoutes(), map, 0)) {
      expect(map.isSolid(caretaker.actor.tx, caretaker.actor.ty), caretaker.name).toBe(false)
      for (const stop of caretaker.stops) {
        expect(map.isSolid(stop.tx, stop.ty), `${caretaker.name} ${stop.tx},${stop.ty}`).toBe(false)
      }
    }
  })

  it('reach their stops rather than getting stuck on the way', () => {
    const caretakers = createCaretakers(caretakerRoutes(), map, 0)
    const dt = 1 / 30
    const visited = caretakers.map(() => new Set<string>())
    for (let t = 0; t < 600; t += dt) {
      caretakers.forEach((caretaker, i) => {
        tickCaretaker(caretaker, t, dt, rules)
        if (caretaker.steps.length === 0) visited[i].add(`${caretaker.actor.tx},${caretaker.actor.ty}`)
      })
    }
    // Ten minutes is enough for several stops each, and they keep moving.
    caretakers.forEach((caretaker, i) => {
      expect(visited[i].size, `${caretaker.name} paradas`).toBeGreaterThan(2)
    })
  })

  it('walk unhurriedly: long stands between short walks', () => {
    const caretakers = createCaretakers(caretakerRoutes(), map, 0)
    const dt = 1 / 30
    let walking = 0
    let frames = 0
    for (let t = 0; t < 300; t += dt) {
      for (const caretaker of caretakers) {
        tickCaretaker(caretaker, t, dt, rules)
        if (caretaker.steps.length > 0) walking++
        frames++
      }
    }
    expect(walking / frames).toBeLessThan(0.75)
  })

  it('never walk through a fence, a building or the lake', () => {
    const caretakers = createCaretakers(caretakerRoutes(), map, 0)
    const dt = 1 / 30
    for (let t = 0; t < 300; t += dt) {
      for (const caretaker of caretakers) {
        tickCaretaker(caretaker, t, dt, rules)
        expect(map.isSolid(caretaker.actor.tx, caretaker.actor.ty), caretaker.name).toBe(false)
      }
    }
  })
})
