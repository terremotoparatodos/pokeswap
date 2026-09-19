// Where the Dungeon caves land in every WildLands world, and how far they are
// from the point players arrive at.
//
// Density is a product claim — "a tester finds an entrance in one to three
// minutes" — and a claim like that should be measured rather than felt. This
// prints the real placement against the real procedural worlds, so the
// playtest parameters in `entranceSpawns.ts` can be tuned by looking.
//
//   npm run dungeon:entrances
//
// PLAYTEST TOOL. It reads the world and writes nothing.

import { Atlas, WORLDS } from '../src/features/wildlands/areas/atlas'
import { areaEntrances, COMMUNITY_PLAYTEST_DENSITY } from '../src/features/dungeonEntrances/domain/entranceSpawns'

/** Same derivation the component uses, so this measures what players get. */
function seedOf(areaId: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < areaId.length; i++) hash = Math.imul(hash ^ areaId.charCodeAt(i), 0x01000193) >>> 0
  return hash
}

const atlas = new Atlas()
const now = Date.now()
const chebyshev = (a: { tx: number; ty: number }, b: { tx: number; ty: number }) =>
  Math.max(Math.abs(a.tx - b.tx), Math.abs(a.ty - b.ty))

const lines: string[] = []
lines.push(`density: ${COMMUNITY_PLAYTEST_DENSITY.count} caves, rings ${COMMUNITY_PLAYTEST_DENSITY.minRing}–${COMMUNITY_PLAYTEST_DENSITY.maxRing}, spacing ${COMMUNITY_PLAYTEST_DENSITY.minSpacing}`)

for (const world of WORLDS) {
  const area = atlas.get(world.id)
  const origin = area.arrival(null)
  const entrances = areaEntrances({
    areaId: world.id,
    origin,
    seed: seedOf(world.id),
    now,
    port: {
      isSolid: (tx, ty) => area.isSolid(tx, ty),
      isWater: (tx, ty) => area.isWater(tx, ty),
      isTaken: (tx, ty) => area.portals.some(portal => portal.tiles.some(tile => tile.tx === tx && tile.ty === ty)),
    },
  })
  const rings = entrances.map(entrance => chebyshev(entrance.placement.anchor, origin)).sort((a, b) => a - b)
  lines.push('')
  lines.push(`${world.name} (${world.id}) — arrival (${origin.tx}, ${origin.ty}) — ${entrances.length} caves`)
  lines.push(`  nearest ${rings[0] ?? '—'} tiles, furthest ${rings.at(-1) ?? '—'} tiles`)
  for (const { definition, placement } of entrances) {
    const { anchor, approach } = placement
    lines.push(
      `  ${definition.name.padEnd(18)} rock (${String(anchor.tx).padStart(5)}, ${String(anchor.ty).padStart(5)})` +
      `  stand at (${String(approach.tx).padStart(5)}, ${String(approach.ty).padStart(5)})` +
      `  ${String(chebyshev(anchor, origin)).padStart(3)} tiles out`,
    )
  }
}

process.stdout.write(`${lines.join('\n')}\n`)
