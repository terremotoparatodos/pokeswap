// Which parts of Ciudad Corazón are open during Community Playtest 0.1.
//
// Two doors open — the Centro Pokémon and the Tienda — and everything else
// says so instead of doing nothing. The buildings stay where they are: a city
// with holes in it would be a worse city to walk around, and walking around is
// half of what we are watching.
//
// Every closed door leads somewhere real in the normal build. Closing them here
// is a playtest decision and nothing more: the Mercado, the Swap and the Perfil
// all write to persistent, economic state, and a two-hour build has no business
// near it (see the data classification in COMMUNITY_PLAYTEST_0_1.md).

import type { LobbyFeature } from '../../wildlands/lobby/features'

export type PlaytestSurface =
  /** Heal, party and boxes. */
  | { readonly kind: 'centro' }
  /** Basic tools and Poké Balls. */
  | { readonly kind: 'tienda' }
  | { readonly kind: 'closed'; readonly title: string; readonly reason: string }

/** Why each closed door is closed, in one sentence a player can read. */
const CLOSED: Readonly<Record<Exclude<LobbyFeature, 'caja' | 'mercado'>, string>> = {
  swap: 'El Swap mueve Pokémon de verdad entre cuentas. Queda cerrado durante el playtest.',
  dungeon: 'La Dungeon no se entra desde acá: buscá una cueva en WildLands.',
  pokedex: 'La Pokédex vuelve después del playtest.',
  perfil: 'Tu perfil y tus tokens reales quedan fuera de esta build.',
}

const TITLE: Readonly<Record<LobbyFeature, string>> = {
  caja: 'Centro Pokémon',
  mercado: 'Tienda',
  swap: 'Silph Co.',
  dungeon: 'Gimnasio',
  pokedex: 'Casa de Mr. Pokémon',
  perfil: 'Casino',
}

/**
 * What a door opens during the playtest.
 *
 * The mapping is by feature rather than by building because the feature id is
 * what every entrance already speaks — the door, the menu and the plaza all
 * hand over the same key.
 *
 * `caja` is the Centro Pokémon's door and `mercado` is the Tienda's, which is
 * worth saying out loud: in the normal build those open the box list and the
 * P2P market, and here they open the playtest's own two surfaces.
 */
export function playtestSurfaceFor(feature: LobbyFeature): PlaytestSurface {
  if (feature === 'caja') return { kind: 'centro' }
  if (feature === 'mercado') return { kind: 'tienda' }
  return { kind: 'closed', title: TITLE[feature], reason: CLOSED[feature] }
}

export const OPEN_FEATURES: readonly LobbyFeature[] = ['caja', 'mercado']

export const isOpenDuringPlaytest = (feature: LobbyFeature): boolean => OPEN_FEATURES.includes(feature)

/** The line every closed door shares, above its own reason. */
export const CLOSED_HEADLINE = 'No disponible durante Community Playtest 0.2'
