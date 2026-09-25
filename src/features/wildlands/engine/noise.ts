// Deterministic hashing and value noise — WildLands prototype
//
// The same seed always yields the same world, so nothing needs persisting.
// Since WORLD-1 the functions live in the realtime service's dependency-free
// terrain module, which the browser bundles and the server runs as is: one
// generator, never two copies that could drift apart.

export { fbm, hash2, valueNoise } from '../../../../services/realtime/src/world/terrain.js'
