<template>
  <section class="gal pf-card">
    <header class="gal-head">
      <div>
        <p class="pf-kicker">Kit de {{ KIT_LABEL[kit] }} · {{ assets.length }} assets</p>
        <p class="gal-hint">Arte procedural con la receta de WildLands. Ampliado sin suavizado.</p>
      </div>
      <div class="gal-switch" role="group" aria-label="Profesión">
        <button
          v-for="(label, id) in KIT_LABEL"
          :key="id"
          type="button"
          class="pf-chip"
          :class="{ 'gal-on': kit === id }"
          @click="kit = id"
        >{{ label }}</button>
      </div>
      <div class="gal-grounds" role="group" aria-label="Fondo">
        <button v-for="(value, label) in GROUNDS" :key="label" type="button" class="gal-ground" :class="{ 'gal-ground--on': ground === value }" :style="{ background: value }" :title="label" @click="ground = value" />
      </div>
    </header>

    <h4>{{ CONTEXT_TITLE[kit] }}</h4>
    <ul class="gal-grid">
      <li v-for="entry in contextStates" :key="entry.label" class="gal-cell">
        <span class="gal-stage" :style="{ background: entry.water ?? ground }">
          <img v-if="entry.bubble" class="gal-bubble" :src="toDataUrl(entry.bubble, 4)" alt="">
          <img :src="toDataUrl(entry.art, entry.scale ?? 4)" :alt="entry.label">
        </span>
        <strong>{{ entry.label }}</strong>
        <small>{{ entry.note }}</small>
      </li>
    </ul>

    <template v-for="group in groups" :key="group.kind">
      <h4>{{ KIND_LABEL[group.kind] }} ({{ group.assets.length }})</h4>
      <ul class="gal-grid">
        <li v-for="asset in group.assets" :key="asset.id" class="gal-cell">
          <span class="gal-stage" :style="{ background: group.kind === 'spot' ? WATER_BACKDROP : ground }"><img :src="toDataUrl(asset.art, SCALE[group.kind])" :alt="asset.label"></span>
          <strong>{{ asset.label }}</strong>
          <small>{{ asset.art.w }}×{{ asset.art.h }} · {{ asset.usage }}</small>
          <code>{{ asset.id }}</code>
        </li>
      </ul>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { FISHING_ASSETS } from '../../art/fishingAssets'
import { biteMarkArt, bobberArt } from '../../art/fishingFx'
import { fishingSpotArt } from '../../art/fishingSpots'
import { LOGGING_ASSETS } from '../../art/loggingAssets'
import { loggingTreeArt, plainTreeArt } from '../../art/loggingTrees'
import { bubbleArt, glintArt } from '../../art/miningFx'
import { MINING_ASSETS } from '../../art/miningAssets'
import { miningNodeArt } from '../../art/miningNodes'
import { brighten, toDataUrl, type PixelArt } from '../../art/pixelArt'

type Kit = 'mining' | 'fishing' | 'logging'
type AssetKind = 'node' | 'spot' | 'tree' | 'tool' | 'icon' | 'fx' | 'marker'

const KIT_LABEL: Readonly<Record<Kit, string>> = { mining: 'Minería', fishing: 'Pesca', logging: 'Tala' }
const CONTEXT_TITLE: Readonly<Record<Kit, string>> = {
  mining: 'Estados de nodo en contexto (Veta de hierro)',
  fishing: 'Estados del spot en contexto (Orilla)',
  logging: 'Estados del árbol en contexto (Árbol común)',
}
const GROUNDS: Readonly<Record<string, string>> = { Pradera: '#6fbf5a', Desierto: '#d9a55a', Tundra: '#dfe9f5', Bosque: '#3f8a45', Panel: '#101a36' }
/** Fishing marks are painted on water, so they are shown over water. */
const WATER_BACKDROP = '#3a7fc0'
const KIND_LABEL: Readonly<Record<AssetKind, string>> = {
  node: 'Nodos', spot: 'Spots de pesca', tree: 'Árboles', tool: 'Herramientas', icon: 'Íconos de recursos', fx: 'Efectos', marker: 'Marcadores',
}
const SCALE: Readonly<Record<AssetKind, number>> = { node: 4, spot: 4, tree: 3, tool: 4, icon: 3, fx: 8, marker: 4 }
const ORDER: Readonly<Record<Kit, readonly AssetKind[]>> = {
  mining: ['node', 'tool', 'icon', 'fx', 'marker'],
  fishing: ['spot', 'tool', 'icon', 'fx', 'marker'],
  logging: ['tree', 'tool', 'icon', 'fx', 'marker'],
}

