// Dungeon props, drawn at WildLands scale (D1.2 §7, §21, §22, §24, §25).
//
// Everything here is a `Sprite` the real renderer can depth-sort, shadow and
// light like any other prop: same 16px tile, same anchor convention (feet at
// `ay`), same pixel language as engine/props.ts. These are the assets the
// overworld does not have yet — a chest, a stairway, a locked door, a torch,
// a cave mouth — built so they would not look out of place next to a tree.

import { fromAscii, shade, ellipses, spriteFromPixels, type Sprite } from '../../wildlands/engine/sprite'
import { packColor } from '../../wildlands/engine/pixels'

const PALETTE = {
  K: '#241a12', // outline
  W: '#8e653c', // wood light
  w: '#6b4a2c', // wood
  d: '#4a301b', // wood dark
  G: '#d9a441', // gold
  g: '#a6762a', // gold dark
  Y: '#f5e08a', // shine
  S: '#6f7a90', // stone light
  s: '#4d5668', // stone
  t: '#333a49', // stone dark
  B: '#0d1018', // void
  R: '#e8541f', // flame
  O: '#ffb03a', // flame light
  L: '#fff2c0', // glow
  I: '#c7e6ff', // ice/crystal highlight
  r: '#c0392b', // deep red
  c: '#2b3242', // clasp centre
}

function sprite(rows: readonly string[], ax?: number, ay?: number): Sprite {
  const { w, h, pixels } = fromAscii(rows, PALETTE)
  return spriteFromPixels(w, h, pixels, ax ?? w / 2, ay ?? h - 1)
}

// ── The chest (D1.2.2 §6) ──────────────────────────────────────────────────
//
// Redrawn to look like it belongs to PokeSwap rather than to a generic
// dungeon: a rounded wooden case banded in gold, with a white-and-red lid and
// a round clasp — the Poké Ball read, without being one.

const CHEST_CLOSED = [
  '....KKKKKKKK....',
  '..KKGGGGGGGGKK..',
  '.KGRRRRRRRRRRGK.',
  'KGRRRRRRRRRRRRGK',
  'KGRrRRRRRRRRrRGK',
  'KKGGGGGGGGGGGGKK',
  'KwWWWWWWWWWWWWwK',
  'KwWWWWKKKKWWWWwK',
  'KwWWWKGYYGKWWWwK',
  'KwWWWKGYcYGKWWwK',
  'KwWWWWKKKKWWWWwK',
  'KwWWWWWWWWWWWWwK',
  'KwWWWWWWWWWWWWwK',
  '.KGGGGGGGGGGGGK.',
  '..KKKKKKKKKKKK..',
]

const CHEST_OPEN = [
  '..K..........K..',
  '.KGKKKKKKKKKKGK.',
  'KGRRRRRRRRRRRRGK',
  'KGRrrrrrrrrrrRGK',
  '.KKGGGGGGGGGGKK.',
  'KKBBBBBBBBBBBBKK',
  'KwBLLLLLLLLLLBwK',
  'KwBLYYYYYYYYLBwK',
  'KwBLLLLLLLLLLBwK',
  'KwWWWWWWWWWWWWwK',
  'KwWWWWWWWWWWWWwK',
  'KwWWWWWWWWWWWWwK',
  'KwWWWWWWWWWWWWwK',
  '.KGGGGGGGGGGGGK.',
  '..KKKKKKKKKKKK..',
]

// ── Doors ──────────────────────────────────────────────────────────────────

const DOOR_LOCKED = [
  '...KKKKKKKK...',
  '..KSSSSSSSSK..',
  '.KSSssssssSSK.',
  'KSSsttttttsSSK',
  'KSsttttttttsSK',
  'KSsttGGGGttsSK',
  'KSsttGYYGttsSK',
  'KSsttGGGGttsSK',
  'KSstttttttssSK',
  'KSssttttttssSK',
  'KSSssssssssSSK',
  'KSSSSSSSSSSSSK',
  '.KKKKKKKKKKKK.',
]

const DOOR_OPEN = [
  '...KKKKKKKK...',
  '..KSSSSSSSSK..',
  '.KSSBBBBBBSSK.',
  'KSSBBBBBBBBSSK',
  'KSsBBBBBBBBsSK',
  'KSsBBBBBBBBsSK',
  'KSsBBBBBBBBsSK',
  'KSsBBBBBBBBsSK',
  'KSsBBBBBBBBsSK',
  'KSsBBBBBBBBsSK',
  'KSSBBBBBBBBSSK',
  'KSSSBBBBBBSSSK',
  '.KKKKKKKKKKKK.',
]

const TORCH_A = [
  '..OO..',
  '.ORRO.',
  '.ORRO.',
  '..RR..',
  '..KK..',
  '.KwwK.',
  '.KwwK.',
  '.KwwK.',
  '..KK..',
]

