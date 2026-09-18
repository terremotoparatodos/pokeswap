<script setup lang="ts">
// Alpha Boss Lab: scale and aura, two active Pokémon solo, up to four players
// simulated locally, the scaling numbers, personal loot and the full-inventory
// decision. No networking: the extra players are slots, not connections.

import { computed, ref } from 'vue'
import BattleField from './BattleField.vue'
import { useRealtimeBattle } from './useRealtimeBattle'
import { BATTLE_ITEMS, BOSS_LOOT, buildParty, buildWild, combatantFor } from '../data/runFixtures'
import { poolFor, speciesById } from '../data/speciesFixtures'
import { activeAlliesFor, alphaCombatModifiers, alphaModifier, bossScaling, COOP, effectivePowerMultiple } from '../domain/alpha'
import { actorById, createBattle, prepare } from '../domain/battle'
import { createBossController } from '../domain/bossFight'
import { bossKitFor, type BossSkill } from '../domain/bossSkills'
import { moveById } from '../domain/moves'
import { hpFor } from '../domain/party'
import { deliverRewards, participation, personalLoot, resolvePending, type PendingReward } from '../domain/rewards'
import { createRng } from '../domain/rng'
import { DUNGEON_TIERS, type DungeonTier } from '../domain/tiers'

const { battle, seconds, start, stop } = useRealtimeBattle()

const tier = ref<DungeonTier>('B')
const players = ref(1)
const seed = ref(31)
const freeSlots = ref(1)
const kit = ref<BossSkill[]>([])
const pending = ref<readonly PendingReward[]>([])
const delivered = ref<{ playerId: string; item: string }[]>([])

const alpha = computed(() => alphaModifier(tier.value))
const scaling = computed(() => bossScaling(players.value))
const combat = computed(() => alphaCombatModifiers(tier.value, players.value, 1))
const power = computed(() => effectivePowerMultiple(alpha.value))

const allies = computed(() => (battle.value ? battle.value.actors.filter(actor => actor.side === 'ally') : []))
const enemies = computed(() => (battle.value ? battle.value.actors.filter(actor => actor.side === 'enemy') : []))
const log = computed(() => [...(battle.value?.log ?? [])].reverse().slice(0, 10))

function begin(): void {
  const party = buildParty()
  const active = activeAlliesFor(players.value)
  const pool = poolFor('cave')
  const speciesId = pool[seed.value % pool.length]
  const boss = buildWild(speciesId, 40, ['bodySlam', 'tackle', 'quickAttack', 'growl'])
  const species = speciesById(speciesId)!
  // The Alpha's bulk is applied to the instance; the rest rides as modifiers.
  const scaledHp = Math.round(hpFor(species.baseStats[0], boss.level) * combat.value.hpMultiplier)
  boss.hp = scaledHp
  Object.assign(boss, { maxHp: scaledHp })

  const state = createBattle({
    allies: party.slice(0, active).map(pokemon => ({ combatant: combatantFor(pokemon) })),
    enemies: [{ ...combatantFor(boss), modifiers: combat.value.modifiers }],
    bench: { p1: party.slice(active) },
    items: BATTLE_ITEMS,
    rng: createRng(seed.value),
  })
  const kitRng = createRng(seed.value + 1)
  kit.value = bossKitFor(tier.value, (min, max) => kitRng.int(min, max), items => kitRng.shuffle(items))
  const controller = createBossController('enemy-0', kit.value)
  start(state, (live, dt) => controller.update(live, dt))
}

function chooseMove(actorId: string, moveId: string): void {
  if (battle.value) prepare(battle.value, actorId, { kind: 'move', moveId })
}

const movesOf = (actorId: string) => {
  const actor = battle.value ? actorById(battle.value, actorId) : null
  return actor ? actor.combatant.pokemon.moves.map(id => moveById(id)!) : []
}

/** Simulated co-op: one row per player slot, with the damage they contributed. */
function rollLoot(): void {
  const contributions = Array.from({ length: players.value }, (_, i) => ({
    playerId: `jugador-${i + 1}`,
    damage: i === players.value - 1 && players.value > 1 ? 0 : 500 + i * 40,
    actions: i === players.value - 1 && players.value > 1 ? 0 : 12,
    activeSeconds: 60,
    presentAtKill: true,
  }))
  const eligible = participation(contributions)
  const rewards = personalLoot(seed.value, `exp-${seed.value}`, eligible, BOSS_LOOT)
  const slots = Object.fromEntries(contributions.map(player => [player.playerId, freeSlots.value]))
  const result = deliverRewards(rewards, slots)
  delivered.value = result.delivered.map(reward => ({ playerId: reward.playerId, item: reward.entry!.name }))
  pending.value = result.pending
}

function answer(id: string, decision: 'keep' | 'discardOther' | 'discardReward'): void {
  const resolved = resolvePending(pending.value, id, decision)
  pending.value = resolved.pending
  if (resolved.granted) delivered.value = [...delivered.value, { playerId: id.split(':')[0], item: resolved.granted.name }]
}
</script>

