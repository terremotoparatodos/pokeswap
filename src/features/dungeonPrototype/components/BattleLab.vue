<script setup lang="ts">
// Realtime Battle Lab: 1 v 1, four moves, Action Bars, PP, items and switching.
//
// The bag is a panel, not a pause. Opening it changes nothing about the clock,
// which is the whole point of the interaction we want to judge.

import { computed, ref } from 'vue'
import BattleField from './BattleField.vue'
import { useRealtimeBattle } from './useRealtimeBattle'
import { BATTLE_ITEMS, buildParty, buildWild, combatantFor, STARTING_INVENTORY } from '../data/runFixtures'
import { speciesById } from '../data/speciesFixtures'
import { actorById, createBattle, livingActors, prepare } from '../domain/battle'
import { fillSeconds } from '../domain/damage'
import { moveById } from '../domain/moves'
import { isFainted } from '../domain/party'
import { createRng } from '../domain/rng'

const { battle, seconds, start, stop } = useRealtimeBattle()

const seed = ref(7)
const enemyId = ref(74)
const enemyLevel = ref(25)
const bagOpen = ref(false)
const bag = ref<Record<string, number>>({ ...STARTING_INVENTORY })

const POOL = [74, 95, 41, 66, 25, 135, 79, 246]

function begin(): void {
  const party = buildParty()
  bag.value = { ...STARTING_INVENTORY }
  start(createBattle({
    allies: [combatantFor(party[0])],
    enemies: [combatantFor(buildWild(enemyId.value, enemyLevel.value))],
    bench: party.slice(1),
    items: BATTLE_ITEMS,
    rng: createRng(seed.value),
  }))
}

const ally = computed(() => (battle.value ? actorById(battle.value, 'ally-0') ?? null : null))
const allies = computed(() => (battle.value ? battle.value.actors.filter(actor => actor.side === 'ally') : []))
const enemies = computed(() => (battle.value ? battle.value.actors.filter(actor => actor.side === 'enemy') : []))
const moves = computed(() => (ally.value ? ally.value.combatant.pokemon.moves.map(id => moveById(id)!) : []))
const prepared = computed(() => ally.value?.prepared)
const bench = computed(() => battle.value?.bench ?? [])
const log = computed(() => [...(battle.value?.log ?? [])].reverse().slice(0, 12))

const ppOf = (moveId: string) => ally.value?.combatant.pokemon.pp[moveId] ?? 0
const isPrepared = (moveId: string) => prepared.value?.kind === 'move' && prepared.value.moveId === moveId

function chooseMove(moveId: string): void {
  if (battle.value) prepare(battle.value, 'ally-0', { kind: 'move', moveId })
}

function useItem(itemId: string, targetId?: string): void {
  if (!battle.value || (bag.value[itemId] ?? 0) <= 0) return
  if (prepare(battle.value, 'ally-0', { kind: 'item', itemId, targetId })) {
    // Spent when prepared: the window is committed even if the fight ends first.
    bag.value[itemId] -= 1
  }
}

function switchTo(instanceId: string): void {
  if (battle.value) prepare(battle.value, 'ally-0', { kind: 'switch', instanceId })
}

const speedNote = computed(() => {
  const mine = ally.value ? fillSeconds(ally.value.combatant.species.baseStats[5]) : 0
  return `Barra base: ${mine.toFixed(2)} s`
})
</script>

