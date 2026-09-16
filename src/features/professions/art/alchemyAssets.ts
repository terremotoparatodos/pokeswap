// Registry of the R31-C4 alchemy asset kit. The gallery, the manifest doc and
// tests read from here, so an asset cannot exist without being listed.

import { ITEM_BY_ID } from '../domain/catalog/items'
import { liquidOf } from './alchemyPalette'
import { bubbleFxArt, dropletArt, sparkleArt, steamArt } from './alchemyFx'
import { ALCHEMY_ICON_IDS, alchemyIconArt } from './alchemyItems'
import { alchemyStationArt, type StationArtState } from './alchemyStation'
import { forageNodeArt, FORAGE_NODE_IDS, plainForageArt, type ForageArtState } from './forageNodes'
import { sickleIconArt, sickleSwingArt } from './forageItems'
import { bladeArt, frostMoteArt, petalArt, pollenArt, seedArt } from './forageFx'
import { HERB_FLOWERS, type SickleTier } from './foragePalette'
import { NODE_BY_ID } from '../domain/catalog/nodes'
import { bubbleArt } from './miningFx'
import type { PixelArt } from './pixelArt'

export type AlchemyAssetKind = 'station' | 'node' | 'tool' | 'icon' | 'fx' | 'marker'

export interface AlchemyAsset {
  readonly id: string
  readonly kind: AlchemyAssetKind
  readonly label: string
  readonly usage: string
  readonly build: () => PixelArt
}

const STATION_LABEL: Readonly<Record<StationArtState, string>> = {
  idle: 'apagada', ready: 'al lado del jugador', brewing: 'preparando', done: 'producto listo',
}
const STATION_STATES: readonly StationArtState[] = ['idle', 'ready', 'brewing', 'done']
const FORAGE_STATES: readonly ForageArtState[] = ['ready', 'picked', 'regrowing']
const FORAGE_STATE_LABEL: Readonly<Record<ForageArtState, string>> = {
  ready: 'con fruto', picked: 'recolectada', regrowing: 'rebrotando',
}
const SICKLE_TIERS: readonly SickleTier[] = [1, 2, 3]
const SICKLE_LABEL: Readonly<Record<SickleTier, string>> = { 1: 'Hoz de piedra', 2: 'Hoz de hierro', 3: 'Hoz de acero' }

/** The three liquids the gallery shows on the bench, one per family. */
const SHOWCASE = ['potion', 'ether', 'revive'] as const

