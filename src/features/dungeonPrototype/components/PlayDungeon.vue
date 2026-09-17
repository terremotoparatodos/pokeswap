<script setup lang="ts">
// PLAY DUNGEON: the whole loop in one place (D1 §55).
//
// Designed from 375 px up (§32, §57): the world stays visible and the controls
// live in a compact bar under it. The combat HUD replaces the d-pad, not the
// scene, so the fight never hides the dungeon.

import { computed, onUnmounted, ref, shallowRef, triggerRef } from 'vue'
import BattleField from './BattleField.vue'
import FloorView from './FloorView.vue'
import {
  BATTLE_ITEMS, buildParty, buildWild, combatantFor, FLOOR_LOOT, STARTING_INVENTORY,
} from '../data/runFixtures'
import { DUNGEON_DEFINITIONS, poolOf } from '../data/dungeonCatalog'
import { speciesById } from '../data/speciesFixtures'
import { barOf, cooldownOf, tick, type PreparedAction } from '../domain/battle'
import { createSpawn, formatCountdown, type DungeonDefinition } from '../domain/dungeonSpawn'
import { heal, isFainted, revive } from '../domain/party'
import { moveById } from '../domain/moves'
import { streamFor } from '../domain/rng'
import {
  act, advanceClock, atStairs, descend, endRun, engage, enterAntechamber, move,
  openChest, reachable, settleCombat, startBoss, startPlay, type PlaySession,
} from '../domain/playSession'

const session = shallowRef<PlaySession | null>(null)
const definitionId = ref(DUNGEON_DEFINITIONS[0].definitionId)
const minutes = ref(180)
const players = ref(1)
const bagOpen = ref(false)
const bag = ref<Record<string, number>>({ ...STARTING_INVENTORY })
/** DEV: how many dungeon seconds pass per real second. */
const clockSpeed = ref(1)

const definition = computed<DungeonDefinition>(() =>
  DUNGEON_DEFINITIONS.find(entry => entry.definitionId === definitionId.value) ?? DUNGEON_DEFINITIONS[0])

let frame = 0
let last = 0

const stop = (): void => { if (frame) cancelAnimationFrame(frame); frame = 0 }
onUnmounted(stop)

function loop(now: number): void {
  const live = session.value
  if (!live) return
  const dt = Math.min(1 / 20, (now - last) / 1000)
  last = now
  if (dt > 0) {
    if (live.battle && live.battle.outcome === 'ongoing') {
      tick(live.battle, dt)
      live.boss?.update(live.battle, dt)
    }
    if (live.battle && live.battle.outcome !== 'ongoing') {
      settleCombat(live, () => {
        const rng = streamFor(live.expedition.seed, 'drop', live.expedition.floor, live.log.length)
        const entry = FLOOR_LOOT.entries[rng.int(0, FLOOR_LOOT.entries.length - 1)]
        return rng.chance(0.6) ? [{ itemId: entry.itemId, quantity: entry.quantity }] : []
      })
    }
    advanceClock(live, dt * 1000 * clockSpeed.value)
    triggerRef(session)
  }
  if (live.phase !== 'ended') frame = requestAnimationFrame(loop)
  else frame = 0
}

function begin(): void {
  stop()
  bag.value = { ...STARTING_INVENTORY }
  const now = Date.now()
  const spawn = createSpawn({
    spawnId: `spawn-${now}`,
    definition: definition.value,
    position: { tx: 0, ty: 0, areaId: 'pradera' },
    now, minutes: minutes.value,
    seed: Math.floor(Math.random() * 100000),
  })
  session.value = startPlay({
    definition: definition.value,
    spawn,
    party: buildParty(),
    inventory: STARTING_INVENTORY,
    pool: poolOf(definition.value),
    now,
  })
  last = performance.now()
  frame = requestAnimationFrame(loop)
}

// ── Exploration ────────────────────────────────────────────────────────────

