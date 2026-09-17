<script setup lang="ts">
// The combat popup (D1.2 §11, §27 · D1.2.4 §5 · D1.2.4bis §4).
//
// The world already carries the fight: health, action bars and status pips are
// drawn over the Pokémon themselves. This panel carries what the world cannot —
// who is fighting, what just happened in plain words, which four moves are
// available, and the three things you can always do.
//
// D1.2.4bis §4: it is also meant to be read at a glance, so everything that can
// be a colour or a shape is one. A move wears its type as a colour and its
// category as an icon; PP is a bar as well as a number; a status is a chip with
// the icon of that condition; the HP bar changes colour as it drains.

import { computed, ref, watch } from 'vue'
import { speciesById } from '../data/speciesFixtures'
import { barOf, type BattleActor, type BattleState, type PreparedAction } from '../domain/battle'
import { moveById, type MoveDefinition } from '../domain/moves'
import { isFainted, type PokemonInstance, type StatusCondition } from '../domain/party'
import { colourOfType } from '../render/worldOverlay'
import CombatIcon, { type IconName } from './CombatIcon.vue'

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

/** Each condition has its own icon and its own colour, so it reads instantly. */
const STATUS_LOOK: Record<Exclude<StatusCondition, 'none'>, { icon: IconName; colour: string }> = {
  burn: { icon: 'burn', colour: '#ff8a5c' },
  paralysis: { icon: 'paralysis', colour: '#f8d030' },
  poison: { icon: 'poison', colour: '#c07ad0' },
  freeze: { icon: 'freeze', colour: '#9ad8d8' },
  sleep: { icon: 'sleep', colour: '#a3b2d8' },
}

const TYPE_NAME: Record<string, string> = {
  normal: 'Normal', fire: 'Fuego', water: 'Agua', electric: 'Eléctrico', grass: 'Planta',
  ice: 'Hielo', fighting: 'Lucha', poison: 'Veneno', ground: 'Tierra', flying: 'Volador',
  psychic: 'Psíquico', bug: 'Bicho', rock: 'Roca', ghost: 'Fantasma', dragon: 'Dragón',
  dark: 'Siniestro', steel: 'Acero', fairy: 'Hada',
}

const CATEGORY: Record<MoveDefinition['category'], { icon: IconName; label: string }> = {
  physical: { icon: 'physical', label: 'Físico' },
  special: { icon: 'special', label: 'Especial' },
  status: { icon: 'status', label: 'Estado' },
}

const hpPct = (actor: BattleActor | undefined): number => (actor
  ? Math.max(0, Math.min(100, (actor.combatant.pokemon.hp / actor.combatant.pokemon.maxHp) * 100))
  : 0)

/** Green, amber, red: the same reading the handheld gives you. */
const hpTone = (actor: BattleActor | undefined): string => {
  const pct = hpPct(actor)
  if (pct > 50) return '#57d86a'
  if (pct > 20) return '#f0c04a'
  return '#e3735a'
}

/** The icon that goes with the line being told. */
const storyIcon = computed<IconName>(() => {
  void props.rev
  if (props.battle.throw) return 'ball'
  const text = props.battle.log[props.battle.log.length - 1]?.text ?? ''
  if (text.includes('Protección') || text.includes('escudo')) return 'shield'
  if (text.startsWith('¡Capturado') || text.includes('lanzada') || text.startsWith('Se escapó')) return 'ball'
  if (text === 'Se debilitó') return 'skull'
  if (/\+\d+ (HP|PP)/.test(text)) return 'heart'
  if (text.startsWith('Cambio:')) return 'swap'
  if (text.startsWith('Huida')) return 'flee'
  if (text.startsWith('Estado: ') || text.startsWith('Veneno:') || text === 'Confusión') return 'status'
  return 'physical'
})

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
const typesOf = (actor: BattleActor | undefined): readonly string[] =>
  actor ? speciesById(actor.combatant.pokemon.speciesId)?.types ?? [] : []
const statusOf = (actor: BattleActor | undefined): Exclude<StatusCondition, 'none'> | null => {
  const status = actor?.combatant.pokemon.status ?? 'none'
  return status === 'none' ? null : status
}

const moves = computed(() => (props.rev, active.value
  ? active.value.combatant.pokemon.moves.map(id => moveById(id)!).filter(Boolean)
  : []))

const isPrepared = (moveId: string): boolean =>
  active.value?.prepared.kind === 'move' && active.value.prepared.moveId === moveId

