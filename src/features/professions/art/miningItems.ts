// 16×16 icons for mining resources and pickaxes, plus the in-world swing
// frames. Same shading recipe as WildLands props so icons and the world share
// one look at any size.

import { hash2 } from '../../wildlands/engine/noise'
import { TRANSPARENT } from '../../wildlands/engine/pixels'
import { ROCK_RECIPES } from '../../wildlands/engine/props'
import { capsules, ellipses, layer, shade, type ShadeFn } from '../../wildlands/engine/sprite'
import { ORE_TONES, TOOL_HEAD_TONES, WOOD_OUTLINE, WOOD_TONES, type OreTones } from './miningPalette'
import { color, desaturate, mirror, pixelArt, type PixelArt } from './pixelArt'

const S = 16
const cache = new Map<string, PixelArt>()
const memo = (key: string, build: () => PixelArt): PixelArt => {
  let art = cache.get(key)
  if (!art) cache.set(key, (art = build()))
  return art
}

// ── Resources ───────────────────────────────────────────────────────────────

function lump(ore: OreTones | null, shape: readonly (readonly [number, number, number, number])[], rockTones: readonly string[], outline: string, salt: number): PixelArt {
  const pixels = shade(S, S, ellipses(shape), { tones: rockTones, outline })
  if (ore) {
    const edge = color(outline)
    let placed = 0
    for (let y = 3; y < 13 && placed < 4; y += 2) {
      for (let x = 3; x < 13 && placed < 4; x += 2) {
        const i = y * S + x
        if (pixels[i] === TRANSPARENT || pixels[i] === edge || pixels[i + S + 1] === edge || hash2(x, y, salt) > 0.45) continue
        pixels[i] = color(ore.tones[2])
        pixels[i + 1] = color(ore.tones[1])
        pixels[i + S] = color(ore.tones[1])
        pixels[i + S + 1] = color(ore.tones[0])
        placed++
      }
    }
  }
  return pixelArt(S, S, pixels)
}

const ROCK = ROCK_RECIPES.rock
const LUMP: readonly (readonly [number, number, number, number])[] = [[8, 10, 6.5, 4.8], [6, 8, 4.2, 3.6], [11, 8, 3.6, 3]]

/** A trapezoid bar seen from above-front: bright top face, darker front face. */
function ingot(tones: readonly string[], outline: string): PixelArt {
  const fn: ShadeFn = (x, y) => {
    const px = x + 0.5
    if (y >= 6 && y <= 8) return px >= 4 + (8 - y) * 0.5 && px <= 12 - (8 - y) * 0.5 ? 0.95 - (y - 6) * 0.08 : null
    if (y >= 9 && y <= 12) return px >= 2.5 && px <= 13.5 ? 0.45 - (px - 2.5) / 60 : null
    return null
  }
  const pixels = shade(S, S, fn, { tones, outline, dither: 0 })
  pixels[7 * S + 6] = color('#ffffff')
  return pixelArt(S, S, pixels)
}

function shardIcon(): PixelArt {
  const fn: ShadeFn = (x, y) => {
    const dx = x + 0.5 - 8
    const dy = y + 0.5 - 8
    if (Math.abs(dx) / 4.2 + Math.abs(dy) / 7 > 1) return null
    return dx < 0 ? (dy < 0 ? 1 : 0.68) : dy < 0 ? 0.5 : 0.18
  }
  return pixelArt(S, S, shade(S, S, fn, { tones: ['#35184f', ...ORE_TONES.shard.tones], outline: '#24103a', dither: 0 }))
}

function brickIcon(): PixelArt {
  const fn: ShadeFn = (x, y) => (x >= 2 && x <= 13 && y >= 5 && y <= 12 ? (y < 7 ? 0.95 : 0.55 - x / 60) : null)
  const pixels = shade(S, S, fn, { tones: ROCK.tones, outline: ROCK.outline, dither: 0.3 })
  for (let x = 3; x < 13; x++) pixels[9 * S + x] = color(ROCK.outline)
  pixels[10 * S + 7] = color(ROCK.outline)
  pixels[11 * S + 7] = color(ROCK.outline)
  return pixelArt(S, S, pixels)
}

function vialIcon(): PixelArt {
  const glass = shade(S, S, capsules([[8, 8, 8, 12, 3.2]]), { tones: ['#4f8fb0', '#7fc3dc', '#c8eef7', '#ffffff'], outline: '#264a5c', dither: 0 })
  const cork = shade(S, S, capsules([[8, 3.5, 8, 4.5, 1.6]]), { tones: WOOD_TONES, outline: WOOD_OUTLINE, dither: 0 })
  return pixelArt(S, S, layer(glass, cork))
}

