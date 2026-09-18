# R32.2.1 — Auditoría de movimientos legacy

> GENERADO por `node scripts/legacy-move-audit.mjs`. No editar a mano.
> Fuente legacy: tag `v0-legacy-baseline` (`fd8dd1108631fbd937efe77c92f03ad9b4dab300`), `data/learnset.js` y `data/moves-data.js`.
> Catálogo: `1.oras.ab69b5804411` (621 movimientos).

## Qué se audita

`pokemon_xp.moves` guarda un array de **slugs**. Sólo dos caminos del monolito
retirado lo escribieron alguna vez:

1. `_confirmLearn` (comprar un movimiento) escribe `LEARNSET[id][n][1]`, el
   identificador de PokéAPI (`vine-whip`). Ese camino es limpio.
2. La primera escritura de la fila siembra el array con
   `getMoves(p, level).map(m => m.slug || m.name.toLowerCase().replace(/ /g,'-'))`.
   `getMoves` sólo trae `slug` en su rama de `LEARNSET`; su rama de respaldo
   sobre `LEVEL_MOVES`, la de `STATUS_MOVES` y sus cuatro rellenos fijos traen
   **nombres visibles**, en español o inglés según el idioma de la interfaz.

Esta auditoría recorre **todo el universo de slugs que esos caminos pueden
producir**. No cuenta filas de producción: este repo no tiene acceso a esos
datos, y lo que hace falta saber es qué formas tiene que contemplar una
migración, no cuántas filas tiene hoy cada forma.

## Resultado

| Origen del slug | Slugs distintos | Resuelven | No resuelven |
|---|---:|---:|---:|
| learnset identifier | 595 | 561 | 34 |
| level-up move, Spanish name | 212 | 0 | 212 |
| level-up move, English name | 212 | 211 | 1 |
| status move, Spanish name | 158 | 1 | 157 |
| status move, English name | 158 | 158 | 0 |
| hard-coded filler | 5 | 0 | 5 |
| **Universo unido** | **965** | **561** | **404** |

## No resuelven, por origen

- **learnset identifier** (34): `aqua-cutter`, `aurora-veil`, `axe-kick`, `body-press`, `burn-up`, `comeuppance`, `dragon-hammer`, `dual-wingbeat`, `headlong-rush`, `high-horsepower`, `hyper-drill`, `laser-focus`, … (+22)
- **level-up move, Spanish name** (212): `a-bocajarro`, `absorber`, `acua-cola`, `acua-jet`, `agarre`, `agua-lodosa`, `aire-afilado`, `alboroto`, `alud`, `amago`, `antojo`, `arañazo`, … (+200)
- **level-up move, English name** (1): `vise-grip`
- **status move, Spanish name** (157): `abatidoras`, `acua-aro`, `acupresión`, `afilar`, `agilidad`, `agitacola`, `aguante`, `alivio`, `anulación`, `armadura-ácida`, `aromaterapia`, `arraigo`, … (+145)
- **status move, English name** (0): — (todos resuelven)
- **hard-coded filler** (5): `danza-espada`, `fortaleza`, `gruñido`, `impresionar`, `placaje`

## Las tres causas de un slug que no resuelve

**1. Nombre visible en español.** El catálogo indexa identificadores de veekun,
que son ingleses, así que un nombre español **nunca** resuelve. Es la causa más
grande en número (374 slugs distintos), y también la más fácil de reparar: cada
uno de esos slugs viene de una fila de `LEVEL_MOVES`/`STATUS_MOVES` que trae
el nombre inglés al lado, así que la tabla legacy misma es el diccionario.

**2. Movimiento posterior a la Generación VI.** `learnset.js` se generó desde
PokéAPI moderna, así que su pool incluye movimientos que en ORAS no existen. Son
34 identificadores, y esta es la lista completa:

`aqua-cutter`, `aurora-veil`, `axe-kick`, `body-press`, `burn-up`, `comeuppance`, `dragon-hammer`, `dual-wingbeat`, `headlong-rush`, `high-horsepower`, `hyper-drill`, `laser-focus`, `leafage`, `life-dew`, `liquidation`, `lunar-blessing`, `lunge`, `mystical-power`, `power-trip`, `psyshield-bash`, `rage-fist`, `raging-bull`, `raging-fury`, `smart-strike`, `snowscape`, `spotlight`, `stomping-tantrum`, `strength-sap`, `take-heart`, `tearful-look`, `throat-chop`, `toxic-thread`, `twin-beam`, `wave-crash`

No hay equivalente en el catálogo porque el movimiento no existía: para estos,
reparar el nombre no alcanza.

**3. Renombre entre generaciones.** `vise-grip` es
el único caso por nombre inglés: en Gen VI el identificador es `vice-grip`, y
recién Gen VIII lo escribe `vise-grip`. El movimiento existe; cambió el nombre.

## Lectura

- El camino de compra de movimientos es el único que produce identificadores
  canónicos, y el 94 % de su pool resuelve; lo que falla es posterior a ORAS.
- Los nombres en inglés resuelven casi siempre por coincidencia — `Take Down`
  slugifica a `take-down`, que es el identificador real.
- Un slug que no resuelve **no se reemplaza en silencio**: la estrategia de
  backfill está en `POKEMON_SPECIES_INSTANCE_MODEL.md` §11 y no se aplica sin
  aprobación humana.
