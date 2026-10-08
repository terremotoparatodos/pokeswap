<template>
  <div class="eco-battle-backdrop">
    <section ref="dialog" class="eco-battle" role="dialog" aria-modal="true" aria-label="Combate de prueba" tabindex="-1" @keydown="onKeydown">
      <p class="eco-battle__kicker">Combate de prueba · sandbox de desarrollo</p>

      <template v-if="view.phase === 'engaging'">
        <p class="eco-battle__message" role="status">Pidiendo el encuentro al servidor…</p>
      </template>

      <template v-else-if="view.phase === 'refused'">
        <h2>No se pudo combatir</h2>
        <p class="eco-battle__message" role="status">{{ ecoRefusalText(view.reason) }}</p>
        <button class="eco-battle__primary" @click="session.dismiss()">Volver al mapa</button>
      </template>

      <template v-else-if="view.phase === 'battle' || view.phase === 'ended'">
        <div v-if="wild" class="eco-battle__side eco-battle__side--wild">
          <div class="eco-battle__info">
            <p class="eco-battle__name">{{ wild.name }} <span>salvaje</span></p>
            <p class="eco-battle__level">Nv. {{ wild.level }}<template v-if="wild.status"> · {{ wild.status }}</template></p>
            <div class="eco-battle__bar" role="meter" :aria-valuenow="wild.hp" aria-valuemin="0" :aria-valuemax="wild.maxHp" :aria-label="`PS de ${wild.name}`">
              <div :class="barClass(wild)" :style="{ width: `${pct(wild)}%` }" />
            </div>
            <p class="eco-battle__hp">{{ wild.hp }} / {{ wild.maxHp }} PS</p>
          </div>
          <EcoSprite :species-id="wild.speciesId" facing="down" :size="96" :label="wild.name" />
        </div>

        <div v-if="player" class="eco-battle__side eco-battle__side--player">
          <EcoSprite :species-id="player.speciesId" facing="up" :size="96" :label="`${player.name} (de espaldas)`" />
          <div class="eco-battle__info">
            <p class="eco-battle__name">{{ player.name }} <span class="eco-battle__fixture">fixture de prueba</span></p>
            <p class="eco-battle__level">Nv. {{ player.level }}<template v-if="player.status"> · {{ player.status }}</template></p>
            <div class="eco-battle__bar" role="meter" :aria-valuenow="player.hp" aria-valuemin="0" :aria-valuemax="player.maxHp" :aria-label="`PS de ${player.name}`">
              <div :class="barClass(player)" :style="{ width: `${pct(player)}%` }" />
            </div>
            <p class="eco-battle__hp">{{ player.hp }} / {{ player.maxHp }} PS</p>
          </div>
        </div>

        <template v-if="view.phase === 'battle'">
          <p v-if="!view.connected" class="eco-battle__banner" role="status">Reconectando… el combate está en pausa.</p>
          <p v-else class="eco-battle__meta">
            Tiempo restante {{ remainingLabel }}<template v-if="selectedName"> · elegido: {{ selectedName }}</template>
          </p>
          <div class="eco-battle__moves">
            <button v-for="move in moves" :key="move.id" :disabled="!view.connected || move.pp <= 0" @click="session.useMove(move.id, move.targetsUser)">
              <span>{{ move.name }}</span>
              <small>{{ move.pp }} PP</small>
            </button>
          </div>
          <button class="eco-battle__flee" :disabled="!view.connected" @click="session.flee()">Huir</button>
          <p v-if="view.lastRejection" class="eco-battle__rejected" role="status">El servidor no aceptó esa acción ({{ view.lastRejection }}).</p>
        </template>

        <template v-else>
          <h2 class="eco-battle__result">{{ outcome.title }}</h2>
          <p class="eco-battle__message" role="status">{{ outcome.detail }}</p>
          <button class="eco-battle__primary" :disabled="settling" @click="session.dismiss()">Volver al mapa</button>
        </template>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
// ECO-PRESENTATION-1 (experimental, development builds only): the test battle on screen — the
// server's snapshot drawn with the bundled overworld sprites, the player's move choices and «Huir».
// It decides nothing: every number comes from the server's snapshot; a choice is only a request.
import { computed, onBeforeUnmount, onMounted, onUnmounted, onUpdated, ref, watch } from 'vue'
import type { BattleCatalogIndex } from '../../battle/catalog'
import { maxPPOf } from '../../pokemon/model/instance'
import { ECO_OUTCOME_TEXT, ecoClock, ecoRefusalText, ecoSpeciesName } from '../domain/ecoBattleText'
import { PLAYER_COMBATANT, WILD_COMBATANT } from '../state/ecoBattleSession'
import type { EcoBattleSession, EcoBattleView } from '../state/ecoBattleSession'
import EcoSprite from './EcoSprite.vue'

