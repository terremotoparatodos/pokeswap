// Registry of the R31-C1 mining asset kit. The gallery, the manifest doc and
// tests all read from here, so an asset cannot exist without being listed.

import { bubbleArt, chipArt, dustArt, glintArt, RARITY_CHIP_TONES, sparkArt } from './miningFx'
import { MINING_RESOURCE_ICON_IDS, pickaxeIconArt, pickaxeSwingArt, resourceIconArt, type PickaxeTier } from './miningItems'
import { MINING_NODE_IDS, miningNodeArt, NODE_ANCHORS, RESPAWN_FRAMES } from './miningNodes'
import type { PixelArt } from './pixelArt'

export type MiningAssetKind = 'node' | 'tool' | 'icon' | 'fx' | 'marker'

export interface MiningAsset {
  readonly id: string
  readonly kind: MiningAssetKind
  readonly label: string
  readonly usage: string
  readonly build: () => PixelArt
}

const TIERS: readonly PickaxeTier[] = [1, 2, 3]
const NODE_LABEL: Readonly<Record<string, string>> = {
  stone_outcrop: 'Afloramiento de piedra', coal_seam: 'Veta de carbón', iron_vein: 'Veta de hierro',
  gold_vein: 'Veta de oro', crystal_cluster: 'Cúmulo cristalino',
}
const STATE_LABEL = { ready: 'disponible', depleted: 'agotado', respawning: 'regenerando' } as const

export const MINING_ASSETS: readonly MiningAsset[] = [
  ...MINING_NODE_IDS.flatMap(nodeId => NODE_ANCHORS[nodeId].flatMap(anchor => [
    ...(['ready', 'depleted'] as const).map(state => ({
      id: `node.${nodeId}.${anchor}.${state}`, kind: 'node' as const,
      label: `${NODE_LABEL[nodeId]} (${anchor}) · ${STATE_LABEL[state]}`,
      usage: 'Overworld: reemplaza el prop anfitrión', build: () => miningNodeArt(nodeId, anchor, state),
    })),
    ...Array.from({ length: RESPAWN_FRAMES }, (_, frame) => ({
      id: `node.${nodeId}.${anchor}.respawning.${frame}`, kind: 'node' as const,
      label: `${NODE_LABEL[nodeId]} (${anchor}) · regenerando ${frame + 1}/${RESPAWN_FRAMES}`,
      usage: 'Overworld: progreso de respawn', build: () => miningNodeArt(nodeId, anchor, 'respawning', frame),
    })),
  ])),
  ...TIERS.flatMap(tier => [
    { id: `tool.pickaxe.${tier}.icon`, kind: 'tool' as const, label: `Pico T${tier}`, usage: 'Inventario, equipo, panel', build: () => pickaxeIconArt(tier) },
    { id: `tool.pickaxe.${tier}.broken`, kind: 'tool' as const, label: `Pico T${tier} roto`, usage: 'Herramienta a 0 (reparable)', build: () => pickaxeIconArt(tier, 'broken') },
    { id: `tool.pickaxe.${tier}.retired`, kind: 'tool' as const, label: `Pico T${tier} inservible`, usage: 'Sin reparaciones restantes', build: () => pickaxeIconArt(tier, 'retired') },
    ...([0, 1, 2] as const).map(frame => ({
      id: `tool.pickaxe.${tier}.swing.${frame}`, kind: 'tool' as const, label: `Golpe T${tier} · cuadro ${frame + 1}`,
      usage: 'Overworld: animación de golpe', build: () => pickaxeSwingArt(tier, frame, false),
    })),
  ]),
  ...MINING_RESOURCE_ICON_IDS.map(itemId => ({
    id: `icon.${itemId}`, kind: 'icon' as const, label: itemId, usage: 'Inventario, recompensa, receta, tooltip',
    build: () => resourceIconArt(itemId)!,
  })),
  ...(Object.keys(RARITY_CHIP_TONES) as (keyof typeof RARITY_CHIP_TONES)[]).map(rarity => ({
    id: `fx.chip.${rarity}`, kind: 'fx' as const, label: `Fragmento ${rarity}`, usage: 'Partícula de impacto',
    build: () => chipArt(RARITY_CHIP_TONES[rarity][0], RARITY_CHIP_TONES[rarity][1]),
  })),
  { id: 'fx.spark', kind: 'fx', label: 'Chispa', usage: 'Impacto sobre metal', build: sparkArt },
  { id: 'fx.dust.0', kind: 'fx', label: 'Polvo 1', usage: 'Impacto', build: () => dustArt(0) },
  { id: 'fx.dust.1', kind: 'fx', label: 'Polvo 2', usage: 'Impacto', build: () => dustArt(1) },
  { id: 'fx.glint.rare', kind: 'fx', label: 'Destello raro', usage: 'Nodo raro, prospección, botín raro', build: () => glintArt(false) },
  { id: 'fx.glint.special', kind: 'fx', label: 'Destello especial', usage: 'Hallazgo especial', build: () => glintArt(true) },
  { id: 'marker.bubble.pick', kind: 'marker', label: 'Burbuja: minable', usage: 'Nodo al alcance', build: () => bubbleArt('pick') },
  { id: 'marker.bubble.lock', kind: 'marker', label: 'Burbuja: nivel insuficiente', usage: 'Nodo bloqueado por nivel', build: () => bubbleArt('lock') },
  { id: 'marker.bubble.seal', kind: 'marker', label: 'Burbuja: acceso especial', usage: 'Requiere capacidad del Pokémon', build: () => bubbleArt('seal') },
]