const ppOf = (moveId: string): number => active.value?.combatant.pokemon.pp[moveId] ?? 0
const ppMax = (move: MoveDefinition): number => Math.max(1, move.pp)
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
    <!-- The foe, then us: the same order as the field. -->
    <article class="cp-side cp-side--foe">
      <div class="cp-row">
        <b>{{ nameOf(foe) }}</b>
        <span
          v-for="type in typesOf(foe)" :key="type" class="cp-type"
          :style="{ '--tint': colourOfType(type) }"
        >{{ TYPE_NAME[type] ?? type }}</span>
        <i class="cp-hp">{{ hpOf(foe) }}</i>
      </div>
      <div class="cp-bar">
        <i :style="{ width: `${hpPct(foe)}%`, background: hpTone(foe) }" />
      </div>
      <span
        v-if="statusOf(foe)" class="cp-status"
        :style="{ '--tint': STATUS_LOOK[statusOf(foe)!].colour }"
      >
        <CombatIcon :name="STATUS_LOOK[statusOf(foe)!].icon" />
        {{ LONG[statusOf(foe)!] }}
      </span>
    </article>

    <div v-if="allies.length > 1" class="cp-tabs">
      <button
        v-for="(ally, index) in allies" :key="ally.id" type="button"
        class="cp-tab"
        :class="{ 'cp-tab--on': index === activeIndex, 'cp-tab--ready': ready(ally) && index !== activeIndex }"
        @click="activeIndex = index"
      >{{ index === 0 ? 'A' : 'B' }} · {{ nameOf(ally) }}</button>
    </div>

    <article v-if="active" class="cp-side cp-side--mine">
      <div class="cp-row">
        <b>{{ nameOf(active) }}</b>
        <span
          v-for="type in typesOf(active)" :key="type" class="cp-type"
          :style="{ '--tint': colourOfType(type) }"
        >{{ TYPE_NAME[type] ?? type }}</span>
        <i class="cp-hp">{{ hpOf(active) }}</i>
      </div>
      <div class="cp-bar">
        <i :style="{ width: `${hpPct(active)}%`, background: hpTone(active) }" />
      </div>
      <span
        v-if="statusOf(active)" class="cp-status"
        :style="{ '--tint': STATUS_LOOK[statusOf(active)!].colour }"
      >
        <CombatIcon :name="STATUS_LOOK[statusOf(active)!].icon" />
        {{ LONG[statusOf(active)!] }}
      </span>
    </article>

    <!-- D1.2.4 §5: what just happened, in words anyone can read. -->
    <p class="cp-log">
      <CombatIcon :name="storyIcon" :size="13" />
      <span>{{ story }}</span>
    </p>

    <div v-if="drawer === 'none'" class="cp-moves">
      <button
        v-for="move in moves" :key="move.id" type="button"
        class="cp-move" :class="{ 'cp-move--on': isPrepared(move.id) }"
        :style="{ '--tint': colourOfType(move.type) }"
        :disabled="ppOf(move.id) <= 0"
        :title="`${TYPE_NAME[move.type] ?? move.type} · ${CATEGORY[move.category].label}`"
        @click="choose({ kind: 'move', moveId: move.id })"
      >
        <span class="cp-move-top">
          <CombatIcon :name="CATEGORY[move.category].icon" />
          <b>{{ move.name }}</b>
        </span>
        <span class="cp-move-foot">
          <i class="cp-pp"><em :style="{ width: `${(ppOf(move.id) / ppMax(move)) * 100}%` }" /></i>
          <small>{{ ppOf(move.id) }}</small>
        </span>
      </button>
    </div>

    <div v-else-if="drawer === 'bag'" class="cp-list">
      <button
        v-for="item in bagList" :key="item.id" type="button"
        @click="choose({ kind: 'item', itemId: item.id })"
      >
        <CombatIcon :name="item.id.includes('ball') ? 'ball' : 'heart'" />
        <span>{{ item.name }}</span>
        <small>×{{ item.count }}</small>
      </button>
      <p v-if="!bagList.length">Mochila vacía.</p>
    </div>

    <div v-else class="cp-list">
      <button
        v-for="member in bench" :key="member.instanceId" type="button"
        :disabled="isFainted(member)"
        @click="choose({ kind: 'switch', instanceId: member.instanceId })"
      >
        <CombatIcon :name="isFainted(member) ? 'skull' : 'swap'" />
        <span>{{ speciesById(member.speciesId)?.name }}</span>
        <small>{{ Math.max(0, member.hp) }}/{{ member.maxHp }}</small>
      </button>
      <p v-if="!bench.length">Sin relevo.</p>
    </div>

    <footer class="cp-tools">
      <button
        type="button" :class="{ 'cp-on': drawer === 'party' }"
        @click="drawer = drawer === 'party' ? 'none' : 'party'"
      >
        <CombatIcon name="swap" /> Cambiar
      </button>
      <button type="button" class="cp-flee" @click="emit('flee')">
        <CombatIcon name="flee" /> Huir
      </button>
      <button
        type="button" :class="{ 'cp-on': drawer === 'bag' }"
        @click="drawer = drawer === 'bag' ? 'none' : 'bag'"
      >
        <CombatIcon name="bag" /> Mochila
      </button>
    </footer>
  </section>
</template>

