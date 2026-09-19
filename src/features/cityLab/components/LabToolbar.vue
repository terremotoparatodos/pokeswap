<script setup lang="ts">
// City Mapping Lab — top toolbar: mode, tools, history, map actions and view.

import type { EditLens } from '../world/labProjection'
import type { CityLab, LabTool } from '../state/useCityLab'

const props = defineProps<{ lab: CityLab }>()
const emit = defineEmits<{ export: []; import: []; reset: []; compare: []; zoom: [action: 'in' | 'out' | 'reset' | 'fit'] }>()
const lab = props.lab

const TOOLS: { id: LabTool; label: string; hint: string }[] = [
  { id: 'select', label: 'Seleccionar', hint: 'Click selecciona, arrastrar mueve (Esc)' },
  { id: 'add', label: 'Agregar', hint: 'Click coloca lo elegido en la paleta' },
  { id: 'terrain', label: 'Terreno', hint: 'Pincel de terreno' },
]
const LENSES: { id: EditLens; label: string }[] = [
  { id: 'plan', label: 'Planta' }, { id: 'handheld', label: 'Vista jugador' }, { id: 'dramatic', label: 'Dramática' },
]
const TIMES: { value: number; label: string }[] = [
  { value: 0.4, label: 'Día' }, { value: 0.73, label: 'Atardecer' }, { value: 0.95, label: 'Noche' },
]
</script>

<template>
  <header class="bar">
    <strong class="bar-title">City Mapping Lab <small>DEV</small></strong>

    <div class="bar-group" role="group" aria-label="Modo">
      <button type="button" :class="{ on: lab.mode.value === 'edit' }" @click="lab.mode.value = 'edit'">✎ EDIT</button>
      <button type="button" :class="{ on: lab.mode.value === 'play' }" title="P" @click="lab.mode.value = 'play'">▶ PLAY</button>
    </div>

    <template v-if="lab.mode.value === 'edit'">
      <div class="bar-group" role="group" aria-label="Herramienta">
        <button v-for="t in TOOLS" :key="t.id" type="button" :title="t.hint" :class="{ on: lab.tool.value === t.id }" @click="lab.tool.value = t.id">{{ t.label }}</button>
      </div>
      <div class="bar-group">
        <button type="button" title="Ctrl+Z" :disabled="!lab.canUndo.value" @click="lab.undo()">↶</button>
        <button type="button" title="Ctrl+Y" :disabled="!lab.canRedo.value" @click="lab.redo()">↷</button>
      </div>
    </template>

    <div class="bar-group">
      <button type="button" class="accent" @click="lab.validate()">VALIDATE MAP</button>
      <button type="button" @click="emit('export')">EXPORT PATCH</button>
      <button type="button" @click="emit('import')">IMPORT PATCH</button>
      <button type="button" class="danger" @click="emit('reset')">RESET TO BASELINE</button>
      <button type="button" @click="emit('compare')">🌳 Comparar árboles</button>
    </div>

    <div class="bar-group bar-view">
      <label>Lente
        <select v-model="lab.editLens.value" :disabled="lab.mode.value === 'play'">
          <option v-for="l in LENSES" :key="l.id" :value="l.id">{{ l.label }}</option>
        </select>
      </label>
      <span v-if="lab.mode.value === 'edit'" class="zoom" title="Rueda del mouse: zoom al cursor · + / − / 0">
        <button type="button" title="Alejar (−)" @click="emit('zoom', 'out')">−</button>
        <b>{{ Math.round(lab.zoom.value * 100) }}%</b>
        <button type="button" title="Acercar (+)" @click="emit('zoom', 'in')">+</button>
        <button type="button" title="100 % (0)" @click="emit('zoom', 'reset')">Reset</button>
        <button type="button" title="Encuadrar toda la ciudad" @click="emit('zoom', 'fit')">Encuadrar ciudad</button>
      </span>
      <label>Hora
        <select v-model.number="lab.clock.value">
          <option v-for="t in TIMES" :key="t.value" :value="t.value">{{ t.label }}</option>
        </select>
      </label>
    </div>
  </header>
</template>

<style scoped>
.bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 8px 12px; background: #141a2b; border-bottom: 1px solid #2a3350; }
.bar-title { color: #ffd84a; font-size: 14px; margin-right: 6px; }
.bar-title small { color: #ff7a7a; font-size: 10px; letter-spacing: 0.08em; }
.bar-group { display: flex; gap: 4px; align-items: center; }
.bar-view { margin-left: auto; gap: 10px; }
.bar-view label { display: flex; gap: 4px; align-items: center; color: #aab4d4; font-size: 12px; }
button, select {
  padding: 5px 9px; border: 1px solid #34406a; border-radius: 6px; background: #1d2540; color: #dfe7ff; font: 12px system-ui, sans-serif; cursor: pointer;
}
button:disabled { opacity: 0.4; cursor: default; }
button.on { background: #3c5bd6; border-color: #6d8cff; color: #fff; }
button.accent { background: #2e6b3e; border-color: #4ea566; }
button.danger { background: #5a2330; border-color: #a2465a; }
.zoom { display: flex; align-items: center; gap: 4px; }
.zoom b { min-width: 42px; text-align: center; color: #dfe7ff; font: 600 12px system-ui, sans-serif; }
</style>
