# ECO-1 — Catálogo de encuentros (datos, validación y consultas), sin conexión al mundo

> Rama `world/eco-1-encounter-catalog-0.3`, desde `integration/world-skills-0.3 @ ad6a98e6c9389cedc88f07f541a7940dd70286e9`.
> Diseño de referencia: `docs/design/POKEMON_ECOSYSTEM_1_PROPOSAL.md` en `design/pokemon-ecosystem-1 @ dd789eb`. Se leyó desde esa rama y **no** se modificó.
> **No cambia nada de lo que aparece en el juego.** Ningún código activo importa el catálogo. No hay SQL, migraciones, protocolo, persistencia, flags, hosted ni Cloud.

---

## 1. Resumen

- `src/features/ecosystem/encounters/` es un módulo de dominio puro:
  - catálogo tipado de **35 entradas** en 3 zonas (Pradera abierta, bosque y `cueva-inicial`);
  - 21 familias evolutivas;
  - 7 categorías de especies excluidas, con su fuente;
  - validador con 33 códigos de error;
  - consultas puras y una selección por ticket explícito.
- Sin Vue, Colyseus, Supabase, Node, archivos del servidor ni sesión. Un test lo verifica sobre el código fuente y tiene control negativo.
- Pesos en **dos niveles**: primero el share del tier (porcentaje de la zona) y después el peso relativo dentro del tier. Un tier sin candidatos conserva su probabilidad como `unassigned` y la selección devuelve `empty-tier`: no se redistribuye nada.
- **Corrección a la propuesta.** Sus tablas tienen 12 + 12 + 11 = **35** entradas, 33 especies y 21 familias. El resumen de la propuesta (y el encargo) decía 31, 25 y 22 por un error de conteo. Se transcribieron las tablas tal cual, sin agregar ni quitar especies; un test fija exactamente esa lista.

## 2. Archivos y API

| Archivo | Responsabilidad | Líneas |
| --- | --- | --- |
| `types.ts` | Tipos: `EncounterRarity` (con orden fijo), `EncounterZone`, `EncounterEntry`, `SpawnGroup`, `EncounterFamily`, `SpeciesCategoryList`, `EncounterCatalog`, `EncounterSpeciesLookup` | 117 |
| `speciesCategories.ts` | Legendarios, míticos, pseudos, starters, fósiles, línea Eevee y bebés. Ids explícitos con `source` (el catálogo de batalla no tiene esos flags) | 53 |
| `families.ts` | Las 21 familias que usan las tablas, con etapa por miembro y bebés marcados | 45 |
| `initialCatalog.ts` | `ENCOUNTER_ZONES`, `ENCOUNTER_ENTRIES` y `ECO_1_ENCOUNTER_CATALOG` (`status: 'provisional'`) | 94 |
| `policy.ts` | `ORDINARY_ENCOUNTER_EXCLUDED` y `ordinaryEncounterExclusion(catalog, speciesId)` | 22 |
| `validation.ts` | `validateEncounterCatalog(catalog, lookupSpecies)` → `{ ok, issues[] }`, con todos los problemas y no sólo el primero | 223 |
| `queries.ts` | `zoneById`, `entriesInZone`, `entriesForSpecies`, `entriesInFamily`, `entriesOfRarity`, `zoneDistribution`, `pickEncounter`, `ticketFrom` | 138 |
| `testing.ts` | `lookupFromSpeciesList` (helper de tests) | 9 |
| `*.test.ts` (5) | §4 | — |

**Modelo:**

- **Zona:** `id` estable (`pradera.abierta`, `pradera.bosque`, `cueva-inicial`), `kind`, `areaId` y `subzoneId` existentes, `levelRange`, `maxStage` y `rarityShares` (porcentajes que suman 100).
- **Entrada:**
  - `id` = `<zona>:<slug>`, único en todo el catálogo;
  - `speciesId` + `speciesName`: el slug de `core.json`, repetido para la revisión y validado;
  - `familyId`: la familia evolutiva;
  - `rarity`: rareza de **aparición**;
  - `weight`: relativo **dentro del tier**;
  - `group {min,max}`: el **grupo de aparición**, un campo distinto de la familia;
  - `habitat`: micro-hábitat, validado contra el tipo de zona;
  - `restrictions`: colocación, tamaño, excepción con motivo, nota.
- **La misma especie en dos zonas** son dos entradas (Pidgeotto y Pikachu): no hay deduplicación global.
- **Tres rarezas separadas:**
  - `EncounterRarity` es la única de este módulo;
  - el valor de especie no se modela;
  - la rareza de huevo no existe aquí y no se deriva de ésta.

**Selección:**

