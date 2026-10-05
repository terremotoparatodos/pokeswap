<script setup lang="ts">
// ECO-PREVIEW-1 — dev-only simulator view. Renders the controller's state and
// forwards clicks to it; every rule lives in the real engine. Not a game route.
import { computed, ref, shallowRef } from 'vue'
import { overworldSheetUrl } from '../../wildlands/engine/characters'
import { compareSetups, DEFAULT_SESSION, type SimMetrics } from './compare'
import { realNestDetails, TILE_KIND } from './realMap'
import { defaultParams, PREVIEW_ZONES, type NestLayout, type PreviewZoneId, type SimParams } from './scenarios'
import {
  advance, aliveEncounters, createSim, repeatEvaluation, resetSim, retire, setForcedInactive, setPlayers, viewOf,
  type SimSetup, type SimState,
} from './simulator'
import type { RetireCause } from '../population/types'

const zoneId = ref<PreviewZoneId>('cueva-inicial')
const layout = ref<NestLayout>('mixed')
const seed = ref(42)
const params = ref<SimParams>(defaultParams('cueva-inicial'))
const error = ref<string | null>(null)
const sim = shallowRef<SimState | null>(null)
const selected = ref<string | null>(null)

function start(): void {
  const created = createSim({ zoneId: zoneId.value, layout: layout.value, seed: seed.value, params: { ...params.value } })
  if (!created.ok) {
    error.value = created.issues.map(i => `${i.code}: ${i.message}`).join(' · ')
    sim.value = null
    return
  }
  error.value = null
  selected.value = null
  selectedNestId.value = null
  sim.value = created.sim
}

function changeZone(): void {
  params.value = defaultParams(zoneId.value)
  start()
}

const act = (next: (s: SimState) => SimState) => { if (sim.value) sim.value = next(sim.value) }
const doRetire = (cause: RetireCause) => {
  const id = selected.value
  if (id) act(s => retire(s, id, cause))
  selected.value = null
}

const view = computed(() => (sim.value ? viewOf(sim.value) : null))

// ECO-MAP-1: real-map proposal mode.
const isReal = computed(() => sim.value?.setup.layout === 'real-map')
const columns = computed(() => (sim.value ? sim.value.scenario.bounds.maxTx - sim.value.scenario.bounds.minTx + 1 : 0))
const cellPx = computed(() => (!isReal.value ? 30 : columns.value > 40 ? 10 : columns.value > 21 ? 22 : 30))
const KIND_CLASS: Record<string, string> = Object.fromEntries(Object.entries(TILE_KIND).map(([name, char]) => [char, `k-${name}`]))
const selectedNestId = ref<string | null>(null)
const nestDetails = computed(() => (isReal.value ? realNestDetails(zoneId.value) : []))
const selectedNest = computed(() => nestDetails.value.find(d => d.nest.id === selectedNestId.value) ?? null)
function pick(cell: { encounter: { id: string } | null; nestId: string | null }): void {
  if (cell.encounter) selected.value = cell.encounter.id
  else if (cell.nestId) selectedNestId.value = cell.nestId
}
const selectedEncounter = computed(() => (sim.value && selected.value ? aliveEncounters(sim.value).find(e => e.id === selected.value) ?? null : null))
const log = computed(() => (sim.value ? [...sim.value.log].reverse().slice(0, 40) : []))
const groupHue = (groupId: string) => [...groupId].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
const seconds = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`)

// Comparison A (current params) vs B (editable copy), same seed and session script.
const paramsB = ref<SimParams>(defaultParams('cueva-inicial'))
const layoutB = ref<NestLayout>('by-habitat')
const comparison = shallowRef<{ a: SimMetrics; b: SimMetrics } | null>(null)
function runComparison(): void {
  const a: SimSetup = { zoneId: zoneId.value, layout: layout.value, seed: seed.value, params: { ...params.value } }
  const b: SimSetup = { zoneId: zoneId.value, layout: layoutB.value, seed: seed.value, params: { ...paramsB.value } }
  try {
    comparison.value = compareSetups(a, b)
    error.value = null
  } catch (e) {
    comparison.value = null
    error.value = String((e as Error).message)
  }
}
const metricRows = (m: SimMetrics) => [
  ['Encuentros nacidos', m.encountersBorn], ['Retirados (simulado)', m.retired], ['Vivos promedio', m.meanAlive.toFixed(2)],
  ['Vivos máximo', m.maxAlive], ['Dormancias', m.dormancies], ['Fallos', Object.entries(m.failures).map(([k, v]) => `${k} ${v}`).join(', ') || '—'],
  ['Especies', Object.entries(m.bySpecies).map(([k, v]) => `#${k}×${v}`).join(' ')],
]
const numericKeys: (keyof SimParams)[] = ['delayMs', 'jitter', 'retryMs', 'dormantAfterMs', 'staggerMinMs', 'staggerMaxMs', 'areaMaxAlive', 'nestMaxAlive', 'groupCap']

