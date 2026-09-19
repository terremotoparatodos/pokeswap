<script setup lang="ts">
// City Mapping Lab — the viewport (DEV only).
//
// One real WildLands `Renderer` draws both modes. EDIT feeds it the working
// copy with a free camera and the lab's debug layers; PLAY feeds it the same
// copy with the player, the populace and the town's own lens (labPlay.ts).
// Switching modes swaps the scene, never the renderer, so nothing reloads.

import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { createActor } from '../../wildlands/engine/actors'
import { lighting } from '../../wildlands/engine/atmosphere'
import { loadNpcTrainerArt, type Dir } from '../../wildlands/engine/characters'
import { KeyboardInput } from '../../wildlands/engine/keyboard'
import type { Tile } from '../../wildlands/engine/pathfinding'
import { PlayerAppearance } from '../../wildlands/engine/playerAppearance'
import { LENSES, type CameraLens, type LensName } from '../../wildlands/engine/projection'
import { buildPropSprites } from '../../wildlands/engine/props'
import { Renderer, type RouteMarker, type Scene } from '../../wildlands/engine/renderer'
import { TILE } from '../../wildlands/engine/world'
import { DEFAULT_PLAYER_CHARACTER_ID, playerCharacter } from '../../wildlands/identity/playerCharacters'
import { brushTiles, moveEntity, previewAdd, previewSolidTiles, previewTiles } from '../domain/editOps'
import { treeCollisionTiles, treeFeet, treeTapBounds } from '../../worldAssets/trees/cityTrees'
import type { Pick } from '../../wildlands/engine/renderer'
import { anchorOf, type EntityRef } from '../domain/labCity'
import type { CityLab } from '../state/useCityLab'
import { drawScreenOverlay, LabGroundOverlay, markerThings, type OverlayInputs } from '../world/labOverlay'
import { pickEntity } from '../world/labPicking'
import { LabPlay } from '../world/labPlay'
import { contains, EDIT_LENSES, frameGeometry, tileAt, uprightRect, viewOf, worldAt, type FrameGeometry } from '../world/labProjection'
import { clampZoom, fitZoom, stepZoom, wheelZoom, withZoom, zoomAt } from '../world/editorCamera'
import { isDrag, pressGesture, type Gesture } from '../world/editorGestures'
import { drawnThings, type DrawnThing } from '../world/labThings'

const props = defineProps<{ lab: CityLab }>()
const lab = props.lab

// Same sheet the game loads for NPCs (engine/game.ts).
const NPC_SHEET = '/assets/trainers/protahombre.png'
const LENS_ORDER: LensName[] = ['handheld', 'dramatic', 'cenital']
const NO_ROUTE: RouteMarker = { tiles: [], target: null, rejected: null }
/** Keyboard pan (WASD), world px per second at 100 %. */
const PAN_SPEED = 260

const canvas = ref<HTMLCanvasElement | null>(null)
const overlayCanvas = ref<HTMLCanvasElement | null>(null)
const toast = ref<string | null>(null)
const playTile = ref<Tile | null>(null)
const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
let renderer: Renderer | null = null
let overlayCtx: CanvasRenderingContext2D | null = null
let frameId = 0
let last = 0
let seconds = 0
let geometry: FrameGeometry | null = null
const play = shallowRef<LabPlay | null>(null)
let playLens: LensName = 'handheld'
let playGrid = false

// EDIT camera (lab.editCamera, world px + lab.zoom) and pointer state.
const cam = lab.editCamera
const held = new Set<string>()
const ghost = shallowRef<{ tiles: readonly Tile[]; solid?: readonly Tile[]; valid: boolean } | null>(null)
const stroke = shallowRef<Tile[] | null>(null)
/** Space held: the next left press pans from anywhere (cursor shows the hand). */
const spaceHeld = ref(false)
const panning = ref(false)
/**
 * A press in progress. It only becomes a drag past DRAG_THRESHOLD; until then
 * a release is a click (select / place / deselect) — see editorGestures.ts.
 */
