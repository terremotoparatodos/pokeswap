export const PLAYER_CHARACTERS = [
  { id: 'lucas', label: 'Entrenador', sheetUrl: '/assets/trainers/protahombre.png', columns: 8 },
  { id: 'dawn-pink', label: 'Entrenadora rosa', sheetUrl: '/assets/trainers/dawnrosa.png', columns: 4 },
  { id: 'dawn-yellow', label: 'Entrenadora amarilla', sheetUrl: '/assets/trainers/dawmamarillo.png', columns: 4 },
] as const

export type PlayerCharacterId = (typeof PLAYER_CHARACTERS)[number]['id']
export type PlayerCharacter = (typeof PLAYER_CHARACTERS)[number]

export const DEFAULT_PLAYER_CHARACTER_ID: PlayerCharacterId = 'lucas'

export function isPlayerCharacterId(value: unknown): value is PlayerCharacterId {
  return typeof value === 'string' && PLAYER_CHARACTERS.some(character => character.id === value)
}

export function playerCharacter(id: PlayerCharacterId): PlayerCharacter {
  return PLAYER_CHARACTERS.find(character => character.id === id) ?? PLAYER_CHARACTERS[0]
}
