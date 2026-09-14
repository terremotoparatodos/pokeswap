import type { Dir } from '../engine/characters'
import {
  DEFAULT_PLAYER_CHARACTER_ID,
  isPlayerCharacterId,
  type PlayerCharacterId,
} from './playerCharacters'

const STORAGE_PREFIX = 'pokeswap:wildlands:player:v1:'
const VERSION = 1
const DIRECTIONS = new Set<Dir>(['down', 'up', 'left', 'right'])

export interface TownPosition {
  tx: number
  ty: number
  dir: Dir
}

export interface PlayerPreferences {
  version: 1
  characterId: PlayerCharacterId
  companionPokemonId: number | null
  townPosition: TownPosition | null
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function defaultPlayerPreferences(): PlayerPreferences {
  return {
    version: VERSION,
    characterId: DEFAULT_PLAYER_CHARACTER_ID,
    companionPokemonId: null,
    townPosition: null,
  }
}

export function playerPreferencesKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`
}

export function readPlayerPreferences(userId: string, storage: StorageLike = localStorage): PlayerPreferences {
  const fallback = defaultPlayerPreferences()
  let raw: string | null
  try {
    raw = storage.getItem(playerPreferencesKey(userId))
  } catch {
    return fallback
  }
  if (!raw) return fallback
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || value.version !== VERSION || !isPlayerCharacterId(value.characterId)) throw new Error('invalid preferences')
    const companionPokemonId = positiveInteger(value.companionPokemonId) ? value.companionPokemonId : null
    const townPosition = parseTownPosition(value.townPosition)
    return { version: VERSION, characterId: value.characterId, companionPokemonId, townPosition }
  } catch {
    try {
      storage.removeItem(playerPreferencesKey(userId))
    } catch {
      // Storage is optional cosmetic state; the safe fallback is already in memory.
    }
    return fallback
  }
}

export function writePlayerPreferences(userId: string, preferences: PlayerPreferences, storage: StorageLike = localStorage): boolean {
  try {
    storage.setItem(playerPreferencesKey(userId), JSON.stringify(preferences))
    return true
  } catch {
    return false
  }
}

export function removePlayerPreferences(userId: string, storage: StorageLike = localStorage): boolean {
  try {
    storage.removeItem(playerPreferencesKey(userId))
    return true
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0
}

function parseTownPosition(value: unknown): TownPosition | null {
  if (!isRecord(value)) return null
  if (!Number.isInteger(value.tx) || !Number.isInteger(value.ty)) return null
  if (typeof value.dir !== 'string' || !DIRECTIONS.has(value.dir as Dir)) return null
  return { tx: value.tx as number, ty: value.ty as number, dir: value.dir as Dir }
}
