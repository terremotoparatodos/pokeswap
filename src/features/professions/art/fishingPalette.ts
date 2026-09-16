// Fishing palette (R31-C2). Water tones sit slightly darker and bluer than the
// terrain water WildLands paints, so a fishing spot reads as "deeper here"
// without turning into UI. Wood and steel come from the mining palette so rods
// and pickaxes look like the same workshop made them.

import { TOOL_HEAD_TONES, WOOD_OUTLINE, WOOD_TONES } from './miningPalette'

export interface WaterTones {
  /** dark → light */
  readonly tones: readonly [string, string, string]
  readonly foam: string
}

/** One per fishing node: calmer shallows, open coast, deep reef. */
export const WATER_TONES = {
  shore_spot: { tones: ['#2d68a4', '#4a8fc9', '#7cbde4'], foam: '#eaf6ff' },
  coastal_spot: { tones: ['#215c99', '#3a7fc0', '#69aede'], foam: '#e3f2ff' },
  reef_spot: { tones: ['#17497f', '#2a6aa8', '#4f96cc'], foam: '#dcefff' },
} as const satisfies Record<string, WaterTones>

export interface FishTones {
  readonly body: readonly [string, string, string]
  readonly belly: string
  readonly fin: string
}

export const FISH_TONES = {
  common: { body: ['#35637d', '#5b9ab8', '#93cbdf'], belly: '#e7f3f7', fin: '#24495d' },
  quality: { body: ['#2f6b58', '#4f9c7c', '#8ecfa8'], belly: '#f2f8ea', fin: '#204b3b' },
} as const satisfies Record<string, FishTones>

export const SEAWEED_TONES = ['#1d5333', '#2f7f4b', '#5aab68'] as const
export const SEAWEED_OUTLINE = '#123520'
export const PEARL_TONES = ['#9fb0c4', '#d5e2ee', '#ffffff'] as const
export const PEARL_OUTLINE = '#5d6f84'
export const SCALE_TONES = ['#9c3560', '#d85d8c', '#ffb1cb'] as const
export const SCALE_OUTLINE = '#5e1c39'
export const OIL_TONES = ['#8a6a1f', '#c39a33', '#efd06a'] as const

/** The bobber is the one deliberately loud colour on the water. */
export const BOBBER = { red: '#e0503f', dark: '#8f2b22', white: '#f4f7fb', outline: '#3d1410' } as const
export const LINE_TONE = '#f2f6ff'
export const SPLASH_TONE = '#f2fbff'

export type RodTier = 1 | 2 | 3

/** T1 plain wood, T2 wood with steel bands, T3 deep-blue composite with gold. */
export const ROD_TONES: Readonly<Record<RodTier, { tones: readonly string[]; outline: string; band: string | null }>> = {
  1: { tones: WOOD_TONES, outline: WOOD_OUTLINE, band: null },
  2: { tones: WOOD_TONES, outline: WOOD_OUTLINE, band: TOOL_HEAD_TONES[2].tones[2] },
  3: { tones: TOOL_HEAD_TONES[3].tones, outline: TOOL_HEAD_TONES[3].outline, band: '#f7d354' },
}
