// First-paint art preload — Ciudad Corazón
//
// The town has code-drawn fallbacks, so a failed image never blocks entry.
// Pokémon overworld sheets intentionally stay demand-loaded in population.ts.

import { HEARTHOME } from '../areas/atlas'
import { DEFAULT_PLAYER_CHARACTER_ID, playerCharacter } from '../identity/playerCharacters'

function loadImage(src: string): Promise<void> {
  return new Promise(resolve => {
    const image = new Image()
    image.onload = image.onerror = () => resolve()
    image.src = src
  })
}

/** Preloads the city sprites and default protagonist needed for the first scene. */
export function preloadLobbyArt(): Promise<void> {
  const art = HEARTHOME.art
  const sources = new Set<string>([playerCharacter(DEFAULT_PLAYER_CHARACTER_ID).sheetUrl])
  for (const building of HEARTHOME.buildings) if (building.image) sources.add(building.image.src)
  for (const tree of art?.trees ?? []) sources.add(tree)
  for (const fountain of art?.fountains ?? []) sources.add(fountain.src)
  for (const variants of Object.values(art?.props ?? {})) for (const image of variants ?? []) sources.add(image.src)
  return Promise.all([...sources].map(loadImage)).then(() => undefined)
}
