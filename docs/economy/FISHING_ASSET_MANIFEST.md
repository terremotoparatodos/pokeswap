# Fishing Asset Manifest (R31-C2)

> Fuente de verdad: `src/features/professions/art/fishingAssets.ts`. Un test (`art/fishingArt.test.ts`) exige ids únicos y que todos construyan.
> **Formato de todos los assets:** buffer RGBA en código (`PixelArt`), convertido a canvas (motor) o PNG data URL (UI) en tiempo de ejecución. No hay archivos binarios nuevos en `public/`.
> **Origen de todos:** **original procedural** con la receta de props de WildLands, igual que el kit de Minería.
> **Estado:** implementado y visible en la galería del playground (`/dev/profesiones` → Galería → Pesca).

## Spots (18)

Archivo: `art/fishingSpots.ts` · función `fishingSpotArt(nodeId, state, frame)`.

| id (patrón) | Uso | Dimensiones | Variantes | Notas |
|---|---|---|---|---|
| `spot.shore_spot.ready.{0,1}` | Overworld: marca plana en el agua | 20×13 | 2 | Sombra de pez que se desplaza |
| `spot.shore_spot.bite` | Pique | 20×13 | 1 | Anillo interior brillante y sombra centrada |
| `spot.shore_spot.spent` | Agotado | 20×13 | 1 | Agua lisa, sin sombra |
| `spot.shore_spot.respawning.{0,1,2}` | Regeneración | 20×13 | 3 | Burbujas primero, sombra al final |
| `spot.coastal_spot.*` | Igual, azul de playa | 20×13 | 7 | — |
| `spot.reef_spot.*` | Igual, azul profundo | 20×13 | 7 | — |

- **Anclaje:** centro (`ax = w/2`, `ay = h/2`): se pinta centrado en la casilla de agua, no sobre la tierra.
- **Colisión:** ninguna. El agua sigue siendo agua y el coral o la roca marina del arrecife quedan intactos.

## Cañas (18)

Archivo: `art/fishingItems.ts`.

| id | Uso | Dimensiones | Notas |
|---|---|---|---|
| `tool.rod.{1,2,3}.icon` | Inventario, equipo, tarjeta | 16×16 | Madera, madera con anilla de acero, compuesto con anilla dorada |
| `tool.rod.{1,2,3}.broken` | Caña a 0, reparable | 16×16 | Vara partida en dos tramos |
| `tool.rod.{1,2,3}.retired` | Sin reparaciones | 16×16 | Desaturada 85 %, oscurecida 25 % |
| `tool.rod.{1,2,3}.cast.{0,1,2}` | Lanzamiento en el mundo | 18×18, ancla en la mano (8,10) | Atrás, latigazo, sostener; espejado en runtime |

`rodTipOffset(frame, facingLeft)` devuelve la punta de la caña para que la línea salga de ahí.

## Íconos de recursos (6)

Archivo: `art/fishingItems.ts` · `fishingResourceIconArt(itemId)`.

| id | Ítem | Dimensiones | Notas |
|---|---|---|---|
| `icon.fish` | Pescado | 16×16 | Cuerpo sombreado, cola triangular, ojo |
| `icon.quality_fish` | Pez Selecto | 16×16 | Más grande y verdoso |
| `icon.seaweed` | Alga | 16×16 | Tres frondas |
| `icon.pearl` | Perla | 16×16 | Esfera nacarada con brillo |
| `icon.heart_scale` | Escama Corazón | 16×16 | Corazón rosado facetado |
| `icon.fish_oil` | Aceite de Pescado | 16×16 | Frasco con aceite ámbar |

`ItemGlyph` usa estos íconos (y los de Minería) escalados ×1–2 con `image-rendering: pixelated`.

## Efectos (9)

Archivo: `art/fishingFx.ts`.

| id | Uso | Dimensiones | Notas |
|---|---|---|---|
| `fx.ripple.{0,1,2}` | Onda que se expande | 5×3 → 9×5 | Se aclara y crece |
| `fx.splash.{0,1}` | Chapoteo | 5×3 | Entrada de la línea y captura |
| `fx.droplet` | Gota | 1×2 | Partícula del chapoteo |
| `fx.bubbles.{0,1}` | Burbujas | 4×3 | Spot vivo bajo la superficie |
| `fx.line` | Línea | 1×1 | Se encadenan 4 entre caña y flotador |

## Marcadores (4)

| id | Uso | Dimensiones | Notas |
|---|---|---|---|
| `marker.bobber.float` | Flotador en el agua | 4×4 | Rojo y blanco, el único color fuerte |
| `marker.bobber.sunk` | Flotador hundido | 4×3 | Pique |
| `marker.bite` | Marca "!" | 5×7 | Aviso de recoger |
| `marker.bubble.rod` | Burbuja: pescable | 11×10 | Globo con caña (vocabulario compartido con Minería) |

## Reutilizado sin crear assets

| Asset | Uso | Origen |
|---|---|---|
| `/assets/overworld/NNNN.png` | Pokémon trabajador durante la pesca | **Reutilizado** de WildLands, vía la pieza compartida `overworld/workerCompanion.ts` |
| `fx.glint.rare` / `fx.glint.special` | Destello de rareza y de aparición del trabajador | Kit de Minería |
| `marker.bubble.lock` / `marker.bubble.seal` | Nivel insuficiente y acceso especial | Kit de Minería |
| Coral y roca marina | Props del arrecife | WildLands: Pesca **no** los reemplaza |

## Dibujado sin asset propio

| Elemento | Dónde | Notas |
|---|---|---|
| Anillo de proximidad y objetivo | `fishingOverlay.ground` | Elipse plana en el buffer de suelo |
| Etiquetas "+N" y "+XP" | `renderer.drawLabel` | Texto de canvas con borde navy |

**Total registrado: 58 assets** (el contador de la galería lo muestra en vivo).
