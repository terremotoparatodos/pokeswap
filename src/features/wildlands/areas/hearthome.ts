// Ciudad Corazón — WildLands lobby
//
// Hearthome City's layout (streets, plazas, fountains, hedges and gates
// measured tile by tile from the Platinum map) populated with the hand-drawn
// sprites extracted from public/assets/tilesets/buildings.png by
// scripts/extract_town_sprites.py. Footprints are sized to each sprite.

import { HEARTHOME_TERRAIN } from './hearthomeTerrain'
import type { ArtImage, TownArtSet, TownDef, TownGate, TownProp } from './townArea'
import {
  TOWN_BUILDINGS, TOWN_FOUNTAINS, TOWN_GATES, TOWN_PROPS, TOWN_SPAWN, type TownBuildingFootprint,
} from '../../../../services/realtime/src/world/townLayout.js'
import type { WorldDef } from './wildArea'

const art = (name: string) => `/assets/town/${name}.png`
const modelSprite = (name: string) => `/assets/town/models/${name}-sprite.png`
const gateImage = (fallback: string, model: string, flatTop: ArtImage['flatTop']): ArtImage => import.meta.env.VITE_PLAYTEST === 'on'
  ? { src: modelSprite(model), model: `/assets/town/models/${model}.json` }
  : { src: art(fallback), flatTop, model: `/assets/town/models/${model}.json` }

const HEARTHOME_ART: TownArtSet = {
  trees: [art('tree-a'), art('tree-b'), art('tree-c')],
  // HeartGold's fountain model (scripts/build_town_models.py); the PNGs stay as loading fallback.
  fountains: [
    { src: art('fountain-a'), flatTop: 40, model: '/assets/town/models/fountain.json' },
    { src: art('fountain-b'), flatTop: 40, model: '/assets/town/models/fountain.json' },
    { src: art('fountain-c'), flatTop: 40, model: '/assets/town/models/fountain.json' },
  ],
  props: {
    hedge: [{ src: art('hedge') }],
    lamp: [{ src: art('lamp') }],
    sign: [{ src: art('sign') }],
    fenceH: [{ src: art('fence-h') }],
    // Pre-rendered façades keep the plaza furniture visible when the
    // playtest disables the CPU model rasterizer.
    bench: [{ src: modelSprite('bench-1') }],
    benchLeft: [{ src: modelSprite('bench-2') }],
  },
  // Autotiled fences (scripts/build_town_street_art.py): straight runs, corner pickets where a
  // row meets a column, and vertical runs as upright posts every 8 px.
  // Platinum's own 3D models (scripts/build_town_models.py).
  models: {
    lamp: '/assets/town/models/lamp.json',
    bench: '/assets/town/models/bench-1.json',
    benchLeft: '/assets/town/models/bench-2.json',
  },
  fences: {
    h: { src: art('fence-h') },
    cornerLeft: { src: art('fence-corner-left') },
    cornerRight: { src: art('fence-corner-right') },
    post: { src: art('fence-post') },
  },
}

// The street props are navigation (they block tiles), so their places live in
// the shared town layout (CAVES-4); only what the signs say is decided here.
const SIGN_TEXT: Readonly<Record<string, string>> = {
  'amity-west': 'Plaza Amistad · Puerta a la Tundra Helada',
  'amity-east': 'Plaza Amistad · Puerta a la Costa Coral',
  welcome: 'Ciudad Corazón · Donde los corazones se encuentran',
  fountains: 'Barrio de las fuentes · Casas y Tienda',
  casino: 'Casino · Perfil de entrenadores',
  gym: 'Gimnasio de Ciudad Corazón · Líder: por anunciar',
  'west-south-gates': 'Puerta oeste → Pradera Brisa · Puerta sur → Desierto Ardiente',
  'east-gate': 'Puerta este → Bosque Umbrío',
  'activity-board': 'Tablón de actividad',
}

function props(): TownProp[] {
  return TOWN_PROPS.map(({ kind, tx, ty, key, board }) => kind === 'sign'
    ? { kind, tx, ty, text: SIGN_TEXT[key ?? ''], ...(board ? { board } : {}) }
    : { kind, tx, ty })
}

/** A building's footprint, open tiles and door: navigation, from the shared town layout. */
function footprint(id: string): Omit<TownBuildingFootprint, 'id'> & { id: string } {
  const found = TOWN_BUILDINGS.find(b => b.id === id)
  if (!found) throw new Error(`hearthome: no footprint for building ${id}`)
  const { open, door, ...rect } = found
  return { ...rect, ...(open ? { open: [...open] } : {}), ...(door ? { door: { ...door } } : {}) }
}

