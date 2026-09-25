<template>
  <div class="swl skx">
    <SkillsPanel v-if="skills" ref="panelRef" :xp="layer.xp.value" :workers="crew" @open="(open: boolean) => emit('panel', 'skills', open)" />

    <SkillsBag v-if="bagOpen" :inventory="layer.inventory.value" :supplies="ownedSupplies" @close="bagOpen = false" />

    <div v-if="card" class="swl-card">
      <WorkCard
        :key="card.nodeId"
        :resource="card.resource"
        :state="card.state"
        :phase="layer.phase.value"
        :run="layer.run.value"
        :result="layer.result.value"
        :refusal="layer.refusal.value"
        :xp="layer.xp.value"
        :workers="crew"
        :last-worker="layer.lastWorker.value[card.resource.skill] ?? null"
        @work="(worker, name) => layer.work(worker, name)"
        @close="layer.close()"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { WorkerRef } from '../local/localSkillsSession'
import { useSkillsLayer, type SkillsGamePort, type WorldHit } from '../ui/useSkillsLayer'
import SkillsBag from './SkillsBag.vue'
import SkillsPanel from './SkillsPanel.vue'
import WorkCard from './WorkCard.vue'
import './skills.css'

// The Skills layer inside WildLands, mounted by `WildlandsView` behind its
// build gate (development builds and the Community Playtest). A normal
// production build mounts nothing.
//
// Talar and Minería are played on the rocks and trees the world already
// draws; Agricultura has its rules, its roadmap and its tests, and waits for
// WORLD-1 to put plots in the world. Local session only: no writes, no
// network, no presence messages.
const props = defineProps<{
  areaKind: 'town' | 'wild'
  game: SkillsGamePort | null
  /** Show the Skills panel. The playtest does; the dev demo too. */
  skills?: boolean
  /**
   * The player's own Pokémon (the playtest party). They do the work; there
   * is no separate "work Pokémon". Without a host roster (dev build) a small
   * fixture crew stands in.
   */
  workers?: readonly WorkerRef[]
  /** Consumables carried into a playtest dungeon, shown in the bag. */
  ownedSupplies?: Readonly<Record<string, number>>
}>()
// `overlay` stays declared for the host contract (it pauses the game behind a
// covering panel); this layer opens none, so it never emits it.
const emit = defineEmits<{ overlay: [open: boolean]; panel: [panel: 'skills' | 'bag', open: boolean] }>()

/** DEV ONLY: a crew that shows the range — a specialist per skill and a clumsy one. */
const DEV_CREW: readonly WorkerRef[] = [
  { instanceId: 'dev-machamp', speciesId: 68 },
  { instanceId: 'dev-scyther', speciesId: 123 },
  { instanceId: 'dev-bulbasaur', speciesId: 1 },
  { instanceId: 'dev-magikarp', speciesId: 129 },
]
const crew = computed<readonly WorkerRef[]>(() => props.workers ?? DEV_CREW)

const layer = useSkillsLayer(() => props.game)
const bagOpen = ref(false)
watch(bagOpen, open => emit('panel', 'bag', open))
const panelRef = ref<{ close: () => void } | null>(null)

const card = computed(() => {
  const selection = layer.selection.value
  const state = layer.nodeState.value
  return selection && state ? { nodeId: selection.target.nodeId, resource: selection.target.resource, state } : null
})

watch(() => props.game, game => {
  if (game) game.setSceneOverlay(layer.overlay)
}, { immediate: true })
onUnmounted(() => layer.detach())

/** Engine probe: this layer places no objects of its own (stations were retired in SKILLS-1). */
const placedObjects = (): readonly never[] => []

const hint = computed(() => props.areaKind === 'wild' && !layer.open.value
  ? { id: 'skills', badge: props.skills ? 'Skills' : 'Dev', tone: 'skills' as const, text: 'Acercate a un árbol o a una roca: elegí un Pokémon y que trabaje' }
  : null)

defineExpose({
  inspect: (hit: WorldHit) => layer.inspect(hit),
  isWorldObject: (hit: WorldHit) => layer.isWorldObject(hit),
  placedObjects,
  overlay: layer.overlay,
  closeTransient: () => { layer.close(); bagOpen.value = false },
  toggleInventory: () => { bagOpen.value = !bagOpen.value },
  closeSkills: () => panelRef.value?.close(),
  closeBag: () => { bagOpen.value = false },
  hint,
  actionOpen: layer.open,
})
</script>

<style scoped>
.swl-card {
  position: absolute;
  left: 50%;
  bottom: 4.9rem;
  z-index: 14;
  width: min(380px, calc(100% - 1.5rem));
  max-height: calc(100dvh - 7rem);
  overflow-y: auto;
  transform: translateX(-50%);
}
@media (max-width: 720px), (max-height: 500px) {
  .swl-card {
    bottom: calc(0.75rem + 44px + 0.5rem + var(--safe-bottom, 0px));
    max-height: calc(100dvh - 0.75rem - 44px - 0.5rem - 8rem - var(--safe-top, 0px) - var(--safe-bottom, 0px));
  }
}
@media (min-width: 721px) and (max-height: 500px) {
  .swl-card { top: calc(0.5rem + var(--safe-top, 0px)); bottom: calc(0.5rem + var(--safe-bottom, 0px)); max-height: none; }
}
</style>
