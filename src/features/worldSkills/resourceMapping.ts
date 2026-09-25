// WORLD node → SKILLS resource (INTEGRATION-1).
//
// WORLD knows a node physically: "a pine in the tundra, 2 rings out, at this
// tile". SKILLS knows resources: `pine_tree` needs Talar 12 and gives pine
// logs. Which resource a given physical node *is* uses SKILLS' own advisory
// placement hints (`RESOURCES[].world`: anchors, habitats, ring, weight) with
// the same deterministic roll the SKILLS playtest already used, so every tree
// keeps the resource it had there. Pure and shared: the browser uses it to
// label and draw a node, the realtime service (bundled) to authorize work on it.
// Neither side can disagree about what a node is.
//
// No rule lives here: levels, durations and rewards stay in SKILLS.

import { hash2 } from '../../../services/realtime/src/world/terrain.js'
import { worldArea } from '../../../services/realtime/src/world/areas.js'
import { RESOURCES, RESOURCE_BY_ID, type ResourceAnchor, type ResourceDefinition } from '../skills/domain/resources'

/** The physical facts WORLD publishes about a node (its public node facts). */
export interface WorldNodeFacts {
  readonly areaId: string
  readonly tx: number
  readonly ty: number
  readonly variantId: string
  readonly biome: string
  /** WORLD's distance ring (0–3). SKILLS' ladder uses rings 0–2. */
  readonly zone: number
}

/** The salt the SKILLS playtest rolled resources with (`localWorld/nodePlacement.ts`). */
const RESOURCE_SALT = 31_031 + 1
const MAX_SKILLS_RING = 2

/** The SKILLS resource a WORLD node is, or null when no resource fits it. */
export function skillsResourceFor(node: WorldNodeFacts): ResourceDefinition | null {
  const area = worldArea(node.areaId)
  if (!area?.procedural || area.seed === null) return null
  const anchor = node.variantId as ResourceAnchor
  const ring = Math.min(MAX_SKILLS_RING, node.zone)
  const candidates = RESOURCES.filter(resource => resource.world.anchors.includes(anchor)
    && (resource.world.habitats as readonly string[]).includes(node.biome) && resource.world.minRing <= ring)
  if (!candidates.length) return null
  const total = candidates.reduce((sum, resource) => sum + resource.world.spawnWeight, 0)
  let roll = hash2(node.tx, node.ty, area.seed + RESOURCE_SALT) * total
  for (const resource of candidates) {
    roll -= resource.world.spawnWeight
    if (roll < 0) return resource
  }
  return candidates[candidates.length - 1]
}

export const resourceById = (id: string): ResourceDefinition | null => RESOURCE_BY_ID.get(id) ?? null
