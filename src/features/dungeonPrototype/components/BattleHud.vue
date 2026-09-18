<script setup lang="ts">
// The combat HUD (D1.1 §7, §9–§12, §22).
//
// Compact on purpose: the world is the screen and this sits under it. With two
// active Pokémon it does **not** show eight buttons — the bars of both are
// always visible, a small A/B tab picks whose four moves are on screen, and the
// tab flashes when the other one's bar is full. Alternatives considered are in
// the D1.1 notes.

import { computed, ref, watch } from 'vue'
import { speciesById } from '../data/speciesFixtures'
import { barOf, cooldownOf, type BattleActor, type BattleState, type PreparedAction } from '../domain/battle'
import { moveById } from '../domain/moves'
import { isFainted, type PokemonInstance, type StatusCondition } from '../domain/party'

const props = defineProps<{
  battle: BattleState
  bag: Readonly<Record<string, number>>
  bench: readonly PokemonInstance[]
  items: Readonly<Record<string, { id: string; name: string }>>
  /** Redraw token: the battle object is mutated in place (see PlayDungeon). */
  rev: number
}>()

const emit = defineEmits<{
  (event: 'choose', actorId: string, action: PreparedAction): void
}>()

type Drawer = 'none' | 'bag' | 'party'
const drawer = ref<Drawer>('none')
const activeIndex = ref(0)

// Same reason as CombatPopup: the battle object is mutated in place.
const allies = computed(() => (props.rev, props.battle.actors.filter(actor => actor.side === 'ally')))
const enemies = computed(() => (props.rev, props.battle.actors.filter(actor => actor.side === 'enemy')))
const active = computed<BattleActor | undefined>(() => allies.value[activeIndex.value] ?? allies.value[0])

// If the one you are looking at faints, look at the other one.
watch(() => active.value && isFainted(active.value.combatant.pokemon), fainted => {
  if (fainted) activeIndex.value = allies.value.findIndex(actor => !isFainted(actor.combatant.pokemon))
})

const STATUS_CHIP: Record<StatusCondition, string> = {
  none: '', burn: 'BRN', paralysis: 'PAR', poison: 'PSN', freeze: 'FRZ', sleep: 'SLP',
}

const nameOf = (actor: BattleActor) => speciesById(actor.combatant.pokemon.speciesId)?.name ?? '???'
const hpPct = (actor: BattleActor) =>
  Math.max(0, Math.min(100, (actor.combatant.pokemon.hp / actor.combatant.pokemon.maxHp) * 100))
const hpClass = (actor: BattleActor) => {
  const pct = hpPct(actor)
  return pct <= 20 ? 'bh-hp--low' : pct <= 50 ? 'bh-hp--mid' : ''
}

const moves = computed(() => (props.rev, active.value
  ? active.value.combatant.pokemon.moves.map(id => moveById(id)!).filter(Boolean)
  : []))

const isPrepared = (moveId: string): boolean =>
  active.value?.prepared.kind === 'move' && active.value.prepared.moveId === moveId

/** Priority and recharge are readable from the cooldown the actor is on. */
const tempo = computed(() => {
  const actor = active.value
  if (!actor) return null
  if (actor.cooldownMultiplier < 1) return { label: 'RÁPIDO', tone: 'fast' }
  if (actor.cooldownMultiplier > 1) return { label: 'RECARGANDO', tone: 'slow' }
  return null
})

function choose(action: PreparedAction): void {
  if (!active.value) return
  emit('choose', active.value.id, action)
  drawer.value = 'none'
}

const ppOf = (moveId: string) => active.value?.combatant.pokemon.pp[moveId] ?? 0
const ready = (actor: BattleActor) => barOf(actor) > 0.92
</script>

