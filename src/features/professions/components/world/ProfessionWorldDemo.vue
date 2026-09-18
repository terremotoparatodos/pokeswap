<template>
  <div class="pf pwd">
    <p v-if="areaKind === 'wild' && !anySelection" class="pwd-hint">
      <span class="pf-demo-badge">Dev</span> Profesiones: acercate a una roca con vetas, un árbol con cinta, un arbusto con bayas, la mesa de alquimia o la orilla
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
      <ForageActionCard
        v-else-if="forage.selection.value"
        :key="forage.selection.value.target.nodeId"
        :session="session"
        :target="forage.selection.value.target"
        :phase="forage.phase.value"
        :outcome="forage.outcome.value"
        @gather="forage.gather()"
        @close="closeAll"
      />
      <AlchemyStationCard
        v-else-if="alchemy.open.value"
        :recipes="alchemy.recipes.value"
        :detail="alchemy.view.value"
        :phase="alchemy.phase.value"
        :quantity="alchemy.quantity.value"
        :max-quantity="alchemy.maxQuantity.value"
        :level="alchemy.level.value"
        :outcome="alchemy.outcome.value"
        :progress="alchemy.progress.value"
        @select="alchemy.select($event)"
        @quantity="alchemy.setQuantity($event)"
        @brew="alchemy.brew()"
        @close="closeAll"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { WorldObjectTarget } from '../../../wildlands/engine/game'
import type { ProfessionId } from '../../domain/types'
import { useProfessionDemo } from '../../demo/useProfessionDemo'
import { useAlchemyController } from '../../alchemy/useAlchemyController'
import { useFishingController } from '../../fishing/useFishingController'
import { useForageController } from '../../forage/useForageController'
import { useLoggingController } from '../../logging/useLoggingController'
import { useMiningController, type MiningGamePort } from '../../mining/useMiningController'
import { CompositeOverlay } from '../../overworld/compositeOverlay'
import AlchemyStationCard from '../AlchemyStationCard.vue'
import FishingActionCard from '../FishingActionCard.vue'
import ForageActionCard from '../ForageActionCard.vue'
import InventoryGrid from '../InventoryGrid.vue'
import LoggingActionCard from '../LoggingActionCard.vue'
import MiningActionCard from '../MiningActionCard.vue'
import ProfessionHud from '../ProfessionHud.vue'
import '../professions.css'

// Visual integration inside WildLands, mounted only in development builds
// (WildlandsView). Every profession — mining, fishing, logging, foraging and
// the alchemy bench — draws itself in the real scene through its overlay, so
// the R31-B generic node panel is no longer shown here (the playground still
// uses it). Local demo session only: no writes, no network, no presence messages.
const props = defineProps<{ areaKind: 'town' | 'wild'; game: MiningGamePort | null }>()
// WildlandsView still listens for `overlay` to pause the game behind a covering
// panel. Since R31-Z.1 the demo opens none, so it never emits; the event stays
// declared to keep that host contract unchanged.
defineEmits<{ overlay: [open: boolean] }>()

/** The fishing bite window is short, so the card has to light up promptly. */
const BITE_POLL_MS = 80

const session = useProfessionDemo()
const bagOpen = ref(false)
const mining = useMiningController(session, () => props.game)
const fishing = useFishingController(session, () => props.game)
const logging = useLoggingController(session, () => props.game)
// Alchemy has no node: the bench is derived from the world's own spawn.
const alchemy = useAlchemyController(session, () => props.game, () => null)
const forage = useForageController(session, () => props.game)
/** The engine holds one overlay, so the professions share a composite. */
const overlay = new CompositeOverlay(mining.overlay, fishing.overlay, logging.overlay, forage.overlay, alchemy.overlay)

const anySelection = computed(() => !!(mining.selection.value || fishing.selection.value || logging.selection.value || forage.selection.value || alchemy.open.value))
const activeProfession = computed<ProfessionId>(() => {
  if (mining.selection.value) return 'mining'
  if (fishing.selection.value) return 'fishing'
  return logging.selection.value ? 'woodcutting' : 'alchemy'
})
const highlight = computed(() => {
  if (mining.outcome.value?.ok) return mining.outcome.value.placements
  if (logging.outcome.value?.ok) return logging.outcome.value.placements
  if (forage.outcome.value?.ok) return forage.outcome.value.placements
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
  alchemy.detach()
  forage.detach()
})

/** Engine probe: the physical objects this demo places in an area (F-1). */
function placedObjects(area: Parameters<typeof alchemy.placedObjects>[0]) {
  return alchemy.placedObjects(area)
}

/** Engine probe: tiles the navigator should approach and face. */
function isWorldObject(hit: WorldObjectTarget): boolean {
  return mining.isNode(hit) || fishing.isSpot(hit) || logging.isTree(hit) || forage.isPlant(hit) || alchemy.isStation(hit)
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
  if (forage.inspect(hit)) {
    mining.close()
    fishing.close()
    logging.close()
    alchemy.close()
    return true
  }
  if (alchemy.inspect(hit)) {
    mining.close()
    fishing.close()
    logging.close()
    forage.close()
    return true
  }
  return false
}

function closeAll(): void {
  mining.close()
  fishing.close()
  logging.close()
  alchemy.close()
  forage.close()
  bagOpen.value = false
}

defineExpose({ inspect, isWorldObject, placedObjects })
</script>

<style scoped>
.pwd-hint { position: absolute; left: 1rem; bottom: 4.75rem; z-index: 5; margin: 0; padding: 0.4rem 0.7rem; border: 2px solid var(--pf-line); border-radius: 10px; background: rgba(16, 26, 54, 0.9); color: var(--pf-soft); font-size: 0.8rem; }
.pwd-mining { position: absolute; left: 50%; bottom: 4.9rem; z-index: 14; display: grid; gap: 0.4rem; width: min(380px, calc(100% - 1.5rem)); max-height: calc(100dvh - 7rem); overflow-y: auto; transform: translateX(-50%); }
.pwd-bag-btn { min-height: 38px; padding: 0 0.8rem; border: 2px solid var(--pf-gold); border-radius: 999px; background: rgba(16, 26, 54, 0.92); color: var(--pf-gold); font: inherit; font-weight: 700; cursor: pointer; }
.pwd-top { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.4rem; }
@media (max-width: 720px) {
  .pwd-mining { bottom: 4.4rem; }
  .pwd-hint { bottom: 8rem; left: 50%; transform: translateX(-50%); white-space: nowrap; }
}
</style>
