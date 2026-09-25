<template>
  <img v-if="url" class="mi" :src="url" :width="size" :height="size" :alt="name" :title="name" draggable="false">
  <span v-else class="mi mi--letter" :style="{ width: `${size}px`, height: `${size}px` }" :title="name" aria-hidden="true">{{ name.charAt(0) }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { materialName } from '../domain/materials'
import { itemIconUrl } from '../scene/art/itemIcons'

const props = withDefaults(defineProps<{ itemId: string; size?: number }>(), { size: 22 })
const name = computed(() => materialName(props.itemId))
const url = computed(() => itemIconUrl(props.itemId))
</script>

<style scoped>
.mi { display: inline-block; flex: none; vertical-align: middle; image-rendering: pixelated; }
.mi--letter { display: inline-grid; place-items: center; border-radius: 4px; background: rgba(255, 255, 255, 0.12); font-size: 0.7rem; font-weight: 700; }
</style>