const step = (dx: number, dy: number): void => {
  const live = session.value
  if (live && move(live, dx, dy)) triggerRef(session)
}

const nearby = computed(() => (session.value ? reachable(session.value) : []))
const onStairs = computed(() => (session.value ? atStairs(session.value) : false))

function fight(entityId: string): void {
  const live = session.value
  if (!live) return
  engage(live, entityId, {
    makeWild: (speciesId, level) => buildWild(speciesId, level),
    makeCombatant: pokemon => combatantFor(pokemon),
    battleItems: BATTLE_ITEMS,
  })
  triggerRef(session)
}

function loot(entityId: string): void {
  const live = session.value
  if (!live) return
  openChest(live, entityId, () => {
    const rng = streamFor(live.expedition.seed, 'chest', entityId)
    const entry = FLOOR_LOOT.entries[rng.int(0, FLOOR_LOOT.entries.length - 1)]
    return [{ itemId: entry.itemId, quantity: entry.quantity }]
  })
  triggerRef(session)
}

function goDown(): void {
  const live = session.value
  if (!live) return
  if (live.expedition.floor >= live.expedition.floors) enterAntechamber(live)
  else descend(live)
  triggerRef(session)
}

// ── Combat ─────────────────────────────────────────────────────────────────

const battle = computed(() => session.value?.battle ?? null)
const allies = computed(() => battle.value?.actors.filter(actor => actor.side === 'ally') ?? [])
const enemies = computed(() => battle.value?.actors.filter(actor => actor.side === 'enemy') ?? [])
const activeMoves = computed(() => allies.value.map(actor => ({
  actorId: actor.id,
  name: speciesById(actor.combatant.pokemon.speciesId)?.name ?? '???',
  moves: actor.combatant.pokemon.moves.map(id => moveById(id)!),
  prepared: actor.prepared,
  pokemon: actor.combatant.pokemon,
  bar: barOf(actor),
  shield: actor.shield,
  cooldown: battle.value ? cooldownOf(battle.value, actor) : 0,
})))

function choose(actorId: string, action: PreparedAction): void {
  const live = session.value
  if (!live || !live.battle) return
  if (action.kind === 'item') {
    if ((bag.value[action.itemId] ?? 0) <= 0) return
    bag.value[action.itemId] -= 1
  }
  // `act` prepares for ally-0; a second active Pokémon is prepared directly.
  if (actorId === 'ally-0') {
    act(live, action)
  } else {
    const actor = live.battle.actors.find(candidate => candidate.id === actorId)
    if (actor) actor.prepared = action
  }
  triggerRef(session)
}

// ── Party and items outside combat ─────────────────────────────────────────

const party = computed(() => session.value?.expedition.party ?? [])

function usePotion(): void {
  const live = session.value
  if (!live || (bag.value.potion ?? 0) <= 0) return
  const hurt = live.expedition.party.find(member => !isFainted(member) && member.hp < member.maxHp)
  if (!hurt) return
  bag.value.potion -= 1
  heal(hurt, 40)
  triggerRef(session)
}

function useRevive(): void {
  const live = session.value
  if (!live || (bag.value.revive ?? 0) <= 0) return
  const fallen = live.expedition.party.find(isFainted)
  if (!fallen) return
  bag.value.revive -= 1
  revive(fallen, 0.5)
  triggerRef(session)
}

const finish = (kind: 'retreat' | 'wipe'): void => {
  const live = session.value
  if (!live) return
  endRun(live, kind)
  stop()
  triggerRef(session)
}

function launchBoss(): void {
  const live = session.value
  if (!live) return
  startBoss(live, {
    makeWild: (speciesId, level) => buildWild(speciesId, level),
    makeCombatant: pokemon => combatantFor(pokemon),
    battleItems: BATTLE_ITEMS,
    players: players.value,
  })
  triggerRef(session)
}

// ── Dev shortcuts ──────────────────────────────────────────────────────────

