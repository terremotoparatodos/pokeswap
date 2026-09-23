/**
 * Where the presence service places an actor that enters a shared area.
 *
 * Dependency-free on purpose: the browser's guard test imports it. Every value
 * must equal what the client's `Area.arrival(from)` returns, because the client
 * moves optimistically from its own arrival while the server applies the same
 * direction intents from this one. Any difference becomes a permanent offset;
 * in Pradera the old `(8, 41)` was the town's west-gate tile and falls on solid
 * terrain, which made every entry trigger the client's safe-spawn recovery,
 * whose own `area` request landed on the same solid tile again.
 */
export const ARRIVALS = Object.freeze({
  /** Town spawn: first join, the "Ciudad" escape hatch and any same-area reset. */
  'ciudad-corazon': Object.freeze({ tx: 31, ty: 20, dir: 'down' }),
  /** `WildArea.arrival()` for seed 208 (`World.findSpawn(['grassland'])`). */
  pradera: Object.freeze({ tx: -5, ty: -69, dir: 'down' }),
})

/** The town tile in front of the west gate, where the Pradera return pad lands. */
export const TOWN_FROM_PRADERA = Object.freeze({ tx: 8, ty: 41, dir: 'right' })

/** Mirrors `TownArea.arrival(from)` / `WildArea.arrival()` for the two presence areas. */
export function arrivalFor(to, from) {
  if (to === 'ciudad-corazon' && from === 'pradera') return TOWN_FROM_PRADERA
  return ARRIVALS[to] ?? null
}
