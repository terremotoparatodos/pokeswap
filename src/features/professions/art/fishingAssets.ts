// Registry of the R31-C2 fishing asset kit. The gallery, the manifest doc and
// tests read from here, so an asset cannot exist without being listed.

import { bubbleArt } from './miningFx'
import { biteMarkArt, bobberArt, bubblesArt, dropletArt, lineDotArt, rippleArt, RIPPLE_FRAMES, splashArt } from './fishingFx'
import { WATER_TONES } from './fishingPalette'
import { FISHING_RESOURCE_ICON_IDS, fishingResourceIconArt, rodCastArt, rodIconArt, type RodTier } from './fishingItems'
import { FISHING_NODE_IDS, fishingSpotArt, SPOT_IDLE_FRAMES, SPOT_RESPAWN_FRAMES } from './fishingSpots'
import type { PixelArt } from './pixelArt'

export type FishingAssetKind = 'spot' | 'tool' | 'icon' | 'fx' | 'marker'

export interface FishingAsset {
  readonly id: string
  readonly kind: FishingAssetKind
  readonly label: string
  readonly usage: string
  readonly build: () => PixelArt
}

const TIERS: readonly RodTier[] = [1, 2, 3]
const SPOT_LABEL: Readonly<Record<string, string>> = {
  shore_spot: 'Orilla', coastal_spot: 'Banco costero', reef_spot: 'Arrecife',
}
const ROD_LABEL: Readonly<Record<RodTier, string>> = { 1: 'Caña básica', 2: 'Caña reforzada', 3: 'Caña maestra' }

export const FISHING_ASSETS: readonly FishingAsset[] = [
  ...FISHING_NODE_IDS.flatMap(nodeId => [
    ...Array.from({ length: SPOT_IDLE_FRAMES }, (_, frame) => ({
      id: `spot.${nodeId}.ready.${frame}`, kind: 'spot' as const,
      label: `${SPOT_LABEL[nodeId]} · disponible ${frame + 1}/${SPOT_IDLE_FRAMES}`,
      usage: 'Overworld: marca en el agua', build: () => fishingSpotArt(nodeId, 'ready', frame),
    })),
    {
      id: `spot.${nodeId}.bite`, kind: 'spot' as const, label: `${SPOT_LABEL[nodeId]} · pique`,
      usage: 'Overworld: el momento de recoger', build: () => fishingSpotArt(nodeId, 'bite'),
    },
    {
      id: `spot.${nodeId}.spent`, kind: 'spot' as const, label: `${SPOT_LABEL[nodeId]} · agotado`,
      usage: 'Overworld: sin peces por ahora', build: () => fishingSpotArt(nodeId, 'spent'),
    },
    ...Array.from({ length: SPOT_RESPAWN_FRAMES }, (_, frame) => ({
      id: `spot.${nodeId}.respawning.${frame}`, kind: 'spot' as const,
      label: `${SPOT_LABEL[nodeId]} · regenerando ${frame + 1}/${SPOT_RESPAWN_FRAMES}`,
      usage: 'Overworld: los peces vuelven', build: () => fishingSpotArt(nodeId, 'respawning', frame),
    })),
  ]),
  ...TIERS.flatMap(tier => [
    { id: `tool.rod.${tier}.icon`, kind: 'tool' as const, label: ROD_LABEL[tier], usage: 'Inventario, equipo, tarjeta', build: () => rodIconArt(tier) },
    { id: `tool.rod.${tier}.broken`, kind: 'tool' as const, label: `${ROD_LABEL[tier]} rota`, usage: 'Herramienta a 0 (reparable)', build: () => rodIconArt(tier, 'broken') },
    { id: `tool.rod.${tier}.retired`, kind: 'tool' as const, label: `${ROD_LABEL[tier]} inservible`, usage: 'Sin reparaciones restantes', build: () => rodIconArt(tier, 'retired') },
    ...([0, 1, 2] as const).map(frame => ({
      id: `tool.rod.${tier}.cast.${frame}`, kind: 'tool' as const, label: `${ROD_LABEL[tier]} · cuadro ${frame + 1}`,
      usage: 'Overworld: lanzamiento y espera', build: () => rodCastArt(tier, frame, false),
    })),
  ]),
  ...FISHING_RESOURCE_ICON_IDS.map(itemId => ({
    id: `icon.${itemId}`, kind: 'icon' as const, label: itemId, usage: 'Inventario, recompensa, receta, tooltip',
    build: () => fishingResourceIconArt(itemId)!,
  })),
  ...Array.from({ length: RIPPLE_FRAMES }, (_, frame) => ({
    id: `fx.ripple.${frame}`, kind: 'fx' as const, label: `Onda ${frame + 1}`, usage: 'Caída de la línea y recogida',
    build: () => rippleArt(frame, WATER_TONES.shore_spot.foam),
  })),
  { id: 'fx.splash.0', kind: 'fx', label: 'Chapoteo 1', usage: 'Entrada al agua y captura', build: () => splashArt(0) },
  { id: 'fx.splash.1', kind: 'fx', label: 'Chapoteo 2', usage: 'Entrada al agua y captura', build: () => splashArt(1) },
  { id: 'fx.droplet', kind: 'fx', label: 'Gota', usage: 'Partícula de chapoteo', build: dropletArt },
  { id: 'fx.bubbles.0', kind: 'fx', label: 'Burbujas 1', usage: 'Espera con pique cerca', build: () => bubblesArt(0) },
  { id: 'fx.bubbles.1', kind: 'fx', label: 'Burbujas 2', usage: 'Espera con pique cerca', build: () => bubblesArt(1) },
  { id: 'fx.line', kind: 'fx', label: 'Línea', usage: 'Punto de la línea entre caña y flotador', build: lineDotArt },
  { id: 'marker.bobber.float', kind: 'marker', label: 'Flotador', usage: 'Línea en el agua', build: () => bobberArt(false) },
  { id: 'marker.bobber.sunk', kind: 'marker', label: 'Flotador hundido', usage: 'Pique', build: () => bobberArt(true) },
  { id: 'marker.bite', kind: 'marker', label: 'Marca de pique', usage: 'Aviso de recoger', build: biteMarkArt },
  { id: 'marker.bubble.rod', kind: 'marker', label: 'Burbuja: pescable', usage: 'Spot al alcance', build: () => bubbleArt('rod') },
]