function forceKey(): void {
  const live = session.value
  if (!live) return
  live.expedition = { ...live.expedition, key: { hasKey: true, defeatsWithoutKey: 0 } }
  triggerRef(session)
}

/** Walks the run down to the boss floor without fighting everything on the way. */
function skipToLastFloor(): void {
  const live = session.value
  if (!live) return
  while (live.expedition.floor < live.expedition.floors) {
    live.expedition = { ...live.expedition, key: { hasKey: true, defeatsWithoutKey: 0 } }
    live.player = live.tiles.exit
    if (!descend(live)) break
  }
  live.player = live.tiles.exit
  triggerRef(session)
}

const countdown = computed(() => (session.value ? formatCountdown(session.value.spawn, session.value.now) : '—'))
const healthyCount = computed(() => party.value.filter(member => !isFainted(member)).length)
</script>

<template>
  <div class="pd">
    <!-- Setup -->
    <section v-if="!session" class="dp-card">
      <h2>Entrar a una Dungeon</h2>
      <div class="dp-row">
        <label class="dp-field">Dungeon
          <select v-model="definitionId">
            <option v-for="entry in DUNGEON_DEFINITIONS" :key="entry.definitionId" :value="entry.definitionId">
              {{ entry.name }} · {{ entry.category }} · {{ entry.tier }} · {{ entry.floors }} pisos
            </option>
          </select>
        </label>
        <label class="dp-field">Minutos
          <input v-model.number="minutes" type="number" min="1" max="240" style="width: 80px">
        </label>
        <label class="dp-field">Jugadores
          <input v-model.number="players" type="number" min="1" max="4" style="width: 70px">
        </label>
        <button type="button" class="dp-btn dp-btn--go" @click="begin">Entrar</button>
      </div>
      <p class="dp-note">
        La Dungeon es un evento temporal: el reloj es del spawn, no de tu expedición.
      </p>
    </section>

    <template v-else>
      <!-- HUD: always visible, always compact -->
      <div class="pd-hud">
        <span class="dp-tag">{{ session.definition.name }}</span>
        <span>Piso {{ session.expedition.floor }}/{{ session.expedition.floors }}</span>
        <span :class="{ 'pd-urgent': session.lastMinutes <= 5 }">⏱ {{ countdown }}</span>
        <span v-if="session.expedition.key.hasKey" class="dp-tag">🔑</span>
        <span v-if="session.lucky" class="dp-tag">✦ {{ session.lucky.label }}</span>
        <span>{{ healthyCount }}/{{ party.length }}</span>
      </div>

      <!-- The world stays on screen in every phase -->
      <section class="dp-card pd-stage">
        <BattleField
          v-if="battle"
          :allies="allies" :enemies="enemies" :seconds="battle.seconds"
          :enemy-scale="session.phase === 'boss' ? 2 : 1" :aura="session.phase === 'boss'"
          :telegraph="battle.telegraph"
        />
        <FloorView
          v-else
          :tiles="session.tiles" :entities="session.entities" :player="session.player"
        />
      </section>

      <!-- Exploring -->
      <section v-if="session.phase === 'exploring'" class="dp-card pd-controls">
        <div class="pd-pad">
          <button type="button" class="dp-btn" @click="step(0, -1)">▲</button>
          <div>
            <button type="button" class="dp-btn" @click="step(-1, 0)">◀</button>
            <button type="button" class="dp-btn" @click="step(1, 0)">▶</button>
          </div>
          <button type="button" class="dp-btn" @click="step(0, 1)">▼</button>
        </div>
        <div class="pd-actions">
          <button
            v-for="entity in nearby" :key="entity.id" type="button" class="dp-btn dp-btn--go"
            @click="entity.kind === 'chest' ? loot(entity.id) : fight(entity.id)"
          >
            {{ entity.kind === 'chest' ? 'Abrir cofre' : entity.kind === 'lucky' ? 'Pokémon con suerte' : 'Combatir' }}
            <template v-if="entity.kind !== 'chest'">
              · {{ speciesById(entity.speciesId ?? 0)?.name }} Nv. {{ entity.level }}
            </template>
          </button>
          <button v-if="onStairs" type="button" class="dp-btn dp-btn--go" @click="goDown">
            {{ session.expedition.floor >= session.expedition.floors ? 'Antecámara del Alpha' : 'Bajar al piso siguiente' }}
          </button>
          <button type="button" class="dp-btn" @click="usePotion">Poción ×{{ bag.potion ?? 0 }}</button>
          <button type="button" class="dp-btn" @click="useRevive">Revivir ×{{ bag.revive ?? 0 }}</button>
          <button type="button" class="dp-btn" @click="finish('retreat')">Retirarse</button>
        </div>
        <p class="dp-note">
          Los Pokémon son visibles y no te atacan por pasar cerca: vos elegís. Algunos cierran un paso.
        </p>
      </section>

      <!-- Antechamber -->
      <section v-else-if="session.phase === 'antechamber'" class="dp-card">
        <h2>Antecámara</h2>
        <p class="dp-note">Acá no se cura ni se restaura nada. Es información y una decisión.</p>
        <ul class="pd-party">
          <li v-for="member in party" :key="member.instanceId" :class="{ 'pd-down': isFainted(member) }">
            {{ speciesById(member.speciesId)?.name }} Nv. {{ member.level }} ·
            {{ Math.max(0, member.hp) }}/{{ member.maxHp }}
            <em v-if="member.status !== 'none'">{{ member.status }}</em>
          </li>
        </ul>
        <p class="dp-note">
          Poción ×{{ bag.potion ?? 0 }} · Revivir ×{{ bag.revive ?? 0 }} · Éter ×{{ bag.ether ?? 0 }} ·
          Poké Ball ×{{ bag.poke_ball ?? 0 }} · quedan {{ countdown }} ·
          jugadores listos: {{ players }}/{{ players }}
        </p>
        <div class="dp-row">
          <button type="button" class="dp-btn dp-btn--go" @click="launchBoss">ENTRAR</button>
          <button type="button" class="dp-btn" @click="finish('retreat')">Retirarse</button>
        </div>
      </section>

      <!-- Combat, normal or boss -->
      <section v-else-if="battle" class="dp-card pd-controls">
        <div v-for="entry in activeMoves" :key="entry.actorId" class="pd-fighter">
          <div class="pd-fighter-head">
            <strong>{{ entry.name }}</strong>
            <span>{{ Math.max(0, entry.pokemon.hp) }}/{{ entry.pokemon.maxHp }}</span>
            <span v-if="entry.shield" class="dp-tag">◈{{ entry.shield }}</span>
            <span v-if="entry.pokemon.status !== 'none'" class="dp-tag">{{ entry.pokemon.status }}</span>
            <span v-if="entry.pokemon.confusedFor > 0" class="dp-tag">confusión</span>
            <em>{{ entry.cooldown }} s</em>
          </div>
          <span class="pd-bar"><i :style="{ width: `${entry.bar * 100}%` }" /></span>
          <div class="pd-moves">
            <button
              v-for="option in entry.moves" :key="option.id" type="button" class="dp-btn pd-move"
              :class="{ 'pd-move--on': entry.prepared.kind === 'move' && entry.prepared.moveId === option.id }"
              :disabled="(entry.pokemon.pp[option.id] ?? 0) <= 0"
              @click="choose(entry.actorId, { kind: 'move', moveId: option.id })"
            >
              <strong>{{ option.name }}</strong>
              <em>{{ entry.pokemon.pp[option.id] }}/{{ option.pp }}</em>
            </button>
          </div>
        </div>

        <div class="dp-row">
          <button type="button" class="dp-btn" @click="bagOpen = !bagOpen">
            {{ bagOpen ? 'Cerrar mochila' : 'Mochila' }}
          </button>
          <span class="dp-note">No pausa. El rival sigue cargando.</span>
        </div>
        <div v-if="bagOpen" class="dp-row">
          <button
            v-for="(count, itemId) in bag" :key="itemId" type="button" class="dp-btn" :disabled="count <= 0"
            @click="choose('ally-0', { kind: 'item', itemId })"
          >{{ BATTLE_ITEMS[itemId]?.name ?? itemId }} ×{{ count }}</button>
        </div>
      </section>

      <!-- Ended -->
      <section v-else-if="session.phase === 'ended'" class="dp-card">
        <h2>Expedición terminada</h2>
        <p><span class="dp-tag">{{ session.result?.outcome ?? '—' }}</span></p>
        <p class="dp-note">
          Conservado: {{ Object.keys(session.result?.extractedLoot ?? {}).length }} items ·
          {{ session.result?.extractedCaptures.length ?? 0 }} capturas.
          Perdido: {{ Object.keys(session.result?.lostLoot ?? {}).length }} items ·
          {{ session.result?.lostCaptures.length ?? 0 }} capturas.
          La próxima entrada empieza en el piso {{ session.result?.nextEntryFloor ?? 1 }}.
        </p>
        <button type="button" class="dp-btn dp-btn--go" @click="session = null">Volver a empezar</button>
      </section>

      <!-- Dev controls, always last so they never crowd the game -->
      <section class="dp-card">
        <h3>Dev</h3>
        <div class="dp-row">
          <label class="dp-field">Reloj ×{{ clockSpeed }}
            <input v-model.number="clockSpeed" type="range" min="1" max="600" step="1">
          </label>
          <button type="button" class="dp-btn" @click="finish('wipe')">Forzar wipe</button>
          <button type="button" class="dp-btn" @click="forceKey">Forzar llave</button>
          <button type="button" class="dp-btn" @click="skipToLastFloor">Ir al último piso</button>
        </div>
        <ul class="dp-log">
          <li v-for="(line, i) in session.log" :key="i">{{ line }}</li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.pd { display: grid; gap: 10px; }