interface Press {
  gesture: Gesture
  start: { x: number; y: number }
  dragging: boolean
  /** World point grabbed, for panning (the map follows the cursor 1:1). */
  grab: { x: number; y: number } | null
  /** Object drag: the entity, grab offset and current target tile. */
  ref: EntityRef | null
  offset: Tile
  target: Tile | null
  tile: Tile | null
}
let current: Press | null = null
/** Where the editor camera was before PLAY, restored on the way back. */
let beforePlay: { x: number; y: number } | null = null
/**
 * Last cursor position over the canvas (CSS px). Zoom buttons, keys and WASD
 * move the map under a still cursor: the hovered tile and the placement
 * preview are recomputed from here every frame, not only on mouse moves.
 */
let pointer: { x: number; y: number } | null = null

const propSprites = buildPropSprites()
const dummy = createActor({ id: 'lab-camera', kind: 'player', habitat: 'any', tx: 0, ty: 0 })
const spawnActor = createActor({ id: 'lab-spawn', kind: 'player', habitat: 'any', tx: 0, ty: 0 })

const area = computed(() => lab.grid.value.area)
/**
 * The area on screen. A new working copy is a new `TownArea`, which bakes its
 * ground and swaps the code-painted fallbacks for the (already cached) PNGs a
 * few microtasks later; showing it only after that avoids a flash per edit.
 */
const shown = shallowRef(area.value)
watch(area, next => {
  next.decorIn(0, 0, 1, 1)
  setTimeout(() => { if (area.value === next) shown.value = next }, 0)
})
const overlayInputs = (): OverlayInputs => ({
  city: lab.city.value,
  grid: lab.grid.value,
  clearance: lab.clearance.value,
  layers: lab.layers,
  hover: lab.mode.value === 'edit' ? lab.hover.value : null,
  selection: lab.mode.value === 'edit' ? lab.selection.value : null,
  ghost: ghost.value,
  brush: lab.mode.value === 'edit' && lab.tool.value === 'terrain'
    ? [...(stroke.value ?? []), ...(lab.hover.value ? brushTiles(lab.hover.value, lab.brushSize.value) : [])]
    : null,
  highlight: lab.highlight.value,
  npcLooks: () => renderer?.npcSprites ?? [],
  spawnLook: () => spawnActor.trainer,
})
const editOverlay = new LabGroundOverlay(overlayInputs)
// PLAY keeps the physical layers (solids, clearance, entrances and exits…) but otherwise looks like the game: no grid, no markers.
const playOverlay = new LabGroundOverlay(() => ({ ...overlayInputs(), layers: { ...lab.layers, grid: false, markers: false, coords: false }, ghost: null, brush: null }))

const keys = new KeyboardInput({
  cycleLens: () => { playLens = LENS_ORDER[(LENS_ORDER.indexOf(playLens) + 1) % LENS_ORDER.length] },
  toggleGrid: () => { playGrid = !playGrid },
  skipTime: () => { lab.clock.value = (lab.clock.value + 0.125) % 1 },
  interact: () => play.value?.interact(),
})

function editLens(): CameraLens {
  return withZoom(EDIT_LENSES[lab.editLens.value], lab.zoom.value)
}

function things(): DrawnThing[] {
  const decor = shown.value.decorIn(-1e6, -1e6, 1e6, 1e6)
  return [...drawnThings(lab.city.value, decor, propSprites), ...markerThings(overlayInputs())]
}

function loop(now: number): void {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000))
  last = now
  seconds += dt
  const r = renderer
  const c = canvas.value
  if (r && c) {
    const scene = lab.mode.value === 'play' && play.value ? playScene(dt) : editScene(dt)
    r.render(scene, dt)
    geometry = frameGeometry(c, scene.lens, scene.camX, scene.camY)
    if (lab.mode.value === 'edit') refreshHover()
    drawOverlay()
  }
  frameId = requestAnimationFrame(loop)
}

function editScene(dt: number): Scene {
  // Held WASD / arrows (without a selection) pan the camera; Shift pans faster.
  let dx = 0
  let dy = 0
  const arrows = !lab.selection.value
  if (held.has('KeyA') || (arrows && held.has('ArrowLeft'))) dx--
  if (held.has('KeyD') || (arrows && held.has('ArrowRight'))) dx++
  if (held.has('KeyW') || (arrows && held.has('ArrowUp'))) dy--
  if (held.has('KeyS') || (arrows && held.has('ArrowDown'))) dy++
  const speed = PAN_SPEED * (held.has('ShiftLeft') || held.has('ShiftRight') ? 2.5 : 1) / lab.zoom.value
  if (dx || dy) {
    cam.x += dx * speed * dt
    cam.y += dy * speed * dt
    lab.rememberView()
  }
  dummy.tx = dummy.fromTx = Math.floor(cam.x / TILE)
  dummy.ty = dummy.fromTy = Math.floor(cam.y / TILE)
  return {
    area: shown.value, fade: 0, camX: cam.x, camY: cam.y, lens: editLens(), seconds, light: lighting(lab.clock.value),
    weather: { kind: 'clear', intensity: 0 }, player: dummy, companion: null, username: null, showPlayer: false,
    actors: [], showGrid: false, route: NO_ROUTE, overlay: editOverlay,
  }
}