const props = defineProps<{
  session: EcoBattleSession
  view: EcoBattleView
  catalog: BattleCatalogIndex | null
  /** Spanish names when the Pokédex is loaded (null in the sandbox: catalog names then). */
  pokedexName?: (speciesId: number) => string | null
}>()

// The remaining time is a local estimate between server messages: redraw it twice a second.
const tick = ref(0)
const timer = setInterval(() => { tick.value++ }, 500)
onUnmounted(() => clearInterval(timer))

const STATUS: Record<string, string> = { paralysis: 'paralizado', poison: 'envenenado', badlyPoisoned: 'gravemente envenenado', burn: 'quemado', sleep: 'dormido', freeze: 'congelado' }
const pretty = (name: string) => name.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
const nameOf = (speciesId: number) => ecoSpeciesName(speciesId, props.pokedexName?.(speciesId), props.catalog?.species(speciesId)?.name)

const snapshot = computed(() => (props.view.phase === 'battle' || props.view.phase === 'ended' ? props.view.snapshot : null))

function side(id: string) {
  const c = snapshot.value?.combatants[id]
  if (!c) return null
  return {
    speciesId: c.instance.speciesId, name: nameOf(c.instance.speciesId), level: c.level,
    hp: Math.max(0, c.condition.currentHp ?? c.stats.hp), maxHp: c.stats.hp,
    status: c.condition.majorStatus === 'none' ? '' : (STATUS[c.condition.majorStatus] ?? c.condition.majorStatus),
  }
}
const player = computed(() => side(PLAYER_COMBATANT))
const wild = computed(() => side(WILD_COMBATANT))
const pct = (s: { hp: number; maxHp: number }) => Math.round((100 * s.hp) / Math.max(1, s.maxHp))
const barClass = (s: { hp: number; maxHp: number }) => (pct(s) > 50 ? 'is-high' : pct(s) > 20 ? 'is-mid' : 'is-low')

const moves = computed(() => {
  const c = snapshot.value?.combatants[PLAYER_COMBATANT]
  if (!c) return []
  return c.instance.moves.map(slot => {
    const move = props.catalog?.move(slot.moveId)
    // `condition.pp` is sparse: an absent move is at full PP.
    const pp = c.condition.pp[slot.moveId] ?? (move ? maxPPOf(move.pp ?? 0, slot.ppUps) : 1)
    return { id: slot.moveId, name: move ? pretty(move.name) : `Movimiento ${slot.moveId}`, targetsUser: move?.target === 'user', pp }
  })
})

const selectedName = computed(() => {
  const selected = snapshot.value?.combatants[PLAYER_COMBATANT]?.runtime.selected
  if (selected?.kind !== 'move') return ''
  const move = props.catalog?.move(selected.moveId)
  return move ? pretty(move.name) : `#${selected.moveId}`
})

// The end can arrive while the player is pressing a move or «Huir»: the result's button takes their
// place, so it ignores clicks for a moment — nobody dismisses a result they never saw.
const RESULT_SETTLE_MS = 700
const settling = ref(false)
let settleTimer: ReturnType<typeof setTimeout> | null = null
watch(() => props.view.phase === 'ended', ended => {
  if (settleTimer) clearTimeout(settleTimer)
  settling.value = ended
  settleTimer = ended ? setTimeout(() => { settling.value = false }, RESULT_SETTLE_MS) : null
}, { immediate: true })
onUnmounted(() => { if (settleTimer) clearTimeout(settleTimer) })

