<script setup lang="ts">
// Expedition Lab: the loop that produces the tension — wear, keys, loot you do
// not own yet, and the choice between walking out and pushing on.
//
// Encounters resolve as a summary here rather than as a full realtime fight:
// the realtime fight has its own lab, and what this one is for is the run.

import { computed, ref } from 'vue'
import { buildParty, buildWild, FLOOR_LOOT, INVENTORY_SLOTS, STARTING_INVENTORY } from '../data/runFixtures'
import { poolFor, speciesById } from '../data/speciesFixtures'
import {
  addExpeditionCapture, addExpeditionLoot, advanceFloor, consumeItem, grantKey,
  retreat, shouldWipe, startExpedition, wipe, type ExpeditionResult, type ExpeditionState,
} from '../domain/expedition'
import { generateFloor } from '../domain/floorPlan'
import { keyChance, rollFloorKey } from '../domain/floorKey'
import { damage, heal, isFainted } from '../domain/party'
import { streamFor } from '../domain/rng'
import { dungeonProfile, DUNGEON_TIERS, type DungeonTier } from '../domain/tiers'

const seed = ref(4242)
const tier = ref<DungeonTier>('C')
const state = ref<ExpeditionState | null>(null)
const result = ref<ExpeditionResult | null>(null)
const defeats = ref(0)
const log = ref<string[]>([])

const profile = computed(() => dungeonProfile(seed.value, tier.value, 'cave'))
const plan = computed(() => (state.value ? generateFloor(profile.value, state.value.floor, poolFor('cave')) : null))
const remaining = computed(() => (plan.value ? plan.value.encounters.length - defeats.value : 0))
const party = computed(() => state.value?.party ?? [])
const nextKeyChance = computed(() => (state.value ? keyChance(state.value.key) : 0))

const say = (text: string) => { log.value = [text, ...log.value].slice(0, 14) }

function begin(): void {
  result.value = null
  defeats.value = 0
  log.value = []
  state.value = startExpedition({
    expeditionId: `exp-${seed.value}`,
    seed: seed.value,
    floors: profile.value.floors,
    party: buildParty(),
    carriedInventory: STARTING_INVENTORY,
  })
  say(`Entrás a ${profile.value.name} (${profile.value.floors} pisos).`)
}

/** One encounter, resolved as a summary: wear on the party, a key roll, a drop. */
function fight(): void {
  const current = state.value
  if (!current || !plan.value || remaining.value <= 0) return
  const rng = streamFor(current.seed, 'run', current.floor, defeats.value)
  const encounter = plan.value.encounters[defeats.value]

  // The party pays for the win: the deeper the floor, the more it costs.
  const lead = current.party.find(member => !isFainted(member))
  if (lead) {
    const hit = Math.round(lead.maxHp * (0.1 + plan.value.difficulty.depth * 0.25) * (0.6 + rng.next() * 0.8))
    damage(lead, hit)
    say(`${speciesById(lead.speciesId)?.name} venció a ${speciesById(encounter.speciesId)?.name} y perdió ${hit} HP.`)
  }

  const roll = rollFloorKey(current.key, rng.next())
  let next = grantKey(current, roll.state)
  if (roll.dropped) say(roll.guaranteed ? 'Llave de piso (garantizada tras varias derrotas).' : 'Llave de piso.')

  if (rng.chance(0.5)) {
    const entry = FLOOR_LOOT.entries[Math.min(FLOOR_LOOT.entries.length - 1, Math.floor(rng.next() * 4))]
    next = addExpeditionLoot(next, [{ itemId: entry.itemId, quantity: entry.quantity }])
    say(`Botín: ${entry.name} ×${entry.quantity} (todavía no es tuyo).`)
  }

  defeats.value += 1
  state.value = next
  if (shouldWipe(next)) endRun('wipe')
}

function tryCapture(): void {
  const current = state.value
  if (!current || !plan.value) return
  const encounter = plan.value.encounters[Math.min(defeats.value, plan.value.encounters.length - 1)]
  if (!encounter) return
  const wild = buildWild(encounter.speciesId, encounter.level)
  state.value = addExpeditionCapture(current, {
    instanceId: wild.instanceId, speciesId: encounter.speciesId, level: encounter.level, floor: current.floor,
  })
  say(`Capturaste ${speciesById(encounter.speciesId)?.name} Nv. ${encounter.level}. Es botín de expedición.`)
}

function usePotion(): void {
  const current = state.value
  if (!current) return
  const spent = consumeItem(current, 'potion')
  if (!spent.used) { say('No quedan Pociones.'); return }
  const hurt = spent.state.party.find(member => !isFainted(member) && member.hp < member.maxHp)
  const healed = hurt ? heal(hurt, 40) : 0
  state.value = spent.state
  say(healed ? `Poción: +${healed} HP.` : 'Poción usada sin efecto.')
}

function nextFloor(): void {
  const current = state.value
  if (!current) return
  const moved = advanceFloor(current)
  if (!moved.advanced) { say(moved.reason === 'no-key' ? 'Necesitás una llave.' : 'No hay más pisos.'); return }
  state.value = moved.state
  defeats.value = 0
  say(`Piso ${moved.state.floor}. HP y PP siguen como estaban: no hay curación gratis.`)
}

