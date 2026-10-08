<template>
  <section class="eco-battle" aria-label="Combate de prueba ECO (desarrollo)">
    <template v-if="view.phase === 'engaging'">
      <p role="status">Pidiendo el encuentro al servidor…</p>
    </template>

    <template v-else-if="view.phase === 'refused'">
      <p role="status">No se pudo combatir: {{ refusal(view.reason) }}.</p>
      <button type="button" @click="session.dismiss()">Cerrar</button>
    </template>

    <template v-else-if="view.phase === 'battle' || view.phase === 'ended'">
      <header>
        <strong>Combate de prueba</strong>
        <span class="eco-battle__fixture">Tu equipo: {{ fixtureLabel }} (sintético)</span>
      </header>
      <div v-for="side in sides" :key="side.id" class="eco-battle__side">
        <span>{{ side.name }} · nv {{ side.level }}<template v-if="side.status"> · {{ side.status }}</template></span>
        <div class="eco-battle__bar" role="meter" :aria-valuenow="side.hp" :aria-valuemax="side.maxHp" :aria-label="`PS de ${side.name}`">
          <div :style="{ width: `${Math.round((100 * side.hp) / side.maxHp)}%` }" />
        </div>
        <span class="eco-battle__hp">{{ side.hp }} / {{ side.maxHp }} PS</span>
      </div>

      <template v-if="view.phase === 'battle'">
        <p class="eco-battle__meta">
          <span v-if="!view.connected">Reconectando… (el combate está en pausa)</span>
          <span v-else>Tiempo de combate restante: {{ remainingLabel }}</span>
          <span v-if="selectedName"> · elegido: {{ selectedName }}</span>
        </p>
        <div class="eco-battle__moves">
          <button v-for="move in moves" :key="move.id" type="button" :disabled="!view.connected || move.pp <= 0" @click="choose(move.id, move.targetsUser)">
            {{ move.name }} <small>#{{ move.id }} · {{ move.pp }} PP</small>
          </button>
        </div>
        <button type="button" class="eco-battle__flee" :disabled="!view.connected" @click="session.flee()">Huir</button>
        <p v-if="view.lastRejection" class="eco-battle__rejected" role="status">El servidor rechazó la acción ({{ view.lastRejection }}).</p>
      </template>

      <template v-else>
        <p class="eco-battle__result" role="status">{{ outcomeLabel }}</p>
        <button type="button" @click="session.dismiss()">Cerrar</button>
      </template>
    </template>
    <p class="eco-battle__note">Sandbox de desarrollo: sin captura, objetos, XP, drops ni recompensas. El servidor decide el resultado.</p>
  </section>
</template>

<script setup lang="ts">
// ECO-GAMEPLAY-2 (experimental, development builds only): shows the server's test battle and sends
// the player's choices. Move and species names come from the battle catalog, loaded lazily here.
import { computed, onUnmounted, ref, shallowRef } from 'vue'
import { loadBattleCatalog } from '../../battle/catalog'
import type { BattleCatalogIndex } from '../../battle/catalog'
import { maxPPOf } from '../../pokemon/model/instance'
import { PLAYER_COMBATANT, WILD_COMBATANT } from '../state/ecoBattleSession'
import type { EcoBattleSession, EcoBattleView } from '../state/ecoBattleSession'

const props = defineProps<{ session: EcoBattleSession; view: EcoBattleView }>()

const catalog = shallowRef<BattleCatalogIndex | null>(null)
loadBattleCatalog().then(index => { catalog.value = index }).catch(() => undefined)

// The remaining time is a local estimate between server messages: redraw it twice a second.
const tick = ref(0)
const timer = setInterval(() => { tick.value++ }, 500)
onUnmounted(() => clearInterval(timer))

const snapshot = computed(() => (props.view.phase === 'battle' || props.view.phase === 'ended' ? props.view.snapshot : null))
const fixtureLabel = computed(() => (props.view.phase === 'battle' ? props.view.fixtureLabel : 'fixture de prueba'))
const speciesName = (id: number) => catalog.value?.species(id)?.name ?? `#${id}`
const STATUS: Record<string, string> = { paralysis: 'paralizado', poison: 'envenenado', badlyPoisoned: 'gravemente envenenado', burn: 'quemado', sleep: 'dormido', freeze: 'congelado' }