let hudTimer = 0
function playScene(dt: number): Scene {
  const p = play.value!
  p.update(dt, keys.direction, keys.sprinting)
  hudTimer -= dt
  if (hudTimer <= 0) {
    hudTimer = 0.15
    toast.value = p.toast?.text ?? null
    playTile.value = p.position
  }
  return {
    area: p.area, fade: 0, camX: p.camX, camY: p.camY, lens: LENSES[playLens], seconds, light: lighting(lab.clock.value),
    weather: { kind: 'clear', intensity: 0 }, player: p.player, companion: null, username: null, showPlayer: true,
    actors: p.populace.actors, showGrid: playGrid, route: p.route, overlay: playOverlay,
  }
}

function drawOverlay(): void {
  const o = overlayCanvas.value
  const f = geometry
  if (!o || !f) return
  if (o.width !== f.width || o.height !== f.height) {
    o.width = f.width
    o.height = f.height
  }
  overlayCtx ??= o.getContext('2d')
  if (!overlayCtx) return
  const editing = lab.mode.value === 'edit'
  const selection = editing ? lab.selection.value : null
  if (!lab.layers.bounds && !selection) {
    overlayCtx.clearRect(0, 0, o.width, o.height)
    return
  }
  drawScreenOverlay(overlayCtx, f, { things: things(), bounds: lab.layers.bounds, selection })
}

// ── EDIT input ─────────────────────────────────────────────────────────────

/** In the Agregar tool, what would be placed under the cursor: visual cell, trunk and validity, before clicking. */
function previewPlacement(): void {
  const at = lab.hover.value
  const kind = at ? lab.paletteKind(at) : null
  const busy = current?.dragging ?? false
  if (lab.mode.value !== 'edit' || lab.tool.value !== 'add' || !at || !kind || busy) {
    if (!busy) ghost.value = null
    return
  }
  const p = previewAdd(lab.base, lab.city.value, kind, at)
  ghost.value = { tiles: p.tiles, solid: p.solid, valid: p.valid }
}
watch([lab.tool, lab.palette, lab.city], previewPlacement)

/**
 * PLAY taps: an actor still wins (renderer.pick), then a placed city tree's
 * tap hitbox — so touching a crown walks to the tree instead of the tile
 * behind it — then the ground.
 */
function playPick(cssX: number, cssY: number): Pick {
  const pick = renderer!.pick(cssX, cssY)
  const f = geometry
  const p = play.value
  if (pick.actor || !f || !p) return pick
  let best: { y: number; tile: Tile } | null = null
  for (const t of p.area.trees) {
    const feet = treeFeet(t.tx, t.ty)
    const r = uprightRect(f, feet.x, feet.y, treeTapBounds(t.kind))
    if (!r || !contains(r, cssX * f.dpr, cssY * f.dpr)) continue
    if (!best || feet.y >= best.y) best = { y: feet.y, tile: treeCollisionTiles(t.kind, t.tx, t.ty)[0] }
  }
  return best ? { tile: best.tile, actor: null } : pick
}

