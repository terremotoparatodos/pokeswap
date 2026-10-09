<template>
  <!-- Not modal: the battle is in the world; this panel only carries the choices and the words.
       Space/Enter on its controls belong to them, never to the map (ECO-PRESENTATION-1 F2).
       ECO-BATTLE-PANEL-1: compact and see-through, anchored beside its battle (`anchor`). -->
  <section ref="root" class="ebp" :style="anchorStyle" role="region" aria-label="Combate de prueba" tabindex="-1" @keydown.space.stop @keydown.enter.stop>
    <p class="ebp-kicker">
      <span>Combate de prueba</span>
      <span v-if="view.phase === 'battle' && view.connected" class="ebp-time" :title="`Tiempo restante ${remainingLabel}`">{{ remainingLabel }}</span>
    </p>

    <template v-if="view.phase === 'engaging'">
      <p class="ebp-log" role="status">Pidiendo el encuentro al servidor…</p>
    </template>

    <template v-else-if="view.phase === 'refused'">
      <p class="ebp-log" role="status">{{ ecoRefusalText(view.reason) }}</p>
      <button type="button" class="ebp-primary" @click="session.dismiss()">Volver al mapa</button>
    </template>

    <template v-else-if="view.phase === 'battle'">
      <div class="ebp-body">
        <div class="ebp-moves" role="group" aria-label="Movimientos">
          <button
            v-for="move in moves" :key="move.id" type="button" class="ebp-move"
            :class="{ 'ebp-move--on': move.selected, 'ebp-move--out': move.pp <= 0 }" :style="{ '--tint': colourOfType(move.type) }"
            :disabled="!view.connected || move.pp <= 0" :aria-pressed="move.selected" :title="move.category"
            @click="session.useMove(move.id, move.targetsUser)"
          >
            <CombatIcon :name="move.icon" />
            <b class="ebp-move-name">{{ move.name }}</b>
            <span class="ebp-move-pp"><template v-if="move.pp > 0">PP <small>{{ move.pp }}</small></template><template v-else>Sin PP</template></span>
          </button>
        </div>
        <button
          type="button" class="ebp-info" :class="{ 'ebp-info--on': info }"
          :aria-expanded="info" aria-controls="ebp-details" @click="info = !info"
        >Info</button>
      </div>
      <button type="button" class="ebp-flee" :disabled="!view.connected" @click="session.flee()"><CombatIcon name="flee" /> Huir</button>
      <p v-if="!view.connected" class="ebp-log ebp-log--warn" role="status">Reconectando… el combate está en pausa.</p>
      <p v-if="view.lastRejection" class="ebp-log ebp-log--warn" role="status">El servidor no aceptó esa acción ({{ view.lastRejection }}).</p>

      <div v-if="info" id="ebp-details" class="ebp-details">
        <article v-for="entry in sides" :key="entry.id" class="ebp-side" :class="entry.mine ? 'ebp-side--mine' : 'ebp-side--foe'">
          <div class="ebp-row">
            <b>{{ entry.name }}</b>
            <span v-if="entry.mine" class="ebp-tag">fixture de prueba</span>
            <span v-else class="ebp-tag ebp-tag--wild">salvaje</span>
          </div>
          <div class="ebp-row ebp-row--sub">
            <i class="ebp-hp">Nv. {{ entry.level }} · {{ entry.hp }}/{{ entry.maxHp }} PS</i>
            <span v-if="entry.status" class="ebp-status">{{ entry.status }}</span>
          </div>
          <div class="ebp-bar" role="meter" :aria-valuenow="entry.hp" aria-valuemin="0" :aria-valuemax="entry.maxHp" :aria-label="`PS de ${entry.name}`">
            <i :style="{ width: `${entry.pct}%`, background: entry.pct > 50 ? '#5fd38a' : entry.pct > 20 ? '#ffd27a' : '#ff7a6b' }" />
          </div>
          <div class="ebp-bar ebp-bar--cd" role="meter" :aria-valuenow="entry.ready" aria-valuemin="0" aria-valuemax="100" :aria-label="`Recarga de ${entry.name}`">
            <i :style="{ width: `${entry.ready}%` }" />
          </div>
        </article>
        <p class="ebp-log">
          Tiempo restante {{ remainingLabel }}<template v-if="selectedName"> · se repite: {{ selectedName }}</template>
        </p>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
// ECO-OVERWORLD-BATTLE-1 (experimental, development builds only): the battle's controls, in the
// visual language of the Dungeon prototype's CombatPopup (type colour per move, category icon, PP
// bar; its CombatIcon and type palette are reused as is). Decides nothing: numbers are the server's
// snapshot, a move or «Huir» is only a request. Replaces the provisional modal of ECO-PRESENTATION-1.
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, watch, type CSSProperties } from 'vue'
import type { BattleCatalogIndex } from '../../battle/catalog'
import { maxPPOf } from '../../pokemon/model/instance'
import CombatIcon, { type IconName } from '../../dungeonPrototype/components/CombatIcon.vue'
import { colourOfType } from '../../dungeonPrototype/render/worldOverlay'
import { ecoClock, ecoRefusalText, ecoSpeciesName } from '../domain/ecoBattleText'
import { PLAYER_COMBATANT, WILD_COMBATANT, presentCombatant } from '../domain/ecoBattlePresentation'
import type { ScreenPoint } from '../domain/ecoBattlePanelPlacement'
import type { EcoBattleSession, EcoBattleView } from '../state/ecoBattleSession'

