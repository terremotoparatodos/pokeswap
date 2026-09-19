// Ciudad Corazón — WildLands lobby
//
// Hearthome City's layout (streets, plazas, fountains, hedges and gates
// measured tile by tile from the Platinum map) populated with the hand-drawn
// sprites extracted from public/assets/tilesets/buildings.png by
// scripts/extract_town_sprites.py. Footprints are sized to each sprite.

import { HEARTHOME_TERRAIN } from './hearthomeTerrain'
import type { TownArtSet, TownDef, TownProp } from './townArea'
import type { WorldDef } from './wildArea'

type Run = [x: number, y0: number, y1: number]
type Line = [y: number, x0: number, x1: number]

const art = (name: string) => `/assets/town/${name}.png`

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

const hedgeRuns: Run[] = [
  [14, 17, 19], [20, 17, 19], [25, 17, 19], [35, 17, 19], [41, 17, 19], [55, 17, 19],
  [8, 24, 29], [16, 24, 29], [22, 26, 29], [27, 26, 29], [32, 26, 29], [38, 26, 29], [49, 26, 29],
  [35, 35, 37], [43, 35, 37],
]
const hedgeRows: Line[] = [[29, 33, 37]]
// The north-east fence stops short of the gym, leaving the walk up to the Amity Square lawn.
const fenceRows: Line[] = [[13, 14, 22], [13, 41, 45], [7, 23, 25], [7, 37, 39], [34, 18, 35], [34, 43, 51]]
const fenceCols: Run[] = [[23, 8, 12], [39, 8, 12], [7, 14, 33], [56, 14, 33]]

function props(): TownProp[] {
  const out: TownProp[] = []
  for (const [x, y0, y1] of hedgeRuns) for (let y = y0; y <= y1; y++) out.push({ kind: 'hedge', tx: x, ty: y })
  for (const [y, x0, x1] of hedgeRows) for (let x = x0; x <= x1; x++) out.push({ kind: 'hedge', tx: x, ty: y })
  for (const [y, x0, x1] of fenceRows) for (let x = x0; x <= x1; x++) out.push({ kind: 'fenceH', tx: x, ty: y })
  for (const [x, y0, y1] of fenceCols) for (let y = y0; y <= y1; y++) out.push({ kind: 'fenceV', tx: x, ty: y })
  const lamps = [[8, 15], [14, 15], [28, 18], [34, 18], [41, 15], [47, 15], [8, 23], [55, 23], [8, 33], [55, 33], [36, 35], [42, 35], [23, 42], [41, 42]]
  for (const [tx, ty] of lamps) out.push({ kind: 'lamp', tx, ty })
  // Two benches end to end beside each pair of fountains, backs to the water (Platinum's layout).
  for (const ty of [35, 37]) out.push({ kind: 'bench', tx: 33, ty }, { kind: 'benchLeft', tx: 45, ty })
  const signs: [number, number, string][] = [
    [13, 11, 'Plaza Amistad · Puerta a la Tundra Helada'],
    [50, 11, 'Plaza Amistad · Puerta a la Costa Coral'],
    [28, 15, 'Ciudad Corazón · Donde los corazones se encuentran'],
    [21, 29, 'Barrio de las fuentes · Casas y Tienda'],
    [37, 28, 'Casa de los Poffins · Perfil de entrenadores'],
    [46, 18, 'Gimnasio de Ciudad Corazón · Líder: por anunciar'],
    [13, 39, 'Puerta oeste → Pradera Brisa · Puerta sur → Desierto Ardiente'],
    [50, 39, 'Puerta este → Bosque Umbrío'],
  ]
  for (const [tx, ty, text] of signs) out.push({ kind: 'sign', tx, ty, text })
  // Next to the Pokémon Center: the activity board.
  out.push({ kind: 'sign', tx: 13, ty: 19, text: 'Tablón de actividad', board: true })
  return out
}