// ── Modal focus: the dialog takes the focus when it opens, keeps Tab / Shift+Tab inside, pulls back any
// focus that lands outside it (the debug panel, the HUD) while it is open, and gives the focus back to
// where it was — or releases it to the page — when it closes. The engine is paused by the view.
const dialog = ref<HTMLElement | null>(null)
let returnFocus: HTMLElement | null = null
const focusables = () => [...(dialog.value?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])') ?? [])]
const keepFocusInside = () => {
  const el = dialog.value
  if (el && !el.contains(document.activeElement)) el.focus()
}
const onFocusIn = (event: FocusEvent) => {
  if (dialog.value && event.target instanceof Node && !dialog.value.contains(event.target)) dialog.value.focus()
}
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const items = focusables()
  if (!items.length) { event.preventDefault(); dialog.value?.focus(); return }
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  if (event.shiftKey && (active === first || active === dialog.value)) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus() }
}
onMounted(() => {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  dialog.value?.focus()
  document.addEventListener('focusin', onFocusIn)
})
// A phase change (request → battle → result) replaces the focused control: the focus stays in the dialog.
onUpdated(keepFocusInside)
onBeforeUnmount(() => {
  document.removeEventListener('focusin', onFocusIn)
  const target = returnFocus
  returnFocus = null
  // Back to where it was if that still exists outside the dialog (e.g. the canvas); the card's
  // «Combatir» is gone by now, so then the focus is released to the page (the map keys still work).
  if (target && target.isConnected && !dialog.value?.contains(target)) target.focus()
  else if (dialog.value?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
})

const remainingLabel = computed(() => { void tick.value; return ecoClock(props.session.remainingMs()) })
const outcome = computed(() => (props.view.phase === 'ended' ? ECO_OUTCOME_TEXT[props.view.outcome] : { title: '', detail: '' }))
</script>

<style scoped>
/* Above the debug panel (20) and the HUD menu (15), below the connection overlay (50): the dialog is modal. */
.eco-battle-backdrop { position: absolute; inset: 0; z-index: 21; display: grid; place-items: center; padding: 1rem; background: rgba(6, 10, 22, .55); }
.eco-battle:focus { outline: none; }
.eco-battle { box-sizing: border-box; width: min(420px, 100%); max-height: calc(100% - 1rem); overflow: auto; padding: 1rem; border: 2px solid #3a5fb8; border-radius: 14px; background: rgba(16, 26, 54, .97); color: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.45); }
h2, p { margin: 0; }
.eco-battle__kicker { color: #9fb2da; font-size: .72rem; text-transform: uppercase; letter-spacing: .06em; margin-bottom: .6rem; }
.eco-battle__side { display: flex; align-items: center; gap: .75rem; padding: .5rem; border-radius: 10px; background: rgba(255,255,255,.05); }
.eco-battle__side + .eco-battle__side { margin-top: .5rem; }
.eco-battle__side--wild .eco-battle__info { flex: 1; }
.eco-battle__side--player .eco-battle__info { flex: 1; }
.eco-battle__name { font-weight: 700; font-size: 1.05rem; }
.eco-battle__name span { color: #9fb2da; font-weight: 400; font-size: .8rem; }
.eco-battle__name .eco-battle__fixture { padding: .05rem .4rem; border-radius: 999px; background: #34404b; color: #ffd27a; }
.eco-battle__level, .eco-battle__hp { color: #dce6ff; font-size: .8rem; }
.eco-battle__bar { height: 8px; margin: .3rem 0 .2rem; border-radius: 4px; background: rgba(255,255,255,.15); overflow: hidden; }
.eco-battle__bar > div { height: 100%; transition: width .25s; }
.is-high { background: #5fd38a; } .is-mid { background: #ffd27a; } .is-low { background: #ff7a6b; }
.eco-battle__meta, .eco-battle__banner, .eco-battle__rejected { margin-top: .6rem; color: #dce6ff; font-size: .85rem; }
.eco-battle__banner { padding: .4rem .6rem; border-radius: 8px; background: rgba(255, 210, 122, .15); color: #ffd27a; }
.eco-battle__rejected { color: #ffd27a; }
.eco-battle__moves { display: grid; grid-template-columns: 1fr 1fr; gap: .4rem; margin-top: .6rem; }
.eco-battle__moves button { display: flex; justify-content: space-between; align-items: center; gap: .4rem; min-height: 44px; padding: .4rem .6rem; border: 0; border-radius: 9px; background: #dfe8ff; color: #101a36; font: inherit; font-weight: 700; cursor: pointer; text-align: left; }
.eco-battle__moves small { font-weight: 400; opacity: .75; white-space: nowrap; }
.eco-battle button:disabled { background: #34404b; color: #c9d3da; cursor: default; }
.eco-battle__flee, .eco-battle__primary { width: 100%; min-height: 44px; margin-top: .5rem; border: 0; border-radius: 9px; font: inherit; font-weight: 700; cursor: pointer; }
.eco-battle__flee { background: transparent; border: 1px solid #5a6874; color: #dce6ff; }
.eco-battle__primary { background: #ffd27a; color: #101a36; margin-top: .9rem; }
.eco-battle__result { margin-top: .9rem; font-size: 1.3rem; }
.eco-battle__message { margin-top: .5rem; color: #dce6ff; line-height: 1.4; }
</style>