<template>
  <div class="bh">
    <!-- Rival(s): name, level, HP, status. Always at the top, like the games. -->
    <div v-for="enemy in enemies" :key="enemy.id" class="bh-foe">
      <span class="bh-name">
        {{ nameOf(enemy) }}<em>Nv. {{ enemy.combatant.pokemon.level }}</em>
      </span>
      <span class="bh-chips">
        <i v-if="STATUS_CHIP[enemy.combatant.pokemon.status]" class="bh-chip">
          {{ STATUS_CHIP[enemy.combatant.pokemon.status] }}
        </i>
        <i v-if="enemy.combatant.pokemon.confusedFor > 0" class="bh-chip bh-chip--conf">CONF</i>
        <i v-if="enemy.shield > 0" class="bh-chip bh-chip--shield">◈{{ enemy.shield }}</i>
      </span>
      <span class="bh-bar bh-bar--hp"><i :class="hpClass(enemy)" :style="{ width: `${hpPct(enemy)}%` }" /></span>
      <span class="bh-bar bh-bar--cd"><i :style="{ width: `${barOf(enemy) * 100}%` }" /></span>
    </div>

    <!-- Which of my Pokémon I am commanding. Only shown when there are two. -->
    <div v-if="allies.length > 1" class="bh-tabs">
      <button
        v-for="(ally, index) in allies" :key="ally.id" type="button"
        class="bh-tab" :class="{ 'bh-tab--on': index === activeIndex, 'bh-tab--ready': ready(ally) }"
        :disabled="isFainted(ally.combatant.pokemon)"
        @click="activeIndex = index"
      >
        <strong>{{ index === 0 ? 'A' : 'B' }} · {{ nameOf(ally) }}</strong>
        <span class="bh-bar bh-bar--hp"><i :class="hpClass(ally)" :style="{ width: `${hpPct(ally)}%` }" /></span>
        <span class="bh-bar bh-bar--cd"><i :style="{ width: `${barOf(ally) * 100}%` }" /></span>
      </button>
    </div>

    <template v-if="active">
      <div class="bh-me">
        <span class="bh-name">
          {{ nameOf(active) }}<em>Nv. {{ active.combatant.pokemon.level }}</em>
        </span>
        <span class="bh-chips">
          <i v-if="STATUS_CHIP[active.combatant.pokemon.status]" class="bh-chip">
            {{ STATUS_CHIP[active.combatant.pokemon.status] }}
          </i>
          <i v-if="active.combatant.pokemon.confusedFor > 0" class="bh-chip bh-chip--conf">CONF</i>
          <i v-if="active.shield > 0" class="bh-chip bh-chip--shield">◈{{ active.shield }}</i>
          <i v-if="tempo" class="bh-chip" :class="`bh-chip--${tempo.tone}`">{{ tempo.label }}</i>
        </span>
        <span class="bh-hpnum">
          {{ Math.max(0, active.combatant.pokemon.hp) }}/{{ active.combatant.pokemon.maxHp }}
          <em>{{ cooldownOf(battle, active) }} s</em>
        </span>
        <span class="bh-bar bh-bar--hp"><i :class="hpClass(active)" :style="{ width: `${hpPct(active)}%` }" /></span>
        <span class="bh-bar bh-bar--cd bh-bar--mine"><i :style="{ width: `${barOf(active) * 100}%` }" /></span>
      </div>

      <div class="bh-moves">
        <button
          v-for="move in moves" :key="move.id" type="button"
          class="bh-move" :class="{ 'bh-move--on': isPrepared(move.id) }"
          :disabled="ppOf(move.id) <= 0"
          @click="choose({ kind: 'move', moveId: move.id })"
        >
          <strong>{{ move.name }}</strong>
          <em>{{ move.type }} · {{ ppOf(move.id) }}/{{ move.pp }}<template v-if="move.priority > 0"> · ⏩</template></em>
        </button>
      </div>

      <div class="bh-actions">
        <button type="button" class="bh-action" :class="{ 'bh-action--on': drawer === 'party' }" @click="drawer = drawer === 'party' ? 'none' : 'party'">CAMBIAR</button>
        <button type="button" class="bh-action" :class="{ 'bh-action--on': drawer === 'bag' }" @click="drawer = drawer === 'bag' ? 'none' : 'bag'">MOCHILA</button>
        <span class="bh-live">● el combate sigue</span>
      </div>

      <!-- Drawers sit over the HUD, never over the world, and close in one tap. -->
      <div v-if="drawer === 'bag'" class="bh-drawer">
        <button
          v-for="(count, itemId) in bag" :key="itemId" type="button"
          class="bh-item" :disabled="count <= 0"
          @click="choose({ kind: 'item', itemId: String(itemId) })"
        >
          <span class="bh-icon" :class="`bh-icon--${itemId}`" />
          <strong>{{ items[itemId]?.name ?? itemId }}</strong>
          <em>×{{ count }}</em>
        </button>
      </div>

      <div v-if="drawer === 'party'" class="bh-drawer">
        <button
          v-for="member in bench" :key="member.instanceId" type="button"
          class="bh-slot" :disabled="isFainted(member)"
          @click="choose({ kind: 'switch', instanceId: member.instanceId })"
        >
          <strong>{{ speciesById(member.speciesId)?.name }}</strong>
          <em>Nv. {{ member.level }} · {{ Math.max(0, member.hp) }}/{{ member.maxHp }}</em>
          <span class="bh-bar bh-bar--hp">
            <i :style="{ width: `${Math.max(0, (member.hp / member.maxHp) * 100)}%` }" />
          </span>
          <em v-if="isFainted(member)" class="bh-down">DEBILITADO</em>
          <em v-else-if="STATUS_CHIP[member.status]">{{ STATUS_CHIP[member.status] }}</em>
        </button>
        <p v-if="!bench.length" class="bh-empty">No queda nadie en la banca.</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.bh { display: grid; gap: 6px; }
