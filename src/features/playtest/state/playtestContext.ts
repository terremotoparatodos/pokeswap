// Where the player is, for the bug reporter.
//
// A report that says "no me anda" is worth little; one that says "pradera
// (-5, -69), pantalla tienda" is worth a lot. The world loop already knows
// this, so it publishes it here rather than the reporter guessing.
//
// Cosmetic, session-only, single writer: `WildlandsView` sets the world, and
// whatever panel is on top sets the surface.

import { readonly, ref, type Ref } from 'vue'

const area = ref<string | null>(null)
const tx = ref<number | null>(null)
const ty = ref<number | null>(null)
const surface = ref<string | null>(null)

export interface PlaytestContext {
  readonly area: Readonly<Ref<string | null>>
  readonly tx: Readonly<Ref<number | null>>
  readonly ty: Readonly<Ref<number | null>>
  readonly surface: Readonly<Ref<string | null>>
  setWorld(nextArea: string | null, nextTx: number | null, nextTy: number | null): void
  /** The panel on top, or null for the world itself. */
  setSurface(next: string | null): void
}

export function usePlaytestContext(): PlaytestContext {
  return {
    area: readonly(area) as Readonly<Ref<string | null>>,
    tx: readonly(tx) as Readonly<Ref<number | null>>,
    ty: readonly(ty) as Readonly<Ref<number | null>>,
    surface: readonly(surface) as Readonly<Ref<string | null>>,
    setWorld(nextArea, nextTx, nextTy): void {
      area.value = nextArea
      tx.value = nextTx
      ty.value = nextTy
    },
    setSurface(next): void {
      surface.value = next
    },
  }
}
