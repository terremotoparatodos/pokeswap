<template>
  <div class="pf pwd">
    <SkillsPanel v-if="skills" :session="session" />

    <section v-if="bagOpen" class="pwd-bag-panel" aria-label="Mochila" role="dialog">
      <header class="pwd-bag-head">
        <strong>🎒 Mochila</strong>
        <button type="button" aria-label="Cerrar mochila" @click="bagOpen = false">×</button>
      </header>
      <div v-if="ownedSupplies" class="pwd-supplies">
        <span v-for="(quantity, itemId) in ownedSupplies" :key="itemId">
          {{ SUPPLY_LABEL[itemId] ?? itemId }} ×{{ quantity }}
        </span>
      </div>
      <InventoryGrid :session="session" :highlight="highlight" compact />
    </section>

    <div v-if="anySelection" class="pwd-mining">
      <div class="pwd-top">
        <ProfessionHud :session="session" :profession="activeProfession" />
      </div>
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
      <FurnaceStationCard
        v-else-if="furnace.open.value"
        :level="furnace.level.value"
        :phase="furnace.phase.value"
        :recipes="furnace.recipes.value"
        :recipe-id="furnace.recipeId.value"
        :selected="furnace.selected.value"
        :quantity="furnace.quantity.value"
        :process="furnace.process.value"
        :progress="furnace.progress.value"
        :remaining-seconds="furnace.remainingSeconds.value"
        :failure="furnace.failure.value"
        @select="furnace.select($event)"
        @quantity="furnace.setQuantity($event)"
        @prepare="furnace.prepare()"
        @start="furnace.start()"
        @collect="furnace.collect()"
        @cancel="furnace.cancel()"
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
import { useFurnaceController } from '../../stations/useFurnaceController'
import { CompositeOverlay } from '../../../wildlands/engine/compositeOverlay'
import AlchemyStationCard from '../AlchemyStationCard.vue'
import FurnaceStationCard from '../FurnaceStationCard.vue'
import FishingActionCard from '../FishingActionCard.vue'
import ForageActionCard from '../ForageActionCard.vue'
import InventoryGrid from '../InventoryGrid.vue'
import LoggingActionCard from '../LoggingActionCard.vue'
import MiningActionCard from '../MiningActionCard.vue'
import ProfessionHud from '../ProfessionHud.vue'
import SkillsPanel from '../SkillsPanel.vue'
import { PROFESSION_IDS, type ToolKind } from '../../domain/types'
import { equipDemoTool, setDemoLevel } from '../../demo/demoSession'
import { TOOL_BY_ID } from '../../domain/catalog/tools'
import '../professions.css'

// Visual integration inside WildLands, mounted by `WildlandsView` behind its
// build gate: development builds, and Community Playtest 0.1, where this is the
// Skills layer players actually use. A normal production build mounts nothing.
//
// Every profession — mining, fishing, logging, foraging and the alchemy bench —
// draws itself in the real scene through its overlay, so the R31-B generic node
// panel is no longer shown here (the playground still uses it). Local demo
// session only: no writes, no network, no presence messages.
const props = defineProps<{
  areaKind: 'town' | 'wild'
  game: MiningGamePort | null
  /** Show the Skills panel. Community Playtest 0.1 does; the dev demo does not. */
  skills?: boolean
  /**
   * PLAYTEST RULE: start every profession at level 1 with no tool equipped.
   *
   * The dev demo starts mid-career (16/9/6/12) so every surface can be looked
   * at. A playtest wants the opposite: the first levels of the real curve are
   * cheap by design — level 2 is two swings — so a tester watches a number go
   * up inside two hours without anyone inventing a multiplier. Nothing about
   * the curve, the XP values or the node requirements changes.
   *
   * No tool is the other half of it: tier-1 nodes allow bare hands, so a player
   * with nothing can still play, and the shop's basic tools are a real upgrade
   * rather than a formality.
   */
  fresh?: boolean
  /** Tool item ids the player owns, e.g. bought in the Tienda. */
  ownedTools?: readonly string[]
  /** Consumables carried into a playtest dungeon. */
  ownedSupplies?: Readonly<Record<string, number>>
}>()
// WildlandsView still listens for `overlay` to pause the game behind a covering
// panel. Since R31-Z.1 the demo opens none, so it never emits; the event stays
// declared to keep that host contract unchanged.
defineEmits<{ overlay: [open: boolean] }>()

/** The fishing bite window is short, so the card has to light up promptly. */
const BITE_POLL_MS = 80
/** How often the surface asks the domain whether the furnace has finished. */
const FURNACE_POLL_MS = 250

const session = useProfessionDemo()
const bagOpen = ref(false)
const SUPPLY_LABEL: Readonly<Record<string, string>> = {
  poke_ball: 'Poké Ball', potion: 'Poción', revive: 'Revivir', ether: 'Éter',
}
const mining = useMiningController(session, () => props.game)
const fishing = useFishingController(session, () => props.game)
const logging = useLoggingController(session, () => props.game)
// Alchemy has no node: the bench is derived from the world's own spawn.
const alchemy = useAlchemyController(session, () => props.game, () => null)
const forage = useForageController(session, () => props.game)
// R33: the furnace is the first station with a real process. It derives its own
// spot further out than the bench and is told which tile the bench took, so the
// two never stand on each other.
const furnace = useFurnaceController(session, () => props.game, area => {
  const bench = alchemy.overlay.stationTile(area)
  return bench ? [bench] : []
})
/** The engine holds one overlay, so the professions share a composite. */
const overlay = new CompositeOverlay(mining.overlay, fishing.overlay, logging.overlay, forage.overlay, alchemy.overlay, furnace.overlay)