const props = defineProps<{
  session: EcoBattleSession
  view: EcoBattleView
  catalog: BattleCatalogIndex | null
  pokedexName?: (speciesId: number) => string | null
  /** Where the focus was when the battle was asked for (the card's or the debug panel's button). */
  returnFocus?: HTMLElement | null
  /**
   * ECO-BATTLE-PANEL-1: the panel's top-left corner beside its battle (canvas CSS px), kept by the
   * layer; null (no scene on screen yet) leaves it in its fallback corner.
   */
  anchor?: ScreenPoint | null
  /** A valid destination on the map (the game canvas) when the origin is gone or unusable. */
  mapFocus?: () => HTMLElement | null
}>()

const root = ref<HTMLElement | null>(null)
// The layer measures the panel to keep it on screen beside the battle.
defineExpose({ root })
const anchorStyle = computed((): CSSProperties => (props.anchor
  ? { left: `${props.anchor.x}px`, top: `${props.anchor.y}px`, right: 'auto', bottom: 'auto' }
  : {}))
/** ECO-BATTLE-PANEL-1: life, recharge and the rest, opened only by the player, inside this panel. */
const info = ref(false)
const tick = ref(0)
const timer = setInterval(() => { tick.value++ }, 250)
onUnmounted(() => clearInterval(timer))

const STATUS: Record<string, string> = { paralysis: 'paralizado', poison: 'envenenado', badlyPoisoned: 'gravemente envenenado', burn: 'quemado', sleep: 'dormido', freeze: 'congelado' }
const ICON: Record<string, IconName> = { physical: 'physical', special: 'special', status: 'status' }
const pretty = (name: string) => name.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
const nameOf = (speciesId: number) => ecoSpeciesName(speciesId, props.pokedexName?.(speciesId), props.catalog?.species(speciesId)?.name)
const snapshot = computed(() => (props.view.phase === 'battle' ? props.view.snapshot : null))

