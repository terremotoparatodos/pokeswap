# R32.2.1 — Auditoría de movimientos legacy

> GENERADO por `node scripts/legacy-move-audit.mjs`. No editar a mano.
> Fuente legacy: tag `v0-legacy-baseline` (`fd8dd1108631fbd937efe77c92f03ad9b4dab300`), `data/learnset.js` y `data/moves-data.js`.
> Catálogo: `1.oras.ab69b5804411` (621 movimientos).
> Generación de cada movimiento: `moves.csv` de veekun, la misma fuente fijada de R32.1.

## Qué se audita

`pokemon_xp.moves` guarda un array de **slugs**. Sólo dos caminos del monolito
retirado lo escribieron alguna vez:

1. `_confirmLearn` (comprar un movimiento) escribe `LEARNSET[id][n][1]`, el
   identificador de PokéAPI (`vine-whip`). Ese camino es limpio.
2. La primera escritura de la fila siembra el array con
   `getMoves(p, level).map(m => m.slug || m.name.toLowerCase().replace(/ /g,'-'))`.
   `getMoves` sólo trae `slug` en su rama de `LEARNSET`; su rama de respaldo
   sobre `LEVEL_MOVES`, la de `STATUS_MOVES` y sus cinco rellenos fijos traen
   **nombres visibles**, en español o inglés según el idioma de la interfaz.

Esta auditoría recorre **todo el universo de slugs que esos caminos pueden
producir**. No cuenta filas de producción: este repo no tiene acceso a esos
datos, y lo que hace falta saber es qué formas tiene que contemplar una
migración.

## Las cuatro categorías

| | Categoría | Qué significa | Qué hace la migración |
|---|---|---|---|
| **A** | Exacto | El slug ya es un identificador del catálogo | Lo usa tal cual |
| **B** | Canonicalizable | Es **el mismo movimiento** con otro nombre: español, alias histórico, spelling viejo | Lo **preserva**, traduciéndolo a su `moveId` canónico |
| **C** | Incompatible con el ruleset | El movimiento realmente no existe en ORAS / Gen VI | Lo marca como incompatibilidad real |
| **D** | Desconocido / corrupto | No se puede identificar sin ambigüedad | Lo separa; nadie adivina |

**B no es backfill.** Un movimiento escrito en español no se reemplaza por otro
movimiento: se **reconoce**. El backfill por learnset queda sólo para C y D, y
no se aplica sin aprobación humana.

## Resultado

| Origen del slug | Slugs | A exactos | B canonicalizables | C incompatibles | D desconocidos |
|---|---:|---:|---:|---:|---:|
| learnset identifier | 595 | 561 | 0 | 19 | 15 |
| level-up move, Spanish name | 212 | 0 | 212 | 0 | 0 |
| level-up move, English name | 212 | 211 | 1 | 0 | 0 |
| status move, Spanish name | 158 | 1 | 157 | 0 | 0 |
| status move, English name | 158 | 158 | 0 | 0 | 0 |
| hard-coded filler | 5 | 0 | 5 | 0 | 0 |
| **Universo unido** | **965** | **561** | **370** | **19** | **15** |

Después de canonicalizar A + B quedan **34 slugs** sin identidad en el catálogo:
**19 incompatibilidades reales de ruleset** y **15 desconocidos**.

## B — cómo se canonicaliza (370)

El diccionario es **la propia tabla legacy**: `LEVEL_MOVES` y `STATUS_MOVES`
guardan el nombre español y el inglés en la misma fila, así que el español se
resuelve por su par inglés y de ahí al identificador del catálogo. No hay
ninguna traducción escrita a mano.

| Slug legacy | Se reconoce por | moveId |
|---|---|---:|
| `a-bocajarro` | nombre inglés `close-combat` | 370 |
| `abatidoras` | nombre inglés `worry-seed` | 388 |
| `absorber` | nombre inglés `absorb` | 71 |
| `acua-aro` | nombre inglés `aqua-ring` | 392 |
| `acua-cola` | nombre inglés `aqua-tail` | 401 |
| `acua-jet` | nombre inglés `aqua-jet` | 453 |

Sólo los renombres históricos necesitan un alias explícito, y hay exactamente 1:

- `vise-grip` → `vice-grip`: Gen VIII renombró el identificador; en Gen VI es el segundo.

El mapa generado vive en `src/features/pokemon/model/generated/legacyMoves.json`
(370 entradas) y lo consume `legacy.ts`. Se regenera con este mismo script.

## C — incompatibilidades reales de ruleset (19)

Probadas con el `generation_id` de veekun, no afirmadas: cada uno de estos
movimientos se introdujo después de la Generación VI, así que no existe en ORAS
y ningún renombre lo arregla.

`aurora-veil` (gen 7), `body-press` (gen 8), `burn-up` (gen 7), `dragon-hammer` (gen 7), `dual-wingbeat` (gen 8), `high-horsepower` (gen 7), `laser-focus` (gen 7), `leafage` (gen 7), `life-dew` (gen 8), `liquidation` (gen 7), `lunge` (gen 7), `power-trip` (gen 7), `smart-strike` (gen 7), `spotlight` (gen 7), `stomping-tantrum` (gen 7), `strength-sap` (gen 7), `tearful-look` (gen 7), `throat-chop` (gen 7), `toxic-thread` (gen 7)

## D — desconocidos / corruptos (15)

No se puede decidir qué son con las fuentes fijadas de R32.1: la instantánea de veekun cubre hasta la generación 8 y ninguno aparece ahí. Casi con seguridad son posteriores —el `learnset.js` legacy se generó desde una PokéAPI moderna—, pero eso es inferencia y no prueba, así que quedan separados de C.

- `aqua-cutter`
- `axe-kick`
- `comeuppance`
- `headlong-rush`
- `hyper-drill`
- `lunar-blessing`
- `mystical-power`
- `psyshield-bash`
- `rage-fist`
- `raging-bull`
- `raging-fury`
- `snowscape`
- `take-heart`
- `twin-beam`
- `wave-crash`

## A — exactos (561)

`absorb`, `acid`, `acid-armor`, `acid-spray`, `acrobatics`, `acupressure`, `aerial-ace`, `aeroblast`, `after-you`, `agility`, … (+551)

## Lectura

- El camino de compra de movimientos produce identificadores canónicos; lo que
  falla ahí es exclusivamente posterior a ORAS.
- Los nombres en inglés resuelven casi siempre por coincidencia — `Take Down`
  slugifica a `take-down`, que es el identificador real.
- Un slug que no resuelve **no se reemplaza en silencio** en ningún caso.