const RESOURCE_BUILDERS: Readonly<Record<string, () => PixelArt>> = {
  stone: () => lump(null, LUMP, ROCK.tones, ROCK.outline, 1),
  coal: () => {
    const art = lump(null, LUMP, ['#141318', '#2b2931', '#44414c', '#6d6a78'], '#07070a', 2)
    art.pixels[6 * S + 6] = color(ORE_TONES.coal.glint)
    art.pixels[6 * S + 7] = color(ORE_TONES.coal.glint)
    art.pixels[9 * S + 10] = color('#9b98aa')
    return art
  },
  iron_ore: () => lump(ORE_TONES.iron, LUMP, ROCK_RECIPES.boulder.tones, ROCK_RECIPES.boulder.outline, 3),
  gold_ore: () => lump(ORE_TONES.gold, LUMP, ROCK_RECIPES.boulder.tones, ROCK_RECIPES.boulder.outline, 4),
  evolution_shard: shardIcon,
  iron_ingot: () => ingot(['#5d6670', '#8b96a1', '#bcc6cf', '#eef2f5'], '#343a42'),
  gold_ingot: () => ingot(['#8a5a12', '#c98f1c', '#f2c94c', '#fff1a8'], '#4e330a'),
  steel_ingot: () => ingot(TOOL_HEAD_TONES[3].tones, TOOL_HEAD_TONES[3].outline),
  stone_brick: brickIcon,
  vial: vialIcon,
}

export const MINING_RESOURCE_ICON_IDS: readonly string[] = Object.keys(RESOURCE_BUILDERS)

export function resourceIconArt(itemId: string): PixelArt | null {
  const build = RESOURCE_BUILDERS[itemId]
  return build ? memo(`res|${itemId}`, build) : null
}

// ── Pickaxes ────────────────────────────────────────────────────────────────

export type PickaxeTier = 1 | 2 | 3
export type ToolArtCondition = 'ok' | 'broken' | 'retired'

export const PICKAXE_ITEMS: Readonly<Record<PickaxeTier, string>> = { 1: 'stone_pickaxe', 2: 'iron_pickaxe', 3: 'steel_pickaxe' }

/**
 * Pickaxe drawn around a pivot (the hand) at `angle` radians (0 = pointing
 * right, negative = up). The head crosses the far end of the handle.
 */
function pickaxePixels(size: number, pivotX: number, pivotY: number, angle: number, length: number, tier: PickaxeTier, broken: boolean): Uint32Array {
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  const px = -dy
  const py = dx
  const at = (t: number, side = 0) => [pivotX + dx * length * t + px * side, pivotY + dy * length * t + py * side] as const
  const [hx, hy] = at(1)
  const handleSegments: [number, number, number, number, number][] = broken
    ? [[...at(0), ...at(0.42), 0.9], [...at(0.62), ...at(0.95), 0.9]]
    : [[...at(0), ...at(0.95), 0.9]]
  const handle = shade(size, size, capsules(handleSegments), { tones: WOOD_TONES, outline: WOOD_OUTLINE, dither: 0.3 })
  const reach = size >= 16 ? 4.6 : 3.4
  const back = broken ? 0.6 : 1.4
  const tipA = [hx + px * reach - dx * back, hy + py * reach - dy * back] as const
  const tipB = [hx - px * reach - dx * back, hy - py * reach - dy * back] as const
  const shift = broken ? 1 : 0
  const head = shade(size, size, capsules([
    [hx + shift, hy + shift, tipA[0] + shift, tipA[1] + shift, 1.25],
    [hx + shift, hy + shift, tipB[0] + shift, tipB[1] + shift, 1.05],
  ]), { tones: TOOL_HEAD_TONES[tier].tones, outline: TOOL_HEAD_TONES[tier].outline, dither: 0 })
  const pixels = layer(handle, head)
  const cx = Math.round(hx + shift)
  const cy = Math.round(hy + shift)
  if (tier === 3 && cx >= 0 && cy >= 0 && cx < size && cy < size) {
    pixels[cy * size + cx] = color('#f7d354')
    if (cx + 1 < size) pixels[cy * size + cx + 1] = color(ORE_TONES.shard.tones[2])
  }
  if (broken && cx > 0 && cy > 0) pixels[(cy - 1) * size + cx - 1] = color('#1a1a1f')
  return pixels
}

export function pickaxeIconArt(tier: PickaxeTier, condition: ToolArtCondition = 'ok'): PixelArt {
  return memo(`pick|${tier}|${condition}`, () => {
    const art = pixelArt(S, S, pickaxePixels(S, 3, 13, -Math.PI / 4, 11.5, tier, condition !== 'ok'))
    return condition === 'retired' ? desaturate(art, 0.85, 0.25) : art
  })
}

/** Swing frames in world scale: 0 raised, 1 mid, 2 strike. Anchored at the hand. */
export const SWING_ANGLES = [-2.05, -0.95, 0.55] as const
export const SWING_SIZE = 18

export function pickaxeSwingArt(tier: PickaxeTier, frame: 0 | 1 | 2, facingLeft: boolean): PixelArt {
  return memo(`swing|${tier}|${frame}|${facingLeft}`, () => {
    const pivot = 8
    const art = pixelArt(SWING_SIZE, SWING_SIZE, pickaxePixels(SWING_SIZE, pivot, pivot + 2, SWING_ANGLES[frame], 8, tier, false), pivot, pivot + 2)
    return facingLeft ? mirror(art) : art
  })
}
