<template>
  <div class="rc-backdrop" @click.self="emit('close')">
    <section
      ref="cardRef"
      class="rc"
      role="dialog"
      aria-modal="true"
      :aria-label="`Ficha de ${resident.displayName}`"
      tabindex="-1"
    >
      <button class="rc-close" type="button" aria-label="Cerrar" @click="emit('close')">×</button>

      <header class="rc-head">
        <span class="rc-sprite" role="img" :aria-label="species" :style="spriteStyle" />
        <div class="rc-titles">
          <p class="rc-species">{{ species }}</p>
          <h2 class="rc-name">{{ resident.displayName }}</h2>
          <p class="rc-platform" :class="`rc-platform--${resident.platform}`">
            <span class="rc-mark" aria-hidden="true" />
            {{ membershipLabel(resident) }}
          </p>
        </div>
      </header>

      <dl class="rc-facts">
        <div v-for="fact in facts" :key="fact.label" class="rc-fact">
          <dt>{{ fact.label }}</dt>
          <dd>{{ fact.value }}</dd>
        </div>
      </dl>

      <p class="rc-note">Los datos de esta versión son de prueba.</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { overworldSheetUrl } from '../../wildlands/engine/characters'
import type { RanchResident } from '../domain/membership'
import { speciesName } from '../domain/species'
import { membershipLabel, residentFacts } from '../domain/tenure'

const props = defineProps<{ resident: RanchResident }>()
const emit = defineEmits<{ close: [] }>()

const cardRef = ref<HTMLElement | null>(null)
const species = computed(() => speciesName(props.resident.speciesId))
const facts = computed(() => residentFacts(props.resident))
// The sheet is 2 columns x 4 rows of square cells, so 200%/400% makes one cell
// fill the box whatever the source cell size is. The url only ever holds a
// validated species number.
const spriteStyle = computed(() => ({
  backgroundImage: `url("${overworldSheetUrl(props.resident.speciesId, props.resident.shiny)}")`,
}))

const onKeyDown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') emit('close')
}
onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  cardRef.value?.focus()
})
onUnmounted(() => window.removeEventListener('keydown', onKeyDown))
</script>

<style scoped>
.rc-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 16px;
  background: rgba(8, 10, 14, 0.55);
  font: 400 15px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
@media (min-width: 640px) {
  .rc-backdrop {
    align-items: center;
  }
}
.rc {
  position: relative;
  width: min(420px, 100%);
  padding: 18px;
  border-radius: 18px;
  background: #fdfaf2;
  color: #22252b;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
  outline: none;
}
.rc-close {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.06);
  color: #3a3f47;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
.rc-head {
  display: flex;
  align-items: center;
  gap: 14px;
}
.rc-sprite {
  flex: none;
  display: block;
  width: 64px;
  height: 64px;
  /* Crops the first front-facing frame out of the overworld sheet. */
  background-color: #eae3d2;
  background-size: 200% 400%;
  background-position: 0 0;
  background-repeat: no-repeat;
  image-rendering: pixelated;
  border-radius: 12px;
}
.rc-titles {
  min-width: 0;
}
.rc-species {
  margin: 0;
  font-size: 13px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #7c8390;
}
.rc-name {
  margin: 2px 0 4px;
  font-size: 21px;
  line-height: 1.15;
  overflow-wrap: anywhere;
}
.rc-platform {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 14px;
  color: #545b66;
}
.rc-mark {
  width: 11px;
  height: 11px;
  border-radius: 3px;
  background: #9146ff;
}
.rc-platform--youtube .rc-mark {
  background: #ff0033;
  border-radius: 4px;
}
.rc-facts {
  margin: 16px 0 0;
  display: grid;
  gap: 1px;
  background: #e7e0d0;
  border: 1px solid #e7e0d0;
  border-radius: 12px;
  overflow: hidden;
}
.rc-fact {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 12px;
  background: #fffdf7;
}
.rc-fact dt {
  color: #6a717c;
}
.rc-fact dd {
  margin: 0;
  font-weight: 600;
  text-align: right;
}
.rc-note {
  margin: 12px 2px 0;
  font-size: 12px;
  color: #8a909b;
}
</style>
