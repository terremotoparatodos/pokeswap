// What a tap lands on (R30 · F-2).
//
// The renderer draws sprites upright over a projected ground plane, so a tall
// prop covers ground that is *behind* it. Resolving a tap by unprojecting the
// touched pixel therefore answers with the tile behind a tree, not the tree:
// the player walks past it and nothing is interacted with. Buildings already
// solved this with their own footprint; wild props never registered anything.
//
// This module is the geometry and the decision, kept pure so it can be tested
// without a canvas: the renderer fills the rects while it draws and asks here
// who owns the point. It decides *what was touched*, nothing else — solidity,
// pathfinding and interaction rules are unchanged and live where they did.

export interface HitRect {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

/** An actor's screen rect, back to front, as the renderer drew them. */
export interface ActorHit<A> extends HitRect {
  readonly actor: A
  /** The tile it stands on: an actor tap answers with it, as it always did. */
  readonly tx: number
  readonly ty: number
}

/** A prop's screen rect plus the tile it stands on. */
export interface PropHit extends HitRect {
  readonly tx: number
  readonly ty: number
}

/**
 * A placed object's screen rect (F-1): the art it declared, projected like any
 * other sprite. It is the *last* thing a tap is matched against, so it can
 * never take a tap away from an actor, from a prop the renderer already drew
 * there, or from open ground outside its own art.
 */
export interface PlacedHit extends HitRect {
  readonly tx: number
  readonly ty: number
}

export type HitResult<A> =
  | { readonly kind: 'actor'; readonly actor: A; readonly tx: number; readonly ty: number }
  | { readonly kind: 'prop'; readonly tx: number; readonly ty: number }
  | { readonly kind: 'placed'; readonly tx: number; readonly ty: number }
  | null

/**
 * The screen rect of one drawn sprite: its visible art, from the first opaque
 * row down to the feet, optionally padded for a fingertip.
 *
 * All four inputs are what the renderer already computes to draw the sprite:
 * `x`/`topY` are its top-left corner on screen, `feetY` the anchor row, and
 * `top` the first opaque row of the art inside its cell.
 */
export function spriteRect(
  x: number, topY: number, feetY: number, width: number, top: number, scale: number, pad = 0,
): HitRect {
  return {
    x0: x - pad,
    x1: x + width * scale + pad,
    y0: topY + top * scale - pad,
    y1: feetY + pad,
  }
}

const inside = (rect: HitRect, sx: number, sy: number): boolean =>
  sx >= rect.x0 && sx <= rect.x1 && sy >= rect.y0 && sy <= rect.y1

/**
 * Who owns this point, in device pixels.
 *
 * The order is the whole contract: an actor first — a Pokémon in front of a
 * tree is still what a tap on it selects — then the world's own props, then
 * anything placed on top of them, and a miss falls through to the ground.
 * Within each group the frontmost (last drawn) wins.
 */
export function hitTest<A>(
  actors: readonly ActorHit<A>[], props: readonly PropHit[], sx: number, sy: number,
  placed: readonly PlacedHit[] = [],
): HitResult<A> {
  for (let i = actors.length - 1; i >= 0; i--) {
    if (inside(actors[i], sx, sy)) {
      const { actor, tx, ty } = actors[i]
      return { kind: 'actor', actor, tx, ty }
    }
  }
  for (let i = props.length - 1; i >= 0; i--) {
    if (inside(props[i], sx, sy)) return { kind: 'prop', tx: props[i].tx, ty: props[i].ty }
  }
  for (let i = placed.length - 1; i >= 0; i--) {
    if (inside(placed[i], sx, sy)) return { kind: 'placed', tx: placed[i].tx, ty: placed[i].ty }
  }
  return null
}

export interface PickTile {
  readonly tx: number
  readonly ty: number
}

/**
 * The whole answer to a tap: an actor, else a prop, else the ground under the
 * point. `ground` is the renderer's own unprojection, passed in so this stays
 * free of the camera.
 */
export function resolvePick<A>(
  actors: readonly ActorHit<A>[], props: readonly PropHit[], sx: number, sy: number,
  ground: (sx: number, sy: number) => PickTile | null,
  placed: readonly PlacedHit[] = [],
): { tile: PickTile | null; actor: A | null } {
  const hit = hitTest(actors, props, sx, sy, placed)
  if (hit?.kind === 'actor') return { tile: { tx: hit.tx, ty: hit.ty }, actor: hit.actor }
  if (hit) return { tile: { tx: hit.tx, ty: hit.ty }, actor: null }
  return { tile: ground(sx, sy), actor: null }
}
