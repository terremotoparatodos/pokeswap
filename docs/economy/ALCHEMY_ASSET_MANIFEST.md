# Alchemy Asset Manifest (R31-C4)

> Fuente única: `src/features/professions/art/alchemyAssets.ts` (57 assets: 30 de la mesa en R31-C4 y 27 de la recolección en R31-C4.1). La galería del playground (pestaña **Galería → Alquimia**) los muestra todos; un test verifica que cada id sea único y que cada asset construya píxeles.
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

## Recolección (R31-C4.1)

### Nodos (15)

Cada nodo tiene tres estados: `ready`, `picked` y `regrowing`.

| Id | Ítem | Tamaño | Notas |
|---|---|---|---|
| `node.berry_bush.{ready,picked,regrowing}` | Arbusto de bayas | 24×17 | El arbusto del mundo con Bayas Aranja |
| `node.herb_patch.{ready,picked,regrowing}` | Parche de hierbas | 18×16 | Mata propia: el ancla es terreno, no prop |
| `node.wild_grove.{ready,picked,regrowing}` | Arboleda silvestre | 24×17 | Zidra + Zanama + corona de flores |
| `node.frost_bloom.{ready,picked,regrowing}` | Flor de escarcha | 14×18 | Flor violeta-blanca sobre el cristal |
| `node.bush.plain` | Arbusto decorativo | 24×17 | Para comparar en la galería |
| `node.tallGrass.plain` | Pasto alto decorativo | 18×16 | Idem |
| `node.crystal.plain` | Cristal sin flor | 14×18 | Idem |

### Hoz (10)

| Id | Uso |
|---|---|
| `tool.sickle.{1,2,3}.icon` | Hoz de piedra, hierro y acero |
| `tool.sickle.{1,2,3}.broken` | Durabilidad 0: el gancho partido |
| `tool.sickle.retired` | Sin reparaciones restantes |
| `tool.sickle.sweep.{0,1,2}` | Barrido en el overworld (10×10) |

### Efectos de recolección (5)

| Id | Uso | Tamaño |
|---|---|---|
| `fx.petal` | Pétalo que sale al recolectar | 4×3 |
| `fx.blade` | Brizna cortada (solo con hoz) | 2×4 |
| `fx.seed` | Semilla que se desprende | 2×2 |
| `fx.pollen` | Polvo vegetal | 4×4 |
| `fx.frostMote` | Mota de escarcha (solo tundra) | 3×3 |

### Marcadores de recolección (2)

| Id | Uso |
|---|---|
| `marker.bubble.hand` | Planta que se recolecta a mano |
| `marker.bubble.sickle` | Planta que pide hoz |

La mano y la hoz son variantes nuevas de la **burbuja compartida** (`bubbleArt`), junto a pico, caña, hacha, matraz, candado y sello.

## Lo que este kit **no** incluye

- **Interiores.** La mesa vive en un claro del mundo, no en un edificio.
- **Ícono de la estructura `alchemy_table`** como ítem de inventario: se construye con una receta de `construction` que la mesa no ofrece (H-4).
- **Colisión de la mesa:** sigue sin ser un objeto físico (ver handoff de R31-C4.1).