<style scoped>
.cp {
  width: 246px; padding: 8px; border: 1px solid #2e3a5e; border-radius: 12px;
  background: linear-gradient(180deg, rgba(16, 23, 42, 0.95), rgba(9, 13, 25, 0.95));
  color: #e8eeff; font-size: 0.72rem;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.5); backdrop-filter: blur(2px);
}

.cp-side { padding: 5px 6px; border: 1px solid #222d4c; border-radius: 8px; background: #0d1426; }
.cp-side--mine { margin-top: 5px; }
.cp-side--foe { border-color: #4a2b2b; }
.cp-row { display: flex; gap: 5px; align-items: center; }
.cp-row b { overflow: hidden; font-size: 0.76rem; text-overflow: ellipsis; white-space: nowrap; }
.cp-hp { margin-left: auto; font-style: normal; font-variant-numeric: tabular-nums; opacity: 0.85; }

.cp-type {
  padding: 1px 5px; border-radius: 999px;
  background: color-mix(in srgb, var(--tint) 26%, transparent);
  color: var(--tint); font-size: 0.56rem; font-weight: 800;
  letter-spacing: 0.02em; text-transform: uppercase;
}

.cp-status {
  display: inline-flex; gap: 3px; align-items: center; margin-top: 4px; padding: 1px 6px;
  border: 1px solid color-mix(in srgb, var(--tint) 50%, transparent); border-radius: 999px;
  color: var(--tint); font-size: 0.6rem; font-weight: 700;
}

.cp-bar {
  position: relative; height: 6px; margin-top: 4px; overflow: hidden;
  border-radius: 999px; background: #080d1a; box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.6);
}
.cp-bar i {
  position: absolute; inset: 0 auto 0 0; display: block;
  border-radius: 999px; transition: width 0.25s linear, background 0.25s linear;
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

.cp-log {
  display: flex; gap: 6px; align-items: flex-start; margin: 6px 0 0; min-height: 2.4em;
  padding: 5px 7px; border-left: 2px solid #3a4a78; border-radius: 0 6px 6px 0;
  background: #0b1120; color: #cfe0ff; font-size: 0.66rem; line-height: 1.3;
}
.cp-log > svg { margin-top: 1px; color: #8fb0ff; }

.cp-moves { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-top: 6px; }
.cp-move {
  display: grid; gap: 4px; padding: 6px 7px;
  border: 1px solid color-mix(in srgb, var(--tint) 38%, #223052);
  border-left: 3px solid var(--tint); border-radius: 7px;
  background: linear-gradient(180deg, color-mix(in srgb, var(--tint) 12%, #16203a), #141d34);
  color: #e8eeff; font: inherit; font-size: 0.66rem; text-align: left; cursor: pointer;
}
.cp-move-top { display: flex; gap: 4px; align-items: center; color: var(--tint); }
.cp-move-top b {
  overflow: hidden; color: #f0f4ff; font-weight: 600; text-overflow: ellipsis; white-space: nowrap;
}
.cp-move-foot { display: flex; gap: 5px; align-items: center; }
.cp-pp {
  position: relative; flex: 1; height: 3px; overflow: hidden; border-radius: 999px; background: #0a1020;
}
.cp-pp em { position: absolute; inset: 0 auto 0 0; display: block; background: var(--tint); opacity: 0.8; }
.cp-move small { font-variant-numeric: tabular-nums; opacity: 0.7; }
.cp-move--on { border-color: #ffd27a; box-shadow: 0 0 0 1px rgba(255, 210, 122, 0.35); }
.cp-move:disabled { opacity: 0.38; cursor: default; }

.cp-list { display: grid; gap: 4px; margin-top: 6px; max-height: 122px; overflow: auto; }
.cp-list button {
  display: flex; gap: 6px; align-items: center; padding: 6px; border: 1px solid #2b3a5e;
  border-radius: 7px; background: #16203a; color: #e8eeff; font: inherit; font-size: 0.66rem; cursor: pointer;
}
.cp-list button span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-list button small { font-variant-numeric: tabular-nums; opacity: 0.7; }
.cp-list button:disabled { opacity: 0.4; cursor: default; }
.cp-list p { margin: 0; color: #6b7ba8; }

.cp-tools { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; margin-top: 6px; }
.cp-tools button {
  display: flex; gap: 4px; align-items: center; justify-content: center;
  padding: 6px 4px; border: 1px solid #2b3a5e; border-radius: 7px; background: #101a2e;
  color: #cfe0ff; font: inherit; font-size: 0.66rem; cursor: pointer;
}
.cp-tools .cp-flee { border-color: #7a4a3a; color: #ffc0a8; }
.cp-tools .cp-on { border-color: #d9a441; color: #ffe2a8; }

@media (max-width: 420px) {
  .cp { width: min(224px, 62vw); font-size: 0.68rem; }
  .cp-type { display: none; }
}
</style>