function local(e: PointerEvent | WheelEvent): { x: number; y: number } {
  const rect = canvas.value!.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function onPointerDown(e: PointerEvent): void {
  if (!geometry) return
  const at = local(e)
  if (lab.mode.value === 'play') {
    if (renderer && play.value) play.value.tap(playPick(at.x, at.y))
    return
  }
  e.preventDefault()
  pointer = at
  canvas.value?.setPointerCapture(e.pointerId)
  const tile = tileAt(geometry, at.x, at.y)
  const hit = lab.tool.value === 'select' && e.button === 0 && !spaceHeld.value && !e.altKey
    ? pickEntity(geometry, lab.city.value, lab.grid.value, things(), at.x, at.y)
    : null
  const gesture = pressGesture({ button: e.button, spaceHeld: spaceHeld.value, altKey: e.altKey, tool: lab.tool.value, onEntity: !!hit?.ref })
  const anchor = hit?.ref ? anchorOf(lab.city.value, hit.ref) : null
  current = {
    gesture, start: at, dragging: false, grab: worldAt(geometry, at.x, at.y),
    ref: hit?.ref ?? null,
    offset: anchor && hit?.tile ? { tx: anchor.tx - hit.tile.tx, ty: anchor.ty - hit.tile.ty } : { tx: 0, ty: 0 },
    target: null, tile,
  }
  // Selecting and painting answer at once; everything else waits to know if it is a click or a drag.
  if (gesture.click === 'select') lab.select(hit!.ref)
  if (gesture.drag === 'paint' && tile) stroke.value = brushTiles(tile, lab.brushSize.value)
  if (gesture.drag === 'pan' && gesture.click === 'none') startPan()
}

function startPan(): void {
  if (!current) return
  current.dragging = true
  panning.value = true
  ghost.value = null
}

/** The tile under the last known cursor position, as the current frame projects it. */
function refreshHover(): void {
  if (!geometry || !pointer) return
  const tile = tileAt(geometry, pointer.x, pointer.y)
  const inside = tile && lab.grid.value.inBounds(tile.tx, tile.ty) ? tile : null
  if (lab.hover.value?.tx !== inside?.tx || lab.hover.value?.ty !== inside?.ty) {
    lab.hover.value = inside
    previewPlacement()
  }
}

function onPointerMove(e: PointerEvent): void {
  if (!geometry || lab.mode.value === 'play') return
  const at = local(e)
  pointer = at
  const tile = tileAt(geometry, at.x, at.y)
  refreshHover()
  const p = current
  if (!p) return
  if (!p.dragging) {
    if (!isDrag(p.start, at)) return
    if (p.gesture.drag === 'pan') startPan()
    else p.dragging = true
  }
  if (p.gesture.drag === 'pan') {
    // The grabbed world point stays under the cursor: the map follows the mouse 1:1.
    const now = worldAt(geometry, at.x, at.y)
    if (now && p.grab) {
      cam.x += p.grab.x - now.x
      cam.y += p.grab.y - now.y
    }
  } else if (p.gesture.drag === 'paint') {
    if (!tile) return
    const seen = new Set(stroke.value!.map(t => `${t.tx},${t.ty}`))
    const add = brushTiles(tile, lab.brushSize.value).filter(t => !seen.has(`${t.tx},${t.ty}`))
    if (add.length) stroke.value = [...stroke.value!, ...add]
  } else if (tile && p.ref) {
    const target = { tx: tile.tx + p.offset.tx, ty: tile.ty + p.offset.ty }
    if (p.target?.tx === target.tx && p.target?.ty === target.ty) return
    p.target = target
    const check = moveEntity(lab.base, lab.city.value, p.ref, target)
    ghost.value = { tiles: previewTiles(lab.city.value, p.ref, target), solid: previewSolidTiles(lab.city.value, p.ref, target), valid: check.ok }
    if (!check.ok) lab.say(`✖ ${check.errors.join(' ')}`, 'error')
    else lab.say(`Soltá para mover a (${target.tx}, ${target.ty})${check.warnings.length ? ` — ⚠ ${check.warnings.join(' ')}` : ''}`, check.warnings.length ? 'warn' : 'info')
  }
}

function onPointerUp(): void {
  const p = current
  current = null
  if (!p) return
  const wasPan = panning.value
  panning.value = false
  if (p.gesture.drag === 'paint') {
    if (stroke.value) lab.paint(stroke.value)
    stroke.value = null
  } else if (p.dragging) {
    // A drag never places or deselects: it panned or moved an object.
    if (p.gesture.drag === 'object' && p.ref && p.target) lab.moveTo(p.ref, p.target)
    if (wasPan) lab.rememberView()
  } else if (p.gesture.click === 'place' && p.tile) {
    lab.addAt(p.tile)
  } else if (p.gesture.click === 'deselect') {
    lab.select(null)
  }
  ghost.value = null
  previewPlacement()
}

/** Zoom keeping the world point under `cursor` (CSS px) where it is; the view centre when absent. */
function zoomTo(next: number, cursor?: { x: number; y: number }): void {
  const c = canvas.value
  if (!c || lab.mode.value !== 'edit') return
  const view = viewOf(c)
  const point = cursor ? { sx: cursor.x * view.dpr, sy: cursor.y * view.dpr } : { sx: view.width / 2, sy: view.height * 0.56 }
  const moved = zoomAt({ x: cam.x, y: cam.y, zoom: lab.zoom.value }, next, point, view, EDIT_LENSES[lab.editLens.value])
  cam.x = moved.x
  cam.y = moved.y
  lab.zoom.value = moved.zoom
  lab.rememberView()
}

function onWheel(e: WheelEvent): void {
  if (lab.mode.value !== 'edit') return
  e.preventDefault()
  zoomTo(wheelZoom(lab.zoom.value, e.deltaY), local(e))
}

function zoomIn(): void { zoomTo(stepZoom(lab.zoom.value, 1)) }
function zoomOut(): void { zoomTo(stepZoom(lab.zoom.value, -1)) }
function zoomReset(): void { zoomTo(1) }

/** Frames the whole city (as far as the zoom range allows). */
function fitCity(): void {
  const c = canvas.value
  if (!c) return
  const view = viewOf(c)
  const fit = fitZoom(lab.grid.value.width * TILE, lab.grid.value.height * TILE, view, EDIT_LENSES[lab.editLens.value])
  cam.x = fit.x
  cam.y = fit.y
  lab.zoom.value = clampZoom(fit.zoom)
  lab.rememberView()
}

function onLeave(): void {
  pointer = null
  lab.hover.value = null
}

function typing(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

const NUDGE: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }

function onKeyDown(e: KeyboardEvent): void {
  if (typing(e)) return
  const mod = e.ctrlKey || e.metaKey
  if (lab.mode.value === 'play') {
    if (e.code === 'Escape' || e.code === 'KeyP') setMode('edit')
    return
  }
  if (e.code === 'Space') { e.preventDefault(); spaceHeld.value = true; return }
  if (mod && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) lab.redo(); else lab.undo(); return }
  if (mod && e.code === 'KeyY') { e.preventDefault(); lab.redo(); return }
  if (mod && e.code === 'KeyD') { e.preventDefault(); lab.duplicateSelected(); return }
  if (mod) return
  if (e.key === '+' || e.code === 'NumpadAdd' || e.code === 'Equal') { e.preventDefault(); zoomIn(); return }
  if (e.key === '-' || e.code === 'NumpadSubtract' || e.code === 'Minus') { e.preventDefault(); zoomOut(); return }
  if (e.key === '0' || e.code === 'Numpad0') { e.preventDefault(); zoomReset(); return }
  if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); lab.deleteSelected(); return }
  if (e.code === 'Escape') { lab.select(null); lab.tool.value = 'select'; return }
  if (e.code === 'KeyP') { setMode('play'); return }
  if (e.code === 'KeyG') { lab.layers.grid = !lab.layers.grid; return }
  const nudge = NUDGE[e.code]
  const sel = lab.selection.value
  if (nudge && sel) {
    e.preventDefault()
    const at = anchorOf(lab.city.value, sel)
    if (at) lab.moveTo(sel, { tx: at.tx + nudge[0], ty: at.ty + nudge[1] })
    return
  }
  if (NUDGE[e.code]) e.preventDefault()
  held.add(e.code)
}

