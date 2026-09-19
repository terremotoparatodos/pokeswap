<template>
  <p v-if="hint" class="de-hint">
    <span class="de-badge">Dungeon</span> {{ hint }}
  </p>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import type { Area } from '../../wildlands/engine/area'
import { placedObject, type PlacedObject, type PlacedObjectSpec } from '../../wildlands/engine/placedObjects'
import type { WorldProbeTarget } from '../../wildlands/engine/worldProbes'
import { toneForBiome, type CaveTone } from '../art/caveEntranceArt'
import { areaEntrances, COMMUNITY_PLAYTEST_MINUTES, type AreaEntrance } from '../domain/entranceSpawns'
import { CaveOverlay } from '../world/caveOverlay'

// The physical presence of Dungeons in WildLands, and nothing else: it derives
// the caves of the area the player is in, hands them to the engine as solid
// placed objects, draws them, and reports when somebody walks into one.
//
// It does not run a dungeon. Entering is an event the host decides what to do
// with, which keeps this component out of the expedition's business entirely.

interface PlayerSnapshot {
  readonly tx: number
  readonly ty: number
  readonly areaId: string
}

const props = defineProps<{
  game: { playerSnapshot(): PlayerSnapshot } | null
  /** Tiles another feature has already claimed (profession nodes, stations). */
  isTaken?: (area: Area, tx: number, ty: number) => boolean
}>()

const emit = defineEmits<{ enter: [entrance: AreaEntrance] }>()

/** Caves of the area the player is in, paired with the object the engine holds. */
const placed = shallowRef<readonly { entrance: AreaEntrance; object: PlacedObject }[]>([])
const tone = ref<CaveTone>('stone')
const overlay = new CaveOverlay({
  entrances: () => placed.value,
  player: () => props.game?.playerSnapshot() ?? null,
  tone: () => tone.value,
  now: () => Date.now(),
})

/**
 * The area's own seed. Derived from the id rather than reached for through the
 * concrete `WildArea`, because `Area` is the contract the engine speaks and a
 * cast to get at a field would be the first crack in it. Same id, same caves,
 * for everyone.
 */
function seedOf(areaId: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < areaId.length; i++) hash = Math.imul(hash ^ areaId.charCodeAt(i), 0x01000193) >>> 0
  return hash
}

const TONE_BY_AREA: Readonly<Record<string, string>> = {
  tundra: 'tundra', costa: 'beach', desierto: 'desert', pradera: 'grassland', bosque: 'forest',
}

/** Engine probe, called on every area entry: the caves this area has. */
function placedObjects(area: Area): readonly PlacedObjectSpec[] {
  // Dungeons belong to the wild. Ciudad Corazón keeps its buildings.
  if (area.kind !== 'wild') {
    placed.value = []
    return []
  }
  const origin = area.arrival(null)
  const taken = props.isTaken
  const entrances = areaEntrances({
    areaId: area.id,
    origin,
    seed: seedOf(area.id),
    now: Date.now(),
    minutes: COMMUNITY_PLAYTEST_MINUTES,
    port: {
      isSolid: (tx, ty) => area.isSolid(tx, ty),
      isWater: (tx, ty) => area.isWater(tx, ty),
      isTaken: (tx, ty) => isPortal(area, tx, ty) || (taken?.(area, tx, ty) ?? false),
    },
  })
  tone.value = toneForBiome(TONE_BY_AREA[area.id] ?? 'grassland')
  const specs = entrances.map(toSpec)
  placed.value = entrances.map((entrance, index) => ({ entrance, object: placedObject(specs[index]) }))
  return specs
}

/** The pad home is a portal; a cave standing on it would strand the player. */
function isPortal(area: Area, tx: number, ty: number): boolean {
  return area.portals.some(portal => portal.tiles.some(tile => tile.tx === tx && tile.ty === ty))
}

function toSpec(entrance: AreaEntrance): PlacedObjectSpec {
  const { anchor } = entrance.placement
  return {
    id: entrance.spawn.spawnId,
    areaId: entrance.spawn.position.areaId,
    anchor,
    kind: 'dungeonEntrance',
    solid: true,
    interactive: true,
    width: 3,
    depth: 2,
    // The rock rises well above its feet; a tap on the face should reach it.
    hitbox: { width: 48, height: 46 },
  }
}

const entranceAt = (target: WorldProbeTarget): AreaEntrance | null =>
  placed.value.find(({ object }) =>
    object.areaId === target.area.id
    && object.footprint.some(tile => tile.tx === target.tx && tile.ty === target.ty))?.entrance ?? null

/** Engine probe: tiles the navigator should walk up to and face. */
function isWorldObject(target: WorldProbeTarget): boolean {
  return entranceAt(target) !== null
}

/** Engine probe: the player is standing beside this tile, facing it. */
function inspect(target: WorldProbeTarget): boolean {
  const entrance = entranceAt(target)
  if (!entrance) return false
  emit('enter', entrance)
  return true
}

const hint = computed(() => {
  const player = props.game?.playerSnapshot()
  if (!player || !placed.value.length) return null
  const close = placed.value.some(({ entrance }) =>
    Math.max(Math.abs(entrance.placement.approach.tx - player.tx), Math.abs(entrance.placement.approach.ty - player.ty)) <= 6)
  return close ? null : 'Hay cuevas cerca. Buscá una boca oscura en la roca y tocala.'
})

defineExpose({ inspect, isWorldObject, placedObjects, overlay })
</script>

<style scoped>
.de-hint {
  position: absolute;
  left: 1rem;
  bottom: 7.5rem;
  z-index: 5;
  margin: 0;
  padding: 0.4rem 0.7rem;
  border: 2px solid #3a5fb8;
  border-radius: 10px;
  background: rgba(16, 26, 54, 0.9);
  color: #dfe8ff;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 0.78rem;
}
.de-badge {
  display: inline-block;
  margin-right: 0.35rem;
  padding: 0 0.35rem;
  border-radius: 5px;
  background: #f0b429;
  color: #101a36;
  font-size: 0.68rem;
  font-weight: 800;
}

@media (max-width: 720px) {
  .de-hint { left: 50%; bottom: 10.5rem; transform: translateX(-50%); max-width: calc(100% - 1.5rem); }
}
</style>
