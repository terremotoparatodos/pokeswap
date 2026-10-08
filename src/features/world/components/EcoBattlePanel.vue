<template>
  <!-- Not modal: the battle is in the world; this panel only carries the choices and the words.
       Space/Enter on its controls belong to them, never to the map (ECO-PRESENTATION-1 F2). -->
  <section ref="root" class="ebp" role="region" aria-label="Combate de prueba" tabindex="-1" @keydown.space.stop @keydown.enter.stop>
    <p class="ebp-kicker">Combate de prueba · sandbox</p>

    <template v-if="view.phase === 'engaging'">
      <p class="ebp-log" role="status">Pidiendo el encuentro al servidor…</p>
    </template>

    <template v-else-if="view.phase === 'refused'">
      <p class="ebp-log" role="status">{{ ecoRefusalText(view.reason) }}</p>
      <button type="button" class="ebp-primary" @click="session.dismiss()">Volver al mapa</button>
    </template>

    <template v-else-if="view.phase === 'battle' || view.phase === 'ended'">
      <article v-for="side in sides" :key="side.id" class="ebp-side" :class="side.mine ? 'ebp-side--mine' : 'ebp-side--foe'">
        <div class="ebp-row">
          <b>{{ side.name }}</b>
          <span v-if="side.mine" class="ebp-tag">fixture de prueba</span>
          <span v-else class="ebp-tag ebp-tag--wild">salvaje</span>
          <i class="ebp-hp">Nv. {{ side.level }} · {{ side.hp }}/{{ side.maxHp }} PS</i>
        </div>
        <div class="ebp-bar" role="meter" :aria-valuenow="side.hp" aria-valuemin="0" :aria-valuemax="side.maxHp" :aria-label="`PS de ${side.name}`">
          <i :style="{ width: `${side.pct}%`, background: side.pct > 50 ? '#5fd38a' : side.pct > 20 ? '#ffd27a' : '#ff7a6b' }" />
        </div>
        <span v-if="side.status" class="ebp-status">{{ side.status }}</span>
      </article>

      <template v-if="view.phase === 'battle'">
        <p v-if="!view.connected" class="ebp-log ebp-log--warn" role="status">Reconectando… el combate está en pausa.</p>
        <p v-else class="ebp-log">
          Tiempo restante {{ remainingLabel }}<template v-if="selectedName"> · se repite: {{ selectedName }}</template>
        </p>
        <div class="ebp-moves">
          <button
            v-for="move in moves" :key="move.id" type="button" class="ebp-move"
            :class="{ 'ebp-move--on': move.selected }" :style="{ '--tint': colourOfType(move.type) }"
            :disabled="!view.connected || move.pp <= 0" :title="move.category"
            @click="session.useMove(move.id, move.targetsUser)"
          >
            <span class="ebp-move-top"><CombatIcon :name="move.icon" /><b>{{ move.name }}</b></span>
            <span class="ebp-move-foot"><i class="ebp-pp"><em :style="{ width: `${move.ppPct}%` }" /></i><small>{{ move.pp }}</small></span>
          </button>
        </div>
        <button type="button" class="ebp-flee" :disabled="!view.connected" @click="session.flee()"><CombatIcon name="flee" /> Huir</button>
        <p v-if="view.lastRejection" class="ebp-log ebp-log--warn" role="status">El servidor no aceptó esa acción ({{ view.lastRejection }}).</p>
      </template>

      <template v-else>
        <h2 class="ebp-result">{{ outcome.title }}</h2>
        <p class="ebp-log" role="status">{{ outcome.detail }}</p>
        <button type="button" class="ebp-primary" :disabled="settling" @click="session.dismiss()">Volver al mapa</button>
      </template>
    </template>
  </section>
</template>

<script setup lang="ts">
// ECO-OVERWORLD-BATTLE-1 (experimental, development builds only): the battle's controls, in the
// visual language of the Dungeon prototype's CombatPopup (type colour per move, category icon, PP
// bar; its CombatIcon and type palette are reused as is). Decides nothing: numbers are the server's
// snapshot, a move or «Huir» is only a request. Replaces the provisional modal of ECO-PRESENTATION-1.
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, watch } from 'vue'
import type { BattleCatalogIndex } from '../../battle/catalog'
import { maxPPOf } from '../../pokemon/model/instance'
import CombatIcon, { type IconName } from '../../dungeonPrototype/components/CombatIcon.vue'
import { colourOfType } from '../../dungeonPrototype/render/worldOverlay'
import { ECO_OUTCOME_TEXT, ecoClock, ecoRefusalText, ecoSpeciesName } from '../domain/ecoBattleText'
import { PLAYER_COMBATANT, WILD_COMBATANT } from '../domain/ecoBattlePresentation'
import type { EcoBattleSession, EcoBattleView } from '../state/ecoBattleSession'

