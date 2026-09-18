<script setup lang="ts">
// City Mapping Lab — palette: real props (with their real art) and terrain brush.

import { computed, onMounted, ref } from 'vue'
import { HEARTHOME } from '../../wildlands/areas/atlas'
import { buildPropSprites } from '../../wildlands/engine/props'
import { buildTownProps } from '../../wildlands/engine/townProps'
import { PALETTE, TERRAIN_LABEL, isSolidKind } from '../domain/labCatalog'
import { isStreetProp, TERRAIN_KINDS, type LabPropKind } from '../domain/labCity'
import type { CityLab, PaletteChoice } from '../state/useCityLab'

const props = defineProps<{ lab: CityLab }>()
const lab = props.lab

const groups = computed(() => {
  const out = new Map<string, typeof PALETTE[number][]>()
  for (const entry of PALETTE) out.set(entry.group, [...(out.get(entry.group) ?? []), entry])
  return [...out.entries()]
})

/** Thumbnails: the town's hand-drawn PNG when it has one, else the sprite the engine paints. */
const thumbs = ref<Partial<Record<LabPropKind, string>>>({})
onMounted(() => {
  const world = buildPropSprites()
  const street = buildTownProps()
  const out: Partial<Record<LabPropKind, string>> = {}
  for (const { kind } of PALETTE) {
    const art = isStreetProp(kind) ? HEARTHOME.art?.props?.[kind]?.[0]?.src : undefined
    const sprite = isStreetProp(kind) ? street[kind] : world[kind]
    out[kind] = art ?? sprite.canvas.toDataURL()
  }
  thumbs.value = out
})

function choose(kind: PaletteChoice): void {
  lab.palette.value = kind
  lab.tool.value = 'add'
}
</script>

<template>
  <aside class="pal">
    <section>
      <h3>Agregar</h3>
      <p class="hint">Elegí y hacé click en el mapa. Esc vuelve a seleccionar.</p>
      <div v-for="[group, entries] in groups" :key="group" class="pal-group">
        <h4>{{ group }}</h4>
        <div class="pal-grid">
          <button
            v-for="e in entries" :key="e.kind" type="button" class="pal-item"
            :class="{ on: lab.tool.value === 'add' && lab.palette.value === e.kind }"
            :title="`${e.kind}${isSolidKind(e.kind) ? ' · sólido' : ' · NO sólido'}${isStreetProp(e.kind) ? '' : ' · objeto del mundo (el patch lo marca)'}`"
            @click="choose(e.kind)"
          >
            <img v-if="thumbs[e.kind]" :src="thumbs[e.kind]" alt="">
            <span>{{ e.label }}</span>
          </button>
        </div>
      </div>
      <h4>NPC</h4>
      <div class="pal-grid">
        <button type="button" class="pal-item" :class="{ on: lab.tool.value === 'add' && lab.palette.value === 'wanderer' }" @click="choose('wanderer')">
          <span>Wanderer</span>
        </button>
      </div>
    </section>

    <section>
      <h3>Terreno</h3>
      <div class="pal-grid">
        <button
          v-for="k in TERRAIN_KINDS" :key="k" type="button" class="pal-item"
          :class="{ on: lab.tool.value === 'terrain' && lab.terrainKind.value === k }"
          @click="lab.terrainKind.value = k; lab.tool.value = 'terrain'"
        >
          <i class="swatch" :class="`swatch-${k}`" />
          <span>{{ TERRAIN_LABEL[k] }}</span>
        </button>
      </div>
      <div class="brush">
        Pincel
        <button type="button" :class="{ on: lab.brushSize.value === 1 }" @click="lab.brushSize.value = 1">1×1</button>
        <button type="button" :class="{ on: lab.brushSize.value === 3 }" @click="lab.brushSize.value = 3">3×3</button>
      </div>
    </section>
  </aside>
</template>

<style scoped>
.pal { overflow-y: auto; padding: 10px; background: #111626; border-right: 1px solid #2a3350; color: #dfe7ff; font: 12px system-ui, sans-serif; }
h3 { margin: 4px 0 6px; font-size: 13px; color: #ffd84a; }
h4 { margin: 10px 0 4px; font-size: 11px; color: #8f9bc4; text-transform: uppercase; letter-spacing: 0.06em; }
.hint { margin: 0 0 6px; color: #8f9bc4; }
section + section { margin-top: 16px; border-top: 1px solid #2a3350; padding-top: 8px; }
.pal-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px; }
.pal-item {
  display: flex; align-items: center; gap: 6px; padding: 4px 6px; border: 1px solid #2c3656; border-radius: 6px;
  background: #1a2138; color: inherit; font: inherit; cursor: pointer; text-align: left;
}
.pal-item.on { border-color: #6d8cff; background: #26356e; }
.pal-item img { width: 24px; height: 24px; object-fit: contain; image-rendering: pixelated; }
.swatch { width: 18px; height: 18px; border-radius: 3px; border: 1px solid #000; }
.swatch-s { background: #d6bd8c; }
.swatch-g { background: #74c24f; }
.swatch-p { background: #b8c0d8; }
.swatch-t { background: #2f6a36; }
.brush { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.brush button { padding: 3px 8px; border: 1px solid #34406a; border-radius: 6px; background: #1d2540; color: #dfe7ff; cursor: pointer; }
.brush button.on { background: #3c5bd6; }
</style>
