<script setup lang="ts">
// City Mapping Lab — Validate Map results. Clicking one frames and highlights it.

import { computed, ref } from 'vue'
import type { Finding, Severity } from '../domain/validateMap'
import type { CityLab } from '../state/useCityLab'

const props = defineProps<{ lab: CityLab }>()
const emit = defineEmits<{ focus: [tx: number, ty: number] }>()
const lab = props.lab
const show = ref<Record<Severity, boolean>>({ error: true, warning: true, info: false })
const ICON: Record<Severity, string> = { error: '⛔', warning: '⚠', info: 'ℹ' }

const visible = computed(() => (lab.findings.value ?? []).filter(f => show.value[f.severity]))

function open(f: Finding): void {
  lab.highlight.value = f.tiles
  if (f.ref) lab.select(f.ref)
  const t = f.tiles[0]
  if (t) emit('focus', t.tx, t.ty)
}
</script>

<template>
  <section v-if="lab.findings.value" class="fnd">
    <header>
      <strong>Validate Map</strong>
      <span v-if="lab.findingsStale.value" class="stale">desactualizado — volvé a validar</span>
      <label v-for="s in (['error', 'warning', 'info'] as Severity[])" :key="s">
        <input v-model="show[s]" type="checkbox"> {{ ICON[s] }} {{ lab.findings.value.filter(f => f.severity === s).length }}
      </label>
      <button type="button" @click="lab.findings.value = null; lab.highlight.value = []">Cerrar</button>
    </header>
    <ol>
      <li v-for="(f, i) in visible" :key="i" :class="f.severity" @click="open(f)">
        <span class="sev">{{ ICON[f.severity] }}</span>
        <span class="cat">{{ f.category }}</span>
        <span class="msg">{{ f.message }}</span>
      </li>
      <li v-if="!visible.length" class="empty">Nada para mostrar con estos filtros.</li>
    </ol>
  </section>
</template>

<style scoped>
.fnd { display: flex; flex-direction: column; max-height: 210px; background: #0f1422; border-top: 1px solid #2a3350; color: #dfe7ff; font: 12px system-ui, sans-serif; }
header { display: flex; align-items: center; gap: 10px; padding: 6px 10px; border-bottom: 1px solid #222a44; }
header button { margin-left: auto; padding: 3px 8px; border: 1px solid #34406a; border-radius: 6px; background: #1d2540; color: #dfe7ff; cursor: pointer; }
.stale { color: #ffb347; }
ol { margin: 0; padding: 0; list-style: none; overflow-y: auto; }
li { display: flex; gap: 8px; padding: 4px 10px; border-bottom: 1px solid #1a2036; cursor: pointer; }
li:hover { background: #1a2340; }
li.error .sev { color: #ff6b6b; }
li.warning .sev { color: #ffc14d; }
.cat { min-width: 90px; color: #8f9bc4; }
.empty { color: #8f9bc4; cursor: default; }
</style>
