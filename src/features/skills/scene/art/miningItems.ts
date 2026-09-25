// 16×16 icons for mining resources. Same shading recipe as WildLands props so
// icons and the world share one look at any size. SKILLS-1 removed pickaxes:
// the Pokémon does the work, so there is no tool to draw.

import { hash2 } from '../../../wildlands/engine/noise'
import { TRANSPARENT } from '../../../wildlands/engine/pixels'
import { ROCK_RECIPES } from '../../../wildlands/engine/props'
import { ellipses, shade, type ShadeFn } from '../../../wildlands/engine/sprite'
import { ORE_TONES, type OreTones } from './miningPalette'
import { color, pixelArt, type PixelArt } from './pixelArt'

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

function shardIcon(): PixelArt {
  const fn: ShadeFn = (x, y) => {
    const dx = x + 0.5 - 8
    const dy = y + 0.5 - 8
    if (Math.abs(dx) / 4.2 + Math.abs(dy) / 7 > 1) return null
    return dx < 0 ? (dy < 0 ? 1 : 0.68) : dy < 0 ? 0.5 : 0.18
  }
  return pixelArt(S, S, shade(S, S, fn, { tones: ['#35184f', ...ORE_TONES.shard.tones], outline: '#24103a', dither: 0 }))
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
  crystal: shardIcon,
}

export const MINING_RESOURCE_ICON_IDS: readonly string[] = Object.keys(RESOURCE_BUILDERS)

export function resourceIconArt(itemId: string): PixelArt | null {
  const build = RESOURCE_BUILDERS[itemId]
  return build ? memo(`res|${itemId}`, build) : null
}
