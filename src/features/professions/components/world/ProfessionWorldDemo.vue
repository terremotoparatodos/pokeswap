<template>
  <div class="pf pwd">
    <p v-if="areaKind === 'wild' && !target" class="pwd-hint">
      <span class="pf-demo-badge">Dev</span> Profesiones: acercate a una roca, árbol, arbusto u orilla
    </p>
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
import { shallowRef } from 'vue'
import type { WorldObjectTarget } from '../../../wildlands/engine/game'
import type { World } from '../../../wildlands/engine/world'
import { NODE_BY_ID } from '../../domain/catalog/nodes'
import { nodeAt, worldNodePort } from '../../domain/nodePlacement'
import type { DemoNodeTarget } from '../../demo/demoSession'
import { useProfessionDemo } from '../../demo/useProfessionDemo'
import NodeInteractionPanel from '../NodeInteractionPanel.vue'
import ProfessionHud from '../ProfessionHud.vue'
import '../professions.css'

// R31-B visual integration inside WildLands. Mounted only in development
// builds (WildlandsView). Uses a local demo session: no writes, no network,
// no presence messages — the realtime server knows nothing about it.
defineProps<{ areaKind: 'town' | 'wild' }>()
const emit = defineEmits<{ overlay: [open: boolean] }>()

const session = useProfessionDemo()
const target = shallowRef<DemoNodeTarget | null>(null)

/** Called by the engine for a tile beside or in front of the player. Returns true when it opened a node. */
function inspect(hit: WorldObjectTarget): boolean {
  if (hit.area.kind !== 'wild') return false
  const world = (hit.area as { world?: World }).world
  if (!world) return false
  const placement = nodeAt(worldNodePort(world), hit.tx, hit.ty)
  const node = placement ? NODE_BY_ID.get(placement.definitionId) : undefined
  if (!placement || !node) return false
  target.value = { nodeId: placement.nodeId, node, biome: placement.biome }
  emit('overlay', true)
  return true
}

function close(): void {
  target.value = null
  emit('overlay', false)
}

defineExpose({ inspect })
</script>

<style scoped>
.pwd-hint { position: absolute; left: 1rem; bottom: 4.75rem; z-index: 5; margin: 0; padding: 0.4rem 0.7rem; border: 2px solid var(--pf-line); border-radius: 10px; background: rgba(16, 26, 54, 0.9); color: var(--pf-soft); font-size: 0.8rem; }
.pwd-backdrop { position: absolute; inset: 0; z-index: 14; display: grid; place-items: end center; padding: 1rem 1rem 5.5rem; background: rgba(8, 12, 28, 0.25); }
.pwd-stack { display: grid; gap: 0.5rem; width: min(440px, 100%); max-height: calc(100dvh - 7rem); overflow-y: auto; }
.pwd-top { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.4rem; }
@media (max-width: 720px) {
  .pwd-backdrop { padding: 0.5rem 0.5rem 4.5rem; }
  .pwd-hint { bottom: 8rem; left: 50%; transform: translateX(-50%); white-space: nowrap; }
}
</style>
