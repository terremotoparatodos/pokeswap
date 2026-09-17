// The sprites the dungeon draws (D1.1 §2, §5).
//
// Reused from WildLands, unmodified:
//   - `loadOverworldFrames` → the **real** bundled overworld sheet of a species,
//     so the Pokémon in the cave are the same ones that walk around Pradera;
//   - `buildTrainer` + `PLAYER_PALETTE` → the same player sprite as the world;
//   - `Dir` → the same four facings.
//
// A species with no sheet falls back to a shaded blob built with the engine's
// own recipe, so a missing asset never blanks the screen.

import {
  buildTrainer, loadOverworldFrames, PLAYER_PALETTE,
  type Dir, type PokemonFrames, type TrainerSprites,
} from '../../wildlands/engine/characters'
import type { Sprite } from '../../wildlands/engine/sprite'
import { blobSprite } from './tileArt'

let trainer: TrainerSprites | null = null

/** The player, drawn exactly as in WildLands. Built once, synchronously. */
export function playerSprites(): TrainerSprites {
  if (!trainer) trainer = buildTrainer(PLAYER_PALETTE)
  return trainer
}

const sheets = new Map<number, PokemonFrames | null>()
const pending = new Map<number, Promise<void>>()

const FALLBACK_TINTS = ['#c96d4a', '#4a8cc9', '#6bc94a', '#c9b44a', '#a04ac9', '#4ac9b4']

/** A stand-in that still looks like it belongs to the game. */
function fallbackFrames(speciesId: number): PokemonFrames {
  const sprite = blobSprite(FALLBACK_TINTS[speciesId % FALLBACK_TINTS.length])
  const pair = [sprite, sprite]
  return { down: pair, up: pair, left: pair, right: pair }
}

/**
 * Frames for a species, or null while the sheet is still loading. Starts the
 * load on first ask and never asks twice; drawing simply uses the fallback
 * until the real sheet lands.
 */
export function speciesFrames(speciesId: number): PokemonFrames {
  const cached = sheets.get(speciesId)
  if (cached) return cached
  if (cached === null) return fallbackFrames(speciesId)
  if (!pending.has(speciesId)) {
    pending.set(speciesId, loadOverworldFrames(speciesId, false)
      .then(frames => { sheets.set(speciesId, frames) })
      .catch(() => { sheets.set(speciesId, null) }))
  }
  return fallbackFrames(speciesId)
}

/** Warms the sheets a floor will need, so nothing pops in mid-step. */
export function preloadSpecies(ids: readonly number[]): void {
  for (const id of new Set(ids)) speciesFrames(id)
}

/** One walk frame of a species, alternating on a slow cycle like the followers. */
export function speciesSprite(speciesId: number, dir: Dir, seconds: number): Sprite {
  const cycle = speciesFrames(speciesId)[dir]
  return cycle[Math.floor(seconds * 1.6) % cycle.length]
}

export function playerSprite(dir: Dir, seconds: number, moving: boolean): Sprite {
  const cycle = playerSprites()[dir]
  return moving ? cycle[Math.floor(seconds * 6) % cycle.length] : cycle[0]
}

export const facingOf = (dx: number, dy: number, fallback: Dir): Dir => {
  if (dx === 0 && dy === 0) return fallback
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'down' : 'up'
}