.bh-foe, .bh-me {
  display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; align-items: center;
  padding: 6px 8px; border: 1px solid #2b3a5e; border-radius: 10px; background: #172038;
}
.bh-foe { border-color: #4a2a33; }
.bh-name { font-size: 0.82rem; font-weight: 700; }
.bh-name em, .bh-hpnum em { margin-left: 6px; font-size: 0.7rem; font-style: normal; font-weight: 400; color: #93a2c6; }
.bh-hpnum { font-size: 0.75rem; text-align: right; }
.bh-chips { display: flex; gap: 4px; justify-self: end; }
.bh-chip { padding: 1px 5px; border-radius: 4px; background: #3a2a4a; color: #dcc7ff; font-size: 0.62rem; font-style: normal; font-weight: 800; }
.bh-chip--conf { background: #4a3a20; color: #ffd9a0; }
.bh-chip--shield { background: #23415e; color: #8ec7ff; }
.bh-chip--fast { background: #1f4a35; color: #7ee2a8; }
.bh-chip--slow { background: #4a2020; color: #ff9f7a; }
.bh-bar { position: relative; grid-column: 1 / -1; height: 7px; border-radius: 999px; background: #0f1730; overflow: hidden; }
.bh-bar i { position: absolute; inset: 0 auto 0 0; display: block; border-radius: 999px; transition: width 0.12s linear; }
.bh-bar--hp i { background: #7ee2a8; }
.bh-hp--mid { background: #ffd27a !important; }
.bh-hp--low { background: #ff6b6b !important; }
.bh-bar--cd { height: 5px; }
.bh-bar--cd i { background: #6b7ba8; }
.bh-bar--mine i { background: #ffd27a; }

.bh-tabs { display: grid; grid-auto-flow: column; gap: 6px; }
.bh-tab {
  display: grid; gap: 3px; padding: 6px 8px; min-height: 44px;
  border: 1px solid #2b3a5e; border-radius: 10px; background: #141c31; color: #e8eeff;
  font: inherit; font-size: 0.74rem; text-align: left; cursor: pointer;
}
.bh-tab--on { border-color: #ffd27a; }
.bh-tab--ready { box-shadow: 0 0 0 1px #ffd27a inset; }
.bh-tab:disabled { opacity: 0.4; }

.bh-moves { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.bh-move {
  display: flex; flex-direction: column; gap: 2px; align-items: flex-start;
  min-height: 48px; padding: 6px 8px;
  border: 1px solid #2b3a5e; border-radius: 10px; background: #1f2b49; color: #e8eeff;
  font: inherit; text-align: left; cursor: pointer;
}
.bh-move strong { font-size: 0.8rem; }
.bh-move em { font-size: 0.66rem; font-style: normal; color: #93a2c6; }
.bh-move--on { border-color: #ffd27a; background: #2a3354; box-shadow: inset 0 0 0 1px #ffd27a; }
.bh-move:disabled { opacity: 0.4; cursor: not-allowed; }

.bh-actions { display: flex; gap: 6px; align-items: center; }
.bh-action {
  flex: 1; min-height: 44px; border: 1px solid #2b3a5e; border-radius: 10px;
  background: #1f2b49; color: #e8eeff; font: inherit; font-weight: 700; cursor: pointer;
}
.bh-action--on { border-color: #ffd27a; color: #ffd27a; }
.bh-live { font-size: 0.66rem; color: #7ee2a8; }

.bh-drawer {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(128px, 1fr)); gap: 6px;
  padding: 8px; border: 1px solid #2b3a5e; border-radius: 10px; background: #101729;
}
.bh-item, .bh-slot {
  display: grid; gap: 2px; min-height: 48px; padding: 6px 8px;
  border: 1px solid #2b3a5e; border-radius: 8px; background: #1b2540; color: #e8eeff;
  font: inherit; text-align: left; cursor: pointer;
}
.bh-item { grid-template-columns: 20px 1fr auto; align-items: center; }
.bh-item em, .bh-slot em { font-size: 0.68rem; font-style: normal; color: #93a2c6; }
.bh-item:disabled, .bh-slot:disabled { opacity: 0.4; cursor: not-allowed; }
.bh-down { color: #ff8a8a !important; }
.bh-icon { width: 16px; height: 16px; border-radius: 50%; background: #6b7ba8; }
.bh-icon--potion { background: #ff7a9f; }
.bh-icon--revive { background: #ffd27a; }
.bh-icon--ether { background: #8ec7ff; }
.bh-icon--poke_ball { background: linear-gradient(#e04a4a 0 50%, #e8edf6 50% 100%); border: 1px solid #14100f; }
.bh-empty { margin: 0; font-size: 0.75rem; color: #93a2c6; }
</style>
