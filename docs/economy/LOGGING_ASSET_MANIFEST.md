# Logging Asset Manifest (R31-C3)

> Fuente de verdad: `src/features/professions/art/loggingAssets.ts`. Un test (`art/loggingArt.test.ts`) exige ids únicos, que todos construyan y que los árboles conserven la huella del prop.
> **Formato de todos los assets:** buffer RGBA en código (`PixelArt`), convertido a canvas (motor) o PNG data URL (UI) en tiempo de ejecución. No hay archivos binarios nuevos en `public/`.
> **Origen:** **derivado** de las recetas de árbol de WildLands (`treeKindPixels`, `treeTrunkPixels`, `TREE_METRICS`), expuestas en R31-C3 sin cambiar el resultado del mundo; el resto es **original procedural** con la misma receta.
> **Estado:** implementado y visible en la galería del playground (`/dev/profesiones` → Galería → Tala).

## Árboles (20)

Archivo: `art/loggingTrees.ts` · función `loggingTreeArt(nodeId, kind, state)`.

| id (patrón) | Uso | Dimensiones | Variantes | Notas |
|---|---|---|---|---|
| `tree.common_tree.tree.{ready,stump,sprout,sapling}` | Overworld, reemplaza el árbol anfitrión | 34×42 | 4 | Marca de hacha; tocón con anillos |
| `tree.common_tree.palm.*` | Overworld (playa) | 40×46 | 4 | Mismo lenguaje sobre la palmera |
| `tree.pine_tree.pine.*` | Overworld (bosque) | 28×44 | 4 | Marca + gotas de resina |
| `tree.hardwood_tree.tree.*` | Overworld (bosque) | 34×42 | 4 | Corteza oscura con veta |
| `tree.boreal_tree.snowpine.*` | Overworld (tundra) | 28×44 | 4 | Corteza gris y escarcha |

- **Variante de mordida** (sin id propio): `brighten(art, 0.18)` durante el cuadro de impacto, memoizada.
- **Caída** (sin arte nuevo): el mismo sprite con desplazamiento creciente; al 70 % se cambia por el tocón.
- **Anclaje y colisión:** idénticos al prop original (`TREE_METRICS`), así que la sombra, el orden de dibujo y el pathfinding no cambian.
- **Árbol decorativo** (`plainTreeArt`): el prop tal cual, sin marca; la galería lo muestra al lado del talable para comparar.

## Hachas (18)

Archivo: `art/loggingItems.ts`.

| id | Uso | Dimensiones | Notas |
|---|---|---|---|
| `tool.axe.{1,2,3}.icon` | Inventario, equipo, tarjeta | 16×16 | Piedra, hierro, acero (remache dorado) |
| `tool.axe.{1,2,3}.broken` | Hacha a 0, reparable | 16×16 | Mango partido y cabeza desprendida |
| `tool.axe.{1,2,3}.retired` | Sin reparaciones | 16×16 | Desaturada 85 %, oscurecida 25 % |
| `tool.axe.{1,2,3}.swing.{0,1,2}` | Hachazo en el mundo | 18×18, ancla en la mano (8,10) | Arriba, medio, mordida; espejado en runtime |

## Íconos de recursos (8)

Archivo: `art/loggingItems.ts` · `loggingResourceIconArt(itemId)`. **Todos los ítems ya existían en R31-A**: no se amplió la economía.

| id | Ítem | Notas |
|---|---|---|
| `icon.common_log` | Tronco Común | Tronco acostado con cara de corte y anillos |
| `icon.hardwood_log` | Madera Dura | Corteza oscura y veta marcada |
| `icon.boreal_log` | Madera Boreal | Corteza gris azulada |
| `icon.resin` | Resina | Gota ámbar con brillo |
| `icon.apricorn` | Bonguri | Nuez violeta con tapa (drop raro) |
| `icon.plank` / `icon.hardwood_plank` | Tablón / Tablón Duro | Cara aserrada con canto de corteza |
| `icon.tool_handle` | Mango | Vara torneada |

## Efectos (7)

Archivo: `art/loggingFx.ts`.

| id | Uso | Dimensiones | Notas |
|---|---|---|---|
| `fx.splinter.{light,dark}` | Astillas del hachazo | 3×1 | Alargadas, no cuadradas como la piedra |
| `fx.leaf.{0,1}` | Hojas | 4×3 | Dos cuadros: la hoja voltea mientras cae |
| `fx.sawdust.{0,1}` | Aserrín | 4×3 | Cálido y semitransparente |
| `fx.bark.flake` | Corteza | 2×2 | Salta en la mordida |

## Marcadores (1)

| id | Uso | Dimensiones | Notas |
|---|---|---|---|
| `marker.bubble.axe` | Árbol talable al lado | 11×10 | Globo con hacha (vocabulario compartido) |

## Reutilizado sin crear assets

| Asset | Uso | Origen |
|---|---|---|
| `tree` / `pine` / `snowpine` / `palm` | Base de todos los árboles talables | WildLands (`engine/props.ts`) |
| `/assets/overworld/NNNN.png` | Pokémon trabajador durante la tala | WildLands, vía `overworld/workerCompanion.ts` |
| `fx.glint.rare` | Destello de madera rara y del trabajador | Kit de Minería |
| `marker.bubble.lock` / `marker.bubble.seal` | Bloqueos | Kit de Minería |
| Pool de partículas y tabla de rarezas | Astillas, aserrín y ráfaga final | Minería (`mining/particles.ts`, `mining/miningRarity.ts`) |

## Dibujado sin asset propio

| Elemento | Dónde | Notas |
|---|---|---|
| Anillo de proximidad y objetivo | `loggingOverlay.ground` | Elipse plana, algo más ancha que la de Minería (los árboles ocupan más) |
| Etiquetas "+N" y "+XP" | `renderer.drawLabel` | Texto de canvas con borde navy |

**Total registrado: 54 assets** (el contador de la galería lo muestra en vivo).