const sides = computed(() => {
  const s = snapshot.value
  if (!s) return []
  return [PLAYER_COMBATANT, WILD_COMBATANT].map(id => s.combatants[id]).filter(Boolean).map(c => ({
    id: c.combatantId, name: `${speciesName(c.instance.speciesId)}${c.combatantId === WILD_COMBATANT ? ' salvaje' : ''}`, level: c.level,
    hp: Math.max(0, c.condition.currentHp ?? c.stats.hp), maxHp: c.stats.hp,
    status: c.condition.majorStatus === 'none' ? '' : (STATUS[c.condition.majorStatus] ?? c.condition.majorStatus),
  }))
})

const moves = computed(() => {
  const player = snapshot.value?.combatants[PLAYER_COMBATANT]
  if (!player) return []
  return player.instance.moves.map(slot => {
    const move = catalog.value?.move(slot.moveId)
    // `condition.pp` is sparse: an absent move is at full PP.
    const pp = player.condition.pp[slot.moveId] ?? (move ? maxPPOf(move.pp ?? 0, slot.ppUps) : 1)
    return { id: slot.moveId, name: move?.name ?? `movimiento ${slot.moveId}`, targetsUser: move?.target === 'user', pp }
  })
})

const selectedName = computed(() => {
  const selected = snapshot.value?.combatants[PLAYER_COMBATANT]?.runtime.selected
  return selected?.kind === 'move' ? (catalog.value?.move(selected.moveId)?.name ?? `#${selected.moveId}`) : ''
})

const remainingLabel = computed(() => {
  void tick.value
  const s = Math.ceil(props.session.remainingMs() / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})

const OUTCOME: Record<string, string> = {
  victory: '¡Victoria! El Pokémon salvaje se retiró del mundo para todos (simulación, sin recompensa).',
  defeat: 'Derrota. El Pokémon salvaje sigue en el mundo.',
  draw: 'Empate. El Pokémon salvaje sigue en el mundo.',
  fled: 'Huiste. El Pokémon salvaje sigue en el mundo.',
  expired: 'Se agotó el tiempo del combate de prueba. El Pokémon salvaje sigue en el mundo.',
  disconnected: 'El combate se liberó por desconexión. El Pokémon salvaje sigue en el mundo.',
  'left-area': 'Saliste del área: el combate se liberó.',
  vanished: 'El encuentro ya no existe: el combate se liberó.',
}
const outcomeLabel = computed(() => (props.view.phase === 'ended' ? (OUTCOME[props.view.outcome] ?? props.view.outcome) : ''))

const REFUSAL: Record<string, string> = {
  busy: 'otro jugador lo está combatiendo', 'too-far': 'estás demasiado lejos', 'other-area': 'está en otra área',
  'not-alive': 'ya no está', 'already-battling': 'ya tenés un combate', 'battle-unavailable': 'combates no disponibles',
  unavailable: 'población no disponible', 'not-player': 'solo jugadores', 'not-current-socket': 'sesión reemplazada',
  'client-outdated': 'cliente desactualizado', disabled: 'el servidor no tiene el experimento', invalid: 'pedido inválido',
  offline: 'sin conexión', 'no-answer': 'sin respuesta del servidor',
}
const refusal = (reason: string) => REFUSAL[reason] ?? reason

function choose(moveId: number, targetsUser: boolean) {
  props.session.useMove(moveId, targetsUser)
}
</script>

<style scoped>
.eco-battle {
  margin-top: 8px;
  padding: 8px;
  border-radius: 6px;
  background: rgba(40, 52, 64, 0.92);
}
.eco-battle header { display: flex; flex-direction: column; margin-bottom: 6px; }
.eco-battle__fixture { opacity: 0.8; }
.eco-battle__side { display: grid; gap: 2px; margin-bottom: 6px; }
.eco-battle__bar { height: 6px; border-radius: 3px; background: rgba(255, 255, 255, 0.15); overflow: hidden; }
.eco-battle__bar > div { height: 100%; background: #5fd38a; transition: width 0.2s; }
.eco-battle__hp { opacity: 0.75; }
.eco-battle__moves { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin: 6px 0; }
.eco-battle button { font: inherit; padding: 4px 6px; cursor: pointer; }
.eco-battle button:disabled { cursor: default; opacity: 0.5; }
.eco-battle small { opacity: 0.7; }
.eco-battle__meta, .eco-battle__rejected, .eco-battle__result, .eco-battle__note { margin: 6px 0 0; }
.eco-battle__note { opacity: 0.6; }
</style>
