<script setup lang="ts">
// The floor, drawn as a cave (D1 §6).
//
// A camera window around the player rather than the whole map, so the same
// component reads at 375 px and on a desktop. Placeholder art on purpose: what
// has to be legible here is the shape of the cave, where the Pokémon are, and
// which way is down.

import { computed } from 'vue'
import { tileAt, THEME_LOOK, type FloorEntity, type FloorTiles, type TilePoint } from '../domain/floorTiles'
import { speciesById } from '../data/speciesFixtures'

const props = defineProps<{
  tiles: FloorTiles
  entities: readonly FloorEntity[]
  player: TilePoint
  /** Tiles across the camera window. */
  viewW?: number
  viewH?: number
}>()

const TILE = 16
const width = computed(() => props.viewW ?? 17)
const height = computed(() => props.viewH ?? 13)

/** Keeps the player centred, clamped so the camera never leaves the map. */
const origin = computed(() => ({
  x: Math.max(0, Math.min(props.tiles.width - width.value, props.player.x - Math.floor(width.value / 2))),
  y: Math.max(0, Math.min(props.tiles.height - height.value, props.player.y - Math.floor(height.value / 2))),
}))

const look = computed(() => THEME_LOOK[props.tiles.theme])

const FILL: Record<string, string> = {
  rock: '#232c44', floor: '#3b4763', rubble: '#333d57', water: '#2a4a6b',
  bridge: '#6b5536', ledge: '#2c3550', accent: '#6b7a99', stairs: '#e0c070',
}

const cells = computed(() => {
  const out: { x: number; y: number; kind: string; fill: string }[] = []
  for (let y = 0; y < height.value; y++) {
    for (let x = 0; x < width.value; x++) {
      const tx = origin.value.x + x
      const ty = origin.value.y + y
      const kind = tileAt(props.tiles, tx, ty)
      const fill = kind === 'accent' ? look.value.accent : kind === 'water' ? look.value.water : FILL[kind]
      out.push({ x: x * TILE, y: y * TILE, kind, fill })
    }
  }
  return out
})

const visible = computed(() => props.entities
  .filter(entity => !entity.taken)
  .map(entity => ({
    entity,
    x: (entity.at.x - origin.value.x) * TILE,
    y: (entity.at.y - origin.value.y) * TILE,
  }))
  .filter(item => item.x >= -TILE && item.y >= -TILE && item.x < width.value * TILE && item.y < height.value * TILE))

const playerAt = computed(() => ({
  x: (props.player.x - origin.value.x) * TILE,
  y: (props.player.y - origin.value.y) * TILE,
}))

const colourOf = (entity: FloorEntity): string =>
  entity.kind === 'chest' ? '#e0b050'
    : entity.kind === 'lucky' ? '#8ef0c0'
      : entity.isAlpha ? '#ff5252' : '#ff9f7a'

const labelOf = (entity: FloorEntity): string =>
  entity.kind === 'chest' ? '▣' : entity.kind === 'lucky' ? '✦' : entity.isAlpha ? '★' : '●'

const nameOf = (entity: FloorEntity): string =>
  entity.kind === 'chest' ? `Cofre ${entity.rarity}`
    : `${speciesById(entity.speciesId ?? 0)?.name ?? '???'} Nv. ${entity.level}`
</script>

<template>
  <div class="fv">
    <svg :viewBox="`0 0 ${width * TILE} ${height * TILE}`" width="100%" role="img" :aria-label="`Piso (${look.name})`">
      <rect
        v-for="(cell, i) in cells" :key="i"
        :x="cell.x" :y="cell.y" :width="TILE" :height="TILE" :fill="cell.fill"
        :stroke="cell.kind === 'rock' ? '#1b2235' : 'none'" stroke-width="0.5"
      />
      <!-- Stairs read as the way down even before you stand on them. -->
      <g v-for="(item, i) in visible" :key="`e${i}`">
        <circle :cx="item.x + TILE / 2" :cy="item.y + TILE / 2" :r="item.entity.isAlpha ? 9 : 6" :fill="colourOf(item.entity)" />
        <text
          :x="item.x + TILE / 2" :y="item.y + TILE / 2 + 4"
          text-anchor="middle" font-size="9" fill="#101728"
        >{{ labelOf(item.entity) }}</text>
      </g>
      <g>
        <circle :cx="playerAt.x + TILE / 2" :cy="playerAt.y + TILE / 2" r="6" fill="#ffd27a" />
        <circle :cx="playerAt.x + TILE / 2" :cy="playerAt.y + TILE / 2" r="8" fill="none" stroke="#ffd27a" opacity="0.4" />
      </g>
    </svg>
    <ul class="fv-legend">
      <li v-for="(item, i) in visible.slice(0, 4)" :key="`l${i}`">
        <span :style="{ color: colourOf(item.entity) }">{{ labelOf(item.entity) }}</span> {{ nameOf(item.entity) }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.fv svg { display: block; border-radius: 10px; background: #151c2e; image-rendering: pixelated; }
.fv-legend { display: flex; flex-wrap: wrap; gap: 10px; margin: 6px 0 0; padding: 0; list-style: none; font-size: 0.72rem; color: #93a2c6; }
</style>
