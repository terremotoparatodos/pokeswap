# Alchemy Asset Manifest (R31-C4)

> Fuente única: `src/features/professions/art/alchemyAssets.ts` (30 assets). La galería del playground (pestaña **Galería → Alquimia**) los muestra todos; un test verifica que cada id sea único y que cada asset construya píxeles.
> Todo es **arte procedural propio**, generado en código con las mismas primitivas de WildLands (`shade`, `capsules`, `ellipses`, `layer`). **No hay assets de terceros ni descargas.**

## Estación (7)

| Id | Uso | Tamaño | Notas |
|---|---|---|---|
| `station.idle` | Overworld: mesa sin actividad | 34×30 | Matraz vacío, hornillo apagado |
| `station.ready` | Overworld: jugador al lado | 34×30 | La misma mesa aclarada 14 % |
| `station.brewing` | Overworld: durante la preparación | 34×30 | Llama + matraz con color, 4 cuadros |
| `station.done` | Overworld: producto listo | 34×30 | Frasco tapado y destello |
| `station.brewing.potion` | Galería | 34×30 | El matraz toma el rosa de la Poción |
| `station.brewing.ether` | Galería | 34×30 | Azur del Éter |
| `station.brewing.revive` | Galería | 34×30 | Oro del Revivir |

## Íconos (13)

Todos 16×16, para inventario, recetas y recompensas.

| Id | Ítem | Origen en la economía |
|---|---|---|
| `icon.oran_berry` | Baya Aranja | Alquimia (arbusto de bayas) |
| `icon.leppa_berry` | Baya Zanama | Alquimia |
| `icon.sitrus_berry` | Baya Zidra | Alquimia |
| `icon.medicinal_herb` | Hierba Medicinal | Alquimia (parche de hierbas) |
| `icon.revival_herb` | Hierba Revivir | Alquimia (rara) |
| `icon.wild_essence` | Esencia Salvaje | Combate (PvE) |
| `icon.herbal_extract` | Extracto Herbal | Alquimia (intermedio) |
| `icon.potion` | Poción | Producto |
| `icon.super_potion` | Superpoción | Producto |
| `icon.hyper_potion` | Hiperpoción | Producto |
| `icon.ether` | Éter | Producto |
| `icon.revive` | Revivir | Producto (con destello) |
| `icon.vigor_tea` | Té de Vigor | Producto |

**No se redibujaron** ítems que ya tienen arte en otro kit: `vial` (Minería), `seaweed`, `heart_scale`, `fish_oil` (Pesca), `plank`, `resin` (Tala). `ItemGlyph` los resuelve en cadena: Minería → Pesca → Tala → **Alquimia**.

## Efectos (8)

| Id | Uso | Tamaño |
|---|---|---|
| `fx.bubble` | Burbuja del hervor, con el color del producto | 4×4 |
| `fx.bubble.pop` | Último cuadro (anillo) | 4×4 |
| `fx.steam.0/1/2` | Vapor que crece y se disuelve | 6×6 |
| `fx.droplet` | Ingrediente que entra / producto que se embotella | 3×3 |
| `fx.sparkle` | Lote terminado | 5×5 |
| `fx.sparkle.strong` | Insumo ahorrado por el Pokémon | 5×5 |

## Marcadores (2)

| Id | Uso |
|---|---|
| `marker.bubble.flask` | Burbuja con matraz sobre la mesa, al estar al lado |
| `marker.bubble.lock` | Burbuja con candado (receta bloqueada por nivel) |

El matraz es una **variante nueva de la burbuja compartida** (`bubbleArt('flask')` en `art/miningFx.ts`), junto a pico, caña, hacha, candado y sello: un solo componente para las cuatro profesiones.

## Lo que este kit **no** incluye

- **Nodos de recolección de Alquimia.** El dominio define cuatro (`berry_bush`, `herb_patch`, `wild_grove`, `frost_bloom`) con hoz como herramienta. R31-C4 cubrió el lado de **procesamiento**; esos nodos siguen usando el panel genérico de R31-B y no tienen arte propio. Es la deuda más grande de la fase (ver handoff, H-1).
- **Interiores.** La mesa vive en un claro del mundo, no en un edificio.
- **Ícono de la estructura `alchemy_table`** como ítem de inventario: se construye con una receta de `construction` que la mesa no ofrece (H-4).
