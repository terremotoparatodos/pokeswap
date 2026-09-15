<template>
  <section class="wm pf-card">
    <header class="wm-head">
      <p class="pf-kicker">{{ title }} · ({{ centerTx }}, {{ centerTy }})</p>
      <ul class="wm-legend">
        <li v-for="(color, id) in PROFESSION_COLOR" :key="id"><span :style="{ background: color }" />{{ PROFESSIONS[id].name }}</li>
      </ul>
    </header>
    <div class="wm-scroll">
      <div class="wm-grid" :style="{ gridTemplateColumns: `repeat(${cols}, var(--wm-cell))` }">
        <template v-for="cell in cells" :key="cell.key">
          <button
            v-if="cell.node"
            type="button"
            class="wm-cell wm-node"
            :class="{ 'wm-node--on': cell.node.nodeId === selectedId }"
            :style="{ background: cell.color, '--wm-dot': PROFESSION_COLOR[cell.profession!] }"
            :title="`${cell.name} · Nv. ${cell.level}`"
            :aria-label="`${cell.name}, nivel ${cell.level}`"
            @click="emit('select', cell.node)"
          />
          <span v-else class="wm-cell" :class="{ 'wm-center': cell.center, 'wm-solid': cell.solid }" :style="{ background: cell.color }" />
        </template>
      </div>
    </div>
    <p class="wm-note">Nodos reales de la semilla {{ seed }}: la misma posición que calcularía el servidor. El centro marca tu ubicación de referencia.</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { World, type Biome } from '../../wildlands/engine/world'
import { NODE_BY_ID } from '../domain/catalog/nodes'
import { PROFESSIONS } from '../domain/catalog/professions'
import { nodeAt, worldNodePort } from '../domain/nodePlacement'
import type { ProfessionId } from '../domain/types'
import type { DemoNodeTarget } from '../demo/demoSession'

// Top-down slice of a real procedural world with its deterministic nodes.
const props = withDefaults(defineProps<{
  seed: number
  centerTx: number
  centerTy: number
  title?: string
  cols?: number
  rows?: number
  selectedId?: string | null
}>(), { title: 'Mapa de nodos', cols: 29, rows: 19, selectedId: null })
const emit = defineEmits<{ select: [target: DemoNodeTarget] }>()

const BIOME_COLOR: Readonly<Record<Biome, string>> = {
  deep: '#1d3f8a', ocean: '#2f6fd0', beach: '#e8d49a', desert: '#d9a55a', grassland: '#6fbf5a', forest: '#3f8a45', tundra: '#dfe9f5',
}
const PROFESSION_COLOR: Readonly<Record<ProfessionId, string>> = {
  mining: '#c9a27a', woodcutting: '#8bd17c', fishing: '#7fb8ff', alchemy: '#f39ad8',
}

const port = computed(() => worldNodePort(new World(props.seed)))

const cells = computed(() => {
  const world = port.value
  const out = []
  const left = props.centerTx - Math.floor(props.cols / 2)
  const top = props.centerTy - Math.floor(props.rows / 2)
  for (let row = 0; row < props.rows; row++) {
    for (let col = 0; col < props.cols; col++) {
      const tx = left + col
      const ty = top + row
      const placement = nodeAt(world, tx, ty)
      const definition = placement ? NODE_BY_ID.get(placement.definitionId) : undefined
      out.push({
        key: `${tx}:${ty}`,
        color: world.isWater(tx, ty) ? BIOME_COLOR.ocean : BIOME_COLOR[world.biomeAt(tx + 0.5, ty + 0.5)],
        solid: world.decorAt(tx, ty) !== null,
        center: tx === props.centerTx && ty === props.centerTy,
        node: placement && definition ? { nodeId: placement.nodeId, node: definition, biome: placement.biome } satisfies DemoNodeTarget : null,
        profession: definition?.profession,
        name: definition?.name,
        level: definition?.requiredLevel,
      })
    }
  }
  return out
})
</script>

<style scoped>
.wm { --wm-cell: 18px; display: grid; gap: 0.5rem; padding: 0.85rem; }
.wm-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.4rem; }
.wm-legend { display: flex; flex-wrap: wrap; gap: 0.6rem; margin: 0; padding: 0; list-style: none; color: var(--pf-muted); font-size: 0.74rem; }
.wm-legend li { display: inline-flex; align-items: center; gap: 0.25rem; }
.wm-legend span { width: 10px; height: 10px; border-radius: 50%; }
.wm-scroll { overflow-x: auto; }
.wm-grid { display: grid; width: max-content; border: 2px solid #0b1430; border-radius: 8px; overflow: hidden; }
.wm-cell { display: block; width: var(--wm-cell); height: var(--wm-cell); box-sizing: border-box; }
.wm-solid { box-shadow: inset 0 0 0 5px rgba(0, 0, 0, 0.18); }
.wm-center { box-shadow: inset 0 0 0 3px #e03c3c; }
.wm-node { position: relative; padding: 0; border: 0; cursor: pointer; }
.wm-node::after { content: ''; position: absolute; inset: 3px; border: 2px solid #101a36; border-radius: 50%; background: var(--wm-dot); }
.wm-node:hover::after, .wm-node:focus-visible::after { inset: 1px; }
.wm-node--on::after { box-shadow: 0 0 0 3px #fff; }
.wm-note { margin: 0; color: var(--pf-muted); font-size: 0.74rem; }
@media (max-width: 520px) { .wm { --wm-cell: 14px; } }
</style>