/** A gate's tiles and arrival: navigation, from the shared town layout. */
function gate(to: string, label: string): TownGate {
  const found = TOWN_GATES.find(g => g.to === to)
  if (!found) throw new Error(`hearthome: no gate to ${to}`)
  return { to, label, tiles: found.tiles.map(t => ({ ...t })), arrival: { ...found.arrival } }
}

export function hearthomeDef(worlds: readonly WorldDef[], id: string): TownDef {
  const worldName = (w: string) => worlds.find(def => def.id === w)?.name ?? w
  return {
    id,
    name: 'Ciudad Corazón',
    // The steeper town camera: 3D buildings keep Platinum's proportions and hide less behind them.
    lens: 'town',
    terrain: HEARTHOME_TERRAIN,
    spawn: { ...TOWN_SPAWN },
    buildings: [
      // Silph Co. (HeartGold's model) stands where the Contest Hall was: 10 tiles wide for its 160 px, same door.
      { ...footprint('contest'), name: 'Silph Co.', blurb: 'El intercambio fue retirado.', style: 'contest', feature: 'swap', image: { src: '/assets/town/models/silph-sprite.png', model: '/assets/town/models/silph.json' } },
      { ...footprint('amityL'), name: 'Plaza Amistad', blurb: 'Subí la escalera para viajar a la Tundra Helada.', style: 'amityGate', image: gateImage('amity-gate', 'gate-north', 'all') },
      { ...footprint('amityR'), name: 'Plaza Amistad', blurb: 'Subí la escalera para viajar a la Costa Coral.', style: 'amityGate', image: gateImage('amity-gate', 'gate-north', 'all') },
      { ...footprint('gateW'), name: 'Puerta oeste', blurb: 'Entrá por el costado para ir a la Pradera Brisa.', style: 'routeGate', image: gateImage('route-gate', 'gate-west', 52) },
      { ...footprint('gateE'), name: 'Puerta este', blurb: 'Entrá por el costado para ir al Bosque Umbrío.', style: 'routeGate', image: gateImage('route-gate', 'gate-east', 52) },
      { ...footprint('gateS'), name: 'Puerta sur', blurb: 'Pisá la plaza gris de arriba para ir al Desierto Ardiente.', style: 'routeGate', image: gateImage('route-gate', 'gate-south', 52) },
      { ...footprint('pokecenter'), name: 'Centro Pokémon', blurb: 'Acá te guardan la caja con tus Pokémon.', style: 'pokecenter', feature: 'caja', image: { src: art('pokecenter'), flatTop: 54, model: '/assets/town/models/pokecenter.json' } },
      { ...footprint('house1'), name: 'Casa', blurb: 'No hay nadie. Se escucha una radio adentro.', style: 'house', image: { src: art('house-green'), flatTop: 43, model: '/assets/town/models/celadon-green.json' } },
      { ...footprint('apt1'), name: 'Departamentos', blurb: 'Las jardineras están recién regadas.', style: 'apartment', image: { src: art('apartment-a'), flatTop: 70, model: '/assets/town/models/celadon-tall.json' } },
      { ...footprint('gym'), name: 'Gimnasio', blurb: 'La entrada al Dungeon.', style: 'gym', feature: 'dungeon', image: { src: art('gym'), flatTop: 59, model: '/assets/town/models/gym.json' } },
      // Mr. Pokémon's House (HeartGold's model) where the Fan Club was: same Pokédex door, a 4×4 footprint.
      { ...footprint('fanclub'), name: 'Casa de Mr. Pokémon', blurb: 'Guarda la Pokédex de todos los entrenadores.', style: 'redhouse', feature: 'pokedex', image: { src: '/assets/town/models/mrpokemon-sprite.png', model: '/assets/town/models/mrpokemon.json' } },
      { ...footprint('house2'), name: 'Casa', blurb: 'Huele a pan recién horneado.', style: 'house', image: { src: art('house-blue'), flatTop: 43, model: '/assets/town/models/celadon-green.json' } },
      { ...footprint('mart'), name: 'Tienda', blurb: 'El Mercado de PokeSwap: comprá y vendé Pokémon.', style: 'mart', feature: 'mercado', image: { src: art('mart'), flatTop: 36, model: '/assets/town/models/mart.json' } },
      // The Casino (HeartGold's Game Corner) where the Poffin House was: the Perfil entrance, 7×4 tiles
      // (a hedge column and the end of the hedge row made room for it).
      { ...footprint('poffin'), name: 'Casino', blurb: 'Tu perfil, tus tokens y tus movimientos.', style: 'contest', feature: 'perfil', image: { src: '/assets/town/models/casino-sprite.png', model: '/assets/town/models/casino.json' } },
      { ...footprint('apt2'), name: 'Departamentos', blurb: 'Alguien practica flauta en el segundo piso.', style: 'apartment', image: { src: art('apartment-b'), flatTop: 75, model: '/assets/town/models/celadon-tall.json' } },
    ],
    fountains: TOWN_FOUNTAINS.map(f => ({ ...f })),
    props: props(),
    art: HEARTHOME_ART,
    // City blocks traced from the outlined sidewalks around each building group.
    plots: [
      { x0: 13, y0: 14, x1: 26, y1: 20 },
      { x0: 34, y0: 13, x1: 42, y1: 20 },
      { x0: 46, y0: 13, x1: 55, y1: 20 },
      { x0: 8, y0: 22, x1: 16, y1: 30 },
      { x0: 21, y0: 25, x1: 50, y1: 30 },
      { x0: 37, y0: 22, x1: 50, y1: 24 },
    ],
    gates: [
      gate('tundra', `Puerta norte → ${worldName('tundra')}`),
      gate('costa', `Puerta norte → ${worldName('costa')}`),
      gate('pradera', `Puerta oeste → ${worldName('pradera')}`),
      gate('bosque', `Puerta este → ${worldName('bosque')}`),
      gate('desierto', `Puerta sur → ${worldName('desierto')}`),
    ],
    residents: [
      { tx: 10, ty: 17, dir: 'right', lines: ['«¡Bienvenido a Ciudad Corazón, el corazón de PokeSwap!»'] },
      { tx: 16, ty: 22, dir: 'down', lines: ['«En el Centro Pokémon te guardan la caja con tus Pokémon.»'] },
      { tx: 17, ty: 32, dir: 'up', lines: ['«Por la puerta sur se llega al Desierto Ardiente. ¡Llevá agua!»'] },
      { tx: 21, ty: 23, dir: 'right', lines: ['«Mr. Pokémon no habla de otra cosa que de Pokémon.»'] },
      { tx: 24, ty: 12, dir: 'down', lines: ['«Dicen que en Silph Co. van a investigar huevos.»'] },
      { tx: 26, ty: 33, dir: 'left', lines: ['«Me encanta el ruido de las fuentes.»'] },
      { tx: 28, ty: 23, dir: 'down', lines: ['«En la Tienda está el Mercado. ¡Hay cada Pokémon!»'] },
      { tx: 29, ty: 39, dir: 'up', lines: ['«Las puertas de arriba llevan a la Tundra y a la Costa.»'] },
      { tx: 35, ty: 27, dir: 'down', lines: ['«Si te perdés en un mundo, volvé al círculo brillante donde llegaste.»'] },
      { tx: 39, ty: 32, dir: 'left', lines: ['«Dicen que en la Tundra Helada brillan cristales raros.»'] },
      { tx: 42, ty: 17, dir: 'left', lines: ['«Por el Gimnasio se entra al Dungeon. ¡Suerte!»'] },
      { tx: 51, ty: 29, dir: 'down', lines: ['«La puerta este da a un bosque espeso. Llevá paciencia.»'] },
      { tx: 53, ty: 40, dir: 'left', lines: ['«Soy montañista. La Pradera Brisa es para descansar.»'] },
      { tx: 54, ty: 21, dir: 'down', lines: ['«Hacé click en el suelo para caminar, así de fácil.»'] },
    ],
    wanderers: [
      { tx: 30, ty: 21 }, { tx: 46, ty: 21 }, { tx: 20, ty: 32 }, { tx: 40, ty: 38 }, { tx: 13, ty: 20 },
    ],
    // The fountain quarter: owned Pokémon (top 10 by price) stroll here.
    // Tiles near doors and gates are skipped when homes are assigned.
    plazaZones: [
      { x0: 13, y0: 33, x1: 25, y1: 40 },
      { x0: 27, y0: 33, x1: 44, y1: 40 },
      { x0: 46, y0: 33, x1: 53, y1: 40 },
    ],
  }
}
