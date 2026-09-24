import { describe, expect, it } from 'vitest'
import { Atlas } from '../areas/atlas'
import { createActor } from '../engine/actors'
import { SCENARIOS, ScenarioDriver } from './scenarioDriver'

const controls = { setVirtualDir() {}, setVirtualSprint() {} }

describe('scenario driver routes', () => {
  for (const def of Object.values(SCENARIOS)) {
    it(`${def.id}: every leg has a path over the real collision`, () => {
      const atlas = new Atlas()
      const driver = new ScenarioDriver(def, controls) as unknown as {
        plan(player: unknown, area: unknown, w: unknown): { tx: number; ty: number }[] | null
      }
      let area = atlas.get(def.startArea)
      let at = { ...def.start }
      for (const w of def.waypoints) {
        if (area.id !== w.area) {
          const from = area.id
          area = atlas.get(w.area)
          at = area.arrival(from)
        }
        const player = createActor({ id: 'p', kind: 'player', habitat: 'any', tx: at.tx, ty: at.ty })
        const path = driver.plan(player, area, w)
        expect(path, `${def.id} → ${w.area} ${w.tx},${w.ty}`).not.toBeNull()
        // The route starts where the player stands, or the driver cannot find it on it.
        expect(path![0]).toEqual({ tx: at.tx, ty: at.ty })
        at = path![path!.length - 1]
      }
    })
  }
})
