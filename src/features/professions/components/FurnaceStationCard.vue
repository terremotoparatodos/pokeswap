<template>
  <section class="fs pf-card">
    <header class="fs-head">
      <div>
        <p class="pf-kicker">Horno de Fundición · Minería Nv. {{ level }}</p>
        <h3 class="fs-title">{{ STATE_TITLE[phase] }}</h3>
      </div>
      <button type="button" class="fs-close" aria-label="Cerrar" @click="$emit('close')">×</button>
    </header>

    <!-- IDLE: pick a process and commit the inputs. -->
    <template v-if="phase === 'idle'">
      <ul class="fs-list">
        <li v-for="entry in recipes" :key="entry.id">
          <button
            type="button"
            class="fs-recipe"
            :class="{ 'fs-recipe--on': entry.id === recipeId, 'fs-recipe--blocked': entry.block }"
            @click="$emit('select', entry.id)"
          >
            <ItemGlyph :item-id="entry.output.itemId" :size="20" />
            <span class="fs-recipe-name">{{ nameOf(entry.output.itemId) }}</span>
            <span v-if="entry.block === 'level'" class="fs-tag fs-tag--lock">Nv. {{ entry.requiredLevel }}</span>
            <span v-else-if="entry.block === 'inputs'" class="fs-tag fs-tag--miss">Faltan</span>
            <span v-else class="fs-tag fs-tag--ok">Listo</span>
          </button>
        </li>
      </ul>

      <template v-if="selected">
        <ul class="fs-ing">
          <li v-for="input in selected.inputs" :key="input.itemId" :class="{ 'fs-ing--short': input.have < input.quantity * quantity }">
            <ItemGlyph :item-id="input.itemId" :size="20" />
            <span class="fs-ing-name">{{ nameOf(input.itemId) }}</span>
            <span class="fs-ing-count">{{ input.have }}/{{ input.quantity * quantity }}</span>
          </li>
        </ul>

        <div class="fs-qty">
          <button type="button" class="fs-step" :disabled="quantity <= 1" aria-label="Menos" @click="$emit('quantity', quantity - 1)">−</button>
          <output class="fs-qty-value">{{ quantity }}</output>
          <button type="button" class="fs-step" aria-label="Más" @click="$emit('quantity', quantity + 1)">+</button>
        </div>

        <button type="button" class="pf-btn fs-act" :disabled="!!selected.block" @click="$emit('prepare')">
          {{ selected.block === 'level' ? `Requiere Nv. ${selected.requiredLevel}` : selected.block === 'inputs' ? 'Faltan materiales' : `Cargar ${quantity}` }}
        </button>
      </template>
    </template>

    <!-- READY: the ore is already inside. Light it, or take it back. -->
    <template v-else-if="phase === 'ready'">
      <p class="fs-note">El horno tiene los materiales cargados y reservados para este proceso.</p>
      <ul class="fs-ing">
        <li v-for="stack in process?.committed ?? []" :key="stack.itemId">
          <ItemGlyph :item-id="stack.itemId" :size="20" />
          <span class="fs-ing-name">{{ nameOf(stack.itemId) }}</span>
          <span class="fs-ing-count">×{{ stack.quantity }}</span>
        </li>
      </ul>
      <p class="fs-out">
        <ItemGlyph v-if="process?.output[0]" :item-id="process.output[0].itemId" :size="20" />
        <span>Producirá <strong>{{ process?.output[0]?.quantity }} × {{ nameOf(process?.output[0]?.itemId ?? '') }}</strong></span>
        <span class="fs-secs">{{ Math.round((process?.durationMs ?? 0) / 1000) }} s</span>
      </p>
      <div class="fs-row">
        <button type="button" class="pf-btn fs-act" @click="$emit('start')">Encender</button>
        <button type="button" class="fs-ghost" @click="$emit('cancel')">Descargar</button>
      </div>
    </template>

    <!-- WORKING: the bar is derived from the process, not from a timer. -->
    <template v-else-if="phase === 'working'">
      <div class="fs-progress" role="progressbar" :aria-valuenow="Math.round(progress * 100)" aria-valuemin="0" aria-valuemax="100">
        <span :style="{ width: `${Math.round(progress * 100)}%` }" />
      </div>
      <p class="fs-busy">Fundiendo · quedan {{ remainingSeconds }} s</p>
      <p class="fs-note">Podés alejarte: el proceso sigue igual y el resultado espera en el horno.</p>
    </template>

    <!-- DONE: it stays here until someone takes it. -->
    <template v-else>
      <p class="fs-out">
        <ItemGlyph v-if="process?.output[0]" :item-id="process.output[0].itemId" :size="20" />
        <span>Listo: <strong>{{ process?.output[0]?.quantity }} × {{ nameOf(process?.output[0]?.itemId ?? '') }}</strong></span>
      </p>
      <button type="button" class="pf-btn fs-act" @click="$emit('collect')">Retirar</button>
    </template>

    <p v-if="failure" class="fs-block">{{ FAILURE_TEXT[failure.code] ?? failure.code }}</p>
  </section>
