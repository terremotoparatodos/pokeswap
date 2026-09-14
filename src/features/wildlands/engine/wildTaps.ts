// Wild Pokémon hit testing — world interaction only. No slot/economic data
// crosses this boundary; the view checks its live read-only snapshot on open.

import type { Actor } from './actors'
import type { Area } from './area'
import type { Pick } from './renderer'

export type WildHit = { kind: 'wild'; pokemonId: number }

function wildHit(area: Area, actor: Actor | null | undefined): WildHit | null {
  if (area.kind !== 'wild' || !actor?.wild || !actor.pokemon) return null
  return { kind: 'wild', pokemonId: actor.pokemon.id }
}

export function wildHitAt(area: Area, pick: Pick): WildHit | null {
  return wildHit(area, pick.actor)
}

export function wildHitFacing(area: Area, actor: Actor | undefined): WildHit | null {
  return wildHit(area, actor)
}