const TORCH_B = [
  '..O...',
  '.ORO..',
  '.ORRO.',
  '..RR..',
  '..KK..',
  '.KwwK.',
  '.KwwK.',
  '.KwwK.',
  '..KK..',
]

const ENTRANCE = [
  '.....KKKKKKKKKKKKKK.....',
  '...KKtttttttttttttKKK...',
  '..KttSSSSSSSSSSSSSSttK..',
  '.KtSSSsssssssssssSSSStK.',
  'KtSSsssttttttttttsssSStK',
  'KtSssttBBBBBBBBBBttssStK',
  'KtSsttBBBBBBBBBBBBttsStK',
  'KtSsttBBBBBBBBBBBBttsStK',
  'KtSstBBBBBBBBBBBBBBtsStK',
  'KtSstBBBBBBBBBBBBBBtsStK',
  'KtSstBBBBBBBBBBBBBBtsStK',
  'KtSsttBBBBBBBBBBBBttsStK',
  'KtSssttBBBBBBBBBBttssStK',
  'KtSSsssttttttttttsssSStK',
  'KKtSSSsssssssssssSSStKK.',
  '.KKttSSSSSSSSSSSSttKK...',
  '...KKKttttttttttKKK.....',
]

// ── The stairway (D1.2.2 §7) ───────────────────────────────────────────────
//
// Read from directly above: a square landing cut into the floor, with steps
// running down it as concentric bands that darken toward the middle. That is
// the reading the handheld dungeon crawlers made famous — this is an original
// drawing of it, generated rather than copied, so it sits flush in the ground
// and is unmistakable from a distance.
//
// LOCKED puts a stone slab with a keyhole over the opening; OPEN shows the
// steps, and the overlay adds a slow glint on top.

const STAIR_SIZE = 22

function stairPixels(open: boolean): Uint32Array {
  const size = STAIR_SIZE
  const out = new Uint32Array(size * size)
  const frame = [packColor('#1a1f2b'), packColor('#4d5668'), packColor('#6f7a90'), packColor('#8b97ad')]
  const steps = [packColor('#7f8b9f'), packColor('#69748a'), packColor('#535d72'), packColor('#3d4659'), packColor('#262d3d'), packColor('#11151f')]
  const slab = [packColor('#5c6578'), packColor('#48505f'), packColor('#343b47')]
  const gold = packColor('#d9a441')
  const dark = packColor('#161a24')

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Chebyshev distance from the edge: concentric square bands.
      const ring = Math.min(x, y, size - 1 - x, size - 1 - y)
      let colour: number
      if (ring === 0) colour = frame[0]
      else if (ring <= 2) colour = frame[Math.min(frame.length - 1, ring)]
      else {
        const step = Math.min(steps.length - 1, ring - 3)
        colour = steps[step]
        // A groove between steps, so each band reads as an edge and not a blur.
        if ((ring - 3) % 2 === 1 && (x + y) % 2 === 0) colour = steps[Math.min(steps.length - 1, step + 1)]
      }
      out[y * size + x] = colour
    }
  }

  if (!open) {
    // A slab over the hole, with a keyhole in the middle.
    for (let y = 3; y < size - 3; y++) {
      for (let x = 3; x < size - 3; x++) {
        const band = ((x - 3) >> 2) + ((y - 3) >> 2)
        out[y * size + x] = slab[band % slab.length]
      }
    }
    const c = size / 2
    for (let y = -3; y <= 3; y++) {
      for (let x = -2; x <= 2; x++) {
        const round = Math.abs(x) + Math.abs(y) <= 3
        if (round) out[(c + y) * size + (c + x)] = dark
      }
    }
    out[(c - 1) * size + c] = gold
    out[c * size + c] = gold
  }
  return out
}

let cache: Record<string, Sprite> | null = null

function all(): Record<string, Sprite> {
  if (cache) return cache
  const landing = (open: boolean): Sprite => {
    const made = spriteFromPixels(STAIR_SIZE, STAIR_SIZE, stairPixels(open), STAIR_SIZE / 2, STAIR_SIZE * 0.72)
    // It is a hole in the ground, not a body: no projected shadow, and the
    // anchor sits in the middle so the landing lies *around* the tile rather
    // than standing up behind it.
    made.castShadow = false
    return made
  }
  cache = {
    chestClosed: sprite(CHEST_CLOSED),
    chestOpen: sprite(CHEST_OPEN),
    stairsOpen: landing(true),
    stairsLocked: landing(false),
    doorLocked: sprite(DOOR_LOCKED),
    doorOpen: sprite(DOOR_OPEN),
    torchA: sprite(TORCH_A),
    torchB: sprite(TORCH_B),
    entrance: sprite(ENTRANCE, 12, 16),
  }
  return cache
}

