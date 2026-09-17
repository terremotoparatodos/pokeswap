# BATTLE DATA GAP REPORT

> Auditoría de qué datos Pokémon existen hoy en el repo y qué falta para tener un Battle Catalog real.
> Rama: `feat/d0-dungeon-pve-prototype`. Base: `origin/integration/r31 @ 8b0f1d21`.
> **No se importó ninguna base externa** y **no se inventó ningún dato faltante**. Lo que el prototipo usa son valores canónicos de las 14 especies que necesita, declarados como fixture y marcados como tal.

## 1. Qué existe hoy

| Dato | Dónde | Cobertura | Calidad |
|---|---|---|---|
| **Base stats** (HP, Atk, Def, SpA, SpD, Spe) | `src/features/professions/domain/catalog/speciesBaseStats.ts` | **493 especies** (Gen 1–4) | Bueno. Generado por `scripts/extract_legacy_base_stats.mjs` desde el baseline legacy; tupla ordenada, sin formas |
| **Tipos** | Columnas `type1` / `type2` de la tabla `pokemon` (Supabase) | Todas las filas de la tabla | Strings sin validar en el cliente; **ningún módulo del repo los interpreta** |
| **Nombres** (es/en/pt/fr) | Tabla `pokemon` | Todas | Bueno |
| **Sprites overworld** | `loadOverworldFrames` (`wildlands/engine/characters.ts`) + `/assets/overworld/NNNN.png` | Las que tengan hoja | Suficiente para el mundo; no hay sprites de batalla |
| **Sprite frontal** | `pokemon.sprite_url` | Todas | Suficiente |
| **Metadatos de producto** | `pokemon.is_legendary`, `is_popular`, `base_price`, `base_aura`, `generation`, `region`, `locked` | Todas | Son del mercado/swap, no de combate |
| **Fixture de 17 especies con tipos** | `professions/demo/demoWorkers.ts` | 17 | Demo de profesiones, no catálogo |
| **Afinidades laborales** | `professions/domain/affinity.ts` | — | Sistema de profesiones; **no** sirve para combate |

## 2. Qué falta

Nada de lo siguiente existe en el repo, en ninguna forma:

| Dato | Necesario para | Notas |
|---|---|---|
| **Tabla de efectividad de tipos** | Todo el daño | Ni parcial. El prototipo trae una Gen 6+ como PROTOTYPE ASSUMPTION |
| **Catálogo de movimientos** | Todo | id, nombre, tipo, categoría, potencia, precisión, PP, prioridad, efectos, probabilidad secundaria, objetivo, flags (contacto, sonido, protegible…) |
| **Learnsets** | Elegir los 4 movimientos de una instancia | Por especie, por método (nivel, TM, huevo, tutor) y por generación |
| **Abilities** | Reglas de combate | Catálogo + qué ability tiene cada especie/slot |
| **Catch rate** | Captura | 3–255 por especie. El prototipo lo declara para 14 especies |
| **Formas** | Todo | Alola/Galar/Hisui/Paldea, megas, formas de Deoxys/Rotom/etc. Hoy el repo es "una fila por especie" |
| **Naturalezas, IV, EV** | `PokemonInstance` real | El modelo de instancia no existe todavía (§4) |
| **Experiencia / curva de nivel** | Progresión de la instancia | — |
| **Sprites de batalla** | Presentación | Hoy solo hay overworld y frontal |
| **Peso y altura** | Movimientos que dependen de ellos | Bloquea familias enteras si se quieren cubrir |

## 3. Schema propuesto

Un **Battle Catalog** propio, separado de la tabla `pokemon` (que es de mercado), y separado de las profesiones. Datos de solo lectura, versionados, idénticos en cliente y servidor.

```ts
interface BattleSpecies {
  speciesId: number
  formId: string            // 'base' | 'alola' | 'mega-x' …
  name: string
  types: [TypeName] | [TypeName, TypeName]
  baseStats: { hp; attack; defense; spAttack; spDefense; speed }
  abilities: { slot1: AbilityId; slot2?: AbilityId; hidden?: AbilityId }
  catchRate: number         // 3–255
  weightKg: number
  heightM: number
  growthRate: GrowthRateId
  eggGroups: EggGroupId[]
  learnset: { moveId: MoveId; method: 'level' | 'tm' | 'egg' | 'tutor'; level?: number }[]
}

interface BattleMove {
  moveId: MoveId
  name: string
  type: TypeName
  category: 'physical' | 'special' | 'status'
  power: number | null
  accuracy: number | null   // null = nunca falla
  pp: number
  priority: number
  target: 'self' | 'opponent' | 'allOpponents' | 'field'
  effects: MoveEffect[]     // status, stat stages, drain, recharge, protect, …
  flags: { contact; sound; protectable; punch; … }
}

interface TypeChart { [attacking: TypeName]: Partial<Record<TypeName, 0 | 0.25 | 0.5 | 1 | 2 | 4>> }

interface BattleAbility { abilityId; name; hooks: AbilityHook[] }
```

Y el par que hoy no está separado:

```ts
// El catálogo, compartido e inmutable.
interface PokemonSpecies { … }   // lo de arriba

// El individuo, propiedad del jugador y autoridad del servidor.
interface PokemonInstance {
  instanceId: string
  speciesId: number
  formId: string
  level: number
  nature: NatureId
  ivs: StatSpread
  evs: StatSpread
  abilityId: AbilityId
  moves: { moveId: MoveId; pp: number; ppUp: number }[]
  currentHp: number
  status: StatusCondition
  originalTrainerId: string
  metAt: { area: string; floor?: number; expeditionId?: string }
}
```

