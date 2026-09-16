// Logging palette (R31-C3). Bark and leaves come from the WildLands tree props
// so a harvestable tree is the same tree; only the cut face, the tier marks and
// the tools are new.

import { LEAF_OUTLINE, LEAVES, TRUNK_OUTLINE, TRUNK_TONES } from '../../wildlands/engine/props'
import { TOOL_HEAD_TONES, WOOD_OUTLINE, WOOD_TONES } from './miningPalette'

export { LEAVES, LEAF_OUTLINE, TRUNK_TONES, TRUNK_OUTLINE }

/** Fresh-cut wood: the pale face of a stump and of a log seen end-on. */
export const CUT_TONES = ['#a97643', '#d9a66a', '#f0d29c'] as const
export const CUT_RING = '#8a5c31'

/** Bark flavour per wood tier; `streak` paints the grain that tells them apart. */
export const WOOD_TIERS = {
  common: { tones: TRUNK_TONES, outline: TRUNK_OUTLINE, streak: '#5b3720' },
  hardwood: { tones: ['#3a2416', '#55351f', '#74492a', '#8f6038'], outline: '#20130a', streak: '#2c1b10' },
  boreal: { tones: ['#41403f', '#5d5d5e', '#7d8086', '#a3aab4'], outline: '#262728', streak: '#cfe0ef' },
} as const

export type WoodTier = keyof typeof WOOD_TIERS

export const RESIN_TONES = ['#8a5a12', '#d69a26', '#ffd77a'] as const
export const RESIN_OUTLINE = '#4e330a'
export const APRICORN_TONES = ['#4b2a6b', '#7a45a8', '#b183d6'] as const
export const APRICORN_OUTLINE = '#2c173f'
export const SAWDUST_TONE = '#d8b47e'
export const SPROUT_TONES = ['#2c7a37', '#6cc255', '#a4e27c'] as const

export type AxeTier = 1 | 2 | 3

/** Axe heads share the pickaxe metals; handles share the wood. */
export const AXE_TONES: Readonly<Record<AxeTier, { head: readonly string[]; outline: string; handle: readonly string[]; handleOutline: string }>> = {
  1: { head: TOOL_HEAD_TONES[1].tones, outline: TOOL_HEAD_TONES[1].outline, handle: WOOD_TONES, handleOutline: WOOD_OUTLINE },
  2: { head: TOOL_HEAD_TONES[2].tones, outline: TOOL_HEAD_TONES[2].outline, handle: WOOD_TONES, handleOutline: WOOD_OUTLINE },
  3: { head: TOOL_HEAD_TONES[3].tones, outline: TOOL_HEAD_TONES[3].outline, handle: WOOD_TONES, handleOutline: WOOD_OUTLINE },
}
