// ECO-PRESENTATION-1 (experimental, development builds only): the words the test-battle screens
// show. Presentation only — the server decides every outcome and every refusal; this only names
// them. Nothing here suggests a capture, a reward or anything kept.

import type { EcoBattleOutcome } from '../../../../services/realtime/src/world/worldProtocol.js'

/** The end of a test battle, as the player reads it. */
export const ECO_OUTCOME_TEXT: Readonly<Record<EcoBattleOutcome, { readonly title: string; readonly detail: string }>> = {
  victory: { title: 'Victoria', detail: 'El Pokémon salvaje se fue de esta zona para todos. Es una simulación: no hay captura ni recompensa.' },
  defeat: { title: 'Derrota', detail: 'Tu Pikachu de prueba se debilitó. El Pokémon salvaje sigue en el mapa.' },
  draw: { title: 'Empate', detail: 'Ninguno quedó en pie. El Pokémon salvaje sigue en el mapa.' },
  fled: { title: 'Huiste', detail: 'El Pokémon salvaje sigue en el mapa y queda libre.' },
  expired: { title: 'Se acabó el tiempo', detail: 'El combate de prueba llegó a su límite sin ganador. El Pokémon salvaje sigue en el mapa.' },
  disconnected: { title: 'Combate liberado', detail: 'Pasó demasiado tiempo sin conexión. El Pokémon salvaje sigue en el mapa.' },
  'left-area': { title: 'Combate liberado', detail: 'Saliste del área. El Pokémon salvaje sigue en el mapa.' },
  vanished: { title: 'Combate terminado', detail: 'Ese Pokémon ya no está en el mapa.' },
}

/** ECO-BATTLE-SPECTATORS-1: how someone else's battle ended, as a short label over it (shown briefly). */
export const ECO_SPECTATOR_OUTCOME_TEXT: Readonly<Record<EcoBattleOutcome, string>> = {
  victory: 'Ganó',
  defeat: 'Perdió',
  draw: 'Empate',
  fled: 'Huyó',
  expired: 'Sin ganador',
  disconnected: 'Combate liberado',
  'left-area': 'Combate liberado',
  vanished: 'Combate terminado',
}

/** Why the server did not start a battle (or why the request did not reach it). */
export const ECO_REFUSAL_TEXT: Readonly<Record<string, string>> = {
  busy: 'Otro entrenador lo está combatiendo.',
  'too-far': 'Estás demasiado lejos.',
  'no-room': 'No hay lugar delante de ese Pokémon para tu Pikachu: probá desde otro lado.',
  'other-area': 'Está en otra área.',
  'not-alive': 'Ya no está aquí.',
  'already-battling': 'Ya tenés un combate en curso.',
  'battle-unavailable': 'Los combates de prueba no están disponibles.',
  unavailable: 'La población no está disponible.',
  'not-player': 'Solo los jugadores pueden combatir.',
  'not-current-socket': 'Esta pestaña ya no es tu sesión activa.',
  'client-outdated': 'Actualizá la página.',
  disabled: 'El servidor no tiene el experimento activo.',
  invalid: 'Pedido inválido.',
  offline: 'Sin conexión.',
  'no-answer': 'El servidor no respondió.',
}

export const ecoRefusalText = (reason: string): string => ECO_REFUSAL_TEXT[reason] ?? `No se pudo (${reason}).`

/** A display name: the Pokédex's when this client has it, else the battle catalog's (capitalised), else the number. */
export function ecoSpeciesName(speciesId: number, pokedexName: string | null | undefined, catalogName: string | null | undefined): string {
  if (pokedexName) return pokedexName
  if (catalogName) return catalogName.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
  return `#${speciesId}`
}

/** `bosque-claro-suroeste:1:1` from a full encounter id (namespace and area dropped): the individual, for people. */
export const ecoShortId = (encounterId: string): string => encounterId.split(':').slice(2).join(':')

/** m:ss of battle time. */
export function ecoClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
