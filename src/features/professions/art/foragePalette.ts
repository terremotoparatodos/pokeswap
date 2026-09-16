// Foraging palette (R31-C4.1): the gathering half of Alchemy.
//
// The rule inherited from the other three professions holds: the plant is the
// world's own plant. What changes is **what hangs from it** — berries, flowers,
// a bloom of ice — and that is where the colour goes. The berry tones are the
// same ones the icons use, so a blue berry on a bush and a Baya Aranja in the
// bag are visibly the same fruit.

import { BUSH_RECIPES, CRYSTAL_RECIPE, LEAF_OUTLINE, LEAVES } from '../../wildlands/engine/props'
import { BERRY_TONES, SPARKLE_TONES } from './alchemyPalette'
import { TOOL_HEAD_TONES } from './miningPalette'
import { WOOD_OUTLINE, WOOD_TONES } from './miningPalette'

export { BUSH_RECIPES, CRYSTAL_RECIPE, LEAVES, LEAF_OUTLINE, BERRY_TONES, SPARKLE_TONES }

/** Fruit that hangs from a forage node, in the icon's own colours. */
export const FRUIT = {
  oran: BERRY_TONES.oran,
  leppa: BERRY_TONES.leppa,
  sitrus: BERRY_TONES.sitrus,
} as const

export type FruitKind = keyof typeof FRUIT

/** A picked node keeps its twigs: bare stems where the fruit was. */
export const TWIG_TONE = '#4a3520'
/** First regrowth: a pale bud before the fruit has colour. */
export const BUD_TONES = ['#6a8a4a', '#9ec46a'] as const

/** The herb patch: taller, bluer green than the tall grass around it. */
export const HERB_BLADES = ['#1f5f33', '#2f8a45', '#49b258', '#7fd07a'] as const
export const HERB_OUTLINE = '#10381d'
/** Its small flowers: the cue that this tuft is not just grass. */
export const HERB_FLOWERS = ['#e8e2ff', '#c9b6ff', '#ffffff'] as const
/** A cut patch: pale ends where the sickle passed. */
export const CUT_STEM = '#c9dfa0'

/** The frost bloom: ice petals on the crystal, colder and paler than the shard. */
export const FROST_PETALS = ['#8fb6e8', '#c3dcff', '#eef7ff'] as const
export const FROST_OUTLINE = '#3f6592'
export const FROST_CORE = ['#7ad6f5', '#dffbff'] as const

/** Sickle: pickaxe metals and the same wood, on a curved blade. */
export type SickleTier = 1 | 2 | 3

export const SICKLE_TONES: Readonly<Record<SickleTier, { head: readonly string[]; outline: string; handle: readonly string[]; handleOutline: string }>> = {
  1: { head: TOOL_HEAD_TONES[1].tones, outline: TOOL_HEAD_TONES[1].outline, handle: WOOD_TONES, handleOutline: WOOD_OUTLINE },
  2: { head: TOOL_HEAD_TONES[2].tones, outline: TOOL_HEAD_TONES[2].outline, handle: WOOD_TONES, handleOutline: WOOD_OUTLINE },
  3: { head: TOOL_HEAD_TONES[3].tones, outline: TOOL_HEAD_TONES[3].outline, handle: WOOD_TONES, handleOutline: WOOD_OUTLINE },
}
