<template>
  <div class="pf pwd">
    <p v-if="areaKind === 'wild' && !anySelection && !target" class="pwd-hint">
      <span class="pf-demo-badge">Dev</span> Profesiones: acercate a una roca con vetas, un árbol marcado, un arbusto o la orilla
    </p>

    <div v-if="anySelection" class="pwd-mining">
      <div class="pwd-top">
        <ProfessionHud :session="session" :profession="activeProfession" />
        <button type="button" class="pwd-bag-btn" :aria-expanded="bagOpen" @click="bagOpen = !bagOpen">Mochila</button>
      </div>
      <InventoryGrid v-if="bagOpen" class="pwd-bag" :session="session" :highlight="highlight" compact />
      <MiningActionCard
        v-if="mining.selection.value"
        :key="mining.selection.value.target.nodeId"
        :session="session"
        :target="mining.selection.value.target"
        :phase="mining.phase.value"
        :outcome="mining.outcome.value"
        @mine="mining.mine()"
        @close="closeAll"
      />
      <FishingActionCard
        v-else-if="fishing.selection.value"
        :key="fishing.selection.value.target.nodeId"
        :session="session"
        :target="fishing.selection.value.target"
        :phase="fishing.phase.value"
        :outcome="fishing.outcome.value"
        :biting="fishing.biting.value"
        @cast="fishing.cast()"
        @reel="fishing.reel()"
        @close="closeAll"
      />
      <LoggingActionCard
        v-else-if="logging.selection.value"
        :key="logging.selection.value.target.nodeId"
        :session="session"
        :target="logging.selection.value.target"
        :phase="logging.phase.value"
        :outcome="logging.outcome.value"
        @chop="logging.chop()"
        @close="closeAll"
      />
    </div>

    <div v-if="target" class="pwd-backdrop" @click.self="close">
      <div class="pwd-stack">
        <div class="pwd-top">
          <ProfessionHud :session="session" :profession="target.node.profession" />
          <span class="pf-demo-badge">Demo local · no se guarda</span>
        </div>
        <NodeInteractionPanel :key="target.nodeId" :session="session" :target="target" closable @close="close" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, shallowRef, watch } from 'vue'
import type { WorldObjectTarget } from '../../../wildlands/engine/game'
import type { World } from '../../../wildlands/engine/world'
import { NODE_BY_ID } from '../../domain/catalog/nodes'
import { nodeAt, worldNodePort } from '../../domain/nodePlacement'
import type { ProfessionId } from '../../domain/types'
import type { DemoNodeTarget } from '../../demo/demoSession'
import { useProfessionDemo } from '../../demo/useProfessionDemo'
import { useFishingController } from '../../fishing/useFishingController'
import { useLoggingController } from '../../logging/useLoggingController'
import { useMiningController, type MiningGamePort } from '../../mining/useMiningController'
import { CompositeOverlay } from '../../overworld/compositeOverlay'
import FishingActionCard from '../FishingActionCard.vue'
import InventoryGrid from '../InventoryGrid.vue'
import LoggingActionCard from '../LoggingActionCard.vue'
import MiningActionCard from '../MiningActionCard.vue'
import NodeInteractionPanel from '../NodeInteractionPanel.vue'
import ProfessionHud from '../ProfessionHud.vue'
import '../professions.css'

// Visual integration inside WildLands, mounted only in development builds
// (WildlandsView). Mining (R31-C1), fishing (R31-C2) and logging (R31-C3) use
// their overlays in the real scene; the rest keep the R31-B panel. Local demo
// session only: no writes, no network, no presence messages.
const props = defineProps<{ areaKind: 'town' | 'wild'; game: MiningGamePort | null }>()
const emit = defineEmits<{ overlay: [open: boolean] }>()

/** The fishing bite window is short, so the card has to light up promptly. */
const BITE_POLL_MS = 80
/** Professions that draw themselves in the world instead of opening the R31-B panel. */
const OVERLAY_PROFESSIONS: readonly ProfessionId[] = ['mining', 'fishing', 'woodcutting']

const session = useProfessionDemo()
const target = shallowRef<DemoNodeTarget | null>(null)
const bagOpen = ref(false)
const mining = useMiningController(session, () => props.game)
const fishing = useFishingController(session, () => props.game)
const logging = useLoggingController(session, () => props.game)
/** The engine holds one overlay, so the professions share a composite. */
const overlay = new CompositeOverlay(mining.overlay, fishing.overlay, logging.overlay)