interface ContextState {
  readonly label: string
  readonly note: string
  readonly art: PixelArt
  readonly bubble: PixelArt | null
  readonly water?: string
  readonly scale?: number
}

const kit = ref<Kit>('mining')
const ground = ref(GROUNDS.Desierto)
const KITS: Readonly<Record<Kit, readonly { id: string; kind: string; label: string; usage: string; build: () => PixelArt }[]>> = {
  mining: MINING_ASSETS, fishing: FISHING_ASSETS, logging: LOGGING_ASSETS,
}
const assets = computed(() => KITS[kit.value])
const groups = computed(() => ORDER[kit.value].map(kind => ({
  kind,
  assets: assets.value.filter(asset => asset.kind === kind).map(asset => ({ ...asset, art: asset.build() })),
})))

const ironVein = miningNodeArt('iron_vein', 'boulder', 'ready')
const MINING_STATES: readonly ContextState[] = [
  { label: 'AVAILABLE', note: 'Lejos: sin marcas', art: ironVein, bubble: null },
  { label: 'INTERACTABLE', note: 'Al lado: burbuja + anillo suave', art: ironVein, bubble: bubbleArt('pick') },
  { label: 'TARGETED / IN_PROGRESS', note: 'Anillo dorado; golpe con destello', art: brighten(ironVein, 0.35), bubble: null },
  { label: 'LOCKED_LEVEL', note: 'Solo al acercarse', art: ironVein, bubble: bubbleArt('lock') },
  { label: 'SPECIAL_ACCESS', note: 'Requiere capacidad del Pokémon', art: miningNodeArt('crystal_cluster', 'crystal', 'ready'), bubble: bubbleArt('seal') },
  { label: 'RARE (detectado)', note: 'Destello si está en radio de prospección', art: miningNodeArt('gold_vein', 'boulder', 'ready'), bubble: glintArt(false) },
  { label: 'DEPLETED', note: 'Sin mineral, cima rota, escombros', art: miningNodeArt('iron_vein', 'boulder', 'depleted'), bubble: null },
  { label: 'RESPAWNING 1/3', note: 'Motas de mineral vuelven', art: miningNodeArt('iron_vein', 'boulder', 'respawning', 0), bubble: null },
  { label: 'RESPAWNING 3/3', note: 'Casi listo', art: miningNodeArt('iron_vein', 'boulder', 'respawning', 2), bubble: null },
]

const FISHING_STATES: readonly ContextState[] = [
  { label: 'AVAILABLE', note: 'Agua más honda y una sombra que se mueve', art: fishingSpotArt('shore_spot', 'ready'), bubble: null, water: WATER_BACKDROP },
  { label: 'INTERACTABLE', note: 'Al lado: burbuja con caña + anillo suave', art: fishingSpotArt('shore_spot', 'ready', 1), bubble: bubbleArt('rod'), water: WATER_BACKDROP },
  { label: 'WAITING', note: 'Línea en el agua, flotador quieto', art: fishingSpotArt('shore_spot', 'ready'), bubble: bobberArt(false), water: WATER_BACKDROP },
  { label: 'BITE', note: 'Anillo brillante, sombra debajo y "!"', art: fishingSpotArt('shore_spot', 'bite'), bubble: biteMarkArt(), water: WATER_BACKDROP },
  { label: 'LOCKED_LEVEL', note: 'Solo al acercarse', art: fishingSpotArt('coastal_spot', 'ready'), bubble: bubbleArt('lock'), water: WATER_BACKDROP },
  { label: 'SPECIAL_ACCESS', note: 'Arrecife: requiere aguas profundas', art: fishingSpotArt('reef_spot', 'ready'), bubble: bubbleArt('seal'), water: '#2a6aa8' },
  { label: 'RARE (detectado)', note: 'Destello si está en radio de prospección', art: fishingSpotArt('reef_spot', 'ready', 1), bubble: glintArt(true), water: '#2a6aa8' },
  { label: 'DEPLETED', note: 'Agua lisa, sin sombra', art: fishingSpotArt('shore_spot', 'spent'), bubble: null, water: WATER_BACKDROP },
  { label: 'RESPAWNING 1/3', note: 'Burbujas primero', art: fishingSpotArt('shore_spot', 'respawning', 0), bubble: null, water: WATER_BACKDROP },
  { label: 'RESPAWNING 3/3', note: 'Los peces volvieron', art: fishingSpotArt('shore_spot', 'respawning', 2), bubble: null, water: WATER_BACKDROP },
]

