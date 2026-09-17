<script setup lang="ts">
// The combat popup (D1.2 §11, §27).
//
// Small on purpose. The health, the action bars and the status pips are drawn
// in the world, over the Pokémon themselves, so this panel only has to carry
// what the world cannot: which four moves are available, and the two buttons
// that open the bag and the party. It floats over a corner of the scene and
// never takes the world off the screen.

import { computed, ref, watch } from 'vue'
import { speciesById } from '../data/speciesFixtures'
import { barOf, type BattleActor, type BattleState, type PreparedAction } from '../domain/battle'
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
  (event: 'flee'): void
}>()

type Drawer = 'none' | 'bag' | 'party'
const drawer = ref<Drawer>('none')
const activeIndex = ref(0)

// The battle is a plain object mutated in place, so nothing here may cache on
// its own: every derivation reads `rev` first, which is the redraw token the
// parent bumps. Without it a switch left the panel showing the four moves of
// the Pokémon that walked off, every one of them at 0 PP (D1.2.3 §3).
const allies = computed(() => (props.rev, props.battle.actors.filter(actor => actor.side === 'ally')))
const foe = computed(() => (props.rev, props.battle.actors.find(actor => actor.side === 'enemy')))
const active = computed<BattleActor | undefined>(() => allies.value[activeIndex.value] ?? allies.value[0])

watch(() => active.value && isFainted(active.value.combatant.pokemon), fainted => {
  if (fainted) {
    const next = allies.value.findIndex(actor => !isFainted(actor.combatant.pokemon))
    if (next >= 0) activeIndex.value = next
  }
})

// D1.2.4 §5: the panel talks like a person, not like a data sheet.
const LONG: Record<StatusCondition, string> = {
  none: '',
  burn: 'Quemado',
  paralysis: 'Paralizado',
  poison: 'Envenenado',
  freeze: 'Congelado',
  sleep: 'Dormido',
}

const hpPct = (actor: BattleActor | undefined): number => (actor
  ? Math.max(0, Math.min(100, (actor.combatant.pokemon.hp / actor.combatant.pokemon.maxHp) * 100))
  : 0)

/**
 * The last thing that happened, rewritten for somebody who has never played a
 * Pokémon game. The engine's log is precise; this is the version you read while
 * the fight is running.
 */
const story = computed(() => {
  void props.rev
  const battle = props.battle
  if (battle.throw) return 'La Poké Ball está en el aire…'
  const last = battle.log[battle.log.length - 1]
  if (!last) return 'El combate empezó.'
  const who = last.actorId.startsWith('ally') ? 'Tu Pokémon' : 'El rival'
  const text = last.text

  const hurt = /^(.+?): (\d+) de daño/.exec(text)
  if (hurt) return `${who} usó ${hurt[1]} e hizo ${hurt[2]} de daño.`
  if (text.includes('Protección absorbió')) return `${who} bloqueó el ataque con Protección.`
  if (text.includes('escudo')) return `${who} se protegió.`
  if (text.startsWith('Estado: ')) {
    const mark = LONG[text.replace('Estado: ', '') as StatusCondition]
    return mark ? `${who} quedó ${mark.toLowerCase()}.` : `${who} sufrió un estado.`
  }
  if (text === 'Confusión') return `${who} quedó confundido.`
  if (text.startsWith('Confusión:')) return `${who} está confundido y se golpeó solo.`
  if (text.startsWith('Veneno:')) return `${who} perdió salud por el veneno.`
  if (text === 'Despertó') return `${who} se despertó.`
  if (text === 'Se debilitó') return `${who} ya no puede seguir.`
  if (text.startsWith('Combate:')) return `${who} no tiene PP: usó Combate y se lastimó.`
  if (text.includes('no tiene PP')) return `${who} se quedó sin PP en ese movimiento.`
  if (text.startsWith('Cambio:')) return 'Cambiaste de Pokémon.'
  if (text.startsWith('¡Capturado')) return '¡Lo atrapaste!'
  if (text.startsWith('Se escapó')) return 'La Poké Ball se abrió: se escapó.'
  if (text.includes('lanzada')) return 'Lanzaste una Poké Ball…'
  if (text.startsWith('Huida')) return 'Te alejaste del combate.'
  const item = /^(.+?): \+(\d+) (HP|PP)/.exec(text)
  if (item) return `Usaste ${item[1]}: +${item[2]} ${item[3]}.`
  return text
})

