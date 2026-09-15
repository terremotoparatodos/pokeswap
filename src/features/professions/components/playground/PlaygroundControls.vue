<template>
  <aside class="ctl pf-card" aria-label="Controles del playground">
    <p class="pf-kicker">Controles</p>

    <label class="ctl-field">
      <span>Profesión</span>
      <select :value="profession" @change="emit('update:profession', ($event.target as HTMLSelectElement).value as ProfessionId)">
        <option v-for="id in PROFESSION_IDS" :key="id" :value="id">{{ PROFESSIONS[id].name }}</option>
      </select>
    </label>

    <label class="ctl-field">
      <span>Nivel de profesión: {{ level }}</span>
      <input type="range" min="1" :max="MAX_PROFESSION_LEVEL" :value="level" @input="setLevel(($event.target as HTMLInputElement).valueAsNumber)">
    </label>

    <label class="ctl-field">
      <span>Pokémon</span>
      <select :value="state.workers[profession] ?? ''" @change="setWorker(($event.target as HTMLSelectElement).value)">
        <option value="">Sin Pokémon</option>
        <option v-for="worker in DEMO_WORKERS" :key="worker.speciesId" :value="worker.speciesId">{{ worker.name }}</option>
      </select>
    </label>

    <label class="ctl-field">
      <span>Nivel del Pokémon: {{ state.workerLevel }}</span>
      <input type="range" min="1" max="100" :value="state.workerLevel" @input="session.update(s => setDemoWorkerLevel(s, ($event.target as HTMLInputElement).valueAsNumber))">
    </label>

    <label class="ctl-field">
      <span>Herramienta ({{ TOOL_KIND_LABEL[kind] }})</span>
      <select :value="tool?.definition.itemId ?? ''" @change="equip(($event.target as HTMLSelectElement).value)">
        <option value="">Ninguna</option>
        <option v-for="option in toolOptions" :key="option.itemId" :value="option.itemId">{{ itemName(option.itemId) }} (T{{ option.tier }})</option>
      </select>
    </label>

    <label v-if="tool" class="ctl-field">
      <span>Durabilidad: {{ tool.instance.durability }} / {{ tool.instance.maxDurability }}</span>
      <input type="range" min="0" :max="tool.instance.maxDurability" :value="tool.instance.durability" @input="session.update(s => setDemoDurability(s, kind, ($event.target as HTMLInputElement).valueAsNumber))">
    </label>

    <label class="ctl-field">
      <span>Energía: {{ Math.floor(state.energy.current) }} / {{ maxEnergy }}</span>
      <input type="range" min="0" :max="maxEnergy" :value="state.energy.current" @input="session.update(s => setDemoEnergy(s, ($event.target as HTMLInputElement).valueAsNumber))">
    </label>
    <label class="ctl-check">
      <input type="checkbox" :checked="state.energy.rested > 0" @change="session.update(s => setDemoEnergy(s, s.energy.current, ($event.target as HTMLInputElement).checked ? 200 : 0))">
      Descanso acumulado (+XP)
    </label>

    <label class="ctl-field">
      <span>Mochila</span>
      <select :value="''" @change="applyPreset(($event.target as HTMLSelectElement))">
        <option value="" disabled>Elegir preset…</option>
        <option v-for="(label, preset) in BAG_PRESETS" :key="preset" :value="preset">{{ label }}</option>
      </select>
    </label>

    <label class="ctl-field">
      <span>Capacidad: {{ state.bag.capacity }} espacios (demo)</span>
      <input type="range" min="12" max="30" :value="state.bag.capacity" @input="session.update(s => setDemoCapacity(s, ($event.target as HTMLInputElement).valueAsNumber))">
    </label>

    <label class="ctl-field">
      <span>Nodo del catálogo</span>
      <select :value="target?.node.id ?? ''" @change="pickCatalogNode(($event.target as HTMLSelectElement).value)">
        <option v-for="node in nodes" :key="node.id" :value="node.id">{{ node.name }} · Nv. {{ node.requiredLevel }}</option>
      </select>
    </label>

    <div class="ctl-buttons">
      <button type="button" :disabled="!target" @click="target && session.update(s => depleteDemoNode(s, target!))">Agotar nodo</button>
      <button type="button" @click="session.update(s => setDemoInventory(s, { ...demoCounts(s), ...CRAFTING_KIT }))">Kit de insumos</button>
      <button type="button" @click="session.advance(HOUR_MS)">Avanzar 1 h</button>
      <button type="button" class="ctl-reset" @click="session.reset()">Reiniciar demo</button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { GATHERING_NODES } from '../../domain/catalog/nodes'
