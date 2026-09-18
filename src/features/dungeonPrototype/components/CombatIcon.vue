<script setup lang="ts">
// The icon set of the combat panel (D1.2.4bis §4).
//
// Drawn here, as paths on a 24×24 grid, for two reasons: they inherit the
// colour of whatever they sit on (a move tinted by its type, a status chip
// tinted by its condition), and they are ours — no icon font, no third-party
// asset, nothing to attribute.

export type IconName =
  | 'physical' | 'special' | 'status'
  | 'swap' | 'flee' | 'bag' | 'heart' | 'shield' | 'ball' | 'skull'
  | 'burn' | 'paralysis' | 'poison' | 'freeze' | 'sleep'

defineProps<{ name: IconName; size?: number }>()

/** One path per icon. Stroked, not filled, so they stay legible at 12px. */
const PATHS: Record<IconName, string> = {
  // A fist coming in: contact damage.
  physical: 'M7 13c0-3 2-5 5-5h3a3 3 0 0 1 0 6h-1m-7-1v3a3 3 0 0 0 3 3h5a4 4 0 0 0 4-4v-2',
  // A burst: damage that travels.
  special: 'M12 3v5m0 8v5m-9-9h5m8 0h5M6 6l3 3m6 6 3 3M18 6l-3 3m-6 6-3 3',
  // A swirl: something that changes the fight instead of ending it.
  status: 'M12 4a8 8 0 1 0 8 8 5 5 0 0 1-5 5 4 4 0 0 1-4-4 3 3 0 0 1 3-3',
  // Two arrows trading places.
  swap: 'M4 9h13l-3-3m3 3-3 3M20 15H7l3-3m-3 3 3 3',
  // A runner leaving.
  flee: 'M13 4a2 2 0 1 0 0 .01M11 21l2-6-3-3 1-5 3 3 3 1M8 13l-2 2',
  bag: 'M5 9h14l-1 11H6zM9 9V6a3 3 0 0 1 6 0v3',
  heart: 'M12 20s-7-4.4-7-9a3.8 3.8 0 0 1 7-2 3.8 3.8 0 0 1 7 2c0 4.6-7 9-7 9z',
  shield: 'M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z',
  // A Poké Ball, flattened to a stroke.
  ball: 'M3.5 12h5m7 0h5M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0zM14.5 12a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  skull: 'M8 17v3h8v-3m3-5a7 7 0 1 0-14 0c0 2.6 1.4 4 3 5h8c1.6-1 3-2.4 3-5zM9.5 11.5h.01M14.5 11.5h.01',
  burn: 'M12 3s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3 1-3s1 2 2 2 2-5 2-8z',
  paralysis: 'M13 3 6 13h5l-2 8 8-11h-5z',
  poison: 'M12 4c3 3 5 5.5 5 8a5 5 0 0 1-10 0c0-2.5 2-5 5-8zM10 20h4',
  freeze: 'M12 3v18M4 7.5l16 9M20 7.5l-16 9',
  sleep: 'M6 7h6l-6 6h6M14 13h5l-5 5h5',
}
</script>

<template>
  <svg
    class="ci" :width="size ?? 12" :height="size ?? 12" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
  >
    <path :d="PATHS[name]" />
  </svg>
</template>

<style scoped>
.ci { flex: none; vertical-align: -1px; }
</style>