<template>
  <div class="dp-grid">
    <section class="dp-card">
      <h2>Encuentro</h2>
      <div class="dp-row">
        <label class="dp-field">Seed
          <input v-model.number="seed" type="number" style="width: 90px">
        </label>
        <label class="dp-field">Rival
          <select v-model.number="enemyId">
            <option v-for="id in POOL" :key="id" :value="id">{{ speciesById(id)?.name }}</option>
          </select>
        </label>
        <label class="dp-field">Nivel
          <input v-model.number="enemyLevel" type="number" min="1" max="80" style="width: 70px">
        </label>
        <button type="button" class="dp-btn dp-btn--go" @click="begin">Empezar</button>
        <button type="button" class="dp-btn" :disabled="!battle" @click="stop">Detener</button>
      </div>
      <p class="dp-note">{{ speedNote }} · el combate ocurre en el mundo, sin pantalla aparte.</p>

      <template v-if="battle">
        <BattleField :allies="allies" :enemies="enemies" :seconds="seconds" />
        <p v-if="battle.outcome !== 'ongoing'" class="dp-note">
          <span class="dp-tag">{{ battle.outcome }}</span>
          {{ battle.outcome === 'captured' ? 'El Pokémon pasa a ser botín de expedición.' : '' }}
        </p>
      </template>
      <p v-else class="dp-note">Elegí un rival y empezá.</p>
    </section>

    <section v-if="battle && ally" class="dp-card">
      <h2>Acción preparada</h2>
      <p class="dp-note">
        Podés cambiarla mientras la barra carga. Se ejecuta lo que esté elegido cuando se llena.
      </p>
      <div class="bl-moves">
        <button
          v-for="move in moves"
          :key="move.id"
          type="button"
          class="dp-btn bl-move"
          :class="{ 'bl-move--on': isPrepared(move.id) }"
          :disabled="ppOf(move.id) <= 0 || battle.outcome !== 'ongoing'"
          @click="chooseMove(move.id)"
        >
          <strong>{{ move.name }}</strong>
          <em>{{ move.type }} · {{ move.category }} · PP {{ ppOf(move.id) }}/{{ move.pp }}</em>
          <em v-if="move.priority > 0">prioridad {{ move.priority }}</em>
        </button>
      </div>

      <div class="dp-row" style="margin-top: 10px">
        <button type="button" class="dp-btn" @click="bagOpen = !bagOpen">
          {{ bagOpen ? 'Cerrar mochila' : 'Abrir mochila' }}
        </button>
        <span class="dp-note">Abrir la mochila NO pausa nada.</span>
      </div>

      <div v-if="bagOpen" class="bl-bag">
        <button
          v-for="(count, itemId) in bag"
          :key="itemId"
          type="button"
          class="dp-btn"
          :disabled="count <= 0 || battle.outcome !== 'ongoing'"
          @click="useItem(itemId)"
        >{{ BATTLE_ITEMS[itemId]?.name ?? itemId }} ×{{ count }}</button>
      </div>

      <h3>Cambiar Pokémon ({{ bench.length }} en banca)</h3>
      <div class="bl-bag">
        <button
          v-for="member in bench"
          :key="member.instanceId"
          type="button"
          class="dp-btn"
          :disabled="isFainted(member) || battle.outcome !== 'ongoing'"
          @click="switchTo(member.instanceId)"
        >
          {{ speciesById(member.speciesId)?.name }} · {{ member.hp }}/{{ member.maxHp }}
        </button>
      </div>
      <p class="dp-note">Cambiar también consume una ventana de acción (PROTOTYPE ASSUMPTION).</p>
    </section>

    <section v-if="battle" class="dp-card">
      <h2>Registro</h2>
      <ul class="dp-log">
        <li v-for="(event, i) in log" :key="i">{{ event.at }}s · {{ event.actorId }} · {{ event.text }}</li>
      </ul>
      <p class="dp-note">
        Rivales vivos: {{ livingActors(battle, 'enemy').length }} · reloj {{ seconds.toFixed(1) }} s
      </p>
    </section>
  </div>
</template>

<style scoped>
.bl-moves { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
.bl-move { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; text-align: left; }
.bl-move em { font-size: 0.7rem; font-style: normal; color: #93a2c6; }
.bl-move--on { border-color: #ffd27a; box-shadow: inset 0 0 0 1px #ffd27a; }
.bl-bag { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
</style>