const props = defineProps<{
  session: EcoBattleSession
  view: EcoBattleView
  catalog: BattleCatalogIndex | null
  pokedexName?: (speciesId: number) => string | null
  /** Where the focus was when the battle was asked for (the card's or the debug panel's button). */
  returnFocus?: HTMLElement | null
}>()

const root = ref<HTMLElement | null>(null)
const tick = ref(0)
const timer = setInterval(() => { tick.value++ }, 500)
onUnmounted(() => clearInterval(timer))

const STATUS: Record<string, string> = { paralysis: 'paralizado', poison: 'envenenado', badlyPoisoned: 'gravemente envenenado', burn: 'quemado', sleep: 'dormido', freeze: 'congelado' }
const ICON: Record<string, IconName> = { physical: 'physical', special: 'special', status: 'status' }
const pretty = (name: string) => name.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
const nameOf = (speciesId: number) => ecoSpeciesName(speciesId, props.pokedexName?.(speciesId), props.catalog?.species(speciesId)?.name)
const snapshot = computed(() => (props.view.phase === 'battle' || props.view.phase === 'ended' ? props.view.snapshot : null))

const sides = computed(() => [WILD_COMBATANT, PLAYER_COMBATANT].flatMap(id => {
  const c = snapshot.value?.combatants[id]
  if (!c) return []
  const hp = Math.max(0, c.condition.currentHp ?? c.stats.hp)
  return [{
    id, mine: id === PLAYER_COMBATANT, name: nameOf(c.instance.speciesId), level: c.level, hp, maxHp: c.stats.hp,
    pct: Math.round((100 * hp) / Math.max(1, c.stats.hp)),
    status: c.condition.majorStatus === 'none' ? '' : (STATUS[c.condition.majorStatus] ?? c.condition.majorStatus),
  }]
}))

const moves = computed(() => {
  const c = snapshot.value?.combatants[PLAYER_COMBATANT]
  if (!c) return []
  const selected = c.runtime.selected?.kind === 'move' ? c.runtime.selected.moveId : null
  return c.instance.moves.map(slot => {
    const move = props.catalog?.move(slot.moveId)
    const max = move ? maxPPOf(move.pp ?? 0, slot.ppUps) : 1
    // `condition.pp` is sparse: an absent move is at full PP.
    const pp = c.condition.pp[slot.moveId] ?? max
    return {
      id: slot.moveId, name: move ? pretty(move.name) : `Movimiento ${slot.moveId}`, type: move?.type, category: move?.category ?? 'physical',
      icon: ICON[move?.category ?? 'physical'], targetsUser: move?.target === 'user', pp, ppPct: max > 0 ? Math.round((100 * pp) / max) : 0, selected: slot.moveId === selected,
    }
  })
})
const selectedName = computed(() => moves.value.find(m => m.selected)?.name ?? '')
const remainingLabel = computed(() => { void tick.value; return ecoClock(props.session.remainingMs()) })
const outcome = computed(() => (props.view.phase === 'ended' ? ECO_OUTCOME_TEXT[props.view.outcome] : { title: '', detail: '' }))

// The end can arrive while a move or «Huir» is being pressed: the result's button takes their place,
// so it ignores clicks for a moment (unchanged from ECO-PRESENTATION-1).
const RESULT_SETTLE_MS = 700
const settling = ref(false)
let settleTimer: ReturnType<typeof setTimeout> | null = null
watch(() => props.view.phase === 'ended', ended => {
  if (settleTimer) clearTimeout(settleTimer)
  settling.value = ended
  settleTimer = ended ? setTimeout(() => { settling.value = false }, RESULT_SETTLE_MS) : null
}, { immediate: true })
onUnmounted(() => { if (settleTimer) clearTimeout(settleTimer) })

