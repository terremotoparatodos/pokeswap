<template>
  <button class="rc" :class="[`rc--${view.availability}`, { 'rc--selected': selected }]" type="button" :aria-pressed="selected">
    <span class="rc-glyphs">
      <ItemGlyph v-for="output in view.outputs" :key="output.itemId" :item-id="output.itemId" :size="26" />
    </span>
    <span class="rc-body">
      <strong>{{ view.title }}</strong>
      <small>{{ label }}</small>
    </span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { RecipeView } from '../ui/recipeView'
import ItemGlyph from './ItemGlyph.vue'

const props = defineProps<{ view: RecipeView; selected: boolean }>()

const label = computed(() => {
  if (props.view.availability === 'locked') return `Requiere Nv. ${props.view.requiredLevel}`
  const missing = props.view.ingredients.filter(ingredient => ingredient.missing > 0)
  if (missing.length) return `Falta ${missing.map(ingredient => ingredient.name).join(', ')}`
  return `Podés crear ${props.view.maxCraftable}`
})
</script>

<style scoped>
.rc { display: flex; align-items: center; gap: 0.6rem; width: 100%; min-height: 52px; padding: 0.45rem 0.6rem; border: 2px solid transparent; border-radius: 10px; background: var(--pf-navy-2); color: inherit; font: inherit; text-align: left; cursor: pointer; }
.rc:hover { border-color: rgba(255, 255, 255, 0.2); }
.rc--selected { border-color: var(--pf-gold); }
.rc-glyphs { display: inline-flex; gap: 2px; }
.rc-body { display: grid; min-width: 0; }
.rc-body strong { overflow: hidden; font-size: 0.9rem; text-overflow: ellipsis; white-space: nowrap; }
.rc-body small { overflow: hidden; color: var(--pf-muted); font-size: 0.74rem; text-overflow: ellipsis; white-space: nowrap; }
.rc--ready small { color: var(--pf-good); }
.rc--missing small { color: var(--pf-warn); }
.rc--locked { opacity: 0.55; }
</style>
