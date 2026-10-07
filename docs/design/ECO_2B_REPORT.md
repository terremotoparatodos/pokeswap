# ECO-2B — Bundle reproducible del ecosistema para el realtime

> Rama `world/eco-2b-realtime-bundle-0.3`, desde `world/eco-2a-encounter-engine-0.3 @ ba87bebd34023c0ecf1ce1952412d46618964ead` (incluye ECO-1 y ECO-2A). Las ramas ECO-1 y ECO-2A no se modificaron.
> **Preparado, no conectado.** Ningún room, servicio, ruta ni componente importa el bundle. No se tocaron `worldRoom.js`, `wildService.js`, presencia, sesiones, protocolo, economía, SQL, Cloud, CI, `package.json` ni el lockfile.

---

## 1. Resumen

- `scripts/integration/bundle-encounters.mjs` genera `services/realtime/src/world/ecosystem/encounters.generated.js` (662 líneas, ~35 KB):
  - ESM sin dependencias;
  - el realtime lo puede importar tal cual;
  - es el catálogo ECO-1 y el motor ECO-2A compilados desde sus fuentes TypeScript, sin copia manual.
- `--check` falla con exit 1 si el artefacto falta o está desactualizado y nunca escribe.
- **Los guards de aislamiento leen imports reales.** Un único guard (`src/features/ecosystem/isolation.test.ts`, sobre `typescript.preProcessFile`) reemplaza a los dos de ECO-1 y ECO-2A, que confundían strings de fixtures con imports. Desaparece la concatenación de ECO-2A.
- Paridad comprobada entre fuentes y bundle: mismo catálogo, misma validación, misma selección para 24 000 tickets, misma población y las mismas transiciones a lo largo de 300 pasos sembrados.

## 2. Generador

Mismas convenciones que `bundle-skills.mjs`:
- esbuild (transitivo vía Vite, como en SKILLS: no se agregó ninguna dependencia);
- `platform: 'neutral'`, `format: 'esm'`, `target: 'es2022'`;
- encabezado `GENERATED … Do not edit`;
- un test de deriva con `?raw`.

```text
node scripts/integration/bundle-encounters.mjs                    escribe el bundle
node scripts/integration/bundle-encounters.mjs --check            exit 1 si falta o está viejo; no escribe
node scripts/integration/bundle-encounters.mjs --output <archivo> otro destino (lo usan los tests)
```

API del script (ESM):

- `bundleEncounters({ plugins? })` → texto del bundle. `plugins` existe sólo para los tests de deriva.
- `bundleStatus(fresh, output?)` → `'fresh' | 'stale' | 'missing'`. Sólo lee.
- Constantes `ROOT`, `ENTRY` y `OUTPUT`.

**Reproducibilidad.**
- `absWorkingDir` es la raíz del repo, así que las únicas rutas del bundle son comentarios de módulo relativos al repo (`// src/features/ecosystem/...`).
- No hay timestamps ni rutas absolutas: un test lo verifica.
- Los finales de línea se normalizan a `\n`, y la comparación de `--check` y del test también los normaliza, así que el checkout CRLF de Windows no produce falsos "stale".

**Entrada única:** `src/features/ecosystem/server/encounterRuntime.ts`.
- **Sólo re-exporta**, sin lógica propia, de modo que el bundle no puede divergir en semántica.
- Superficie exportada (`ENCOUNTER_RUNTIME_API = 1`):
  - catálogo: `ECO_1_ENCOUNTER_CATALOG`, `ENCOUNTER_RARITIES`, `SPECIES_CATEGORY_IDS`, `EVENT_ONLY_CATEGORIES`, `ordinaryEncounterExclusion`, `validateEncounterCatalog`;
  - consultas: `zoneById`, `entriesInZone`, `entriesForSpecies`, `entriesInFamily`, `entriesOfRarity`, `zoneDistribution`, `pickEncounter`, `ticketFrom`;
  - motor: `PROVISIONAL_RESPAWN`, `PROVISIONAL_IDLE`, `validatePopulationConfig`, `createPopulation`, `tickPopulation`, `retireEncounter`, `encounterIdParts`, `publicArea`.
- No incluye `core.json`. El realtime valida el catálogo con su propio lookup de especies al integrarse (ECO-2C).

## 3. Guards de aislamiento corregidos

`src/features/ecosystem/testing/sourceImports.ts` usa el scanner de TypeScript (ya es devDependency).

- **Cuenta:** imports estáticos, `import type`, re-exports, `import('literal')` y `require('literal')`, con resolución de rutas relativas y del alias `@/`.
- **Ignora:** comentarios, strings y el `<template>` de un `.vue` (sólo lee los bloques `<script>`).

**Reglas:**

