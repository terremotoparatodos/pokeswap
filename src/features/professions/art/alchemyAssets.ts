// Registry of the R31-C4 alchemy asset kit. The gallery, the manifest doc and
// tests read from here, so an asset cannot exist without being listed.

import { ITEM_BY_ID } from '../domain/catalog/items'
import { liquidOf } from './alchemyPalette'
import { bubbleFxArt, dropletArt, sparkleArt, steamArt } from './alchemyFx'
import { ALCHEMY_ICON_IDS, alchemyIconArt } from './alchemyItems'
import { alchemyStationArt, type StationArtState } from './alchemyStation'
import { bubbleArt } from './miningFx'
import type { PixelArt } from './pixelArt'

export type AlchemyAssetKind = 'station' | 'icon' | 'fx' | 'marker'

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
  { id: 'marker.bubble.flask', kind: 'marker', label: 'Burbuja con matraz', usage: 'Sobre la mesa al estar al lado', build: () => bubbleArt('flask') },
  { id: 'marker.bubble.lock', kind: 'marker', label: 'Burbuja con candado', usage: 'Receta bloqueada por nivel', build: () => bubbleArt('lock') },
]