import { MAX_PROFESSION_LEVEL, PROFESSIONS } from '../../domain/catalog/professions'
import { TOOLS } from '../../domain/catalog/tools'
import { PROFESSION_IDS, type ProfessionId } from '../../domain/types'
import {
  demoCounts, demoLevel, demoMaxEnergy, demoTool, depleteDemoNode, equipDemoTool, fillDemoBag, setDemoCapacity, setDemoDurability,
  setDemoEnergy, setDemoInventory, setDemoLevel, setDemoWorker, setDemoWorkerLevel, type BagPreset, type DemoNodeTarget,
} from '../../demo/demoSession'
import { DEMO_WORKERS } from '../../demo/demoWorkers'
import type { ProfessionDemoSession } from '../../demo/useProfessionDemo'
import { TOOL_KIND_LABEL } from '../../ui/nodeStatus'
import { itemName } from '../../ui/progressionView'

const props = defineProps<{ session: ProfessionDemoSession; profession: ProfessionId; target: DemoNodeTarget | null }>()
const emit = defineEmits<{ 'update:profession': [profession: ProfessionId]; 'update:target': [target: DemoNodeTarget] }>()

const HOUR_MS = 3_600_000
/** Enough inputs to try most early recipes. */
const CRAFTING_KIT = { oran_berry: 20, medicinal_herb: 10, seaweed: 10, vial: 10, sitrus_berry: 8, leppa_berry: 6, stone: 30, coal: 15, iron_ore: 10, common_log: 20, resin: 6, fish: 12 }

const BAG_PRESETS: Readonly<Record<BagPreset, string>> = {
  empty: 'Vacía', partial: 'Parcial', stacks: 'Stacks variados + pico de acero', nearly_full: 'Casi llena (stacks abiertos)', full: 'Llena',
}

function applyPreset(select: HTMLSelectElement): void {
  const preset = select.value as BagPreset
  if (preset) props.session.update(s => fillDemoBag(s, preset))
  select.value = ''
}

const state = computed(() => props.session.state.value)
const level = computed(() => demoLevel(state.value, props.profession))
const kind = computed(() => PROFESSIONS[props.profession].toolKind)
const tool = computed(() => demoTool(state.value, props.profession))
const toolOptions = computed(() => TOOLS.filter(option => option.kind === kind.value))
const maxEnergy = computed(() => demoMaxEnergy(state.value))
const nodes = computed(() => GATHERING_NODES.filter(node => node.profession === props.profession))

const setLevel = (value: number) => props.session.update(s => setDemoLevel(s, props.profession, value))
const setWorker = (value: string) => props.session.update(s => setDemoWorker(s, props.profession, value ? Number(value) : null))
const equip = (itemId: string) => props.session.update(s => equipDemoTool(s, kind.value, itemId || null))

/** Catalog nodes have no world position; they use their first allowed biome. */
function pickCatalogNode(id: string): void {
  const node = GATHERING_NODES.find(entry => entry.id === id)
  if (node) emit('update:target', { nodeId: `catalog:${node.id}`, node, biome: node.biomes[0] })
}
</script>

<style scoped>
.ctl { display: grid; align-content: start; gap: 0.7rem; padding: 1rem; }
.ctl-field { display: grid; gap: 0.25rem; font-size: 0.82rem; }
.ctl-field span { color: var(--pf-soft); }
.ctl-check { display: flex; align-items: center; gap: 0.4rem; color: var(--pf-soft); font-size: 0.82rem; }
.ctl-buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; }
.ctl-buttons button { min-height: 38px; border: 1px solid var(--pf-line); border-radius: 8px; background: var(--pf-navy-2); color: inherit; font: inherit; font-size: 0.8rem; cursor: pointer; }
.ctl-buttons button:disabled { opacity: 0.4; cursor: not-allowed; }
.ctl-reset { grid-column: 1 / -1; border-color: #e03c3c !important; }
</style>
