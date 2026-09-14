// Plaza taps — WildLands lobby (R26)
//
// Resolves what a tap (or the action key while facing a tile) points at in
// the plaza: an owned Pokémon, whose card the view shows, or the activity
// board. The view decides what to open; nothing here reads or writes data.

import type { Actor } from './actors'
import type { Area } from './area'
import type { Pick } from './renderer'

export type PlazaHit = { kind: 'pokemon'; pokemonId: number } | { kind: 'board' }

function ownedHit(actor: Actor | null | undefined): PlazaHit | null {
  return actor?.owned && actor.pokemon ? { kind: 'pokemon', pokemonId: actor.pokemon.id } : null
}

/** A tapped owned Pokémon, or the board (its tile or the post drawn one row above it). */
export function plazaHitAt(area: Area, pick: Pick): PlazaHit | null {
  if (pick.actor) return ownedHit(pick.actor)
  const tile = pick.tile
  if (tile && (area.noticeBoardAt?.(tile.tx, tile.ty) || area.noticeBoardAt?.(tile.tx, tile.ty + 1))) return { kind: 'board' }
  return null
}

/** What the player faces: the actor standing on (tx, ty), else the board. */
export function plazaHitFacing(area: Area, actor: Actor | undefined, tx: number, ty: number): PlazaHit | null {
  if (actor) return ownedHit(actor)
  return area.noticeBoardAt?.(tx, ty) ? { kind: 'board' } : null
}
