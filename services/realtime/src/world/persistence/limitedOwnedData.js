/** Capability facade, not a second reader. No persistent work, location or host operations. */
export function limitedOwnedData(authority) {
  if (typeof authority?.readEcoCombatants !== 'function') throw new Error('limited owned read unavailable')
  return Object.freeze({
    readEcoCombatants: (userId, slotPokemonId = null) => authority.readEcoCombatants(userId, slotPokemonId),
    // Transport compatibility only: this release never hydrates SKILLS or persistent nodes.
    playerState: async () => ({ xp: {}, materials: {}, pokemon: [] }),
    loadNodes: async () => [],
  })
}