.pd-hud {
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
  padding: 8px 10px; border: 1px solid #2b3a5e; border-radius: 10px; background: #172038; font-size: 0.8rem;
}
.pd-urgent { color: #ff8a8a; font-weight: 700; }
.pd-stage { padding: 8px; }
.pd-controls { display: grid; gap: 10px; }
.pd-pad { display: grid; justify-items: center; gap: 4px; }
.pd-pad > div { display: flex; gap: 42px; }
.pd-pad button { min-width: 46px; min-height: 40px; font-size: 1rem; }
.pd-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.pd-actions button { min-height: 40px; }
.pd-party { margin: 0; padding-left: 18px; font-size: 0.82rem; }
.pd-down { color: #ff8a8a; }
.pd-fighter { padding: 6px 0; border-top: 1px solid #2b3a5e; }
.pd-fighter-head { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 0.8rem; }
.pd-fighter-head em { margin-left: auto; font-style: normal; color: #93a2c6; }
.pd-bar { position: relative; display: block; height: 7px; margin: 4px 0; border-radius: 999px; background: #0f1730; overflow: hidden; }
.pd-bar i { position: absolute; inset: 0 auto 0 0; display: block; background: #ffd27a; border-radius: 999px; }
.pd-moves { display: grid; gap: 6px; grid-template-columns: repeat(2, 1fr); }
.pd-move { display: flex; flex-direction: column; align-items: flex-start; min-height: 44px; text-align: left; }
.pd-move em { font-size: 0.68rem; font-style: normal; color: #93a2c6; }
.pd-move--on { border-color: #ffd27a; box-shadow: inset 0 0 0 1px #ffd27a; }
@media (min-width: 640px) {
  .pd-moves { grid-template-columns: repeat(4, 1fr); }
}
</style>