```text
pickEncounter(catalog, zoneId, { tierRoll, entryRoll }, filter?)
  tierRoll ∈ [0,1) recorre common → uncommon → rare → very_rare con share/100
  entryRoll ∈ [0,1) recorre los candidatos del tier con weight/Σweight
  candidatos = entradas del tier ∧ política (nunca categorías excluidas) ∧ filtro del llamador
  → { ok: true, entry, rarity } | { ok: false, reason: 'empty-tier', rarity } | { ok: false, reason: 'unknown-zone' }
```

- La aleatoriedad la decide quien llama: `ticketFrom(next)` recibe la fuente.
- Un ticket fuera de `[0,1)` lanza `RangeError`.
- La política se aplica también en la selección (defensa en profundidad): un catálogo sin validar con Mewtwo nunca lo devuelve.
- No hay parámetro de ownership. Poseer una especie no influye; el test de aislamiento comprueba además que el módulo no menciona `owner_id`, `ownedIds`, `slots` ni `pokemon_instances`.

## 3. Configuración provisional

Transcripción literal de la propuesta §A.2: especies, tiers, pesos, grupos, hábitats y restricciones. **No es balance aprobado** (`status: 'provisional'`, `version: 'eco-1/provisional/2026-10-05'`).

| Zona | Área / subzona (ids existentes) | Niveles | `maxStage` | Shares | Entradas |
| --- | --- | --- | --- | --- | --- |
| `pradera.abierta` | `pradera` / fuera de subzonas | 2–5 | 2 | 70 · 24 · 5,5 · 0,5 | 12 |
| `pradera.bosque` | `pradera` / `bosque` | 3–7 | 2 | 70 · 24 · 5,5 · 0,5 | 12 |
| `cueva-inicial` | `cueva-inicial` (interior) | 5–8 | 2 | 70 · 24 · 5,5 · 0,5 | 11 |

- Con los pesos de la propuesta, la probabilidad de dos niveles coincide **exactamente** con los porcentajes planos de sus tablas (test).
- Datos sin fuente en el catálogo de batalla, explícitos y con `source`: categorías (CAVE_TYPES_AND_FAMILIES §4.3, MMO §6) y familias (canónicas, hueco H1). Ids y slugs se comprueban contra `core.json`. Nada se deduce por número de Pokédex ni por nombre.
- Excepciones autoradas: Metapod y Kakuna (etapa 2 como `uncommon`, `reason: cocoon`). El validador exige la excepción y rechaza una excepción innecesaria.

## 4. Pruebas

Node **18.14.0**: es el único runtime instalado en esta máquina (no hay Node 22, nvm ni volta). Dependencias instaladas con `npm ci` desde el lockfile de la base, sin cambiar `package.json` ni `package-lock.json`.

| Gate | Resultado |
| --- | --- |
| `npx vitest run src/features/ecosystem` | **5 archivos, 42 tests ✔** |
| `npx vitest run` (suite completa) | **209 archivos, 1 977 tests ✔** |
| `npm run typecheck` (`vue-tsc`) | **✔** exit 0 |
| `npm run lint` | **✔** 0 errores. 9 warnings `vue/attributes-order` preexistentes en `.vue` ajenos; `eslint src/features/ecosystem` sin ninguno |
| `git diff --check ad6a98e..HEAD` | **✔** |
| Realtime, staging, Deno, Cloud | No ejecutados (fuera de alcance; el realtime no cambia) |

Cobertura por archivo:

- **`initialCatalog.test.ts` (9):**
  - valida sin issues contra `core.json`;
  - exactamente las 35 entradas de las tablas;
  - 33 especies y 21 familias;
  - distribución de dos niveles = porcentajes de la propuesta, con suma 1;
  - la misma especie en dos zonas;
  - ninguna especie excluida ni etapa 3;
  - `areaId` y `subzoneId` existen en `areas.js`, `caveLayouts.js` y `resourceZones.js`;
  - las categorías contienen anclas conocidas (Mewtwo, Lugia, Mew, Pichu, Bonsly).
- **`validation.test.ts` (14), controles negativos que rompen una sola cosa cada uno:**
  - especie inexistente y slug que no coincide;
  - id de entrada duplicado;
  - especie repetida en una zona (y no entre zonas);
  - zona, rareza, hábitat y tipo de zona desconocidos;
  - hábitat de cueva en superficie;
  - pesos `-1`, `0`, `∞`, `NaN` y `'28'`;
  - shares negativos, `NaN` y que suman 99;
  - tier con share y sin entradas;
  - entrada en un tier de 0 %;
  - grupos `0–1`, `3–2`, `1–7` y `1,5–2`;
  - familia inexistente, especie fuera de su familia, slug de miembro incorrecto, etapas que saltan, id de familia que no es su primer miembro;
  - Mewtwo y Pichu como entradas;
  - Pidgeot (etapa 3) en una zona de `maxStage` 2;
  - intermedia `uncommon` sin excepción y excepción innecesaria;
  - niveles invertidos;
  - categoría con un id inexistente o repetido;
  - varios errores a la vez.
