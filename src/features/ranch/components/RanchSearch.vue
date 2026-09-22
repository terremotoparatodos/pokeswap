<template>
  <div class="rs" :class="{ 'rs--open': results.length > 0 }">
    <label class="rs-field">
      <span class="rs-sr">Buscar habitante</span>
      <svg class="rs-icon" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="9" cy="9" r="5.5" />
        <path d="M13 13l4 4" />
      </svg>
      <input
        ref="inputRef"
        v-model="query"
        class="rs-input"
        type="search"
        autocomplete="off"
        autocorrect="off"
        spellcheck="false"
        enterkeyhint="search"
        placeholder="Buscar habitante"
        role="combobox"
        aria-controls="rancho-resultados"
        :aria-expanded="results.length > 0"
        @keydown.down.prevent="move(1)"
        @keydown.up.prevent="move(-1)"
        @keydown.enter.prevent="choose(results[active])"
        @keydown.esc="clear"
      />
      <button v-if="query" class="rs-clear" type="button" aria-label="Limpiar" @click="clear">×</button>
    </label>

    <ul v-if="results.length" id="rancho-resultados" class="rs-list" role="listbox">
      <li v-for="(resident, position) in results" :key="resident.id">
        <button
          class="rs-hit"
          :class="{ 'rs-hit--active': position === active }"
          type="button"
          role="option"
          :aria-selected="position === active"
          @click="choose(resident)"
          @mousemove="active = position"
        >
          <span class="rs-mark" :class="`rs-mark--${resident.platform}`" aria-hidden="true" />
          <span class="rs-name">{{ resident.displayName }}</span>
          <span class="rs-species">{{ speciesName(resident.speciesId) }}</span>
        </button>
      </li>
    </ul>
    <p v-else-if="query.trim() && searched" class="rs-empty">Nadie con ese nombre vive en el Rancho.</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { RanchResident } from '../domain/membership'
import { searchByName, type SearchEntry } from '../domain/search'
import { speciesName } from '../domain/species'

const props = defineProps<{ index: SearchEntry<RanchResident>[] }>()
const emit = defineEmits<{ pick: [resident: RanchResident] }>()

const query = ref('')
const active = ref(0)
const searched = ref(false)
const inputRef = ref<HTMLInputElement | null>(null)

const results = computed(() => (query.value.trim() ? searchByName(props.index, query.value) : []))

watch(query, () => {
  active.value = 0
  searched.value = true
})

function move(delta: number): void {
  if (!results.value.length) return
  active.value = (active.value + delta + results.value.length) % results.value.length
}

function choose(resident: RanchResident | undefined): void {
  if (!resident) return
  query.value = ''
  searched.value = false
  inputRef.value?.blur()
  emit('pick', resident)
}

function clear(): void {
  query.value = ''
  searched.value = false
}
</script>

<style scoped>
.rs {
  width: min(360px, calc(100vw - 24px));
  font: 500 15px/1.3 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}
.rs-field {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  height: 44px;
  border-radius: 12px;
  background: rgba(20, 22, 26, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(6px);
}
.rs-icon {
  width: 18px;
  height: 18px;
  flex: none;
  fill: none;
  stroke: #cfd6e0;
  stroke-width: 1.8;
  stroke-linecap: round;
}
.rs-input {
  flex: 1;
  min-width: 0;
  background: none;
  border: 0;
  outline: none;
  color: #fff;
  font: inherit;
}
.rs-input::placeholder {
  color: #9aa3b0;
}
.rs-input::-webkit-search-cancel-button {
  display: none;
}
.rs-clear {
  flex: none;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.1);
  color: #dfe5ee;
  font-size: 17px;
  line-height: 1;
  cursor: pointer;
}
.rs-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.rs-list {
  margin: 6px 0 0;
  padding: 4px;
  list-style: none;
  border-radius: 12px;
  background: rgba(20, 22, 26, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.4);
  max-height: min(46vh, 320px);
  overflow-y: auto;
}
.rs-hit {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 8px;
  border: 0;
  border-radius: 9px;
  background: none;
  color: #eef2f8;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.rs-hit--active,
.rs-hit:hover {
  background: rgba(255, 255, 255, 0.11);
}
.rs-mark {
  flex: none;
  width: 11px;
  height: 11px;
  border-radius: 3px;
}
.rs-mark--twitch {
  background: #9146ff;
}
.rs-mark--youtube {
  background: #ff0033;
  border-radius: 4px;
}
.rs-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rs-species {
  flex: none;
  color: #9aa3b0;
  font-size: 13px;
}
.rs-empty {
  margin: 6px 0 0;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(20, 22, 26, 0.9);
  color: #b9c2cf;
  font-size: 14px;
}
</style>