const sides = computed(() => [WILD_COMBATANT, PLAYER_COMBATANT].flatMap(id => {
  const c = snapshot.value?.combatants[id]
  if (!c) return []
  // The recharge: the action bar the world draws, interpolated the same way.
  void tick.value
  const view = props.view
  const shown = view.phase === 'battle' ? presentCombatant(view.snapshot, id, { receivedAt: view.snapshotAt, now: props.session.clock(), connected: view.connected }) : null
  const hp = Math.max(0, c.condition.currentHp ?? c.stats.hp)
  return [{
    id, mine: id === PLAYER_COMBATANT, name: nameOf(c.instance.speciesId), level: c.level, hp, maxHp: c.stats.hp,
    pct: Math.round((100 * hp) / Math.max(1, c.stats.hp)),
    status: c.condition.majorStatus === 'none' ? '' : (STATUS[c.condition.majorStatus] ?? c.condition.majorStatus),
    ready: Math.round(100 * (shown?.actionFill ?? 0)),
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
// ECO-BATTLE-ENDING-1: the end is no longer shown here. The panel leaves the moment the server's end
// arrives (the layer stops holding the player), so no result button needs a settling guard.

// Focus, without trapping or containment (the panel is NOT modal: Tab leaves it freely, nothing is
// made inert): it moves here when the battle is asked for, so the keyboard can go on; if a phase
// change removes the focused control, it lands on the panel again; on close it goes back to the
// control the battle was asked from IF it still exists and is usable (connected, enabled, not inert,
// not hidden) — the debug button included, ECO-PRESENTATION-1's closure residual F3 — and otherwise
// to a valid destination on the map (the game canvas).
const keepFocus = () => {
  const el = root.value
  if (el && (document.activeElement === document.body || document.activeElement === null)) el.focus()
}
onMounted(() => root.value?.focus())
watch(() => props.view.phase, () => nextTick(keepFocus))
function usable(el: HTMLElement | null | undefined): el is HTMLElement {
  if (!el || !el.isConnected || root.value?.contains(el)) return false
  if ((el as HTMLButtonElement).disabled || el.closest('[inert]')) return false
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden' || node.hidden) return false
  }
  return true
}
onBeforeUnmount(() => {
  const target = props.returnFocus
  if (usable(target)) { target.focus(); return }
  const map = props.mapFocus?.()
  if (map && map.isConnected) map.focus({ preventScroll: true })
  else if (root.value?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
})
</script>

<style scoped>
/* ECO-BATTLE-PANEL-1: compact and see-through; beside its battle when anchored, else this corner. */
.ebp {
  position: absolute; right: 12px; bottom: 5.5rem; z-index: 12; box-sizing: border-box;
  width: 184px; padding: 6px; border: 1px solid rgba(70, 90, 140, 0.55); border-radius: 10px;
  background: rgba(9, 13, 25, 0.66); backdrop-filter: blur(2px);
  color: #e8eeff; font-size: 0.7rem; box-shadow: 0 6px 16px rgba(0, 0, 0, 0.35);
}
.ebp:focus { outline: none; }
.ebp-kicker { display: flex; justify-content: space-between; margin: 0 0 5px; color: #9fb2da; font-size: 0.58rem; letter-spacing: 0.06em; text-transform: uppercase; }
.ebp-time { font-variant-numeric: tabular-nums; letter-spacing: 0; }
.ebp-body { display: flex; gap: 4px; }
.ebp-moves { display: flex; flex: 1; flex-direction: column; gap: 3px; min-width: 0; }
.ebp-move {
  display: grid; grid-template-columns: auto 1fr auto; gap: 4px; align-items: center; min-height: 28px; padding: 3px 5px;
  border: 1px solid color-mix(in srgb, var(--tint) 40%, rgba(34, 48, 82, 0.8)); border-left: 3px solid var(--tint); border-radius: 6px;
  background: rgba(20, 29, 52, 0.78); color: var(--tint); font: inherit; font-size: 0.68rem; text-align: left; cursor: pointer;
}
.ebp-move-name { overflow: hidden; color: #f0f4ff; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.ebp-move-pp { color: #cfd8f0; font-size: 0.6rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ebp-move small { font-size: inherit; }
.ebp-move--on { border-color: #ffd27a; background: rgba(60, 52, 28, 0.85); box-shadow: 0 0 0 1px rgba(255, 210, 122, 0.45); }
.ebp-move--on .ebp-move-name::before { content: '▸ '; color: #ffd27a; }
.ebp-move--out .ebp-move-pp { color: #ff9d8f; }
.ebp-info {
  width: 22px; padding: 0; border: 1px solid rgba(90, 110, 160, 0.7); border-radius: 6px; background: rgba(20, 29, 52, 0.78);
  color: #cfe0ff; font: inherit; font-size: 0.6rem; font-weight: 700; letter-spacing: 0.08em; writing-mode: vertical-rl; cursor: pointer;
}
.ebp-info--on { border-color: #8fb0ff; background: #2c4a8f; color: #fff; }
.ebp-move:disabled, .ebp-flee:disabled, .ebp-primary:disabled { opacity: 0.45; cursor: default; }
.ebp-flee, .ebp-primary { display: flex; gap: 4px; align-items: center; justify-content: center; width: 100%; min-height: 28px; margin-top: 4px; border-radius: 6px; font: inherit; font-weight: 700; cursor: pointer; }
.ebp-flee { border: 1px solid rgba(122, 74, 58, 0.9); background: rgba(16, 26, 46, 0.78); color: #ffc0a8; }
.ebp-primary { border: 0; background: #ffd27a; color: #101a36; }
.ebp-log { margin: 4px 0 0; padding: 3px 5px; border-left: 2px solid #3a4a78; border-radius: 0 5px 5px 0; background: rgba(11, 17, 32, 0.8); color: #cfe0ff; line-height: 1.25; }
.ebp-log--warn { border-left-color: #d9a441; color: #ffd27a; }
.ebp-details { margin-top: 5px; }
.ebp-side { padding: 4px 5px; border: 1px solid rgba(34, 45, 76, 0.9); border-radius: 6px; background: rgba(13, 20, 38, 0.8); }
.ebp-side + .ebp-side { margin-top: 4px; }
.ebp-side--foe { border-color: rgba(74, 43, 43, 0.9); }
.ebp-row { display: flex; gap: 4px; align-items: center; }
.ebp-row b { overflow: hidden; font-size: 0.72rem; text-overflow: ellipsis; white-space: nowrap; }
.ebp-row--sub { justify-content: space-between; margin-top: 2px; }
.ebp-tag { padding: 0 4px; border-radius: 999px; background: #34404b; color: #ffd27a; font-size: 0.55rem; white-space: nowrap; }
.ebp-tag--wild { color: #ffb0a8; }
.ebp-hp { font-style: normal; font-variant-numeric: tabular-nums; white-space: nowrap; opacity: 0.9; }
.ebp-status { padding: 0 5px; border: 1px solid #6b5a2e; border-radius: 999px; color: #ffd27a; font-size: 0.58rem; }
.ebp-bar { position: relative; height: 5px; margin-top: 3px; overflow: hidden; border-radius: 999px; background: #080d1a; }
.ebp-bar i { position: absolute; inset: 0 auto 0 0; display: block; border-radius: 999px; transition: width 0.25s linear; }
.ebp-bar--cd { height: 3px; }
.ebp-bar--cd i { background: #8fb0ff; transition: none; }
</style>