</template>

<script setup lang="ts">
// The furnace panel (R33). Functional, not final: R33 is not the phase that
// designs the crafting UI. It shows one of the four states, and every button
// is a transition of the process machine — the panel decides nothing itself.

import { ITEM_BY_ID } from '../domain/catalog/items'
import type { StationPhase, StationProcessState } from '../stations/stationProcess'
import type { FurnaceRecipeView } from '../stations/useFurnaceController'
import ItemGlyph from './ItemGlyph.vue'

defineProps<{
  level: number
  phase: StationPhase
  recipes: readonly FurnaceRecipeView[]
  recipeId: string
  selected: FurnaceRecipeView | null
  quantity: number
  process: StationProcessState | null
  progress: number
  remainingSeconds: number
  failure: { readonly code: string } | null
}>()

defineEmits<{
  close: []
  select: [id: string]
  quantity: [value: number]
  prepare: []
  start: []
  collect: []
  cancel: []
}>()

const STATE_TITLE: Record<StationPhase, string> = {
  idle: 'Apagado',
  ready: 'Cargado',
  working: 'Fundiendo',
  done: 'Terminado',
}

/** Plain text for what the domain refused, so a code never reaches the player. */
const FAILURE_TEXT: Record<string, string> = {
  station_busy: 'El horno ya tiene un proceso en curso.',
  missing_inputs: 'No tenés los materiales necesarios.',
  level_too_low: 'Tu nivel de Minería no alcanza para este proceso.',
  invalid_quantity: 'Esa cantidad no es válida.',
  not_ready: 'El horno todavía no está listo para eso.',
  not_working: 'El horno no está funcionando.',
  not_done: 'El proceso todavía no terminó.',
  no_process: 'El horno está vacío.',
  already_started: 'El horno ya está encendido.',
  output_capacity_exceeded: 'Necesitás espacio en la mochila para retirar el resultado. El horno lo guarda hasta entonces.',
  station_not_productive: 'Esta estación todavía no funciona.',
  untrusted_clock: 'No se pudo leer el reloj del proceso.',
  recipe_not_supported: 'El horno no puede hacer eso.',
  unknown_recipe: 'Ese proceso no existe.',
  unknown_station: 'Esa estación no existe.',
  invalid_process_id: 'El proceso no tiene identidad válida.',
}

const nameOf = (itemId: string): string => ITEM_BY_ID.get(itemId)?.name ?? itemId
</script>

<style scoped>
.fs { display: grid; gap: 10px; }
.fs-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.fs-title { margin: 2px 0 0; font-size: 1.05rem; }
.fs-close { background: none; border: 0; color: inherit; font-size: 1.3rem; line-height: 1; cursor: pointer; padding: 0 4px; }
.fs-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.fs-recipe { width: 100%; display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.12); background: rgba(255, 255, 255, 0.04); color: inherit; cursor: pointer; }
.fs-recipe--on { border-color: #ffd27a; }
.fs-recipe--blocked { opacity: 0.6; }
.fs-recipe-name { flex: 1; text-align: left; }
.fs-tag { font-size: 0.72rem; padding: 1px 6px; border-radius: 999px; }
.fs-tag--ok { background: rgba(122, 214, 122, 0.18); }
.fs-tag--miss { background: rgba(240, 160, 90, 0.18); }
.fs-tag--lock { background: rgba(255, 255, 255, 0.1); }
.fs-ing { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; }
.fs-ing li { display: flex; align-items: center; gap: 8px; font-size: 0.85rem; }
.fs-ing-name { flex: 1; }
.fs-ing--short { color: #f0a05a; }
.fs-out { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 0.88rem; }
.fs-secs { margin-left: auto; opacity: 0.7; }
.fs-qty { display: flex; align-items: center; gap: 6px; }
.fs-step { width: 28px; height: 28px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.16);
  background: rgba(255, 255, 255, 0.05); color: inherit; cursor: pointer; }
.fs-qty-value { min-width: 2ch; text-align: center; }
.fs-row { display: flex; gap: 8px; }
.fs-act { flex: 1; }
.fs-ghost { border: 1px solid rgba(255, 255, 255, 0.16); background: none; color: inherit; border-radius: 8px; padding: 0 12px; cursor: pointer; }
.fs-progress { height: 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
.fs-progress span { display: block; height: 100%; background: linear-gradient(90deg, #c23a10, #ffc247); }
.fs-busy { margin: 0; font-size: 0.88rem; }
.fs-note { margin: 0; font-size: 0.78rem; opacity: 0.72; }
.fs-block { margin: 0; font-size: 0.8rem; color: #f0a05a; }
</style>