const anySelection = computed(() => !!(mining.selection.value || fishing.selection.value || logging.selection.value || forage.selection.value || alchemy.open.value || furnace.open.value))
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

// PLAYTEST RULE (see the `fresh` prop): level 1 everywhere, empty hands.
if (props.fresh) {
  session.update(state => {
    let next = PROFESSION_IDS.reduce((carry, id) => setDemoLevel(carry, id, 1), state)
    for (const kind of ['pickaxe', 'axe', 'rod', 'sickle'] as ToolKind[]) next = equipDemoTool(next, kind, null)
    return next
  })
}

/**
 * Tools the player owns. Equipping is idempotent and driven from outside, so
 * buying a pickaxe in the Tienda is the whole interaction — nothing in here
 * grants a tool to itself.
 */
watch(() => props.ownedTools, owned => {
  if (!owned?.length) return
  session.update(state => {
    let next = state
    for (const itemId of owned) {
      const definition = TOOL_BY_ID.get(itemId)
      // Never downgrade: a player who bought stone and then iron keeps iron.
      if (!definition) continue
      const current = next.tools[definition.kind]
      const currentTier = current ? TOOL_BY_ID.get(current.itemId)?.tier ?? 0 : 0
      if (definition.tier > currentTier) next = equipDemoTool(next, definition.kind, itemId)
    }
    return next
  })
}, { immediate: true, deep: true })

const bitePoll = setInterval(() => fishing.syncBite(), BITE_POLL_MS)
// The furnace's own poll asks the *domain* whether the work is finished at the
// session's clock. It decides nothing and is idempotent: it is a reader, not
// the source of truth for the process (§15, §37).
const furnacePoll = setInterval(() => furnace.tick(), FURNACE_POLL_MS)

watch(() => props.game, game => {
  if (game) game.setSceneOverlay(overlay)
}, { immediate: true })
onUnmounted(() => {
  clearInterval(bitePoll)
  clearInterval(furnacePoll)
  mining.detach()
  fishing.detach()
  logging.detach()
  alchemy.detach()
  forage.detach()
  furnace.detach()
})

/** Engine probe: the physical objects this demo places in an area (F-1). */
function placedObjects(area: Parameters<typeof alchemy.placedObjects>[0]) {
  return [...alchemy.placedObjects(area), ...furnace.placedObjects(area)]
}

/** Engine probe: tiles the navigator should approach and face. */
function isWorldObject(hit: WorldObjectTarget): boolean {
  return mining.isNode(hit) || fishing.isSpot(hit) || logging.isTree(hit) || forage.isPlant(hit)
    || alchemy.isStation(hit) || furnace.isStation(hit)
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
    furnace.close()
    return true
  }
  if (furnace.inspect(hit)) {
    mining.close()
    fishing.close()
    logging.close()
    forage.close()
    alchemy.close()
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
  furnace.close()
  bagOpen.value = false
}

// `overlay` joins the three engine probes because the host may not be the only
// thing drawing into the scene any more: Community Playtest 0.1 composes this
// overlay with the dungeon entrances' one. Exposing it changes nothing for the
// dev demo, which still installs it itself in the watcher above.
function toggleInventory(): void {
  bagOpen.value = !bagOpen.value
}

// The host draws this in its world hint tray, next to the other features'
// hints. A plain object, so this feature needs nothing from WildLands for it.
const hint = computed(() => props.areaKind === 'wild' && !anySelection.value
  ? { id: 'skills', badge: props.skills ? 'Skills' : 'Dev', tone: 'skills' as const, text: 'Acercate a una roca con vetas, un árbol con cinta, un arbusto con bayas, la mesa de alquimia, el horno o la orilla' }
  : null)

defineExpose({ inspect, isWorldObject, placedObjects, overlay, closeTransient: closeAll, toggleInventory, hint, actionOpen: anySelection })
</script>

<style scoped>
.pwd-mining { position: absolute; left: 50%; bottom: 4.9rem; z-index: 14; display: grid; gap: 0.4rem; width: min(380px, calc(100% - 1.5rem)); max-height: calc(100dvh - 7rem); overflow-y: auto; transform: translateX(-50%); }
.pwd-top { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.4rem; }
.pwd-bag-panel { position: absolute; top: 4.5rem; left: 1rem; z-index: 16; display: grid; gap: 0.55rem; width: min(440px, calc(100% - 2rem)); max-height: calc(100dvh - 9rem); padding: 0.75rem; overflow-y: auto; border: 2px solid var(--pf-gold); border-radius: 12px; background: rgba(12, 20, 42, 0.97); box-shadow: 0 12px 30px rgba(0, 0, 0, 0.48); }
.pwd-bag-head { display: flex; align-items: center; justify-content: space-between; color: var(--pf-gold); }
.pwd-bag-head button { width: 36px; height: 36px; border: 1px solid rgba(255,255,255,.25); border-radius: 8px; background: transparent; color: #fff; font: inherit; font-size: 1.3rem; cursor: pointer; }
.pwd-supplies { display: flex; flex-wrap: wrap; gap: 0.3rem; }
.pwd-supplies span { padding: 0.15rem 0.5rem; border: 1px solid rgba(255,255,255,.2); border-radius: 999px; color: var(--pf-soft); font-size: 0.72rem; }
@media (max-width: 720px) {
  .pwd-mining { bottom: 4.4rem; }
  .pwd-bag-panel { top: 4.2rem; left: 0.75rem; width: calc(100% - 1.5rem); max-height: calc(100dvh - 8.5rem); }
}
</style>
