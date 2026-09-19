// Dialogue lines — WildLands prototype
//
// What Pokémon and NPCs say when the player talks to them. Residents with
// their own lines use those; everyone else picks a stock line by tile.

import type { Actor } from './actors'

const TRAINER_LINES = [
  '«¡Qué calor hace por acá!»',
  '«Dicen que de noche aparecen cristales raros.»',
  '«Mi Pokémon se escapó hacia el agua…»',
  '«Estoy entrenando para el próximo swap.»',
]
const TOWN_LINES = [
  '«¿Ya elegiste a qué mundo ir hoy?»',
  '«Me encanta pasear por la plaza de las fuentes.»',
  '«Hoy me toca un Swap en Silph Co.»',
  '«Vengo de la Costa Coral, ¡hay Pokémon nadando por todos lados!»',
]

/** Line for a Pokémon or NPC standing on (tx, ty); null for anything else. */
export function actorLine(actor: Actor, town: boolean, tx: number, ty: number): string | null {
  if (actor.pokemon) {
    if (town) return `${actor.pokemon.name} te saluda contento.`
    if (actor.pokemon.shiny) return `✨ ¡Un ${actor.pokemon.name} shiny salvaje! ✨`
    return `¡Un ${actor.pokemon.name} salvaje te mira fijo!`
  }
  if (actor.kind !== 'npc') return null
  const lines = actor.lines ?? (town ? TOWN_LINES : TRAINER_LINES)
  return lines[Math.abs(tx * 7 + ty * 13) % lines.length]
}