function onKeyUp(e: KeyboardEvent): void {
  held.delete(e.code)
  if (e.code === 'Space') spaceHeld.value = false
}

function onBlur(): void {
  held.clear()
  spaceHeld.value = false
}

// ── Modes ──────────────────────────────────────────────────────────────────

function setMode(mode: 'edit' | 'play'): void {
  lab.mode.value = mode
}

watch(lab.mode, mode => {
  current = null
  panning.value = false
  ghost.value = null
  stroke.value = null
  if (mode === 'play' && renderer) {
    const city = lab.city.value
    const from = lab.playFrom.value
    const start = from ? { ...from, dir: 'down' as Dir } : city.spawn
    // The populace snaps residents off solid tiles, exactly like the game.
    const p = new LabPlay(area.value, start, renderer.playerSprites, renderer.npcSprites)
    loadNpcTrainerArt(NPC_SHEET, renderer.npcSprites, () => p.populace.actors)
    play.value = p
    playLens = area.value.lens
    beforePlay = { x: cam.x, y: cam.y }
    keys.attach()
  } else {
    keys.detach()
    // Back to EDIT: the editor's own pan and zoom, as they were before PLAY.
    if (beforePlay) {
      cam.x = beforePlay.x
      cam.y = beforePlay.y
      beforePlay = null
    }
    play.value = null
    toast.value = null
    playTile.value = null
  }
})