- **`queries.test.ts` (13):**
  - consultas por zona, especie, familia y rareza;
  - el share se aplica primero: un tier de una sola entrada conserva el 70 % y no "crece" a su peso;
  - tier vacío: `unassigned` = 0,5 %, sin redistribución, y la selección dice `empty-tier`;
  - filtro que vacía todo;
  - zona desconocida;
  - límites exactos de tier y de peso;
  - determinismo con 500 selecciones sembradas, sin llamar a `Math.random` (spy);
  - muestra sembrada de 200 000 dentro de ±0,3 pp de lo publicado;
  - tickets inválidos;
  - la política se aplica aunque el catálogo no esté validado;
  - ownership ausente de la API.
- **`assets.test.ts` (2):** los 33 sprites overworld, normales y shiny, con la URL del propio motor (`overworldSheetUrl`). Control negativo: la especie 9999 aparece como faltante en las dos variantes. El dominio no ve archivos.
- **`isolation.test.ts` (4):**
  - los módulos de runtime sólo se importan entre sí y nunca mencionan ownership;
  - ningún archivo de `src/`, `services/` ni `scripts/` fuera del módulo lo importa;
  - cada guard tiene su control negativo (Vue, Supabase, `node:fs`, `services/`, `import()` de Colyseus, `ownedIds`, e importadores simulados `.ts` y `.vue`).

**Mutaciones** (manuales, sobre la copia de trabajo, restauradas con `git checkout`). Las 8 fueron detectadas:

| Mutante | Tests que fallan |
| --- | --- |
| M1 legendarios fuera de la política | 2 |
| M2 tier vacío sin `unassigned` | 2 |
| M3 sin el chequeo de suma 100 | 1 |
| M4 peso plano por especie (ignora el share) | 1 |
| M5 `Math.random` interno en la selección | 3 |
| M6 sin el chequeo de grupo | 2 |
| M7 la selección ignora la política | 1 |
| M8 un tier vacío recae en otro | 1 |

M4 es la confusión "70 % comunes" = "70 unidades por especie". Con los pesos de la propuesta las dos lecturas coinciden por casualidad: el test del tier de una sola entrada es el que las distingue.

## 5. Decisiones todavía pendientes (no se convirtieron en reglas)

- Todos los números del catálogo (pesos, shares, grupos, niveles): revisión de producto y medición en el mundo.
- Pool curado de huevos, reparto de doble tipo (R3), distribución de huevos (suma 99 %), contenido del huevo "Legendario": **no están en esta rama.**
- D-SH1 (tasa shiny), D-TM1 (horario de aparición: el catálogo no tiene condiciones horarias) y D-CB1 (combate compartido): fuera de alcance.
- Tamaño (`sizeClass`) y `placement` se registran como datos. Los aplicará el sistema de nidos (ECO-2), no este módulo.
- Familias y categorías son datos autorados (hueco H1/H3). Si el catálogo de batalla llega a traer evolución, este archivo se reemplaza por esa fuente.

## 6. Contradicción que sigue viva

El roster salvaje actual (`services/realtime/src/world/wildPopulation.js`) **sigue** excluyendo especies con dueño, sin repetir especie y con un 2 % de legendarios. **Esta rama no lo cambia ni lo elimina**: el catálogo nuevo no está conectado. La contradicción (K1/K2 de la propuesta) se resuelve recién al integrar ECO-2.

## 7. Paso siguiente: conectarlo al mundo (ECO-2)

1. **Llevar el catálogo al realtime sin duplicarlo.** El realtime es JS sin build. El mecanismo existente es el bundle verificado (`skills.generated.js` con test de deriva). Hay que generar un `encounters.generated.js` desde este módulo con el mismo patrón, nunca una copia a mano (AGENTS §14).
2. **Validar al arrancar.** El realtime corre `validateEncounterCatalog` con un lookup del catálogo de batalla y falla cerrado si hay issues.
3. **`NestAuthority`** (memoria, sin valor): nidos fijos por zona, grupos según `group`, `encounterId = scope:nest:generación:miembro`, tickets de un CSPRNG del servidor (`ticketFrom(csprng)`), `empty-tier` → el nido queda vacío ese ciclo.
4. **Retirar el roster horario de Pradera:** U19–U21, U26, U28 y U29 de `MMO_SPAWN_RARITY_AND_INSTANCES.md` §2. Sólo entonces desaparecen K1 y K2.
5. Coordinar el momento con la principal: ECO-2 toca `worldRoom.js` y `wildService.js`.
