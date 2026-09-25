// Logging palette (R31-C3). Bark and leaves come from the WildLands tree props
// so a harvestable tree is the same tree; only the cut face and the tier marks
// are new.

import { LEAF_OUTLINE, LEAVES, TRUNK_OUTLINE, TRUNK_TONES } from '../../../wildlands/engine/props'

export { LEAVES, LEAF_OUTLINE, TRUNK_TONES, TRUNK_OUTLINE }

/** Fresh-cut wood: the pale face of a stump and of a log seen end-on. */
export const CUT_TONES = ['#a97643', '#d9a66a', '#f0d29c'] as const
export const CUT_RING = '#8a5c31'

/** Bark flavour per wood tier; `streak` paints the grain that tells them apart. */
export const WOOD_TIERS = {
  common: { tones: TRUNK_TONES, outline: TRUNK_OUTLINE, streak: '#5b3720' },
  pine: { tones: ['#4a2c1a', '#6b4128', '#8c5a36', '#b07a4c'], outline: '#28170c', streak: '#d9a66a' },
  hardwood: { tones: ['#3a2416', '#55351f', '#74492a', '#8f6038'], outline: '#20130a', streak: '#2c1b10' },
  boreal: { tones: ['#41403f', '#5d5d5e', '#7d8086', '#a3aab4'], outline: '#262728', streak: '#cfe0ef' },
} as const

export type WoodTier = keyof typeof WOOD_TIERS

/** Amber beads on pine bark. */
export const RESIN_TONES = ['#8a5a12', '#d69a26', '#ffd77a'] as const

export const SAWDUST_TONE = '#d8b47e'
/**
 * The forester's ribbon: the one deliberately loud colour in the forest, the
 * way the bobber is on the water. Nothing else in a WildLands wood is red.
 */
export const RIBBON = { light: '#f05a4a', dark: '#a82d27', tie: '#ffe9c9', outline: '#5e1712' } as const
export const SPROUT_TONES = ['#2c7a37', '#6cc255', '#a4e27c'] as const
