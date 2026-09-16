// Alchemy palette (R31-C4).
//
// Alchemy is the first profession that makes something instead of taking it, so
// its colour comes from the *product*: glass and wood are neutral and the
// liquid is what carries the identity. A potion is rose, an ether is azure, a
// revive is gold. The same liquid tones paint the icon, the flask on the table
// and the bubbles while it brews, so a player learns the colour once.

import { TRUNK_OUTLINE, TRUNK_TONES } from '../../wildlands/engine/props'
import { TOOL_HEAD_TONES } from './miningPalette'

/** The bench is the world's own wood; only the glassware is new. */
export const BENCH_TONES = TRUNK_TONES
export const BENCH_OUTLINE = TRUNK_OUTLINE

/** Glass: nearly colourless, read by its highlight and its dark rim. */
export const GLASS_TONES = ['#6d8ea3', '#9dc0d1', '#c8e4ef', '#f2fbff'] as const
export const GLASS_OUTLINE = '#2c4250'
export const CORK_TONES = ['#8a5c31', '#c09257', '#e0bb82'] as const

/** Burner and stand share the pickaxe metals, so the toolkit stays one family. */
export const BRASS_TONES = TOOL_HEAD_TONES[2].tones
export const BRASS_OUTLINE = TOOL_HEAD_TONES[2].outline
export const FLAME_TONES = ['#c23a10', '#f07818', '#ffc247', '#fff3b0'] as const
export const STEAM_TONES = ['#8fa8bd', '#c3d6e4', '#eef6fb'] as const

export interface Liquid {
  /** Dark → light; index 2 is the surface the bubbles break on. */
  readonly tones: readonly [string, string, string]
  readonly outline: string
}

const liquid = (a: string, b: string, c: string, outline: string): Liquid => ({ tones: [a, b, c], outline })

/**
 * One liquid per product. Families read at a glance: red-rose heals HP, azure
 * restores PP, gold brings back, green is a raw preparation.
 */
export const LIQUIDS: Readonly<Record<string, Liquid>> = {
  potion: liquid('#8f2b46', '#d2436b', '#ff8fa8', '#4a1526'),
  super_potion: liquid('#8a4a10', '#e08a1e', '#ffc35e', '#4a2607'),
  hyper_potion: liquid('#5a1c74', '#9c34c0', '#d87ff0', '#2f0d3f'),
  ether: liquid('#12506e', '#2b8fb8', '#77d6f0', '#06293a'),
  revive: liquid('#8a6a10', '#e3c034', '#fff2a8', '#4a3707'),
  vigor_tea: liquid('#4a6a14', '#88ad2a', '#cfe06a', '#26380a'),
  herbal_extract: liquid('#14532c', '#2c8a4a', '#6fc47c', '#072a15'),
}

export const DEFAULT_LIQUID: Liquid = liquid('#3a5a72', '#5f8fae', '#9cc7dd', '#1c2e3c')

export const liquidOf = (itemId: string): Liquid => LIQUIDS[itemId] ?? DEFAULT_LIQUID

/** Berries and herbs: the ingredients Alchemy brings in by itself. */
export const BERRY_TONES = {
  oran: { tones: ['#1e4f8f', '#2f7ad1', '#6fb2f2'], outline: '#0d2b4f' },
  leppa: { tones: ['#8f2410', '#d14a1e', '#f2895a'], outline: '#4a1207' },
  sitrus: { tones: ['#8a7a10', '#d1c02a', '#f2e87a'], outline: '#4a3f07' },
} as const

export const LEAF_TONES = ['#1d5a2e', '#2c7a37', '#44a043', '#6cc255'] as const
export const LEAF_OUTLINE_TONE = '#133d20'
export const HERB_TONES = ['#2c6a3a', '#4a9a52', '#84c67a'] as const
export const REVIVAL_TONES = ['#6a2c74', '#a854c0', '#e2a8f0'] as const
export const ESSENCE_TONES = ['#3f2c74', '#6f54c0', '#b8a8f0'] as const

/** The one loud accent of the kit: a finished product sparkles, nothing else does. */
export const SPARKLE_TONES = ['#fff3b0', '#ffe07a', '#ffffff'] as const
