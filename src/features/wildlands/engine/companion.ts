import { actorPosition, advance, createActor, isMoving, type Actor, type PokemonInfo } from './actors'
import type { Dir } from './characters'
import type { Tile } from './pathfinding'
import type { PokedexEntry } from './population'
import { TILE } from './world'

const FOLLOW_LAG = 1
const MAX_TRAIL = 8
const MIN_SPEED = 4.5

export type CompanionPokemon = Pick<PokedexEntry, 'id' | 'name_es' | 'sprite_url'>
export type LoadCompanion = (pokemon: CompanionPokemon) => Promise<PokemonInfo | null>

/** A non-colliding Pokémon that walks over the player's completed tile trail. */
export class CompanionFollower {
  private current: CompanionPokemon | null = null
  private generation = 0
  private trail: Tile[] = []
  private value: Actor | null = null

  constructor(
    private readonly load: LoadCompanion,
    private readonly fallback: (pokemon: Pick<CompanionPokemon, 'id' | 'name_es'>) => PokemonInfo,
  ) {}

  get actor(): Actor | null {
    return this.value
  }

  set(pokemon: CompanionPokemon | null, player: Actor): void {
    if (samePokemon(this.current, pokemon)) return
    this.current = pokemon
    this.value = null
    this.trail = []
    const generation = ++this.generation
    if (!pokemon) return
    void this.load(pokemon)
      .catch(() => null)
      .then(info => {
        if (generation !== this.generation || this.current?.id !== pokemon.id) return
        this.value = createActor({
          id: `companion:${pokemon.id}`,
          kind: 'pokemon',
          habitat: 'any',
          tx: player.tx,
          ty: player.ty,
          dir: player.dir,
          speed: MIN_SPEED,
          pokemon: info ?? this.fallback(pokemon),
        })
      })
  }

  /** Area changes and teleports never make the follower cross the whole map. */
  reset(player: Actor): void {
    this.trail = []
    if (!this.value) return
    place(this.value, player.tx, player.ty, player.dir)
  }

  playerArrived(player: Actor): void {
    if (!this.value) return
    this.trail.push({ tx: player.tx, ty: player.ty })
    if (this.trail.length > MAX_TRAIL) {
      const behind = this.trail[Math.max(0, this.trail.length - FOLLOW_LAG - 1)]
      place(this.value, behind.tx, behind.ty, player.dir)
      this.trail = this.trail.slice(-FOLLOW_LAG)
    }
  }

  update(player: Actor, dt: number): void {
    const companion = this.value
    if (!companion) return
    companion.speed = Math.max(MIN_SPEED, player.speed * 1.1)
    if (!isMoving(companion) && this.trail.length > FOLLOW_LAG) {
      const next = this.trail.shift()!
      const dx = next.tx - companion.tx
      const dy = next.ty - companion.ty
      if (Math.abs(dx) + Math.abs(dy) !== 1) {
        place(companion, next.tx, next.ty, direction(dx, dy, companion.dir))
      } else {
        companion.fromTx = companion.tx
        companion.fromTy = companion.ty
        companion.tx = next.tx
        companion.ty = next.ty
        companion.dir = direction(dx, dy, companion.dir)
        companion.progress = 0
      }
    }
    advance(companion, dt)

    // Defensive camera leash for unexpected discontinuities outside normal tile movement.
    const playerPos = actorPosition(player)
    const companionPos = actorPosition(companion)
    if (Math.hypot(playerPos.x - companionPos.x, playerPos.y - companionPos.y) > TILE * MAX_TRAIL) this.reset(player)
  }
}

function samePokemon(a: CompanionPokemon | null, b: CompanionPokemon | null): boolean {
  return a?.id === b?.id && a?.name_es === b?.name_es && a?.sprite_url === b?.sprite_url
}

function place(actor: Actor, tx: number, ty: number, dir: Dir): void {
  actor.tx = actor.fromTx = tx
  actor.ty = actor.fromTy = ty
  actor.progress = 1
  actor.dir = dir
  actor.hop = 0
  actor.bumping = false
}

function direction(dx: number, dy: number, fallback: Dir): Dir {
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right'
  if (dy !== 0) return dy < 0 ? 'up' : 'down'
  return fallback
}
