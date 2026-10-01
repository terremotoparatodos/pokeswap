/**
 * CAVES-3: the `presence:error` reason of a refused change of area (a cave
 * entered away from its mouth, or left away from its exit pad). It is always
 * followed by a snapshot of the area and tile the actor really has, which the
 * client must accept even though it asked for another area.
 *
 * Dependency-free on purpose: the browser imports it.
 */
export const AREA_TRANSITION_DENIED = 'area transition denied'