const anySelection = computed(() => !!(mining.selection.value || fishing.selection.value || logging.selection.value))
const activeProfession = computed<ProfessionId>(() => {
  if (mining.selection.value) return 'mining'
  return fishing.selection.value ? 'fishing' : 'woodcutting'
})
const highlight = computed(() => {
  if (mining.outcome.value?.ok) return mining.outcome.value.placements
  if (logging.outcome.value?.ok) return logging.outcome.value.placements
  const gather = fishing.outcome.value?.gather
  return gather?.ok ? gather.placements : []
})

const bitePoll = setInterval(() => fishing.syncBite(), BITE_POLL_MS)

watch(() => props.game, game => {
  if (game) game.setSceneOverlay(overlay)
}, { immediate: true })
onUnmounted(() => {
  clearInterval(bitePoll)
  mining.detach()
  fishing.detach()
  logging.detach()
})

/** Engine probe: tiles the navigator should approach and face. */
function isWorldObject(hit: WorldObjectTarget): boolean {
  return mining.isNode(hit) || fishing.isSpot(hit) || logging.isTree(hit) || otherNodeAt(hit) !== null
}

function otherNodeAt(hit: WorldObjectTarget): DemoNodeTarget | null {
  if (hit.area.kind !== 'wild') return null
  const world = (hit.area as { world?: World }).world
  if (!world) return null
  const placement = nodeAt(worldNodePort(world), hit.tx, hit.ty)
  const node = placement ? NODE_BY_ID.get(placement.definitionId) : undefined
  if (!placement || !node || OVERLAY_PROFESSIONS.includes(node.profession)) return null
  return { nodeId: placement.nodeId, node, biome: placement.biome }
}

/** Called by the engine for a tile beside or in front of the player. */
function inspect(hit: WorldObjectTarget): boolean {
  if (mining.inspect(hit)) {
    fishing.close()
    logging.close()
    return true
  }
  if (fishing.inspect(hit)) {
    mining.close()
    logging.close()
    return true
  }
  if (logging.inspect(hit)) {
    mining.close()
    fishing.close()
    return true
  }
  const other = otherNodeAt(hit)
  if (!other) return false
  target.value = other
  emit('overlay', true)
  return true
}

function closeAll(): void {
  mining.close()
  fishing.close()
  logging.close()
  bagOpen.value = false
}

function close(): void {
  target.value = null
  emit('overlay', false)
}

defineExpose({ inspect, isWorldObject })
</script>

<style scoped>
.pwd-hint { position: absolute; left: 1rem; bottom: 4.75rem; z-index: 5; margin: 0; padding: 0.4rem 0.7rem; border: 2px solid var(--pf-line); border-radius: 10px; background: rgba(16, 26, 54, 0.9); color: var(--pf-soft); font-size: 0.8rem; }
.pwd-mining { position: absolute; left: 50%; bottom: 4.9rem; z-index: 14; display: grid; gap: 0.4rem; width: min(380px, calc(100% - 1.5rem)); max-height: calc(100dvh - 7rem); overflow-y: auto; transform: translateX(-50%); }
.pwd-bag-btn { min-height: 38px; padding: 0 0.8rem; border: 2px solid var(--pf-gold); border-radius: 999px; background: rgba(16, 26, 54, 0.92); color: var(--pf-gold); font: inherit; font-weight: 700; cursor: pointer; }
.pwd-backdrop { position: absolute; inset: 0; z-index: 14; display: grid; place-items: end center; padding: 1rem 1rem 5.5rem; background: rgba(8, 12, 28, 0.25); }
.pwd-stack { display: grid; gap: 0.5rem; width: min(440px, 100%); max-height: calc(100dvh - 7rem); overflow-y: auto; }
.pwd-top { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.4rem; }
@media (max-width: 720px) {
  .pwd-backdrop { padding: 0.5rem 0.5rem 4.5rem; }
  .pwd-mining { bottom: 4.4rem; }
  .pwd-hint { bottom: 8rem; left: 50%; transform: translateX(-50%); white-space: nowrap; }
}
</style>