// Focus, without trapping (the panel is not modal): it moves here when the battle is asked for, so
// the keyboard can go on; if a phase change removes the focused control, it stays in the panel;
// on close it goes back to where the battle was asked from, if that still exists (the debug
// button does — ECO-PRESENTATION-1 F3 residual), else it is released to the page.
const keepFocus = () => {
  const el = root.value
  if (el && (document.activeElement === document.body || document.activeElement === null)) el.focus()
}
onMounted(() => root.value?.focus())
watch(() => props.view.phase, () => nextTick(keepFocus))
onBeforeUnmount(() => {
  const target = props.returnFocus
  if (target && target.isConnected && !root.value?.contains(target)) target.focus()
  else if (root.value?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
})
</script>

<style scoped>
.ebp {
  position: absolute; right: 12px; bottom: 5.5rem; z-index: 12; box-sizing: border-box;
  width: min(272px, calc(100% - 24px)); padding: 8px; border: 1px solid #2e3a5e; border-radius: 12px;
  background: linear-gradient(180deg, rgba(16, 23, 42, 0.95), rgba(9, 13, 25, 0.95));
  color: #e8eeff; font-size: 0.74rem; box-shadow: 0 10px 26px rgba(0, 0, 0, 0.5);
}
.ebp:focus { outline: none; }
.ebp-kicker { margin: 0 0 6px; color: #9fb2da; font-size: 0.62rem; letter-spacing: 0.06em; text-transform: uppercase; }
.ebp-side { padding: 5px 6px; border: 1px solid #222d4c; border-radius: 8px; background: #0d1426; }
.ebp-side + .ebp-side { margin-top: 5px; }
.ebp-side--foe { border-color: #4a2b2b; }
.ebp-row { display: flex; gap: 5px; align-items: center; }
.ebp-row b { overflow: hidden; font-size: 0.78rem; text-overflow: ellipsis; white-space: nowrap; }
.ebp-tag { padding: 1px 5px; border-radius: 999px; background: #34404b; color: #ffd27a; font-size: 0.58rem; white-space: nowrap; }
.ebp-tag--wild { color: #ffb0a8; }
.ebp-hp { margin-left: auto; font-style: normal; font-variant-numeric: tabular-nums; white-space: nowrap; opacity: 0.85; }
.ebp-bar { position: relative; height: 6px; margin-top: 4px; overflow: hidden; border-radius: 999px; background: #080d1a; }
.ebp-bar i { position: absolute; inset: 0 auto 0 0; display: block; border-radius: 999px; transition: width 0.25s linear; }
.ebp-status { display: inline-block; margin-top: 4px; padding: 1px 6px; border: 1px solid #6b5a2e; border-radius: 999px; color: #ffd27a; font-size: 0.62rem; }
.ebp-log { margin: 6px 0 0; padding: 5px 7px; border-left: 2px solid #3a4a78; border-radius: 0 6px 6px 0; background: #0b1120; color: #cfe0ff; line-height: 1.3; }
.ebp-log--warn { border-left-color: #d9a441; color: #ffd27a; }
.ebp-moves { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-top: 6px; }
.ebp-move {
  display: grid; gap: 4px; min-height: 44px; padding: 6px 7px; border: 1px solid color-mix(in srgb, var(--tint) 38%, #223052);
  border-left: 3px solid var(--tint); border-radius: 7px; background: linear-gradient(180deg, color-mix(in srgb, var(--tint) 12%, #16203a), #141d34);
  color: #e8eeff; font: inherit; font-size: 0.7rem; text-align: left; cursor: pointer;
}
.ebp-move-top { display: flex; gap: 4px; align-items: center; color: var(--tint); }
.ebp-move-top b { overflow: hidden; color: #f0f4ff; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.ebp-move-foot { display: flex; gap: 5px; align-items: center; }
.ebp-pp { position: relative; flex: 1; height: 3px; overflow: hidden; border-radius: 999px; background: #0a1020; }
.ebp-pp em { position: absolute; inset: 0 auto 0 0; display: block; background: var(--tint); opacity: 0.8; }
.ebp-move small { font-variant-numeric: tabular-nums; opacity: 0.75; }
.ebp-move--on { border-color: #ffd27a; box-shadow: 0 0 0 1px rgba(255, 210, 122, 0.35); }
.ebp-move:disabled, .ebp-flee:disabled, .ebp-primary:disabled { opacity: 0.45; cursor: default; }
.ebp-flee, .ebp-primary { display: flex; gap: 4px; align-items: center; justify-content: center; width: 100%; min-height: 40px; margin-top: 6px; border-radius: 7px; font: inherit; font-weight: 700; cursor: pointer; }
.ebp-flee { border: 1px solid #7a4a3a; background: #101a2e; color: #ffc0a8; }
.ebp-primary { border: 0; background: #ffd27a; color: #101a36; }
.ebp-result { margin: 6px 0 0; font-size: 1.05rem; }
</style>
