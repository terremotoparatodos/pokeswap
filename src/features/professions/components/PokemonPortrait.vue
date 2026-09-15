<template>
  <span class="pp" role="img" :aria-label="name" :style="style" />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { overworldSheetUrl } from '../../wildlands/engine/characters'

// First frame of the down-facing row of the existing overworld sheet (2 × 4 cells).
const props = withDefaults(defineProps<{ speciesId: number; name: string; size?: number }>(), { size: 48 })

const style = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
  backgroundImage: `url(${overworldSheetUrl(props.speciesId, false)})`,
}))
</script>

<style scoped>
.pp {
  display: inline-block;
  flex: none;
  border-radius: 12px;
  background-color: rgba(255, 255, 255, 0.08);
  background-position: 0 0;
  background-repeat: no-repeat;
  background-size: 200% 400%;
  image-rendering: pixelated;
}
</style>
