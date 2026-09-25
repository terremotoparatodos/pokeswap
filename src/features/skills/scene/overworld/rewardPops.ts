// Reward pops (R31-Z): the "+N" item icons and "+N XP" labels that rise over a
// finished action. Every profession overlay drew them the same way; this is
// that one implementation, so the timing, the drift, the fade and the cleanup
// stay identical everywhere.
//
// Presentation only: it never decides what was earned, it shows what the
// caller says was earned.

import type { OverlayLabel, OverlaySprite } from '../../../wildlands/engine/sceneOverlay'
import { toSprite, type PixelArt } from '../art/pixelArt'
import type { ItemStack } from '../../domain/materials'
import { RARITY_FEEDBACK, rarityOfItem } from '../mining/miningRarity'

export interface RewardPop {
  /** Item whose icon rises with the label; null for a text-only pop (XP, notes). */
  readonly itemId: string | null
  readonly text: string
  readonly color: string
  readonly x: number
  readonly y: number
  readonly lift: number
  /** Scene seconds the pop starts at; it may be in the future for a stagger. */
  readonly start: number
  readonly life: number
}

/** How far a pop drifts up over its life, in world pixels. */
const DRIFT = 14
/** Horizontal spacing between the stacks of one reward. */
const STACK_SPACING = 14
/** Delay between the stacks of one reward, and before the XP label. */
const STACK_STAGGER = 0.12
const XP_DELAY = 0.2
const XP_COLOR = '#ffd27a'

/** Fades out over the last 30 % of the life. */
const fade = (t: number): number => (t > 0.7 ? (1 - t) / 0.3 : 1)

export class RewardPops {
  private pops: RewardPop[] = []

  push(pop: RewardPop): void {
    this.pops.push(pop)
  }

  /**
   * The gathering reward: one pop per stack, coloured and timed by its rarity,
   * then the XP label above them.
   */
  pushGathered(stacks: readonly ItemStack[], xp: number, x: number, y: number, lift: number, now: number): void {
    stacks.forEach((stack, index) => {
      const rarity = rarityOfItem(stack.itemId)
      this.pops.push({
        itemId: stack.itemId, text: `+${stack.quantity}`, color: RARITY_FEEDBACK[rarity].labelColor,
        x: x + (index - (stacks.length - 1) / 2) * STACK_SPACING, y, lift, start: now + index * STACK_STAGGER,
        life: 1.2 + RARITY_FEEDBACK[rarity].lingerMs / 1000,
      })
    })
    this.pushXp(xp, x, y, lift + 16, now)
  }

  pushXp(xp: number, x: number, y: number, lift: number, now: number): void {
    this.pops.push({ itemId: null, text: `+${xp} XP`, color: XP_COLOR, x, y, lift, start: now + XP_DELAY, life: 1.3 })
  }

  /** Drops finished pops. */
  prune(seconds: number): void {
    this.pops = this.pops.filter(pop => seconds - pop.start < pop.life)
  }

  clear(): void {
    this.pops = []
  }

  /** The rising item icons, in insertion order. `iconFor` picks the art kit. */
  iconSprites(seconds: number, iconFor: (itemId: string) => PixelArt | null | undefined): OverlaySprite[] {
    const out: OverlaySprite[] = []
    for (const pop of this.pops) {
      if (!pop.itemId) continue
      const icon = iconFor(pop.itemId)
      const t = (seconds - pop.start) / pop.life
      if (!icon || t < 0) continue
      out.push({ wx: pop.x, wy: pop.y, sprite: toSprite(icon, false), lift: pop.lift + t * DRIFT, alpha: fade(t), depthBias: 2 })
    }
    return out
  }

  /** The text of every started pop; an item pop sits beside its icon. */
  labels(seconds: number): OverlayLabel[] {
    return this.pops.flatMap(pop => {
      const t = (seconds - pop.start) / pop.life
      if (t < 0) return []
      return [{
        wx: pop.itemId ? pop.x + 12 : pop.x, wy: pop.y, lift: pop.lift + t * DRIFT + (pop.itemId ? 4 : 0),
        text: pop.text, color: pop.color, alpha: fade(t),
      }]
    })
  }
}
