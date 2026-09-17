<script setup lang="ts">
// DEV TOOLS (D1.1 §32).
//
// Everything technical from D1 still exists, but collapsed and out of the way:
// it must never compete with the game for attention. Closed by default.
//
// It only *asks*: every change to the run is emitted and applied by the owner,
// so the session has a single writer.

import { ref } from 'vue'
import { speciesById } from '../data/speciesFixtures'
import { isFainted } from '../domain/party'
import type { PlaySession } from '../domain/playSession'

export type DevCommand =
  | { readonly kind: 'addMinutes'; readonly minutes: number }
  // D1.2.3 §1: the lab can jump straight into any scenario, not only start a run.
  | { readonly kind: 'fightNearest' }
  | { readonly kind: 'weakenFoe'; readonly fraction: number }
  | { readonly kind: 'toBoss' }
  | { readonly kind: 'giveBalls'; readonly count: number }| { readonly kind: 'forceKey' }
  | { readonly kind: 'toStairs' }
  | { readonly kind: 'skipToLast' }
  | { readonly kind: 'repopulate' }
  | { readonly kind: 'clearFloor' }
  | { readonly kind: 'setHp'; readonly fraction: number }
  | { readonly kind: 'emptyPp' }
  | { readonly kind: 'addMinutes'; readonly minutes: number }

// `rev` is a redraw token: the session is mutated in place, so this is what
// tells Vue the readout below is worth rendering again.
defineProps<{ session: PlaySession; clockSpeed: number; players: number; rev: number; legacyRenderer: boolean }>()

const emit = defineEmits<{
  (event: 'update:clockSpeed', value: number): void
  (event: 'update:players', value: number): void
  (event: 'update:legacyRenderer', value: boolean): void
  (event: 'command', command: DevCommand): void
  (event: 'wipe'): void
  (event: 'restart'): void
}>()

const open = ref(false)
const run = (command: DevCommand): void => emit('command', command)
</script>

<template>
  <section class="dt" :class="{ 'dt--open': open }">
    <button type="button" class="dt-toggle" @click="open = !open">
      {{ open ? '▾' : '▸' }} DEV TOOLS
      <em>seed {{ session.expedition.seed }} · piso {{ session.expedition.floor }} · {{ session.phase }}</em>
    </button>

    <div v-if="open" class="dt-body">
      <div class="dt-group">
        <span>Reloj</span>
        <input
          :value="clockSpeed" type="range" min="1" max="600" step="1"
          @input="emit('update:clockSpeed', Number(($event.target as HTMLInputElement).value))"
        >
        <em>×{{ clockSpeed }}</em>
        <button type="button" @click="run({ kind: 'addMinutes', minutes: 30 })">Consumir 30 min</button>
      </div>

      <div class="dt-group">
        <span>Jugadores</span>
        <input
          :value="players" type="number" min="1" max="4"
          @input="emit('update:players', Number(($event.target as HTMLInputElement).value))"
        >
        <em>1 → dos Pokémon activos contra el Alpha</em>
      </div>

      <div class="dt-group">
        <span>Motor</span>
        <button type="button" @click="emit('update:legacyRenderer', !legacyRenderer)">
          {{ legacyRenderer ? 'Volver al render WildLands' : 'Comparar con el render D1.1' }}
        </button>
        <em>{{ legacyRenderer ? 'prototipo D1.1' : 'WildLands nativo' }}</em>
      </div>

      <div class="dt-group">
        <span>Piso</span>
        <button type="button" @click="run({ kind: 'forceKey' })">Forzar llave</button>
        <button type="button" @click="run({ kind: 'toStairs' })">Ir a la escalera</button>
        <button type="button" @click="run({ kind: 'skipToLast' })">Ir al último piso</button>
        <button type="button" @click="run({ kind: 'repopulate' })">Repoblar</button>
        <button type="button" @click="run({ kind: 'clearFloor' })">Vaciar encuentros</button>
      </div>

      <div class="dt-group">
        <span>Escenario</span>
        <button type="button" @click="run({ kind: 'fightNearest' })">Combate ya</button>
        <button type="button" @click="run({ kind: 'weakenFoe', fraction: 0.12 })">Rival al 12 %</button>
        <button type="button" @click="run({ kind: 'giveBalls', count: 10 })">+10 Balls</button>
        <button type="button" @click="run({ kind: 'toBoss' })">Boss ya</button>
      </div>

      <div class="dt-group">
        <span>Party</span>
        <button type="button" @click="run({ kind: 'setHp', fraction: 1 })">HP full</button>
        <button type="button" @click="run({ kind: 'setHp', fraction: 0.15 })">HP 15 %</button>
        <button type="button" @click="run({ kind: 'emptyPp' })">PP 0</button>
        <button type="button" @click="emit('wipe')">Forzar wipe</button>
        <button type="button" @click="emit('restart')">Reiniciar</button>
      </div>

      <ul class="dt-party">
        <li v-for="member in session.expedition.party" :key="member.instanceId">
          {{ speciesById(member.speciesId)?.name }} · {{ Math.max(0, member.hp) }}/{{ member.maxHp }}
          <template v-if="member.status !== 'none'"> · {{ member.status }}</template>
          <template v-if="isFainted(member)"> · KO</template>
        </li>
      </ul>

      <ul class="dt-log">
        <li v-for="(line, i) in session.log" :key="i">{{ line }}</li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.dt { border: 1px dashed #3a4767; border-radius: 10px; background: #0d1426; }
.dt-toggle {
  display: flex; gap: 8px; align-items: center; width: 100%; padding: 8px 10px;
  border: none; background: transparent; color: #6b7ba8;
  font: inherit; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.08em; text-align: left; cursor: pointer;
}
.dt-toggle em { font-weight: 400; font-style: normal; letter-spacing: 0; }
.dt-body { display: grid; gap: 8px; padding: 0 10px 10px; }
.dt-group { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 0.72rem; color: #93a2c6; }
.dt-group > span { min-width: 68px; font-weight: 700; }
.dt-group em { font-style: normal; }
.dt-group button {
  padding: 6px 10px; border: 1px solid #2b3a5e; border-radius: 8px;
  background: #16203a; color: #e8eeff; font: inherit; font-size: 0.72rem; cursor: pointer;
}
.dt-group input[type="number"] {
  width: 60px; padding: 4px 6px; border: 1px solid #2b3a5e; border-radius: 6px;
  background: #0f1730; color: #e8eeff; font: inherit;
}
.dt-party, .dt-log {
  max-height: 120px; overflow: auto; margin: 0; padding-left: 16px;
  font-size: 0.7rem; color: #6b7ba8;
}
</style>