start()
</script>

<template>
  <main class="eco">
    <header class="banner" data-test="banner">
      <template v-if="isReal">PROPUESTA DE DESARROLLO — mapa real con nidos propuestos (no integrados), catálogo y motor reales. Nada aquí toca el juego, cuentas ni servidores.</template>
      <template v-else>SIMULACIÓN LOCAL — grilla sintética, catálogo y motor reales. Nada aquí toca el juego, cuentas ni servidores.</template>
    </header>

    <section class="controls">
      <label>Hábitat
        <select v-model="zoneId" data-test="zone" @change="changeZone">
          <option v-for="z in PREVIEW_ZONES" :key="z.id" :value="z.id">{{ z.label }}</option>
        </select>
      </label>
      <label>Nidos
        <select v-model="layout" data-test="layout" @change="start">
          <option value="mixed">mixtos</option><option value="by-habitat">por hábitat</option><option value="real-map">mapa real (propuesta)</option>
        </select>
      </label>
      <label>Semilla <input v-model.number="seed" type="number" data-test="seed" @change="start"></label>
      <label>Política
        <select v-model="params.policy" data-test="policy" @change="start">
          <option value="per-group">por grupo</option><option value="per-member">por miembro</option>
        </select>
      </label>
      <label v-for="key in numericKeys" :key="key">{{ key }}
        <input v-model.number="params[key]" type="number" step="any" :data-test="`param-${key}`" @change="start">
      </label>
      <div class="buttons">
        <button data-test="advance-1" @click="act(s => advance(s, 1_000))">+1 s</button>
        <button data-test="advance-15" @click="act(s => advance(s, 15_000))">+15 s</button>
        <button data-test="advance-75" @click="act(s => advance(s, 75_000))">+75 s</button>
        <button data-test="advance-300" @click="act(s => advance(s, 300_000))">+5 min</button>
        <button data-test="repeat" @click="act(repeatEvaluation)">Repetir evaluación</button>
        <button data-test="reset" @click="act(resetSim)">Reiniciar escenario</button>
      </div>
      <div v-if="sim" class="buttons">
        <label>Jugadores <input :value="sim.players" type="number" min="0" data-test="players" @change="act(s => setPlayers(s, Number(($event.target as HTMLInputElement).value)))"></label>
        <label><input type="checkbox" :checked="sim.forcedInactive" data-test="inactive" @change="act(s => setForcedInactive(s, ($event.target as HTMLInputElement).checked))"> Forzar área inactiva</label>
        <small>(se aplica en la próxima evaluación)</small>
      </div>
      <p v-if="error" class="error" data-test="error">{{ error }}</p>
    </section>

    <section v-if="view && sim" class="world">
      <div class="grid" :style="{ gridTemplateColumns: `repeat(${columns}, ${cellPx}px)`, '--cell': `${cellPx}px` }" data-test="grid">
        <button
          v-for="cell in view.cells" :key="`${cell.tx},${cell.ty}`" type="button" class="cell"
          :class="[isReal ? KIND_CLASS[cell.kind] : { blocked: cell.blocked }, { nest: cell.nestId, picked: cell.encounter && cell.encounter.id === selected, 'nest-picked': cell.nestId && cell.nestId === selectedNestId }]"
          :title="`${cell.tx},${cell.ty} ` + (cell.encounter ? `${cell.encounter.id} · especie #${cell.encounter.speciesId}` : cell.nestId ?? (cell.blocked ? 'bloqueada' : ''))"
          :data-test="cell.encounter ? 'encounter' : cell.nestId ? 'nest-tile' : undefined"
          :disabled="!cell.encounter && !cell.nestId"
          @click="pick(cell)"
        >
          <span
            v-if="cell.encounter" class="sprite"
            :style="{ backgroundImage: `url(${overworldSheetUrl(cell.encounter.speciesId, false)})`, outlineColor: `hsl(${groupHue(cell.encounter.groupId)} 70% 45%)` }"
          />
        </button>
      </div>

      <aside class="panel">
        <p data-test="clock">t = {{ (view.now / 1000).toFixed(1) }} s · evaluaciones {{ sim.evaluations }}</p>
        <p data-test="status">Área: <b>{{ view.status }}</b> {{ view.simulated ? '(simulada)' : '(no simulada)' }}</p>
        <p data-test="population">Población {{ view.alive }} / {{ view.areaMax }}</p>
        <table v-if="view.zones.length" data-test="zones">
          <thead><tr><th>Zona de población</th><th>Vivos</th><th>Máximo</th><th>Nidos</th></tr></thead>
          <tbody>
            <tr v-for="z in view.zones" :key="z.id ?? '-'" data-test="zone-row">
              <td>{{ z.id ?? '(sin zona)' }}</td><td>{{ z.alive }}</td><td>{{ z.max ?? '— (sólo el área)' }}</td><td>{{ z.nests }}</td>
            </tr>
          </tbody>
        </table>
        <table>
          <thead><tr><th>Nido</th><th v-if="view.zones.length">Zona</th><th>Vivos</th><th>Gen.</th><th>Próxima reposición</th></tr></thead>
          <tbody>
            <tr v-for="n in view.nests" :key="n.id" data-test="nest-row">
              <td :title="n.habitats.join(', ')">{{ n.id }}</td><td v-if="view.zones.length">{{ n.zone ?? '—' }}</td><td>{{ n.alive }} / {{ n.max }}</td><td>{{ n.generation }}</td><td>{{ seconds(n.dueIn) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="selectedEncounter" class="selection" data-test="selection">
          <p>{{ selectedEncounter.id }}<br>especie #{{ selectedEncounter.speciesId }} · familia {{ selectedEncounter.familyId }} · {{ selectedEncounter.rarity }}<br>grupo {{ selectedEncounter.groupId }} ({{ selectedEncounter.member + 1 }}/{{ selectedEncounter.groupSize }})</p>
          <button data-test="retire-defeated" @click="doRetire('defeated')">Derrotar (simulado)</button>
          <button data-test="retire-captured" @click="doRetire('captured')">Capturar (simulado)</button>
          <button data-test="retire-fled" @click="doRetire('fled')">Huye (simulado)</button>
        </div>
        <div v-if="selectedNest" class="selection" data-test="nest-detail">
          <p><b>{{ selectedNest.nest.id }}</b> · grupo {{ selectedNest.nest.group }} ({{ selectedNest.nest.habitats.join(', ') }})<br>
            ancla {{ selectedNest.nest.anchor.tx }},{{ selectedNest.nest.anchor.ty }} · {{ selectedNest.report.candidates.length }} casillas candidatas · máx. {{ selectedNest.nest.maxAlive }} vivos, grupo ≤ {{ selectedNest.nest.groupCap }}</p>
          <p v-for="(names, tier) in selectedNest.report.eligible" :key="tier">{{ tier }}: {{ names.join(', ') || '—' }}</p>
          <p><i>{{ selectedNest.nest.justification }}</i></p>
          <p v-for="w in selectedNest.report.warnings" :key="w" class="warn">⚠ {{ w }}</p>
        </div>
        <ul v-if="isReal" class="notes" data-test="notes"><li v-for="n in sim.scenario.notes" :key="n">{{ n }}</li></ul>
        <p v-if="isReal" class="legend">P protegido · p portal · # bloqueado · ~ agua · R recurso · w posición de trabajo · = pasillo · r reserva · " pasto alto · verde: casilla candidata de nido</p>
        <ol class="log" data-test="log"><li v-for="(line, i) in log" :key="i">{{ line }}</li></ol>
      </aside>
    </section>

    <section class="compare">
      <h2>Comparar configuraciones (sesión guionada de {{ DEFAULT_SESSION.minutes }} min, misma semilla)</h2>
      <p>A = parámetros actuales. B:</p>
      <label>Nidos B
        <select v-model="layoutB" data-test="layout-b"><option value="mixed">mixtos</option><option value="by-habitat">por hábitat</option><option value="real-map">mapa real (propuesta)</option></select>
      </label>
      <label>Política B
        <select v-model="paramsB.policy" data-test="policy-b"><option value="per-group">por grupo</option><option value="per-member">por miembro</option></select>
      </label>
      <label v-for="key in numericKeys" :key="`b-${key}`">{{ key }} <input v-model.number="paramsB[key]" type="number" step="any"></label>
      <button data-test="compare" @click="runComparison">Comparar</button>
      <table v-if="comparison" data-test="comparison">
        <thead><tr><th /><th>A</th><th>B</th></tr></thead>
        <tbody>
          <tr v-for="(row, i) in metricRows(comparison.a)" :key="i"><td>{{ row[0] }}</td><td>{{ row[1] }}</td><td>{{ metricRows(comparison.b)[i][1] }}</td></tr>
        </tbody>
      </table>
    </section>
  </main>
</template>

<style scoped>
.eco { font: 13px/1.4 system-ui, sans-serif; color: #1d232a; background: #f4f1ea; padding: 12px; min-height: 100vh; box-sizing: border-box; }
.banner { background: #7a2e12; color: #fff; padding: 6px 10px; font-weight: 600; border-radius: 4px; }
.controls, .compare { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: end; margin: 10px 0; }
.controls label, .compare label { display: flex; flex-direction: column; font-size: 11px; }
.controls input[type='number'], .compare input[type='number'] { width: 80px; }
.buttons { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.error { color: #a01010; width: 100%; }
.world { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
.grid { display: grid; gap: 1px; background: #c9c2b2; padding: 1px; }
.cell { width: var(--cell, 30px); height: var(--cell, 30px); padding: 0; border: 0; background: #e9e4d8; position: relative; }
.cell.nest { background: #d6e8c9; }
.cell.blocked { background: #6b6156; }
.cell.k-floor { background: #d9d2bf; }
.cell.k-tall { background: #b9c99a; }
.cell.k-blocked { background: #6b6156; }
.cell.k-resource { background: #2f5d34; }
.cell.k-work { background: #c7b98f; }
.cell.k-corridor { background: #e8dfc4; }
.cell.k-reserved { background: #cfc3a8; }
.cell.k-water { background: #6fa3c9; }
.cell.k-unreachable { background: #8a7f73; }
.cell.k-portal, .cell.k-protected { background: #c0392b; }
.cell.nest { background: #7fcf6b; }
.cell.nest-picked { box-shadow: inset 0 0 0 2px #1f6fb2; }
.notes { font-size: 11px; padding-left: 16px; }
.legend { font-size: 11px; color: #5b5346; }
.warn { color: #8a4b00; }
.cell.picked { box-shadow: inset 0 0 0 2px #d43; }
.cell:disabled { cursor: default; }
.sprite { position: absolute; inset: 1px; background-size: 200% 400%; background-position: 0 0; image-rendering: pixelated; outline: 2px solid; outline-offset: -2px; border-radius: 3px; }
.panel { min-width: 320px; max-width: 460px; }
.panel table, .compare table { border-collapse: collapse; }
.panel td, .panel th, .compare td, .compare th { border: 1px solid #c9c2b2; padding: 2px 6px; text-align: left; }
.log { max-height: 260px; overflow: auto; font-family: ui-monospace, monospace; font-size: 11px; padding-left: 34px; }
.selection { background: #fff8e6; padding: 6px; border: 1px solid #e0c98a; margin: 8px 0; }
</style>