const nameOf = (actor: BattleActor | undefined): string =>
  actor ? speciesById(actor.combatant.pokemon.speciesId)?.name ?? '???' : ''
const hpOf = (actor: BattleActor | undefined): string =>
  actor ? `${Math.max(0, actor.combatant.pokemon.hp)}/${actor.combatant.pokemon.maxHp}` : ''

const moves = computed(() => (props.rev, active.value
  ? active.value.combatant.pokemon.moves.map(id => moveById(id)!).filter(Boolean)
  : []))

const isPrepared = (moveId: string): boolean =>
  active.value?.prepared.kind === 'move' && active.value.prepared.moveId === moveId

const ppOf = (moveId: string): number => active.value?.combatant.pokemon.pp[moveId] ?? 0
const ready = (actor: BattleActor): boolean => barOf(actor) > 0.92

function choose(action: PreparedAction): void {
  if (!active.value) return
  emit('choose', active.value.id, action)
  drawer.value = 'none'
}

const bagList = computed(() => Object.entries(props.bag)
  .filter(([, count]) => count > 0)
  .map(([id, count]) => ({ id, count, name: props.items[id]?.name ?? id })))
</script>

<template>
  <section class="cp">
    <header class="cp-foe">
      <b>{{ nameOf(foe) }}</b>
      <span>{{ hpOf(foe) }}</span>
      <em v-if="foe && foe.combatant.pokemon.status !== 'none'">{{ LONG[foe.combatant.pokemon.status] }}</em>
    </header>
    <div class="cp-bar"><i class="cp-bar--foe" :style="{ width: `${hpPct(foe)}%` }" /></div>

    <div v-if="allies.length > 1" class="cp-tabs">
      <button
        v-for="(ally, index) in allies" :key="ally.id" type="button"
        class="cp-tab" :class="{ 'cp-tab--on': index === activeIndex, 'cp-tab--ready': ready(ally) && index !== activeIndex }"
        @click="activeIndex = index"
      >{{ index === 0 ? 'A' : 'B' }} · {{ nameOf(ally) }}</button>
    </div>

    <header v-if="active" class="cp-mine">
      <b>{{ nameOf(active) }}</b>
      <span>{{ hpOf(active) }}</span>
      <em v-if="active.combatant.pokemon.status !== 'none'">{{ LONG[active.combatant.pokemon.status] }}</em>
    </header>
    <div class="cp-bar"><i class="cp-bar--mine" :style="{ width: `${hpPct(active)}%` }" /></div>

    <!-- D1.2.4 §5: what just happened, in words anyone can read. -->
    <p class="cp-log">{{ story }}</p>

    <div v-if="drawer === 'none'" class="cp-moves">
      <button
        v-for="move in moves" :key="move.id" type="button"
        class="cp-move" :class="{ 'cp-move--on': isPrepared(move.id) }"
        :disabled="ppOf(move.id) <= 0"
        @click="choose({ kind: 'move', moveId: move.id })"
      >
        <b>{{ move.name }}</b>
        <small>{{ ppOf(move.id) }}</small>
      </button>
    </div>

    <div v-else-if="drawer === 'bag'" class="cp-list">
      <button
        v-for="item in bagList" :key="item.id" type="button"
        @click="choose({ kind: 'item', itemId: item.id })"
      >{{ item.name }} <small>×{{ item.count }}</small></button>
      <p v-if="!bagList.length">Mochila vacía.</p>
    </div>

    <div v-else class="cp-list">
      <button
        v-for="member in bench" :key="member.instanceId" type="button"
        :disabled="isFainted(member)"
        @click="choose({ kind: 'switch', instanceId: member.instanceId })"
      >
        {{ speciesById(member.speciesId)?.name }}
        <small>{{ Math.max(0, member.hp) }}/{{ member.maxHp }}</small>
      </button>
      <p v-if="!bench.length">Sin relevo.</p>
    </div>

    <footer class="cp-tools">
      <button type="button" :class="{ 'cp-on': drawer === 'party' }" @click="drawer = drawer === 'party' ? 'none' : 'party'">Cambiar</button>
      <button type="button" class="cp-flee" @click="emit('flee')">Huir</button>
      <button type="button" :class="{ 'cp-on': drawer === 'bag' }" @click="drawer = drawer === 'bag' ? 'none' : 'bag'">Mochila</button>
    </footer>
  </section>
