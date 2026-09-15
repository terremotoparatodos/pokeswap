<template>
  <section class="gal pf-card">
    <header class="gal-head">
      <div>
        <p class="pf-kicker">Kit de Minería · {{ MINING_ASSETS.length }} assets</p>
        <p class="gal-hint">Arte procedural con la receta de WildLands. Ampliado sin suavizado.</p>
      </div>
      <div class="gal-grounds" role="group" aria-label="Fondo">
        <button v-for="(value, label) in GROUNDS" :key="label" type="button" class="gal-ground" :class="{ 'gal-ground--on': ground === value }" :style="{ background: value }" :title="label" @click="ground = value" />
      </div>
    </header>

    <h4>Estados de nodo en contexto (Veta de hierro)</h4>
    <ul class="gal-grid">
      <li v-for="entry in contextStates" :key="entry.label" class="gal-cell">
        <span class="gal-stage" :style="{ background: ground }">
          <img v-if="entry.bubble" class="gal-bubble" :src="toDataUrl(entry.bubble, 4)" alt="">
          <img :src="toDataUrl(entry.art, 4)" :alt="entry.label">
        </span>
        <strong>{{ entry.label }}</strong>
        <small>{{ entry.note }}</small>
      </li>
    </ul>

    <template v-for="group in groups" :key="group.kind">
      <h4>{{ KIND_LABEL[group.kind] }} ({{ group.assets.length }})</h4>
      <ul class="gal-grid">
        <li v-for="asset in group.assets" :key="asset.id" class="gal-cell">
          <span class="gal-stage" :style="{ background: ground }"><img :src="toDataUrl(asset.art, SCALE[group.kind])" :alt="asset.label"></span>
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
import { bubbleArt, glintArt } from '../../art/miningFx'
import { MINING_ASSETS, type MiningAssetKind } from '../../art/miningAssets'
import { miningNodeArt } from '../../art/miningNodes'
import { brighten, toDataUrl } from '../../art/pixelArt'

const GROUNDS: Readonly<Record<string, string>> = { Pradera: '#6fbf5a', Desierto: '#d9a55a', Tundra: '#dfe9f5', Bosque: '#3f8a45', Panel: '#101a36' }
const KIND_LABEL: Readonly<Record<MiningAssetKind, string>> = { node: 'Nodos', tool: 'Herramientas', icon: 'Íconos de recursos', fx: 'Efectos', marker: 'Marcadores' }
const SCALE: Readonly<Record<MiningAssetKind, number>> = { node: 4, tool: 4, icon: 3, fx: 8, marker: 4 }
const ORDER: readonly MiningAssetKind[] = ['node', 'tool', 'icon', 'fx', 'marker']

const ground = ref(GROUNDS.Desierto)
const groups = computed(() => ORDER.map(kind => ({
  kind,
  assets: MINING_ASSETS.filter(asset => asset.kind === kind).map(asset => ({ ...asset, art: asset.build() })),
})))

const ready = miningNodeArt('iron_vein', 'boulder', 'ready')
const contextStates = [
  { label: 'AVAILABLE', note: 'Lejos: sin marcas', art: ready, bubble: null },
  { label: 'INTERACTABLE', note: 'Al lado: burbuja + anillo suave', art: ready, bubble: bubbleArt('pick') },
  { label: 'TARGETED / IN_PROGRESS', note: 'Anillo dorado; golpe con destello', art: brighten(ready, 0.35), bubble: null },
  { label: 'LOCKED_LEVEL', note: 'Solo al acercarse', art: ready, bubble: bubbleArt('lock') },
  { label: 'SPECIAL_ACCESS', note: 'Requiere capacidad del Pokémon', art: miningNodeArt('crystal_cluster', 'crystal', 'ready'), bubble: bubbleArt('seal') },
  { label: 'RARE (detectado)', note: 'Destello si está en radio de prospección', art: miningNodeArt('gold_vein', 'boulder', 'ready'), bubble: glintArt(false) },
  { label: 'DEPLETED', note: 'Sin mineral, cima rota, escombros', art: miningNodeArt('iron_vein', 'boulder', 'depleted'), bubble: null },
  { label: 'RESPAWNING 1/3', note: 'Motas de mineral vuelven', art: miningNodeArt('iron_vein', 'boulder', 'respawning', 0), bubble: null },
  { label: 'RESPAWNING 3/3', note: 'Casi listo', art: miningNodeArt('iron_vein', 'boulder', 'respawning', 2), bubble: null },
]
</script>

<style scoped>
.gal { display: grid; gap: 0.6rem; padding: 1rem; }
.gal-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.6rem; }
.gal-hint { margin: 0.2rem 0 0; color: var(--pf-muted); font-size: 0.8rem; }
.gal-grounds { display: flex; gap: 0.35rem; }
.gal-ground { width: 30px; height: 30px; border: 2px solid rgba(255, 255, 255, 0.3); border-radius: 8px; cursor: pointer; }
.gal-ground--on { border-color: #fff; box-shadow: 0 0 0 2px var(--pf-gold); }
h4 { margin: 0.6rem 0 0; color: var(--pf-soft); font-size: 0.88rem; }
.gal-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.5rem; margin: 0; padding: 0; list-style: none; }
.gal-cell { display: grid; align-content: start; gap: 0.2rem; padding: 0.5rem; border-radius: 10px; background: var(--pf-navy-2); }
.gal-stage { position: relative; display: grid; place-items: end center; min-height: 110px; padding: 0.5rem; border-radius: 8px; }
.gal-stage img { image-rendering: pixelated; max-width: 100%; }
.gal-bubble { position: absolute; top: 4px; left: 50%; transform: translateX(-50%); }
.gal-cell strong { font-size: 0.8rem; }
.gal-cell small { color: var(--pf-muted); font-size: 0.7rem; }
.gal-cell code { overflow: hidden; color: var(--pf-muted); font-size: 0.64rem; text-overflow: ellipsis; white-space: nowrap; }
</style>
