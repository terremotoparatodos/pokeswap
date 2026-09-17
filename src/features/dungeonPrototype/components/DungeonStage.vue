<script setup lang="ts">
// The stage: the canvas the dungeon is drawn on, plus the way in (D1.1 §3, §4).
//
// It owns the camera smoothing and the input, and nothing else. Every rule
// comes from the session it is handed.

import { onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { Dir } from '../../wildlands/engine/characters'
import { DungeonRenderer, type RenderView, type Vfx } from '../render/dungeonRenderer'
import { facingOf } from '../render/dungeonSprites'

const props = defineProps<{ view: RenderView | null; pad?: boolean }>()
const emit = defineEmits<{ (event: 'step', dx: number, dy: number): void }>()

const canvas = ref<HTMLCanvasElement | null>(null)
const renderer = shallowRef<DungeonRenderer | null>(null)
/** Smoothed position, so a step reads as a walk instead of a teleport. */
const smooth = ref({ x: 0, y: 0 })
const facing = ref<Dir>('down')
const moving = ref(false)
let frame = 0
let held: { dx: number; dy: number } | null = null
let lastStep = 0

/** PLAYTEST PARAMETER: how fast a held key repeats, in steps per second. */
const STEP_RATE = 6.5

function step(dx: number, dy: number): void {
  if (dx || dy) facing.value = facingOf(dx, dy, facing.value)
  emit('step', dx, dy)
}

function loop(now: number): void {
  const view = props.view
  const draw = renderer.value
  if (view && draw) {
    if (held && now - lastStep > 1000 / STEP_RATE) {
      lastStep = now
      step(held.dx, held.dy)
    }
    // Ease towards the tile the session says we are on.
    const target = view.player
    const dx = target.x - smooth.value.x
    const dy = target.y - smooth.value.y
    const distance = Math.hypot(dx, dy)
    moving.value = distance > 0.04
    if (distance > 0.001) {
      const k = Math.min(1, 0.22 + distance * 0.1)
      smooth.value = { x: smooth.value.x + dx * k, y: smooth.value.y + dy * k }
    } else {
      smooth.value = { x: target.x, y: target.y }
    }
    draw.draw({
      ...view,
      player: { x: smooth.value.x, y: smooth.value.y, dir: facing.value, moving: moving.value },
    })
  }
  frame = requestAnimationFrame(loop)
}

const KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1], KeyW: [0, -1], ArrowDown: [0, 1], KeyS: [0, 1],
  ArrowLeft: [-1, 0], KeyA: [-1, 0], ArrowRight: [1, 0], KeyD: [1, 0],
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
  const dir = KEYS[event.code]
  if (!dir) return
  event.preventDefault()
  if (!held || held.dx !== dir[0] || held.dy !== dir[1]) {
    held = { dx: dir[0], dy: dir[1] }
    lastStep = performance.now()
    step(dir[0], dir[1])
  }
}

function onKeyUp(event: KeyboardEvent): void {
  if (KEYS[event.code]) held = null
}

/** Touch: press and hold a pad button walks, exactly like a held key. */
function press(dx: number, dy: number): void {
  held = { dx, dy }
  lastStep = performance.now()
  step(dx, dy)
}
const release = (): void => { held = null }

onMounted(() => {
  if (canvas.value) renderer.value = new DungeonRenderer(canvas.value)
  if (props.view) smooth.value = { x: props.view.player.x, y: props.view.player.y }
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', release)
  frame = requestAnimationFrame(loop)
})

onUnmounted(() => {
  cancelAnimationFrame(frame)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('blur', release)
})

// A floor change is a jump, not a walk: snap instead of sliding across the map.
watch(() => props.view?.tiles, () => {
  if (props.view) smooth.value = { x: props.view.player.x, y: props.view.player.y }
})

defineExpose({
  spawn: (effect: Vfx) => renderer.value?.spawn(effect),
  clearVfx: () => renderer.value?.clearVfx(),
})
</script>

<template>
  <div class="ds">
    <canvas ref="canvas" class="ds-canvas" />
    <div v-if="pad !== false" class="ds-pad" aria-label="Movimiento">
      <button type="button" class="ds-key ds-up" @pointerdown.prevent="press(0, -1)" @pointerup="release" @pointerleave="release">▲</button>
      <button type="button" class="ds-key ds-left" @pointerdown.prevent="press(-1, 0)" @pointerup="release" @pointerleave="release">◀</button>
      <button type="button" class="ds-key ds-right" @pointerdown.prevent="press(1, 0)" @pointerup="release" @pointerleave="release">▶</button>
      <button type="button" class="ds-key ds-down" @pointerdown.prevent="press(0, 1)" @pointerup="release" @pointerleave="release">▼</button>
    </div>
    <slot />
  </div>
</template>

<style scoped>
.ds { position: relative; overflow: hidden; border-radius: 12px; background: #0b1020; }
.ds-canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; touch-action: none; }
/* The pad floats over the world so the map keeps the whole panel. */
.ds-pad {
  position: absolute; left: 10px; bottom: 10px;
  display: grid; grid-template-columns: repeat(3, 46px); grid-template-rows: repeat(3, 46px);
  opacity: 0.85;
}
.ds-key {
  border: 1px solid #3a4767; border-radius: 10px;
  background: rgba(23, 32, 56, 0.86); color: #e8eeff; font-size: 1rem; cursor: pointer;
  border-color: #3a4767;
}
.ds-key:active { background: #ffd27a; color: #221a06; }
.ds-up { grid-area: 1 / 2; }
.ds-left { grid-area: 2 / 1; }
.ds-right { grid-area: 2 / 3; }
.ds-down { grid-area: 3 / 2; }
</style>
