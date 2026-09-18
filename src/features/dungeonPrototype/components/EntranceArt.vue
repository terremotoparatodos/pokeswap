<script setup lang="ts">
// The mouth of the dungeon (D1.2 §25).
//
// A small strip of simulated overworld on each card: real WildLands ground
// texture, real props, the real trainer sprite, and the cave mouth the dungeon
// opens through. It is not wired into the overworld yet — it exists so the step
// from WildLands into a Dungeon can be looked at.

import { onMounted, ref } from 'vue'
import { buildTrainer, PLAYER_PALETTE } from '../../wildlands/engine/characters'
import { buildPropSprites } from '../../wildlands/engine/props'
import { sampleTexture, terrainArt } from '../../wildlands/engine/terrainArt'
import { T, type DecorKind } from '../../wildlands/engine/world'
import type { DungeonTheme } from '../domain/tiers'
import { entranceSprite } from '../world/dungeonProps'

const props = defineProps<{ theme: DungeonTheme }>()

const canvas = ref<HTMLCanvasElement | null>(null)

const GROUND: Record<DungeonTheme, number> = {
  cave: T.GRASS, mine: T.SAND, glacier: T.SNOW, forest: T.GRASS,
  volcano: T.DUNE, ruin: T.SAND, tower: T.GRASS,
}

const SIDE: Record<DungeonTheme, DecorKind[]> = {
  cave: ['tree', 'bush', 'rock'], mine: ['rock', 'boulder', 'drybush'],
  glacier: ['snowpine', 'icerock', 'crystal'], forest: ['pine', 'tree', 'bush'],
  volcano: ['boulder', 'rock', 'drybush'], ruin: ['cactus', 'rock', 'boulder'],
  tower: ['crystal', 'rock', 'bush'],
}

const W = 132
const H = 40
const SCALE = 2

onMounted(() => {
  const element = canvas.value
  const ctx = element?.getContext('2d')
  if (!element || !ctx) return
  element.width = W * SCALE
  element.height = H * SCALE
  ctx.imageSmoothingEnabled = false

  // Ground: the same seamless texture the overworld walks on.
  const texture = terrainArt().textures[GROUND[props.theme]]
  const buffer = new Uint32Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) buffer[y * W + x] = sampleTexture(texture, x, y)
  const image = ctx.createImageData(W, H)
  new Uint32Array(image.data.buffer).set(buffer)
  const flat = document.createElement('canvas')
  flat.width = W
  flat.height = H
  flat.getContext('2d')?.putImageData(image, 0, 0)
  ctx.drawImage(flat, 0, 0, W * SCALE, H * SCALE)

  const draw = (sprite: { canvas: HTMLCanvasElement; w: number; h: number; ax: number; ay: number }, x: number, y: number) => {
    ctx.drawImage(sprite.canvas, (x - sprite.ax) * SCALE, (y - sprite.ay) * SCALE, sprite.w * SCALE, sprite.h * SCALE)
  }

  const sprites = buildPropSprites()
  const side = SIDE[props.theme]
  draw(sprites[side[0]], 16, H - 4)
  draw(sprites[side[1]], W - 18, H - 6)
  draw(sprites[side[2]], W - 34, H - 2)
  draw(entranceSprite(), W / 2, H - 6)
  // The player, walking up to it.
  draw(buildTrainer(PLAYER_PALETTE).up[0], W / 2 - 2, H - 1)
})
</script>

<template>
  <canvas ref="canvas" class="ea" aria-hidden="true" />
</template>

<style scoped>
.ea { display: block; width: 100%; height: 74px; border-radius: 8px; object-fit: cover; image-rendering: pixelated; }
</style>
