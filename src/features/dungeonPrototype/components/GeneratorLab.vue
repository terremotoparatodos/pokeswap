<script setup lang="ts">
// Dungeon Generator Lab: seed, tier, theme, floor count, and what each floor
// actually contains. Everything here is derived — nothing is stored.

import { computed, ref } from 'vue'
import { poolFor, speciesById } from '../data/speciesFixtures'
import { generateFloor, type FloorRoom } from '../domain/floorPlan'
import { dungeonProfile, DUNGEON_THEMES, DUNGEON_TIERS, type DungeonTheme, type DungeonTier } from '../domain/tiers'

const seed = ref(4242)
const tier = ref<DungeonTier>('B')
const theme = ref<DungeonTheme>('cave')
const floor = ref(1)

const profile = computed(() => dungeonProfile(seed.value, tier.value, theme.value))
const pool = computed(() => poolFor(theme.value))
const current = computed(() => generateFloor(profile.value, Math.min(floor.value, profile.value.floors), pool.value))
const allFloors = computed(() => Array.from({ length: profile.value.floors }, (_, i) =>
  generateFloor(profile.value, i + 1, pool.value)))

const CELL = 54
const roomBox = (room: FloorRoom) => ({
  x: room.gx * CELL + 6, y: room.gy * CELL + 6, w: room.w * 14, h: room.h * 12,
})
const centreOf = (room: FloorRoom) => {
  const box = roomBox(room)
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 }
}
const roomById = (id: number) => current.value.rooms.find(room => room.id === id)!

const ROOM_FILL: Record<string, string> = {
  entrance: '#3c5a8a', normal: '#243352', encounter: '#5a2f3c', treasure: '#5a4a24',
  special: '#43325c', exit: '#2f5a44', boss: '#7a2230',
}

const reroll = () => { seed.value = Math.floor(Math.random() * 100000) }
const encountersIn = (roomId: number) => current.value.encounters.filter(encounter => encounter.roomId === roomId)
</script>

<template>
  <div class="dp-grid">
    <section class="dp-card">
      <h2>Dungeon</h2>
      <div class="dp-row">
        <label class="dp-field">Seed
          <input v-model.number="seed" type="number" min="0" style="width: 110px">
        </label>
        <label class="dp-field">Tier
          <select v-model="tier">
            <option v-for="id in DUNGEON_TIERS" :key="id" :value="id">{{ id }}</option>
          </select>
        </label>
        <label class="dp-field">Temática
          <select v-model="theme">
            <option v-for="id in DUNGEON_THEMES" :key="id" :value="id">{{ id }}</option>
          </select>
        </label>
        <button type="button" class="dp-btn" @click="reroll">Regenerar</button>
      </div>

      <h3>Antes de entrar</h3>
      <p><strong>{{ profile.name }}</strong> · Tier {{ profile.tier }} · {{ profile.floors }} pisos</p>
      <p class="dp-note">Pool: {{ pool.map(id => speciesById(id)?.name).join(', ') }}</p>

      <h3>Piso {{ current.floor }} / {{ profile.floors }}</h3>
      <div class="dp-row">
        <button type="button" class="dp-btn" :disabled="floor <= 1" @click="floor -= 1">◀ Anterior</button>
        <input v-model.number="floor" type="range" min="1" :max="profile.floors" style="flex: 1">
        <button type="button" class="dp-btn" :disabled="floor >= profile.floors" @click="floor += 1">Siguiente ▶</button>
      </div>
      <p class="dp-note">
        Presupuesto {{ current.difficulty.budget }} · nivel {{ current.difficulty.level }} ·
        profundidad {{ Math.round(current.difficulty.depth * 100) }} %
        <span v-if="current.difficulty.isBossFloor" class="dp-tag">ALPHA</span>
        <span v-else-if="current.exitLocked" class="dp-tag">salida con llave</span>
      </p>
    </section>

    <section class="dp-card">
      <h2>Plano</h2>
      <svg :viewBox="`0 0 ${current.width * CELL + 12} ${current.height * CELL + 12}`" width="100%" role="img" aria-label="Plano del piso">
        <line
          v-for="(link, i) in current.links" :key="`l${i}`"
          :x1="centreOf(roomById(link.from)).x" :y1="centreOf(roomById(link.from)).y"
          :x2="centreOf(roomById(link.to)).x" :y2="centreOf(roomById(link.to)).y"
          stroke="#3d4e78" stroke-width="3"
        />
        <g v-for="room in current.rooms" :key="room.id">
          <rect
            :x="roomBox(room).x" :y="roomBox(room).y" :width="roomBox(room).w" :height="roomBox(room).h"
            rx="4" :fill="ROOM_FILL[room.kind] ?? ROOM_FILL.normal" stroke="#63779f"
          />
          <text :x="centreOf(room).x" :y="centreOf(room).y + 4" text-anchor="middle" font-size="10" fill="#e8eeff">
            {{ room.kind === 'boss' ? '★' : room.kind === 'exit' ? '⇥' : room.kind === 'entrance' ? '⇤'
              : room.kind === 'treasure' ? '◈' : encountersIn(room.id).length || '' }}
          </text>
        </g>
      </svg>
      <p class="dp-note">⇤ entrada · ⇥ salida · ◈ cofre · ★ Alpha · número = encuentros</p>
    </section>

    <section class="dp-card">
      <h2>Contenido del piso</h2>
      <h3>Encuentros ({{ current.encounters.length }})</h3>
      <ul class="dp-log">
        <li v-for="encounter in current.encounters" :key="encounter.id">
          {{ speciesById(encounter.speciesId)?.name ?? encounter.speciesId }} Nv. {{ encounter.level }}
          · sala {{ encounter.roomId }} · peso {{ encounter.weight }}
          <span v-if="encounter.isAlpha" class="dp-tag">ALPHA</span>
        </li>
      </ul>
      <h3>Cofres ({{ current.chests.length }})</h3>
      <ul class="dp-log">
        <li v-for="chest in current.chests" :key="chest.id">{{ chest.rarity }} · sala {{ chest.roomId }}</li>
      </ul>
    </section>

    <section class="dp-card">
      <h2>Curva de dificultad</h2>
      <svg viewBox="0 0 320 120" width="100%" role="img" aria-label="Presupuesto por piso">
        <polyline
          :points="allFloors.map((f, i) => `${10 + (i * 300) / Math.max(1, allFloors.length - 1)},${
            110 - (f.difficulty.budget / Math.max(...allFloors.map(x => x.difficulty.budget))) * 100}`).join(' ')"
          fill="none" stroke="#ffd27a" stroke-width="2"
        />
        <line x1="10" y1="110" x2="310" y2="110" stroke="#3d4e78" />
      </svg>
      <p class="dp-note">
        Sube con la profundidad con una pequeña oscilación por piso: es una tendencia, no una escalera.
        Piso 1 = {{ allFloors[0].difficulty.budget }} · último = {{ allFloors[allFloors.length - 1].difficulty.budget }}.
      </p>
    </section>
  </div>
</template>