<template>
  <div class="dp-grid">
    <section class="dp-card">
      <h2>Alpha</h2>
      <div class="dp-row">
        <label class="dp-field">Tier
          <select v-model="tier">
            <option v-for="id in DUNGEON_TIERS" :key="id" :value="id">{{ id }}</option>
          </select>
        </label>
        <label class="dp-field">Jugadores
          <input v-model.number="players" type="number" min="1" :max="COOP.maxPlayers" style="width: 70px">
        </label>
        <label class="dp-field">Seed
          <input v-model.number="seed" type="number" style="width: 90px">
        </label>
        <button type="button" class="dp-btn dp-btn--go" @click="begin">Empezar</button>
        <button type="button" class="dp-btn" :disabled="!battle" @click="stop">Detener</button>
      </div>
      <p class="dp-note">
        Poder efectivo ≈ <strong>{{ power }}×</strong> (HP ×{{ alpha.hp }} · daño ×{{ alpha.damageDealt }} ·
        defensas ×{{ alpha.defense }} · velocidad ×{{ alpha.speed }} · resistencia a estados
        {{ Math.round(alpha.statusResistance * 100) }} %).
        La velocidad casi no se toca a propósito.
      </p>
      <p class="dp-note">
        Co-op: HP ×{{ scaling.hp }} · daño del boss ×{{ scaling.damageDealt }} ·
        aliados activos {{ scaling.activeAllies }} (1 jugador ⇒ 2 Pokémon; 2–4 ⇒ 1 cada uno).
      </p>

      <template v-if="battle">
        <BattleField
          :allies="allies" :enemies="enemies" :enemy-scale="alpha.size" aura
          :seconds="seconds" :telegraph="battle.telegraph"
        />
        <p v-if="battle.outcome !== 'ongoing'" class="dp-note"><span class="dp-tag">{{ battle.outcome }}</span></p>
      </template>

      <h3>Boss Skills de este Alpha ({{ kit.length }})</h3>
      <ul class="dp-log">
        <li v-for="skill in kit" :key="skill.id">
          <strong>{{ skill.name }}</strong> · {{ skill.shape }} · aviso {{ skill.telegraphSeconds }} s
          <template v-if="skill.damage"> · daño ×{{ skill.damage }}</template>
        </li>
      </ul>
      <p class="dp-note">Son movimientos de WildLands: no están en ORAS y ningún Pokémon del jugador puede aprenderlas.</p>
    </section>

    <section v-if="battle" class="dp-card">
      <h2>Acciones</h2>
      <p class="dp-note">Cada aliado tiene su barra, sus cuatro movimientos y su acción preparada.</p>
      <div v-for="actor in allies" :key="actor.id" class="ab-actor">
        <h3>{{ speciesById(actor.combatant.pokemon.speciesId)?.name }}</h3>
        <div class="dp-row">
          <button
            v-for="move in movesOf(actor.id)"
            :key="move.id"
            type="button"
            class="dp-btn"
            :class="{ 'ab-on': actor.prepared.kind === 'move' && actor.prepared.moveId === move.id }"
            :disabled="(actor.combatant.pokemon.pp[move.id] ?? 0) <= 0"
            @click="chooseMove(actor.id, move.id)"
          >{{ move.name }}</button>
        </div>
      </div>
      <ul class="dp-log">
        <li v-for="(event, i) in log" :key="i">{{ event.at }}s · {{ event.actorId }} · {{ event.text }}</li>
      </ul>
    </section>

    <section class="dp-card">
      <h2>Botín personal</h2>
      <div class="dp-row">
        <label class="dp-field">Espacios libres por jugador
          <input v-model.number="freeSlots" type="number" min="0" max="5" style="width: 70px">
        </label>
        <button type="button" class="dp-btn dp-btn--go" @click="rollLoot">Repartir</button>
      </div>
      <p class="dp-note">
        Cada jugador elegible tira su propia recompensa: no se compite por el objeto raro.
        Con 2+ jugadores el último no participa, para ver la regla de elegibilidad en acción.
      </p>

      <h3>Entregado</h3>
      <ul class="dp-log">
        <li v-for="(entry, i) in delivered" :key="i">{{ entry.playerId }} → {{ entry.item }}</li>
      </ul>

      <template v-if="pending.length">
        <h3>Inventario lleno</h3>
        <div v-for="entry in pending" :key="entry.id" class="dp-card" style="margin-bottom: 8px">
          <p>{{ entry.playerId }} recibió <strong>{{ entry.entry.name }}</strong> y no tiene espacio.</p>
          <div class="dp-row">
            <button type="button" class="dp-btn" @click="answer(entry.id, 'keep')">Conservar (queda en depósito)</button>
            <button type="button" class="dp-btn" @click="answer(entry.id, 'discardOther')">Descartar otra cosa</button>
            <button type="button" class="dp-btn" @click="answer(entry.id, 'discardReward')">Descartar la recompensa</button>
          </div>
        </div>
        <p class="dp-note">Nada se destruye solo: la recompensa espera a que el jugador decida.</p>
      </template>
    </section>
  </div>
</template>

<style scoped>
.ab-actor { padding: 8px 0; border-top: 1px solid #2b3a5e; }
.ab-on { border-color: #ffd27a; box-shadow: inset 0 0 0 1px #ffd27a; }
</style>
