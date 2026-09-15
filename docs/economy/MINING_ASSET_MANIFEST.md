# Mining Asset Manifest (R31-C1)

> Fuente de verdad: `src/features/professions/art/miningAssets.ts`. Un test (`art/miningArt.test.ts`) exige ids únicos y que todos construyan.
> **Formato de todos los assets:** buffer RGBA en código (`PixelArt`), convertido a canvas (motor) o PNG data URL (UI) en tiempo de ejecución. No hay archivos binarios nuevos en `public/`.
> **Origen de todos:** **original procedural** con la receta de props de WildLands. Los nodos **derivan** de las recetas `ROCK_RECIPES` y `CRYSTAL_RECIPE` (`engine/props.ts`), exportadas en R31-C1 sin cambiar su resultado.
> **Estado:** implementado y visible en la galería del playground (`/dev/profesiones` → Galería), salvo que se indique otra cosa.

## Nodos (40)

Archivo: `art/miningNodes.ts` · función `miningNodeArt(nodeId, anchor, state, frame)`.

| id (patrón) | Uso | Dimensiones | Variantes | Notas |
|---|---|---|---|---|
| `node.stone_outcrop.rock.{ready,depleted}` | Overworld, reemplaza la roca anfitriona | 16×12 | 2 + 3 respawn | Cortes claros y marca de cincel |
| `node.stone_outcrop.rock.respawning.{0,1,2}` | Progreso de respawn | 16×12 | 3 | Motas que vuelven |
| `node.coal_seam.{rock,boulder}.*` | Overworld | 16×12 / 30×23 | 5 por ancla | Motas y pepitas negras |
| `node.iron_vein.{boulder,icerock}.*` | Overworld | 30×23 / 20×15 | 5 por ancla | Óxido con brillo metálico |
| `node.gold_vein.{boulder,icerock}.*` | Overworld | 30×23 / 20×15 | 5 por ancla | Pepitas doradas; destello si se detecta |
| `node.crystal_cluster.crystal.*` | Overworld | 14×18 | 5 | Corazón violeta; esquirlas cortadas al agotarse |

- **Variante de impacto** (sin id propio): `brighten(art, 0.35)` durante el cuadro de golpe, memoizada por sprite.
- **Anclaje:** pies en `(w/2, h−1)`, igual que el prop original. Colisión sin cambios: roca, peñasco y roca helada son sólidos; el cristal es caminable (el navegador lo trata como interactuable, ver spec).

## Herramientas (18)

Archivo: `art/miningItems.ts`.

| id | Uso | Dimensiones | Notas |
|---|---|---|---|
| `tool.pickaxe.{1,2,3}.icon` | Inventario, equipo, tarjeta | 16×16 | Piedra, hierro, acero (remache dorado y gema violeta) |
| `tool.pickaxe.{1,2,3}.broken` | Herramienta a 0, reparable | 16×16 | Cabeza desplazada, mango partido, fisura |
| `tool.pickaxe.{1,2,3}.retired` | Sin reparaciones | 16×16 | Desaturado 85 %, oscurecido 25 % |
| `tool.pickaxe.{1,2,3}.swing.{0,1,2}` | Golpe en el mundo | 18×18, ancla en la mano (8,10) | Espejado en runtime para izquierda y arriba |

## Íconos de recursos (10)

Archivo: `art/miningItems.ts` · `resourceIconArt(itemId)`.

| id | Ítem | Dimensiones | Notas |
|---|---|---|---|
| `icon.stone` | Piedra | 16×16 | Tonos de `rock` |
| `icon.coal` | Carbón | 16×16 | Negro con brillos fríos |
| `icon.iron_ore` | Mineral de Hierro | 16×16 | Roca marrón con pepitas óxido |
| `icon.gold_ore` | Mineral de Oro | 16×16 | Roca marrón con pepitas doradas |
| `icon.evolution_shard` | Fragmento Evolutivo | 16×16 | Rombo violeta facetado |
| `icon.iron_ingot` / `icon.gold_ingot` / `icon.steel_ingot` | Lingotes | 16×16 | Barra trapezoidal con cara superior clara |
| `icon.stone_brick` | Bloque de Piedra | 16×16 | Bloque con junta |
| `icon.vial` | Frasco | 16×16 | Vidrio y corcho |

- **Uso en UI:** `ItemGlyph` (inventario, recompensa, receta, tooltip) usa estos íconos escalados ×1–2 con `image-rendering: pixelated`. Los ítems de otras profesiones siguen con la ficha genérica de R31-B.
- **En el mundo:** estos mismos íconos suben desde la roca como recompensa.

## Efectos (9)

Archivo: `art/miningFx.ts`.

| id | Uso | Dimensiones | Notas |
|---|---|---|---|
| `fx.chip.{common,uncommon,rare,special}` | Fragmentos del impacto | 2×2 | Color por rareza |
| `fx.spark` | Chispa en metal | 3×3 | Crema y dorado |
| `fx.dust.{0,1}` | Polvo | 4×3 / 6×3 | Semitransparente |
| `fx.glint.rare` / `fx.glint.special` | Destello de rareza | 5×5 | Blanco / violeta |

## Marcadores (3)

| id | Uso | Dimensiones | Notas |
|---|---|---|---|
| `marker.bubble.pick` | Nodo minable al lado | 11×10 | Globo blanco con pico |
| `marker.bubble.lock` | Nivel insuficiente | 11×10 | Candado dorado |
| `marker.bubble.seal` | Acceso especial | 11×10 | Rombo azul |

## Dibujado sin asset propio

| Elemento | Dónde | Notas |
|---|---|---|
| Anillo de proximidad y objetivo | `miningOverlay.ground` | Elipse plana en el buffer de suelo (se inclina con el terreno) |
| Etiquetas "+N" y "+XP" | `renderer.drawLabel` | Texto de canvas con borde navy, como el nameplate |

**Total registrado: 80 assets.**
