// Registry of the R31-C3 logging asset kit. The gallery, the manifest doc and
// tests read from here, so an asset cannot exist without being listed.

import { axeIconArt, AXE_ITEMS, axeSwingArt, LEAF_PARTICLE_TONES, LOGGING_RESOURCE_ICON_IDS, loggingResourceIconArt } from './loggingItems'
import { barkFlakeArt, LEAF_FRAMES, leafArt, sawdustArt, splinterArt } from './loggingFx'
import { LOGGING_NODE_IDS, loggingTreeArt, NODE_TREE_KINDS, type TreeArtState } from './loggingTrees'
import { WOOD_TIERS } from './loggingPalette'
import { bubbleArt } from './miningFx'
import type { PixelArt } from './pixelArt'
import type { AxeTier } from './loggingPalette'

export type LoggingAssetKind = 'tree' | 'tool' | 'icon' | 'fx' | 'marker'

export interface LoggingAsset {
  readonly id: string
  readonly kind: LoggingAssetKind
  readonly label: string
  readonly usage: string
  readonly build: () => PixelArt
}

const TIERS: readonly AxeTier[] = [1, 2, 3]
const NODE_LABEL: Readonly<Record<string, string>> = {
  common_tree: 'Árbol común', pine_tree: 'Pino', hardwood_tree: 'Árbol de madera dura', boreal_tree: 'Pino boreal',
}
const STATE_LABEL: Readonly<Record<TreeArtState, string>> = {
  ready: 'talable', stump: 'tocón', sprout: 'brote', sapling: 'árbol joven',
}
const AXE_LABEL: Readonly<Record<AxeTier, string>> = { 1: 'Hacha de piedra', 2: 'Hacha de hierro', 3: 'Hacha de acero' }
const STATES: readonly TreeArtState[] = ['ready', 'stump', 'sprout', 'sapling']

export const LOGGING_ASSETS: readonly LoggingAsset[] = [
  ...LOGGING_NODE_IDS.flatMap(nodeId => NODE_TREE_KINDS[nodeId].flatMap(kind => STATES.map(state => ({
    id: `tree.${nodeId}.${kind}.${state}`, kind: 'tree' as const,
    label: `${NODE_LABEL[nodeId]} (${kind}) · ${STATE_LABEL[state]}`,
    usage: state === 'ready' ? 'Overworld: reemplaza el árbol anfitrión' : 'Overworld: después de talar',
    build: () => loggingTreeArt(nodeId, kind, state),
  })))),
  ...TIERS.flatMap(tier => [
    { id: `tool.axe.${tier}.icon`, kind: 'tool' as const, label: AXE_LABEL[tier], usage: 'Inventario, equipo, tarjeta', build: () => axeIconArt(tier) },
    { id: `tool.axe.${tier}.broken`, kind: 'tool' as const, label: `${AXE_LABEL[tier]} rota`, usage: 'Herramienta a 0 (reparable)', build: () => axeIconArt(tier, 'broken') },
    { id: `tool.axe.${tier}.retired`, kind: 'tool' as const, label: `${AXE_LABEL[tier]} inservible`, usage: 'Sin reparaciones restantes', build: () => axeIconArt(tier, 'retired') },
    ...([0, 1, 2] as const).map(frame => ({
      id: `tool.axe.${tier}.swing.${frame}`, kind: 'tool' as const, label: `${AXE_LABEL[tier]} · cuadro ${frame + 1}`,
      usage: 'Overworld: animación de hachazo', build: () => axeSwingArt(tier, frame, false),
    })),
  ]),
  ...LOGGING_RESOURCE_ICON_IDS.map(itemId => ({
    id: `icon.${itemId}`, kind: 'icon' as const, label: itemId, usage: 'Inventario, recompensa, receta, tooltip',
    build: () => loggingResourceIconArt(itemId)!,
  })),
  { id: 'fx.splinter.light', kind: 'fx', label: 'Astilla clara', usage: 'Hachazo', build: () => splinterArt(true) },
  { id: 'fx.splinter.dark', kind: 'fx', label: 'Astilla oscura', usage: 'Hachazo', build: () => splinterArt(false) },
  ...Array.from({ length: LEAF_FRAMES }, (_, frame) => ({
    id: `fx.leaf.${frame}`, kind: 'fx' as const, label: `Hoja ${frame + 1}`, usage: 'Copa sacudida y caída del árbol',
    build: () => leafArt(frame, LEAF_PARTICLE_TONES[1]),
  })),
  { id: 'fx.sawdust.0', kind: 'fx', label: 'Aserrín 1', usage: 'Corte', build: () => sawdustArt(0) },
  { id: 'fx.sawdust.1', kind: 'fx', label: 'Aserrín 2', usage: 'Corte', build: () => sawdustArt(1) },
  { id: 'fx.bark.flake', kind: 'fx', label: 'Corteza', usage: 'Hachazo', build: () => barkFlakeArt(WOOD_TIERS.common.streak) },
  { id: 'marker.bubble.axe', kind: 'marker', label: 'Burbuja: talable', usage: 'Árbol al alcance', build: () => bubbleArt('axe') },
]

export { AXE_ITEMS }