export const ALCHEMY_ASSETS: readonly AlchemyAsset[] = [
  ...STATION_STATES.map(state => ({
    id: `station.${state}`, kind: 'station' as const,
    label: `Mesa de Alquimia · ${STATION_LABEL[state]}`,
    usage: state === 'brewing' ? 'Overworld: durante la preparación' : 'Overworld: estado de la estación',
    build: () => alchemyStationArt(state, liquidOf('potion'), 2),
  })),
  ...SHOWCASE.map(itemId => ({
    id: `station.brewing.${itemId}`, kind: 'station' as const,
    label: `Preparando ${ITEM_BY_ID.get(itemId)?.name ?? itemId}`,
    usage: 'El matraz toma el color del producto',
    build: () => alchemyStationArt('brewing', liquidOf(itemId), 3),
  })),
  ...ALCHEMY_ICON_IDS.map(itemId => ({
    id: `icon.${itemId}`, kind: 'icon' as const,
    label: ITEM_BY_ID.get(itemId)?.name ?? itemId,
    usage: ITEM_BY_ID.get(itemId)?.kind === 'consumable' ? 'Producto: inventario, recetas, recompensa' : 'Ingrediente: inventario y recetas',
    build: () => alchemyIconArt(itemId)!,
  })),
  { id: 'fx.bubble', kind: 'fx', label: 'Burbuja', usage: 'Sube del matraz mientras hierve', build: () => bubbleFxArt(liquidOf('potion'), false) },
  { id: 'fx.bubble.pop', kind: 'fx', label: 'Burbuja al reventar', usage: 'Último cuadro de la burbuja', build: () => bubbleFxArt(liquidOf('potion'), true) },
  { id: 'fx.steam.0', kind: 'fx', label: 'Vapor (denso)', usage: 'Sale del matraz al calentar', build: () => steamArt(0) },
  { id: 'fx.steam.1', kind: 'fx', label: 'Vapor (medio)', usage: 'Segundo cuadro', build: () => steamArt(1) },
  { id: 'fx.steam.2', kind: 'fx', label: 'Vapor (disuelto)', usage: 'Último cuadro', build: () => steamArt(2) },
  { id: 'fx.droplet', kind: 'fx', label: 'Gota', usage: 'Embotellado: del matraz al frasco', build: () => dropletArt(liquidOf('potion')) },
  { id: 'fx.sparkle', kind: 'fx', label: 'Destello', usage: 'Lote terminado', build: () => sparkleArt(false) },
  { id: 'fx.sparkle.strong', kind: 'fx', label: 'Destello fuerte', usage: 'Ingrediente ahorrado por el Pokémon', build: () => sparkleArt(true) },
  // ── Foraging (R31-C4.1) ──────────────────────────────────────────────────
  ...FORAGE_NODE_IDS.flatMap(nodeId => FORAGE_STATES.map(state => ({
    id: `node.${nodeId}.${state}`, kind: 'node' as const,
    label: `${NODE_BY_ID.get(nodeId)?.name ?? nodeId} · ${FORAGE_STATE_LABEL[state]}`,
    usage: state === 'ready' ? 'Overworld: reemplaza el prop anfitrión' : 'Overworld: después de recolectar',
    build: () => forageNodeArt(nodeId, state, state === 'regrowing' ? 1 : 0),
  }))),
  { id: 'node.bush.plain', kind: 'node', label: 'Arbusto decorativo', usage: 'La mayoría de los arbustos no es recurso', build: () => plainForageArt('bush') },
  { id: 'node.tallGrass.plain', kind: 'node', label: 'Pasto alto decorativo', usage: 'Terreno: no es un parche de hierbas', build: () => plainForageArt('tallGrass') },
  { id: 'node.crystal.plain', kind: 'node', label: 'Cristal sin flor', usage: 'Tundra: el cristal que no floreció', build: () => plainForageArt('crystal') },
  ...SICKLE_TIERS.flatMap(tier => [
    { id: `tool.sickle.${tier}.icon`, kind: 'tool' as const, label: SICKLE_LABEL[tier], usage: 'Inventario, equipo, tarjeta', build: () => sickleIconArt(tier) },
    { id: `tool.sickle.${tier}.broken`, kind: 'tool' as const, label: `${SICKLE_LABEL[tier]} rota`, usage: 'Durabilidad 0', build: () => sickleIconArt(tier, 'broken') },
  ]),
  { id: 'tool.sickle.retired', kind: 'tool', label: 'Hoz inservible', usage: 'Sin reparaciones restantes', build: () => sickleIconArt(2, 'retired') },
  ...[0, 1, 2].map(frame => ({
    id: `tool.sickle.sweep.${frame}`, kind: 'tool' as const, label: `Barrido ${frame + 1}/3`,
    usage: 'Overworld: corte con hoz', build: () => sickleSwingArt(2, frame as 0 | 1 | 2, false),
  })),
  { id: 'fx.petal', kind: 'fx', label: 'Pétalo', usage: 'Sale al recolectar', build: () => petalArt(HERB_FLOWERS[1], true) },
  { id: 'fx.blade', kind: 'fx', label: 'Brizna cortada', usage: 'Corte de hierba con hoz', build: () => bladeArt(true) },
  { id: 'fx.seed', kind: 'fx', label: 'Semilla', usage: 'Se desprende del arbusto', build: seedArt },
  { id: 'fx.pollen', kind: 'fx', label: 'Polvo vegetal', usage: 'Queda flotando tras la recolección', build: () => pollenArt(true) },
  { id: 'fx.frostMote', kind: 'fx', label: 'Mota de escarcha', usage: 'Solo en la Flor de escarcha', build: () => frostMoteArt(true) },
  { id: 'marker.bubble.sickle', kind: 'marker', label: 'Burbuja con hoz', usage: 'Planta que necesita hoz', build: () => bubbleArt('sickle') },
  { id: 'marker.bubble.hand', kind: 'marker', label: 'Burbuja con mano', usage: 'Planta que se recolecta a mano', build: () => bubbleArt('hand') },
  { id: 'marker.bubble.flask', kind: 'marker', label: 'Burbuja con matraz', usage: 'Sobre la mesa al estar al lado', build: () => bubbleArt('flask') },
  { id: 'marker.bubble.lock', kind: 'marker', label: 'Burbuja con candado', usage: 'Receta bloqueada por nivel', build: () => bubbleArt('lock') },
]