const commonTree = loggingTreeArt('common_tree', 'tree', 'ready')
const LOGGING_STATES: readonly ContextState[] = [
  { label: 'DECORATIVO', note: 'La mayoría del bosque: sin marca en el tronco', art: plainTreeArt('tree'), bubble: null, scale: 3 },
  { label: 'AVAILABLE', note: 'Marca de hacha tallada en el tronco', art: commonTree, bubble: null, scale: 3 },
  { label: 'INTERACTABLE', note: 'Al lado: burbuja con hacha + anillo suave', art: commonTree, bubble: bubbleArt('axe'), scale: 3 },
  { label: 'CHOPPING', note: 'Destello leve del tronco y temblor', art: brighten(commonTree, 0.18), bubble: null, scale: 3 },
  { label: 'LOCKED_LEVEL', note: 'Solo al acercarse', art: loggingTreeArt('pine_tree', 'pine', 'ready'), bubble: bubbleArt('lock'), scale: 3 },
  { label: 'RARE (detectado)', note: 'Madera dura: destello en prospección', art: loggingTreeArt('hardwood_tree', 'tree', 'ready'), bubble: glintArt(false), scale: 3 },
  { label: 'TOCÓN', note: 'Tala completa: corte pálido y astillas', art: loggingTreeArt('common_tree', 'tree', 'stump'), bubble: null, scale: 4 },
  { label: 'BROTE', note: 'Primer rebrote del tocón', art: loggingTreeArt('common_tree', 'tree', 'sprout'), bubble: null, scale: 4 },
  { label: 'ÁRBOL JOVEN', note: 'Casi listo para volver a talar', art: loggingTreeArt('common_tree', 'tree', 'sapling'), bubble: null, scale: 4 },
  { label: 'BOREAL', note: 'Corteza gris y copa nevada', art: loggingTreeArt('boreal_tree', 'snowpine', 'ready'), bubble: null, scale: 3 },
]

const CONTEXT: Readonly<Record<Kit, readonly ContextState[]>> = {
  mining: MINING_STATES, fishing: FISHING_STATES, logging: LOGGING_STATES,
}
const contextStates = computed(() => CONTEXT[kit.value])
</script>

<style scoped>
.gal { display: grid; gap: 0.6rem; padding: 1rem; }
.gal-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.6rem; }
.gal-hint { margin: 0.2rem 0 0; color: var(--pf-muted); font-size: 0.8rem; }
.gal-switch { display: flex; gap: 0.35rem; }
.gal-switch .pf-chip { border: 1px solid var(--pf-line); font: inherit; font-size: 0.8rem; cursor: pointer; }
.gal-switch .gal-on { border-color: var(--pf-gold); background: var(--pf-gold); color: var(--pf-navy); font-weight: 700; }
.gal-grounds { display: flex; gap: 0.35rem; }
.gal-ground { width: 30px; height: 30px; border: 2px solid rgba(255, 255, 255, 0.3); border-radius: 8px; cursor: pointer; }
.gal-ground--on { border-color: #fff; box-shadow: 0 0 0 2px var(--pf-gold); }
h4 { margin: 0.6rem 0 0; color: var(--pf-soft); font-size: 0.88rem; }
.gal-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.5rem; margin: 0; padding: 0; list-style: none; }
.gal-cell { display: grid; align-content: start; gap: 0.2rem; padding: 0.5rem; border-radius: 10px; background: var(--pf-navy-2); }
.gal-stage { position: relative; display: grid; place-items: center; min-height: 110px; padding: 0.5rem; border-radius: 8px; overflow: hidden; }
.gal-stage img { image-rendering: pixelated; max-width: 100%; }
.gal-bubble { position: absolute; top: 4px; left: 50%; transform: translateX(-50%); }
.gal-cell strong { font-size: 0.8rem; }
.gal-cell small { color: var(--pf-muted); font-size: 0.7rem; }
.gal-cell code { overflow: hidden; color: var(--pf-muted); font-size: 0.64rem; text-overflow: ellipsis; white-space: nowrap; }
</style>
