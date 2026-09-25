<template>
  <div class="swl skx">
    <SkillsPanel v-if="skills" ref="panelRef" :xp="layer.xp.value" :workers="crew" @open="(open: boolean) => emit('panel', 'skills', open)" />

    <SkillsBag v-if="bagOpen" :inventory="layer.inventory.value" :supplies="ownedSupplies" @close="bagOpen = false" />

    <div v-if="farm.view.value" class="swl-card">
      <FarmCard
        :key="farm.view.value.plot.id"
        :plot="farm.view.value"
        :phase="farm.phase.value"
        :duration-ms="farm.run.value?.durationMs ?? 0"
        :result="farm.result.value"
        :refusal="farm.refusal.value"
        :xp="layer.xp.value"
        :workers="crew"
        :last-worker="farm.lastWorker.value"
        @work="(worker, name, cropId) => farm.work(worker, name, cropId)"
        @close="farm.close()"
      />
    </div>

    <div v-else-if="card" class="swl-card">
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
import type { WorkerRef } from '../ui/workerRef'
import type { SharedWorld } from '../../world/state/sharedWorld'
import { createWorldSkillsSession } from '../../worldSkills/client/worldSkillsSession'
import { useFarmPlots } from '../../worldSkills/client/useFarmPlots'
import { PlotOverlay } from '../../worldSkills/client/plotOverlay'
import { CompositeOverlay } from '../../wildlands/engine/compositeOverlay'
import FarmCard from './FarmCard.vue'
import { useSkillsLayer, type SkillsGamePort, type WorldHit } from '../ui/useSkillsLayer'
import SkillsBag from './SkillsBag.vue'
import SkillsPanel from './SkillsPanel.vue'
import WorkCard from './WorkCard.vue'
import './skills.css'

// The Skills layer inside WildLands, mounted by `WildlandsView` behind its
// build gate (development builds and the Community Playtest). A normal
// production build mounts nothing.
//
// Talar and Minería are played on the shared world's rocks and trees
// (INTEGRATION-1): the session sends intents to the realtime server, which
// validates, lets SKILLS decide and persists the result. The crew is the
// player's own Pokémon as the server read them; nothing here grants anything.
const props = defineProps<{
  areaKind: 'town' | 'wild'
  game: SkillsGamePort | null
  /** Show the Skills panel. The playtest does; the dev demo too. */
  skills?: boolean
  /** The shared world: every answer in this layer is the server's (INTEGRATION-1). */
  world: SharedWorld
  /** Consumables carried into a playtest dungeon, shown in the bag. */
  ownedSupplies?: Readonly<Record<string, number>>
}>()
// `overlay` stays declared for the host contract (it pauses the game behind a
// covering panel); this layer opens none, so it never emits it.
const emit = defineEmits<{ overlay: [open: boolean]; panel: [panel: 'skills' | 'bag', open: boolean] }>()

const session = createWorldSkillsSession(props.world)
const layer = useSkillsLayer(() => props.game, session)
/** Agricultura on the shared plots (INTEGRATION-1). */
const farm = useFarmPlots(() => props.game, session, props.world)
const overlay = new CompositeOverlay(layer.overlay, new PlotOverlay(props.world, () => props.world.playerData?.playerId ?? null))
/** The player's own Pokémon, as the server read them (empty until it has). */
const crew = computed<readonly WorkerRef[]>(() => layer.workers.value ?? [])
const bagOpen = ref(false)
watch(bagOpen, open => emit('panel', 'bag', open))
const panelRef = ref<{ close: () => void } | null>(null)

const card = computed(() => {
  const selection = layer.selection.value
  const state = layer.nodeState.value
  return selection && state ? { nodeId: selection.target.nodeId, resource: selection.target.resource, state } : null
})

watch(() => props.game, game => {
  if (game) game.setSceneOverlay(overlay)
}, { immediate: true })
onUnmounted(() => { layer.detach(); farm.detach() })

/** Engine probe: this layer places no objects of its own (stations were retired in SKILLS-1). */
const placedObjects = (): readonly never[] => []

const hint = computed(() => props.areaKind === 'wild' && !layer.open.value && !farm.open.value
  ? { id: 'skills', badge: props.skills ? 'Skills' : 'Dev', tone: 'skills' as const, text: 'Acercate a un árbol, una roca o la huerta: elegí un Pokémon y que trabaje' }
  : null)
const actionOpen = computed(() => layer.open.value || farm.open.value)

defineExpose({
  inspect: (hit: WorldHit) => {
    if (layer.inspect(hit)) { farm.close(); return true }
    if (farm.inspect(hit)) { layer.close(); return true }
    return false
  },
  isWorldObject: (hit: WorldHit) => layer.isWorldObject(hit) || farm.isWorldObject(hit),
  placedObjects,
  overlay,
  closeTransient: () => { layer.close(); farm.close(); bagOpen.value = false },
  toggleInventory: () => { bagOpen.value = !bagOpen.value },
  closeSkills: () => panelRef.value?.close(),
  closeBag: () => { bagOpen.value = false },
  hint,
  actionOpen,
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