</template>

<style scoped>
.cp {
  width: 232px; padding: 7px 8px 8px; border: 1px solid #2e3a5e; border-radius: 10px;
  background: rgba(10, 15, 28, 0.92); color: #e8eeff; font-size: 0.72rem;
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.45); backdrop-filter: blur(2px);
}
.cp-foe, .cp-mine { display: flex; gap: 6px; align-items: baseline; }
.cp-foe { color: #ffb7a8; }
.cp-mine { margin-top: 4px; color: #b9ffd0; }
.cp-foe b, .cp-mine b { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.76rem; }
.cp-foe span, .cp-mine span { font-variant-numeric: tabular-nums; opacity: 0.85; }
.cp-foe em, .cp-mine em {
  padding: 0 4px; border-radius: 4px; background: #3a2740; color: #ffd6a8;
  font-size: 0.6rem; font-style: normal; font-weight: 700;
}

.cp-tabs { display: flex; gap: 4px; margin-top: 5px; }
.cp-tab {
  flex: 1; padding: 3px 4px; overflow: hidden; border: 1px solid #2b3a5e; border-radius: 6px;
  background: #121b31; color: #93a2c6; font: inherit; font-size: 0.62rem; white-space: nowrap;
  text-overflow: ellipsis; cursor: pointer;
}
.cp-tab--on { border-color: #d9a441; color: #ffe2a8; }
.cp-tab--ready { animation: cp-flash 0.8s ease-in-out infinite; }
@keyframes cp-flash { 50% { border-color: #6fb4ff; color: #cfe6ff; } }

.cp-moves { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 6px; }
.cp-move {
  display: flex; gap: 4px; align-items: baseline; justify-content: space-between;
  padding: 6px; border: 1px solid #2b3a5e; border-radius: 7px;
  background: #16203a; color: #e8eeff; font: inherit; font-size: 0.66rem; text-align: left; cursor: pointer;
}
.cp-move b { overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.cp-move small { opacity: 0.6; }
.cp-move--on { border-color: #d9a441; background: #22304f; }
.cp-move:disabled { opacity: 0.4; cursor: default; }

.cp-list { display: grid; gap: 4px; margin-top: 6px; max-height: 118px; overflow: auto; }
.cp-list button {
  display: flex; justify-content: space-between; padding: 6px; border: 1px solid #2b3a5e;
  border-radius: 7px; background: #16203a; color: #e8eeff; font: inherit; font-size: 0.66rem; cursor: pointer;
}
.cp-list button:disabled { opacity: 0.4; cursor: default; }
.cp-list p { margin: 0; color: #6b7ba8; }

.cp-bar {
  position: relative; height: 5px; margin-top: 3px; overflow: hidden;
  border-radius: 999px; background: #10162a;
}
.cp-bar i { position: absolute; inset: 0 auto 0 0; display: block; transition: width 0.2s linear; }
.cp-bar--foe { background: #e3735a; }
.cp-bar--mine { background: #57d86a; }
.cp-log {
  margin: 6px 0 0; min-height: 2.2em; padding: 4px 6px; border-radius: 6px;
  background: #0d1426; color: #cfe0ff; font-size: 0.66rem; line-height: 1.25;
}
.cp-tools { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; margin-top: 6px; }
.cp-tools .cp-flee { border-color: #7a4a3a; color: #ffc0a8; }
.cp-tools button {
  padding: 6px; border: 1px solid #2b3a5e; border-radius: 7px; background: #101a2e;
  color: #cfe0ff; font: inherit; font-size: 0.68rem; cursor: pointer;
}
.cp-tools .cp-on { border-color: #d9a441; color: #ffe2a8; }

@media (max-width: 420px) {
  .cp { width: min(214px, 60vw); font-size: 0.68rem; }
}
</style>
