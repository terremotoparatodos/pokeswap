// The sickle (R31-C4.1): the fourth tool of the family.
//
// Pick, axe and rod are all *straight* — a shaft with something at the end.
// The sickle is the only curved one: a short grip and a blade that hooks back
// over it. At 16×16 that hook is what tells it apart, so it is drawn by hand
// pixel by pixel instead of derived from a curve: a parametric crescent this
// small collapses into a smudge (tried first, and it did).

import { fromAscii } from '../../wildlands/engine/sprite'
import { SICKLE_TONES, type SickleTier } from './foragePalette'
import { desaturate, mirror, pixelArt, type PixelArt } from './pixelArt'

const cache = new Map<string, PixelArt>()
const memo = (key: string, build: () => PixelArt): PixelArt => {
  let art = cache.get(key)
  if (!art) cache.set(key, (art = build()))
  return art
}

export type SickleArtCondition = 'ok' | 'broken' | 'retired'

export const SICKLE_ITEMS: Readonly<Record<SickleTier, string>> = {
  1: 'stone_sickle', 2: 'iron_sickle', 3: 'steel_sickle',
}

/**
 * `E` is the cutting edge (lightest metal), `M` the body of the blade, `D` its
 * dark side, `w` the grip and `W` the grip's shadow. Row 0 is the top.
 */
function tones(tier: SickleTier): Record<string, string> {
  const style = SICKLE_TONES[tier]
  return {
    E: style.head[style.head.length - 1],
    M: style.head[Math.max(0, style.head.length - 2)],
    D: style.outline,
    w: style.handle[2] ?? style.handle[1],
    W: style.handleOutline,
  }
}

/** Icon: the blade hooks left over a grip that points down-right. */
const ICON = [
  '................',
  '.....DDDD.......',
  '...DDEEEEDD.....',
  '..DEEMMMMED.....',
  '.DEEMD..DMED....',
  '.DEMD....DME....',
  '.DEMD.....DM....',
  '.DEMD......D....',
  '.DEMD...........',
  '..DMD...ww......',
  '...DD..wWw......',
  '........wWw.....',
  '.........wWw....',
  '..........wWw...',
  '...........wW...',
  '................',
]

/** Broken: the hook is snapped off and only the heel is left on the grip. */
const BROKEN = [
  '................',
  '................',
  '....DD..........',
  '...DEED.........',
  '...DEMD.........',
  '....DD..........',
  '................',
  '.....D..........',
  '....DMD.........',
  '.....D..ww......',
  '.......wWw......',
  '........wWw.....',
  '.........wWw....',
  '..........wWw...',
  '...........wW...',
  '................',
]

/** Swing poses in world scale, anchored at the hand: raised, mid, through. */
const SWEEP = [
  [
    '..........',
    '...DDD....',
    '..DEEED...',
    '..DEMMD...',
    '...DDD....',
    '....w.....',
    '....w.....',
    '.....w....',
    '..........',
    '..........',
  ],
  [
    '..........',
    '..........',
    '.......DD.',
    '..DDDDEED.',
    '.DEEEEMMD.',
    '..DDDDD...',
    '....w.....',
    '.....w....',
    '..........',
    '..........',
  ],
  [
    '..........',
    '..........',
    '..........',
    '....w.....',
    '.....w....',
    '..DDDDD...',
    '.DEEEEED..',
    '..DMMMD...',
    '...DDD....',
    '..........',
  ],
]

export function sickleIconArt(tier: SickleTier, condition: SickleArtCondition = 'ok'): PixelArt {
  return memo(`sickle|${tier}|${condition}`, () => {
    const rows = condition === 'broken' ? BROKEN : ICON
    const { w, h, pixels } = fromAscii(rows, tones(tier))
    const art = pixelArt(w, h, pixels)
    return condition === 'retired' ? desaturate(art, 0.85, 0.25) : art
  })
}

export const SWEEP_SIZE = 10

export function sickleSwingArt(tier: SickleTier, frame: 0 | 1 | 2, facingLeft: boolean): PixelArt {
  return memo(`sweep|${tier}|${frame}|${facingLeft}`, () => {
    const { w, h, pixels } = fromAscii(SWEEP[frame], tones(tier))
    const art = pixelArt(w, h, pixels, 4, 7)
    return facingLeft ? mirror(art) : art
  })
}