**Lo que el prototipo puede llenar hoy de ese `PokemonInstance`:** level, moves, pp, currentHp, status. **Lo que no:** nature, IVs, EVs, ability, form, OT, metAt. El motor los trata como neutrales (IV 31, sin EV, sin nature, sin ability) y eso está marcado en `domain/party.ts`.

## 4. Fuentes

Ninguna fuente externa está aprobada dentro del proyecto hoy. Las opciones, con su implicancia:

| Opción | Licencia | Implicancia |
|---|---|---|
| **PokéAPI** (descarga única, datos derivados) | Contenido de Nintendo/GF; la API es abierta pero los datos no dejan de ser propiedad de terceros | La más completa; requiere decisión legal/producto y un pipeline de importación versionado |
| **Pokémon Showdown data** (`pokedex.ts`, `moves.ts`, `learnsets.ts`) | MIT sobre el código; los datos siguen siendo de terceros | Muy limpio y ya normalizado por generación; misma cuestión de fondo |
| **Extracción propia desde el baseline legacy** | Lo que ya hicimos con las base stats | Solo cubre lo que el legacy tenía: base stats. No tiene moves ni learnsets |
| **Curado manual por tandas** | Propia | Inviable para ~1000 especies × learnsets |

**Recomendación:** un import único y versionado, revisado por la estación principal, hacia tablas propias (`battle_species`, `battle_moves`, `battle_learnsets`, `battle_abilities`, `type_chart`), con un script bajo `scripts/` igual que el de base stats, y el resultado commiteado como datos generados. Eso mantiene el determinismo cliente/servidor y evita depender de una API en runtime. **La decisión no es mía**: toca licencias, producto y persistencia.

## 5. Generación / ruleset — **CERRADA en D1**

> **APPROVED: `PokeSwap Battle Ruleset v1 = Pokémon Omega Ruby / Alpha Sapphire — Generation VI`.**
> La referencia de datos es Gen 6 / ORAS: typing Gen 6 con Hada, base stats Gen 6, movimientos ORAS con su potencia, precisión, PP, categoría, prioridad y efectos, abilities, learnsets y tabla de tipos Gen 6.
>
> **Sigue OPEN:** la fuente concreta del dataset, su licencia, el pipeline de import, las formas, las Megaevoluciones y los Primals (que **no** se habilitan automáticamente) y el detalle final de `PokemonInstance`.
>
> Los fixtures de D1 ya son coherentes con Gen 6 — Clefairy es Hada, Magnemite es Eléctrico/Acero, Azumarill es Agua/Hada — y la tabla de tipos del prototipo ya era la Gen 6+, así que no hubo que cambiarla.

Lo que sigue queda como registro de por qué se eligió, y de lo que arrastra cada opción:

| Ruleset | Tipos | Implicancias |
|---|---|---|
| **Gen 3 (RSE)** | 17, sin Hada | Sencillo, mecánicas clásicas, sin Equipo/abilities modernas. Choca con que el repo ya lista 493 especies (hasta Gen 4) |
| **Gen 4 (DPPt)** | 17 | Introduce el split físico/especial por movimiento, que es lo que el prototipo ya asume. Encaja con las 493 especies existentes |
| **Gen 6+ (XY en adelante)** | 18, con Hada | Tabla moderna, Acero pierde resistencias a Fantasma/Siniestro. Es lo que el prototipo trae hoy |
| **Gen 9** | 18 | Máxima cobertura de movimientos y formas; mucha más data y más mecánicas (Teracristal, etc.) |

**Lo que cambia con la elección:** la tabla de tipos, el catálogo de movimientos y sus valores, los learnsets, qué abilities existen, qué formas existen y la fórmula de daño exacta. **Cambiarla después es caro**, porque toca datos y motor a la vez.

**Mi recomendación, no una decisión:** **Gen 6+ como ruleset de referencia**, porque la tabla de tipos moderna es la que la mayoría de los jugadores espera y porque Hada equilibra a Dragón, que en un PvE con bosses importa. Pero si el catálogo se queda en 493 especies (Gen 1–4), **Gen 4** es más coherente con los datos que ya tenemos. La pregunta previa es entonces: **¿el catálogo de PokeSwap se queda en 493 especies o se amplía?** Esa respuesta condiciona la otra.

## 6. Qué asumió el prototipo, y dónde

| Asunción | Archivo | Riesgo si cambia |
|---|---|---|
| Tabla de tipos Gen 6+ | `domain/typeChart.ts` | Cambian todos los números de daño. Es un archivo de datos aislado: se reemplaza entero |
| 9 movimientos representativos | `domain/moves.ts` | Ninguno: el schema es lo que importa, el roster es de juguete |
| IV 31, sin EV, sin naturaleza, sin ability | `domain/party.ts` (`hpFor`, `statFor`) | Los stats efectivos cambian cuando exista el modelo real |
| Catch rate declarado para 14 especies | `data/speciesFixtures.ts` | Ninguno: viene del catálogo real cuando exista |
| Fórmula de daño Gen 3+ simplificada | `domain/damage.ts` | Se ajusta con el ruleset |

Ninguno de esos archivos es productivo: viven en `src/features/dungeonPrototype/`, que no entra al bundle.