function endRun(kind: 'retreat' | 'wipe'): void {
  const current = state.value
  if (!current) return
  const outcome = kind === 'retreat' ? retreat(current) : wipe(current)
  result.value = outcome
  state.value = outcome.state
  say(kind === 'retreat' ? 'Te retirás: el botín es tuyo.' : 'Wipe: perdés todo lo conseguido dentro.')
}

const freeSlots = computed(() => INVENTORY_SLOTS - Object.keys(state.value?.carriedInventory ?? {}).length)
</script>

<template>
  <div class="dp-grid">
    <section class="dp-card">
      <h2>Expedición</h2>
      <div class="dp-row">
        <label class="dp-field">Seed
          <input v-model.number="seed" type="number" style="width: 90px">
        </label>
        <label class="dp-field">Tier
          <select v-model="tier">
            <option v-for="id in DUNGEON_TIERS" :key="id" :value="id">{{ id }}</option>
          </select>
        </label>
        <button type="button" class="dp-btn dp-btn--go" @click="begin">Entrar</button>
      </div>

      <template v-if="state">
        <p>
          Piso <strong>{{ state.floor }}</strong> / {{ state.floors }} ·
          <span class="dp-tag">{{ state.status }}</span>
          <span v-if="state.key.hasKey" class="dp-tag">🔑 llave</span>
        </p>
        <p class="dp-note">
          Encuentros restantes en el piso: {{ remaining }} ·
          probabilidad de llave en la próxima derrota: {{ Math.round(nextKeyChance * 100) }} %
        </p>
        <div class="dp-row">
          <button type="button" class="dp-btn" :disabled="state.status !== 'active' || remaining <= 0" @click="fight">Pelear</button>
          <button type="button" class="dp-btn" :disabled="state.status !== 'active'" @click="tryCapture">Capturar</button>
          <button type="button" class="dp-btn" :disabled="state.status !== 'active'" @click="usePotion">Poción</button>
          <button type="button" class="dp-btn" :disabled="state.status !== 'active' || !state.key.hasKey" @click="nextFloor">Piso siguiente</button>
          <button type="button" class="dp-btn" :disabled="state.status !== 'active'" @click="endRun('retreat')">Retirarse</button>
          <button type="button" class="dp-btn" :disabled="state.status !== 'active'" @click="endRun('wipe')">Forzar wipe</button>
        </div>
      </template>
      <p v-else class="dp-note">Elegí seed y tier, y entrá.</p>
    </section>

    <section v-if="state" class="dp-card">
      <h2>Party (desgaste)</h2>
      <ul class="el-party">
        <li v-for="member in party" :key="member.instanceId">
          <span>{{ speciesById(member.speciesId)?.name }} Nv. {{ member.level }}</span>
          <span class="el-meter"><i :style="{ width: `${Math.max(0, member.hp / member.maxHp) * 100}%` }" /></span>
          <span>{{ Math.max(0, member.hp) }}/{{ member.maxHp }}</span>
        </li>
      </ul>
      <p class="dp-note">Sin curación gratis entre pisos: lo que gastás, gastado queda.</p>
    </section>

    <section v-if="state" class="dp-card">
      <h2>Botín</h2>
      <h3>Botín de expedición (en riesgo)</h3>
      <p v-if="!Object.keys(state.expeditionLoot).length && !state.expeditionCaptures.length" class="dp-note">Nada todavía.</p>
      <ul v-else class="dp-log">
        <li v-for="(count, itemId) in state.expeditionLoot" :key="itemId">{{ itemId }} ×{{ count }}</li>
        <li v-for="capture in state.expeditionCaptures" :key="capture.instanceId">
          {{ speciesById(Number(capture.speciesId))?.name }} Nv. {{ capture.level }} (piso {{ capture.floor }})
        </li>
      </ul>
      <h3>Inventario previo (a salvo)</h3>
      <ul class="dp-log">
        <li v-for="(count, itemId) in state.carriedInventory" :key="itemId">{{ itemId }} ×{{ count }}</li>
      </ul>
      <p class="dp-note">Espacios libres: {{ freeSlots }}</p>

      <template v-if="result">
        <h3>Resultado</h3>
        <p><span class="dp-tag">{{ result.outcome }}</span></p>
        <p class="dp-note">
          Conservado: {{ Object.keys(result.extractedLoot).length }} items,
          {{ result.extractedCaptures.length }} capturas ·
          perdido: {{ Object.keys(result.lostLoot).length }} items,
          {{ result.lostCaptures.length }} capturas ·
          próxima entrada: piso {{ result.nextEntryFloor }}.
        </p>
      </template>
    </section>

    <section v-if="log.length" class="dp-card">
      <h2>Bitácora</h2>
      <ul class="dp-log">
        <li v-for="(line, i) in log" :key="i">{{ line }}</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.el-party { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; font-size: 0.8rem; }
.el-party li { display: grid; grid-template-columns: 1fr 2fr auto; gap: 8px; align-items: center; }
.el-meter { position: relative; height: 8px; border-radius: 999px; background: #0f1730; overflow: hidden; }
.el-meter i { position: absolute; inset: 0 auto 0 0; display: block; background: #7ee2a8; border-radius: 999px; }
</style>