/** Frames the camera on a tile (findings, selection). */
function focus(tile: Tile): void {
  cam.x = tile.tx * TILE + TILE / 2
  cam.y = tile.ty * TILE + TILE / 2
  lab.rememberView()
}

defineExpose({ focus, zoomIn, zoomOut, zoomReset, fitCity })

function press(dir: Dir | null): void {
  keys.virtualDir = dir
}

onMounted(() => {
  if (!canvas.value) return
  renderer = new Renderer(canvas.value)
  new PlayerAppearance(spawnActor, renderer.playerSprites).set(playerCharacter(DEFAULT_PLAYER_CHARACTER_ID))
  loadNpcTrainerArt(NPC_SHEET, renderer.npcSprites, () => [])
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)
  // Releasing outside the canvas (or a lost capture) must still finish the drag.
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('mouseup', onPointerUp)
  last = performance.now()
  frameId = requestAnimationFrame(loop)
})

onUnmounted(() => {
  cancelAnimationFrame(frameId)
  keys.detach()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('blur', onBlur)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('mouseup', onPointerUp)
})
</script>

<template>
  <div class="stage" :class="{ 'stage--play': lab.mode.value === 'play', 'stage--grab': spaceHeld && !panning, 'stage--panning': panning }">
    <canvas
      ref="canvas" class="stage-canvas"
      @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerUp"
      @pointerleave="onLeave" @wheel="onWheel" @contextmenu.prevent
    />
    <canvas ref="overlayCanvas" class="stage-overlay" />
    <template v-if="lab.mode.value === 'play'">
      <div class="stage-hud">PLAY · ({{ playTile?.tx }}, {{ playTile?.ty }}) · Shift corre · E habla · V lente · N hora · Esc vuelve a EDIT</div>
      <div v-if="toast" class="stage-toast">{{ toast }}</div>
      <div v-if="coarse" class="stage-pad">
        <button
v-for="d in (['up', 'left', 'right', 'down'] as Dir[])" :key="d" type="button" :class="`pad-${d}`"
          @pointerdown.prevent="press(d)" @pointerup="press(null)" @pointerleave="press(null)" @pointercancel="press(null)">
          {{ { up: '▲', left: '◀', right: '▶', down: '▼' }[d] }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.stage { position: relative; overflow: hidden; background: #0b0f1a; min-height: 0; user-select: none; -webkit-user-select: none; }
.stage--grab .stage-canvas { cursor: grab; }
.stage--panning .stage-canvas { cursor: grabbing; }
.stage-canvas { display: block; width: 100%; height: 100%; image-rendering: pixelated; cursor: crosshair; touch-action: none; }
.stage--play .stage-canvas { cursor: pointer; }
.stage-overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.stage-hud {
  position: absolute; top: 8px; left: 8px; padding: 4px 8px; border-radius: 6px;
  background: rgba(8, 12, 24, 0.72); color: #dfe7ff; font: 12px/1.3 system-ui, sans-serif;
}
.stage-toast {
  position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); max-width: min(90%, 560px);
  padding: 8px 12px; border-radius: 8px; background: rgba(8, 12, 24, 0.85); color: #fff; font: 14px/1.35 system-ui, sans-serif; text-align: center;
}
.stage-pad { position: absolute; left: 12px; bottom: 12px; display: grid; grid-template-columns: repeat(3, 48px); grid-template-rows: repeat(3, 48px); }
.stage-pad button {
  border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 10px; background: rgba(10, 16, 30, 0.6); color: #e8eeff; touch-action: none;
}
.pad-up { grid-area: 1 / 2; }
.pad-left { grid-area: 2 / 1; }
.pad-right { grid-area: 2 / 3; }
.pad-down { grid-area: 3 / 2; }
</style>
