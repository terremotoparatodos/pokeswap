<template>
  <span class="eco-sprite" role="img" :aria-label="label" :style="style" />
</template>

<script setup lang="ts">
// ECO-PRESENTATION-1: one still frame of a species' bundled overworld sheet — the same art the map
// draws (2 columns × 4 rows: down, up, left, right). Local asset, no network; CSS crop, no canvas.
import { computed } from 'vue'
import { overworldSheetUrl } from '../../wildlands/engine/characters'

const ROW = { down: 0, up: 1, left: 2, right: 3 } as const

const props = withDefaults(defineProps<{ speciesId: number; facing?: keyof typeof ROW; size?: number; label: string }>(), { facing: 'down', size: 96 })

const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  backgroundImage: `url(${overworldSheetUrl(props.speciesId, false)})`,
  backgroundPosition: `0% ${(ROW[props.facing] * 100) / 3}%`,
}))
</script>

<style scoped>
.eco-sprite { display: inline-block; flex: none; background-repeat: no-repeat; background-size: 200% 400%; image-rendering: pixelated; }
</style>