| Carpeta | Puede importar |
| --- | --- |
| `encounters/` | Sólo `encounters/` |
| `population/` | `population/` y `encounters/` |
| `server/` | `encounters/` y `population/` |

- Ningún módulo de runtime usa `Date.now`, `Math.random`, timers ni red.
- `encounters/` no menciona ownership.
- Fuera de `src/features/ecosystem`, nadie en `src/`, `services/` ni `scripts/` importa un módulo del ecosistema ni el bundle.

**Permitido explícitamente:**
- los archivos del propio módulo y sus tests (los tests consumen el bundle);
- el generador llega a la entrada **por ruta**, vía esbuild, no por import.

No se excluyó ninguna carpeta de producto del escaneo.

**Controles negativos:**
- **Detecta:** import estático, re-export, `import()` dinámico, `require` e `import type` con alias dentro de un `.vue`.
- **No cuenta:** un string-fixture, un comentario ni texto del template.
- **Prueba sobre el árbol real** (restaurada con `git checkout`): agregar `import … from './ecosystem/encounters.generated.js'` a `worldRoom.js` hace fallar el guard nombrando `worldRoom.js`, y un string-fixture con ese mismo texto en `wildService.js` no lo hace fallar.

## 4. Tests (`src/features/ecosystem/server/encounterBundle.test.ts`, 12)

| Caso | Qué prueba |
| --- | --- |
| Al día | Texto commiteado = build actual; `bundleStatus` = `fresh` |
| Contenido | Sin `import`/`require`, sin rutas absolutas, sin timestamps |
| Reproducible | Dos generaciones consecutivas son idénticas; escribir dos veces da los mismos bytes, iguales al commiteado |
| Superficie | Las exportaciones del bundle son exactamente las de la entrada |
| Node pelado | Un proceso Node aparte (el mismo binario de Node 22), con cwd temporal fuera del repo, importa el bundle por URL y elige `cueva-inicial:zubat` |
| Paridad del catálogo | Mismo JSON; misma validación de un catálogo válido y de uno roto |
| Paridad de selección | 3 zonas × 400 × 20 tickets: mismos resultados, y las 35 entradas alcanzadas |
| Distribución inválida / pool vacío | Shares en 0, pesos `NaN` y todas las especies excluidas: mismas respuestas (`invalid-distribution`, `empty-tier`) |
| Paridad de población | 300 pasos con `seeded(31337)`: 3 nidos (uno `per-member`), una casilla bloqueada, retiradas al 25 % y presencia que se va más de 5 min. Eventos, retiradas, proyecciones y estado final idénticos; el recorrido incluye apariciones y `dormant` |
| Deriva | Cambiar en memoria un peso del catálogo (Pidgey 28 → 29) o una regla del motor (`retryMs` + 1) da `stale` |
| `--check` | Archivo ausente: exit 1 y no lo crea. Archivo viejo: exit 1 y contenido intacto. Archivo fresco: exit 0. El artefacto commiteado: exit 0 |

Prueba adicional sobre el árbol real: alterar el bundle commiteado (`delayMs: 75e3` → `74e3`) hace fallar 3 tests y `--check` sale con 1. Restaurado, `--check` vuelve a 0.

## 5. Gates (Node v22.23.3 portátil verificado, `eca425d`)

| Gate | Resultado |
| --- | --- |
| `vitest run src/features/ecosystem` | 9 archivos, **98 tests ✔** |
| Typecheck (`vue-tsc`) | exit 0 |
| Lint (`eslint .`) | **exit 0**: 0 errores. 9 warnings preexistentes, ninguno del cambio (ESLint ignora `services/`, como con el bundle de SKILLS) |
| `git diff --check ba87beb..HEAD` | exit 0 |
| `bundle-encounters.mjs --check` | exit 0. El árbol no cambió tras ejecutarlo |
| `package.json`, lockfile, CI, `worldRoom.js`, `wildService.js` | Sin cambios |

## 6. Pendiente para conectarlo (ECO-2C, no autorizado aquí)

- `encounterService.js` en el realtime:
  - importa el bundle;
  - valida el catálogo al arrancar con un lookup de especies y falla cerrado;
  - arma la config con nidos derivados del mapa y con guardas;
  - provee CSPRNG, reloj y geometría;
  - toma el namespace de la autoridad persistente.
- Cableado en `worldRoom.js`, mensaje de protocolo con los campos de `publicArea`, cliente que dibuja y retiro del roster horario (K1/K2).
- Agregar `bundle-encounters.mjs --check` al gate de despliegue junto al de SKILLS. **No se tocó CI.**
- Si el bundle crece, considerar si el realtime necesita también `core.json` para validar; hoy no lo incluye.
