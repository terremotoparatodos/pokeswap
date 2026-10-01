/**
 * Where the presence service places an actor that enters a shared area.
 *
 * Dependency-free on purpose: the browser's guard test imports it (it only
 * reads the dependency-free cave and town sources). Every value must equal what the
 * client's `Area.arrival(from)` returns, because the client moves
 * optimistically from its own arrival while the server applies the same
 * direction intents from this one. Any difference becomes a permanent offset;
 * in Pradera the old `(8, 41)` was the town's west-gate tile and falls on solid
 * terrain, which made every entry trigger the client's safe-spawn recovery,
 * whose own `area` request landed on the same solid tile again.
 */
import { caveByInterior } from '../world/caves.js'
import { CAVE_INTERIORS } from '../world/caveLayouts.js'
import { TOWN_GATES, TOWN_SPAWN } from '../world/townLayout.js'

const interiorArrivals = Object.fromEntries(Object.values(CAVE_INTERIORS)
  .map(interior => [interior.id, Object.freeze({ tx: interior.arrival.tx, ty: interior.arrival.ty, dir: interior.arrival.dir })]))

export const ARRIVALS = Object.freeze({
  /** Town spawn: first join, the "Ciudad" escape hatch and any same-area reset. */
  'ciudad-corazon': TOWN_SPAWN,
  /** `WildArea.arrival()` for seed 208 (`World.findSpawn(['grassland'])`). */
  pradera: Object.freeze({ tx: -5, ty: -69, dir: 'down' }),
  /** CAVES-3: inside a cave, the `S` tile of its layout, facing in. */
  ...interiorArrivals,
})

/** The town tile in front of the west gate, where the Pradera return pad lands. */
export const TOWN_FROM_PRADERA = TOWN_GATES.find(gate => gate.to === 'pradera').arrival

/**
 * Mirrors `TownArea.arrival(from)` / `WildArea.arrival(from)` / `CaveArea.arrival()`.
 * Leaving a cave lands on its approach, the walkable tile in front of the
 * mouth: never the mouth itself, so walking out cannot walk straight back in.
 */
export function arrivalFor(to, from) {
  if (to === 'ciudad-corazon' && from === 'pradera') return TOWN_FROM_PRADERA
  const cave = caveByInterior(from)
  if (cave && to === cave.areaId) return Object.freeze({ tx: cave.approach.tx, ty: cave.approach.ty, dir: 'down' })
  return ARRIVALS[to] ?? null
}
