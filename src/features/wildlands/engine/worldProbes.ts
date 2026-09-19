// Several features answering the engine's three world probes.
//
// `GameOptions` takes one `onWorldObject`, one `isWorldObject` and one
// `placedObjectsIn`, which was enough while the professions demo was the only
// thing putting objects in the world. It is not enough once dungeon entrances
// do it too, and the answer is the same one `CompositeOverlay` already gives
// for drawing: compose, do not widen the engine.
//
// The rules are the obvious ones, stated so they cannot drift:
//   - `inspect` stops at the first provider that handles the tile, because an
//     interaction belongs to exactly one thing;
//   - `isWorldObject` is true when any provider claims the tile, because the
//     navigator only wants to know whether to walk up to it and face it;
//   - `placedObjects` concatenates, because the physical layer is a union.

import type { Area } from './area'
import type { PlacedObjectSpec } from './placedObjects'

/** A tile the engine asks about. Structurally the engine's own WorldObjectTarget. */
export interface WorldProbeTarget {
  readonly area: Area
  readonly tx: number
  readonly ty: number
}

export interface WorldProbeProvider {
  inspect(target: WorldProbeTarget): boolean
  isWorldObject(target: WorldProbeTarget): boolean
  placedObjects(area: Area): readonly PlacedObjectSpec[]
}

export interface WorldProbes {
  inspect(target: WorldProbeTarget): boolean
  isWorldObject(target: WorldProbeTarget): boolean
  placedObjects(area: Area): readonly PlacedObjectSpec[]
}

/**
 * `providers` is a function because the callers are Vue template refs: they are
 * null until their component mounts, and asking for them per call avoids
 * capturing that null forever.
 */
export function composeWorldProbes(providers: () => readonly (WorldProbeProvider | null | undefined)[]): WorldProbes {
  const present = () => providers().filter((provider): provider is WorldProbeProvider => !!provider)
  return {
    inspect(target) {
      for (const provider of present()) if (provider.inspect(target)) return true
      return false
    },
    isWorldObject(target) {
      return present().some(provider => provider.isWorldObject(target))
    },
    placedObjects(area) {
      return present().flatMap(provider => [...provider.placedObjects(area)])
    },
  }
}