export function hearthomeDef(worlds: readonly WorldDef[], id: string): TownDef {
  const worldName = (w: string) => worlds.find(def => def.id === w)?.name ?? w
  return {
    id,
    name: 'Ciudad Corazón',
    terrain: HEARTHOME_TERRAIN,
    spawn: { tx: 31, ty: 20, dir: 'down' },
    buildings: [
      // Silph Co. (HeartGold's model) stands where the Contest Hall was: 10 tiles wide for its 160 px, same door.
      { id: 'contest', name: 'Silph Co.', blurb: 'Adentro se hacen los Swaps.', style: 'contest', x: 26, y: 7, w: 10, d: 8, door: { tx: 31, ty: 14 }, feature: 'swap', image: { src: '/assets/town/models/silph-sprite.png', model: '/assets/town/models/silph.json' } },
      { id: 'amityL', name: 'Plaza Amistad', blurb: 'Subí la escalera para viajar a la Tundra Helada.', style: 'amityGate', x: 8, y: 1, w: 6, d: 9, open: [{ tx: 10, ty: 9 }, { tx: 11, ty: 9 }], image: { src: art('amity-gate'), flatTop: 'all' } },
      { id: 'amityR', name: 'Plaza Amistad', blurb: 'Subí la escalera para viajar a la Costa Coral.', style: 'amityGate', x: 50, y: 1, w: 6, d: 9, open: [{ tx: 52, ty: 9 }, { tx: 53, ty: 9 }], image: { src: art('amity-gate'), flatTop: 'all' } },
      { id: 'gateW', name: 'Puerta oeste', blurb: 'Entrá por el costado para ir a la Pradera Brisa.', style: 'routeGate', x: 0, y: 38, w: 6, d: 6, image: { src: art('route-gate'), flatTop: 52, model: '/assets/town/models/gate-west.json' } },
      { id: 'gateE', name: 'Puerta este', blurb: 'Entrá por el costado para ir al Bosque Umbrío.', style: 'routeGate', x: 58, y: 38, w: 6, d: 6, image: { src: art('route-gate'), flatTop: 52, model: '/assets/town/models/gate-east.json' } },
      { id: 'gateS', name: 'Puerta sur', blurb: 'Pisá la plaza gris de arriba para ir al Desierto Ardiente.', style: 'routeGate', x: 9, y: 43, w: 5, d: 6, image: { src: art('route-gate'), flatTop: 52, model: '/assets/town/models/gate-south.json' } },
      { id: 'pokecenter', name: 'Centro Pokémon', blurb: 'Acá te guardan la caja con tus Pokémon.', style: 'pokecenter', x: 15, y: 15, w: 5, d: 5, door: { tx: 17, ty: 19 }, feature: 'caja', image: { src: art('pokecenter'), flatTop: 54, model: '/assets/town/models/pokecenter.json' } },
      { id: 'house1', name: 'Casa', blurb: 'No hay nadie. Se escucha una radio adentro.', style: 'house', x: 21, y: 15, w: 4, d: 5, image: { src: art('house-green'), flatTop: 43 } },
      { id: 'apt1', name: 'Departamentos', blurb: 'Las jardineras están recién regadas.', style: 'apartment', x: 36, y: 13, w: 5, d: 7, image: { src: art('apartment-a'), flatTop: 70 } },
      { id: 'gym', name: 'Gimnasio', blurb: 'La entrada al Dungeon.', style: 'gym', x: 48, y: 14, w: 7, d: 6, door: { tx: 51, ty: 19 }, feature: 'dungeon', image: { src: art('gym'), flatTop: 59, model: '/assets/town/models/gym.json' } },
      { id: 'fanclub', name: 'Club de Fans Pokémon', blurb: 'Guardan la Pokédex de todos los socios.', style: 'redhouse', x: 10, y: 24, w: 5, d: 6, door: { tx: 11, ty: 29 }, feature: 'pokedex', image: { src: art('fanclub'), flatTop: 42 } },
      { id: 'house2', name: 'Casa', blurb: 'Huele a pan recién horneado.', style: 'house', x: 23, y: 25, w: 4, d: 5, image: { src: art('house-blue'), flatTop: 43 } },
      { id: 'mart', name: 'Tienda', blurb: 'El Mercado de PokeSwap: comprá y vendé Pokémon.', style: 'mart', x: 28, y: 26, w: 4, d: 4, door: { tx: 30, ty: 29 }, feature: 'mercado', image: { src: art('mart'), flatTop: 36, model: '/assets/town/models/mart.json' } },
      { id: 'poffin', name: 'Casa de los Poffins', blurb: 'Tu perfil, tus tokens y tus movimientos.', style: 'redhouse', x: 39, y: 24, w: 5, d: 6, door: { tx: 41, ty: 29 }, feature: 'perfil', image: { src: art('poffin'), flatTop: 40 } },
      { id: 'apt2', name: 'Departamentos', blurb: 'Alguien practica flauta en el segundo piso.', style: 'apartment', x: 44, y: 23, w: 5, d: 7, image: { src: art('apartment-b'), flatTop: 75 } },
    ],
    fountains: [
      { x0: 19, y0: 35, x1: 22, y1: 37 },
      { x0: 27, y0: 35, x1: 30, y1: 37 },
      { x0: 47, y0: 35, x1: 50, y1: 37 },
    ],
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
      { to: 'tundra', label: `Puerta norte → ${worldName('tundra')}`, tiles: [{ tx: 10, ty: 9 }, { tx: 11, ty: 9 }], arrival: { tx: 10, ty: 11, dir: 'down' } },
      { to: 'costa', label: `Puerta norte → ${worldName('costa')}`, tiles: [{ tx: 52, ty: 9 }, { tx: 53, ty: 9 }], arrival: { tx: 53, ty: 11, dir: 'down' } },
      { to: 'pradera', label: `Puerta oeste → ${worldName('pradera')}`, tiles: [{ tx: 6, ty: 41 }, { tx: 6, ty: 42 }], arrival: { tx: 8, ty: 41, dir: 'right' } },
      { to: 'bosque', label: `Puerta este → ${worldName('bosque')}`, tiles: [{ tx: 57, ty: 41 }, { tx: 57, ty: 42 }], arrival: { tx: 55, ty: 41, dir: 'left' } },
      { to: 'desierto', label: `Puerta sur → ${worldName('desierto')}`, tiles: [{ tx: 10, ty: 42 }, { tx: 11, ty: 42 }], arrival: { tx: 11, ty: 40, dir: 'up' } },
    ],
    residents: [
      { tx: 10, ty: 17, dir: 'right', lines: ['«¡Bienvenido a Ciudad Corazón, el corazón de PokeSwap!»'] },
      { tx: 16, ty: 22, dir: 'down', lines: ['«En el Centro Pokémon te guardan la caja con tus Pokémon.»'] },
      { tx: 17, ty: 32, dir: 'up', lines: ['«Por la puerta sur se llega al Desierto Ardiente. ¡Llevá agua!»'] },
      { tx: 21, ty: 23, dir: 'right', lines: ['«En el Club de Fans no se habla de otra cosa que de Pokémon.»'] },
      { tx: 24, ty: 12, dir: 'down', lines: ['«En Silph Co. se hacen los Swaps.»'] },
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
