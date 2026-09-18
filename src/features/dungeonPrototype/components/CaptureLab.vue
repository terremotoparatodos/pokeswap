<script setup lang="ts">
// Capture Lab: what the chance actually is, and what a throw feels like.
//
// The formula is a PROTOTYPE ASSUMPTION; the basic ball is meant to disappoint,
// so the interesting reading here is how much weakening and status are worth.

import { computed, ref } from 'vue'
import { speciesById } from '../data/speciesFixtures'
import { attemptCapture, BASIC_BALL, captureChance, STATUS_BONUS } from '../domain/capture'
import { buildWild } from '../data/runFixtures'
import type { StatusCondition } from '../domain/party'
import { createRng } from '../domain/rng'

const POOL = [74, 95, 41, 66, 25, 135, 79, 246]
const STATUSES: readonly StatusCondition[] = ['none', 'burn', 'poison', 'paralysis', 'sleep']

const speciesId = ref(246)
const level = ref(24)
const hpPercent = ref(100)
const status = ref<StatusCondition>('none')
const seed = ref(11)

const target = computed(() => {
  const wild = buildWild(speciesId.value, level.value)
  wild.hp = Math.max(1, Math.round((wild.maxHp * hpPercent.value) / 100))
  wild.status = status.value
  return wild
})
const species = computed(() => speciesById(speciesId.value)!)
const chance = computed(() => captureChance({ target: target.value, catchRate: species.value.catchRate }))

const throws = ref<{ captured: boolean; chance: number }[]>([])
const rng = ref(createRng(seed.value))

function reset(): void {
  rng.value = createRng(seed.value)
  throws.value = []
}

function throwBall(): void {
  const attempt = attemptCapture(
    { target: target.value, catchRate: species.value.catchRate, ball: BASIC_BALL },
    rng.value.next(),
  )
  throws.value = [{ captured: attempt.captured, chance: attempt.chance }, ...throws.value].slice(0, 20)
}

const caught = computed(() => throws.value.filter(entry => entry.captured).length)
</script>

<template>
  <div class="dp-grid">
    <section class="dp-card">
      <h2>Objetivo</h2>
      <div class="dp-row">
        <label class="dp-field">Especie
          <select v-model.number="speciesId">
            <option v-for="id in POOL" :key="id" :value="id">{{ speciesById(id)?.name }}</option>
          </select>
        </label>
        <label class="dp-field">Nivel
          <input v-model.number="level" type="number" min="1" max="80" style="width: 70px">
        </label>
        <label class="dp-field">Estado
          <select v-model="status">
            <option v-for="id in STATUSES" :key="id" :value="id">{{ id }}</option>
          </select>
        </label>
      </div>
      <label class="dp-field" style="margin-top: 8px">HP restante: {{ hpPercent }} %
        <input v-model.number="hpPercent" type="range" min="1" max="100">
      </label>
      <p class="dp-note">
        Catch rate {{ species.catchRate }} · bonus de estado ×{{ STATUS_BONUS[status] }} ·
        Poké Ball básica ×{{ BASIC_BALL.bonus }}
      </p>
    </section>

    <section class="dp-card">
      <h2>Probabilidad</h2>
      <p class="cl-big">{{ (chance * 100).toFixed(1) }} %</p>
      <span class="dp-meter"><i :style="{ width: `${chance * 100}%` }" /></span>
      <p class="dp-note">
        Con una Ball básica y el rival intacto la captura tiene que decepcionar: la Dungeon es
        atractiva por lo que aparece, no por lo fácil que es quedárselo. Mejores Balls llegarán
        por crafting (fuera de alcance).
      </p>
      <div class="dp-row" style="margin-top: 10px">
        <label class="dp-field">Seed
          <input v-model.number="seed" type="number" style="width: 90px" @change="reset">
        </label>
        <button type="button" class="dp-btn dp-btn--go" @click="throwBall">Lanzar Poké Ball</button>
        <button type="button" class="dp-btn" @click="reset">Reiniciar</button>
      </div>
    </section>

    <section class="dp-card">
      <h2>Tiradas</h2>
      <p class="dp-note">{{ caught }} capturas en {{ throws.length }} intentos (RNG con seed: reproducible).</p>
      <ul class="dp-log">
        <li v-for="(entry, i) in throws" :key="i">
          {{ entry.captured ? '✔ capturado' : '✘ se escapó' }} · {{ (entry.chance * 100).toFixed(1) }} %
        </li>
      </ul>
      <p class="dp-note">
        Una captura hecha dentro de la Dungeon es <strong>botín de expedición</strong>: se asegura al
        retirarse y se pierde en un wipe. Ese flujo se prueba en la pestaña Expedición.
      </p>
    </section>
  </div>
</template>

<style scoped>
.cl-big { margin: 0 0 6px; font-size: 2rem; font-weight: 800; color: #ffd27a; }
.dp-meter { position: relative; display: block; height: 10px; border-radius: 999px; background: #0f1730; overflow: hidden; }
.dp-meter i { position: absolute; inset: 0 auto 0 0; display: block; background: #ffd27a; border-radius: 999px; }
</style>