export const chestSprite = (open: boolean): Sprite => (open ? all().chestOpen : all().chestClosed)
/** The way down: locked until the key drops, then open (§7). */
export const stairsSprite = (open: boolean): Sprite => (open ? all().stairsOpen : all().stairsLocked)
export const doorSprite = (open: boolean): Sprite => (open ? all().doorOpen : all().doorLocked)
export const torchSprite = (seconds: number): Sprite => (Math.floor(seconds * 6) % 2 ? all().torchB : all().torchA)
export const entranceSprite = (): Sprite => all().entrance

// ── Poké Ball, at overworld scale ──────────────────────────────────────────

const BALL_ROWS = [
  '..KKKK..',
  '.KRRRRK.',
  'KRRWRRRK',
  'KKKWWKKK',
  'KWWKKWWK',
  '.KWWWWK.',
  '..KKKK..',
]
const BALL_PALETTE = { K: '#1c1c24', R: '#e03c3c', W: '#f4f4f4' }

let ballSprites: Sprite[] | null = null

/**
 * Four frames of a thrown ball opening: closed, cracked, flash, gone. The
 * summon flash is a plain lit sphere so it reads at any scale.
 */
export function ballFrames(): readonly Sprite[] {
  if (ballSprites) return ballSprites
  const { w, h, pixels } = fromAscii(BALL_ROWS, BALL_PALETTE)
  const closed = spriteFromPixels(w, h, pixels, w / 2, h - 1)
  const open = spriteFromPixels(w, h, pixels.map((p, i) => (i < w * 3 ? 0 : p)), w / 2, h - 1)
  const flash = spriteFromPixels(16, 16, shade(16, 16, ellipses([[8, 8, 7, 7]]), {
    tones: ['#ffd46a', '#ffe9a8', '#fffbe8', '#ffffff'], outline: '#ffdf8a', dither: 0.2,
  }), 8, 15)
  const gone = spriteFromPixels(1, 1, new Uint32Array([0]), 0.5, 1)
  ballSprites = [closed, open, flash, gone]
  return ballSprites
}

// ── Health bars, drawn as world sprites so they sit in the scene ───────────

const BAR_W = 20
const BAR_H = 3
const barCache = new Map<string, Sprite>()

/** A small bar above a Pokémon: `fraction` in [0, 1], quantised so it caches. */
export function barSprite(fraction: number, colour: 'hp' | 'low' | 'critical' | 'action'): Sprite {
  const steps = Math.max(0, Math.min(BAR_W - 2, Math.round(fraction * (BAR_W - 2))))
  const key = `${colour}:${steps}`
  const hit = barCache.get(key)
  if (hit) return hit
  const fill = packColor(colour === 'hp' ? '#57d86a' : colour === 'low' ? '#f0c33c' : colour === 'critical' ? '#e3573f' : '#6fb4ff')
  const back = packColor('#1a2033')
  const edge = packColor('#0a0e18')
  const pixels = new Uint32Array(BAR_W * BAR_H)
  for (let y = 0; y < BAR_H; y++) {
    for (let x = 0; x < BAR_W; x++) {
      const border = y === 0 || y === BAR_H - 1 || x === 0 || x === BAR_W - 1
      pixels[y * BAR_W + x] = border ? edge : x - 1 < steps ? fill : back
    }
  }
  const made = spriteFromPixels(BAR_W, BAR_H, pixels, BAR_W / 2, BAR_H)
  made.castShadow = false
  barCache.set(key, made)
  return made
}

const chipCache = new Map<string, Sprite>()

/** A 9×9 status pip (BRN, PAR…), drawn as a rounded dot with a letter notch. */
export function statusChip(colour: string, mark: 'burn' | 'paralysis' | 'poison' | 'freeze' | 'sleep' | 'confused'): Sprite {
  const key = `${colour}:${mark}`
  const hit = chipCache.get(key)
  if (hit) return hit
  const body = packColor(colour)
  const edge = packColor('#0a0e18')
  const light = packColor('#ffffff')
  const size = 9
  const pixels = new Uint32Array(size * size)
  const marks: Record<string, readonly [number, number][]> = {
    burn: [[4, 2], [4, 3], [3, 4], [4, 4], [4, 5], [5, 4]],
    paralysis: [[5, 2], [4, 3], [5, 4], [3, 5], [4, 6]],
    poison: [[3, 3], [5, 3], [4, 4], [3, 5], [5, 5]],
    freeze: [[4, 2], [4, 6], [2, 4], [6, 4], [4, 4]],
    sleep: [[3, 3], [4, 3], [5, 3], [4, 4], [3, 5], [4, 5], [5, 5]],
    confused: [[3, 2], [5, 2], [4, 3], [4, 4], [4, 6]],
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - 4
      const dy = y - 4
      const d = dx * dx + dy * dy
      pixels[y * size + x] = d > 16 ? 0 : d > 9 ? edge : body
    }
  }
  for (const [x, y] of marks[mark]) pixels[y * size + x] = light
  const made = spriteFromPixels(size, size, pixels, size / 2, size)
  made.castShadow = false
  chipCache.set(key, made)
  return made
}
