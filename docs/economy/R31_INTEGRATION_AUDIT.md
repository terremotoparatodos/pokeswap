# R31 — Auditoría de integración

> **Rol:** estación principal (arquitectura e integración).
> **Fecha:** 2026-09-16.
> **Candidato auditado:** `origin/feat/r31c4-1-alchemy-gathering-polish` @ `c7f3a77`.
> **Estado:** diagnóstico. **No se mergeó, no se hizo rebase ni cherry-pick, no se tocó código de R31, no se crearon migraciones.** Este documento es el único archivo agregado. Vive en la rama local `audit/r31-integration` (worktree `../pokeswap-r31-audit`), sin commit ni push.
> **Convención:** **FACT** = verificado en esta auditoría (comando, lectura de código o medición). **INFERENCE** = deducido, no ejecutado. **A VERIFICAR** = requiere un entorno que esta estación no ejercitó.
> **Severidad:** **BLOCKER** (impide integrar o empezar la fase indicada) · **ANTES DE PRODUCCIÓN** (impide que la feature sea real, no que el código dev-only entre a `main`) · **PUEDE ESPERAR**.

---

## 0. Resumen ejecutivo

1. **La genealogía es sana.** Las 7 fases forman una cadena lineal perfecta sobre el HEAD real de `main` (`7e474c6`), sin merges, duplicados ni drift. R31 contiene todo R30. (§1–2)
2. **El aislamiento de producción es real.** El build de producción no contiene playground, laboratorios, demo, catálogo ni textos de profesiones. Solo quedan hooks inertes del motor: +3,6 KB en `WildlandsView` (de 298.300 a 301.948 bytes, con el mismo `.env`). (§7, §15)
3. **Hay un blocker de integración concreto:** el typecheck estricto de la app (`vue-tsc -p tsconfig.app.json`) **falla con 2 errores** introducidos en R31-C4 (`e07ca8b`). `main` pasa. Los handoffs de C4 y C4.1 reportan "vue-tsc OK" y no lo es; CI no lo detecta porque `npm run typecheck` no chequea nada. (§8, §16)
4. **El dominio de R31-A es la mejor parte.** Contratos en tres capas, resolvers puros con RNG inyectado, `previewGathering`, afinidad sin especie óptima y catálogo validado. Es **candidato a servidor, no producción-ready**: le faltan validación de entradas hostiles, enteros para energía, validación de estación, un modelo de agotamiento seguro y un empaquetado que Node pueda ejecutar. (§4, §9)
5. **La capa visual es buena pero está quintuplicada.** Cinco controladores, cinco overlays, cuatro tarjetas y cuatro laboratorios repiten el mismo esqueleto; mining vs logging difieren en ~37 líneas normalizadas. Hay una abstracción natural. Alquimia **no** debe forzarse en ella. (§5, §14)
6. **Para que el servidor pueda validar, faltan piezas de R30 que no son de R31:**
   - el servidor de presencia no conoce el terreno (`acceptMove` suma deltas sin colisión);
   - no puede ejecutar el dominio TypeScript;
   - hay un posible desajuste entre el spawn wild del servidor `(8,41)` y el del mundo cliente `(-5,-69)`, **A VERIFICAR** en producción.

   La arquitectura multiplayer propuesta en §10 depende de resolver eso primero.
7. **Recomendación:** no empezar R32 como "minería persistente". Antes hacen falta dos fases cortas:
   - **R31-Z**, consolidación en cliente: blockers, código muerto, extracción de la abstracción y corrección de docs.
   - **R32-0**, fundaciones de autoridad: paquete de reglas compartido, geometría en servidor, contrato de acciones y verificación del spawn.

   Recién después, una sola profesión persistente. (§19–20)

---

## 1. Estado Git y genealogía de ramas

### 1.1 Estado del repo local (estación principal)

| Dato | Valor (FACT) |
|---|---|
| Checkout principal | `feat/wildlands-r30-cloud-deploy` @ `bf44f41`, árbol `src/` idéntico a `origin/main` |
| Sin commitear en el checkout principal | `.claude/`, `supabase/.temp/`, dos archivos con nombre roto (`C…UsersRodri…launch.json`, `C…calibration-data.json`), `agents/CLAUDE_SECURITY_AND_VERIFICATION_BACKLOG.md`, `docs/SECURITY_AND_VERIFICATION_ROADMAP.md` |
| `git fetch --all --prune` | Nueva: `feat/r31c4-1-alchemy-gathering-polish`. Borradas en remoto: `docs/wildlands-r30-plan`, `feat/wildlands-r29` |
| `origin/migration` | `e7ecaa1`, **detrás** de `main`. El flujo "fase → migration → main" dejó de usarse en R30 (PRs #19–#21 fueron directo a `main`) |

### 1.2 Cadena verificada

Comandos: `git merge-base`, `git merge-base --is-ancestor`, `git rev-list --count`, `git rev-list --merges` y `git patch-id --stable` sobre todos los commits.

| Fase | Rama remota | HEAD | Padre esperado | merge-base = padre | Commits propios | Merges | Detrás del padre |
|---|---|---|---|---|---|---|---|
| R30 | `origin/main` | `7e474c6` | — | — | — | — | — |
| R31-A | `feat/r31-professions-foundation` | `bd33e3e` | `7e474c6` | ✅ | 7 | 0 | 0 |
| R31-B | `feat/r31b-professions-ux` | `721fd2a` | `bd33e3e` | ✅ | 8 | 0 | 0 |
| C1 | `feat/r31c-mining-visual-design` | `93edd32` | `721fd2a` | ✅ | 12 | 0 | 0 |
| C2 | `feat/r31c2-fishing-visual-design` | `2e29ddf` | `93edd32` | ✅ | 7 | 0 | 0 |
| C3 | `feat/r31c3-logging-visual-design` | `9b587e6` | `2e29ddf` | ✅ | 9 | 0 | 0 |
| C4 | `feat/r31c4-alchemy-visual-design` | `8d665e2` | `9b587e6` | ✅ | 6 | 0 | 0 |
| C4.1 | `feat/r31c4-1-alchemy-gathering-polish` | `c7f3a77` | `8d665e2` | ✅ | 4 | 0 | 0 |

- **Lineal:** sí. Cada rama es ancestro exacto de la siguiente, sin merges internos y sin commits del padre ausentes.
- **Total:** 53 commits, un solo autor (`terremotoparatodos`), del 2026-09-15 13:42 al 2026-09-16 13:00 (-03).
- **Duplicados (patch-id):** ninguno.
- **Divergencias inesperadas:** ninguna.
- **HEAD informado por la estación secundaria:** `c7f3a77`, coincide con `origin`.
- **Cambios de R30 ausentes en R31:** ninguno. `git log c7f3a77..origin/main` está vacío. `bf44f41` (último commit documental de R30) y `7e474c6` (merge de PR #21) son ancestros del candidato.

### 1.3 Commits exclusivos por fase

<details><summary>Lista completa (53)</summary>

```text
R31-A  bffebf6 6b1b58e d7b4ada 8f02e01 de9402f ed587ac bd33e3e
R31-B  ef3caac f55a895 bacab98 904f138 774e207 ca8b049 1aff70e 721fd2a
C1     d26a5dd 23056e0 a516bf3 27a7f10 071be95 42dda2b 23eca62 7253e9c 1371025 04fd32f fa2ce08 93edd32
C2     d373e0e 298dedc 152a02e 30cf71e 3a27d74 4b10ab0 2e29ddf
C3     9ba4b11 6d0a2a2 d5be9fc b6cfc0d d6e1e79 ff025de 3e0d909 2cbce6b 9b587e6
C4     f872176 e07ca8b 49a771c 0df7000 014a820 8d665e2
C4.1   826501d 643a67a bc2ea2f c7f3a77
```

</details>

- **Commits que tocan otras features:**
  - `ca8b049` (hook WildLands dev);
  - `d26a5dd` (SceneOverlay, tiles interactuables);
  - `42dda2b`, `4b10ab0`, `ff025de`, `014a820` (demo en mundo);
  - `9ba4b11` (recetas de árbol en `props.ts`);
  - `826501d` (`BUSH_RECIPES`).
- **Commit que introduce el blocker de typecheck:** `e07ca8b`.

---

## 2. Commit base real de R30

| Referencia | Hash | Qué es |
|---|---|---|
| Base de R31 | **`7e474c6`** | Merge PR #21 en `main` (cierre documental R30). Árbol idéntico a `bf44f41` |
| Último commit de contenido R30 | `bf44f41` | `docs(wildlands): record next-phase exploration boundary` |
| Último fix funcional R30 | `bdf6273` | `fix(wildlands): keep presence visible when minimized` (PR #20, merge `0b1b7dc`) |

**FACT:** `origin/main` no avanzó después de `7e474c6`. No hay que rebasar el candidato.

---

## 3. Qué contiene el candidato R31 final

`git diff --stat origin/main c7f3a77`: **189 archivos, +21.821 / −42.**

| Zona | Archivos | Contenido |
|---|---|---|
| `src/features/professions/domain/` (+ `catalog/`) | 26 | Contratos, catálogo (4 profesiones, 54 ítems, 16 nodos, 12 herramientas, 34 recetas), fórmulas, resolvers, colocación y agotamiento de nodos, afinidad, validación de catálogo, 493 base stats generados |
| `simulation/` + `scripts/` | 5 + 2 | Simulador stock-flow, CLI `sim:economy`, extractor de stats del legado |
| `inventory/` | 3 | Contenedor de espacios + stacks, reglas de stack de demo |
| `ui/` | 10 | Modelos de presentación (capacidades, estado de nodo, herramientas, progresión, recetas, feedback, sesión de pesca R31-B) |
| `demo/` | 6 | Reducer de sesión local, trabajadores fixture, landmarks de Pradera |
| `mining/`, `fishing/`, `logging/`, `forage/`, `alchemy/` | 7+7+6+5+6 | Timeline, estado visual, overlay y controlador por profesión |
| `overworld/` | 4 | `CompositeOverlay`, Pokémon trabajador (pose pura y dibujo) |
| `art/` | 29 | Assets procedurales (~250 sprites/íconos/VFX) + paletas + tests |
| `components/` | 34 | Tarjetas de acción, inventario, HUD, panel R31-B, playground, laboratorios, galería, demo en mundo |
| `docs/economy/` | 28 | Diseño, handoffs, direcciones de arte, manifests, specs de interacción |
| **Fuera de la feature** | 12 | `wildlands/engine/{game,navigator,props,renderer}.ts`, `sceneOverlay.ts` (nuevo), `worldObjectNavigation.test.ts` (nuevo), `WildlandsView.vue`, `app/router/routes(.test).ts`, `package.json` (script) |

**Sin cambios en `services/`, `supabase/` ni `.github/`** (FACT, `git diff --stat` vacío).

### 3.1 Cambios en el motor (el único acoplamiento con código de producción)

| Archivo | Cambio | Llega a producción |
|---|---|---|
| `game.ts` (636 → 687 líneas) | `WorldObjectTarget`, `onWorldObject`/`isWorldObject`, `setSceneOverlay`, `setInputLocked`, `playerSnapshot`, `worldObjectBeside` | Sí, inerte (sin callback) |
| `navigator.ts` | `isInteractive` opcional: llegar al lado y encarar tiles no sólidos | Sí, inerte |
| `renderer.ts` | Llama a `overlay.decor/ground/sprites/labels`; `alpha`, `scale` y `depthBias` en drawables | Sí, inerte |
| `props.ts` | Exporta `TREE_METRICS`, `ROCK_RECIPES`, `BUSH_RECIPES`, `CRYSTAL_RECIPE`, paletas; mismo arte | Sí (refactor sin cambio visual declarado) |
| `sceneOverlay.ts` | Interfaz del puerto | Solo tipos |
| `WildlandsView.vue` | Monta `ProfessionWorldDemo` bajo `import.meta.env.DEV` | No (el import dinámico se elimina) |
| `routes.ts` | `/dev/profesiones` bajo `import.meta.env.DEV` | No |

---

## 4. Qué está bien y conservaría

| # | Pieza | Por qué | Clasificación |
|---|---|---|---|
| K1 | **Tres capas de contratos** (`types.ts`: Definition / State / Runtime) | Separa catálogo versionado, estado persistible y valores de una acción. Es la forma correcta para un servidor | Buena, conservar |
| K2 | **Resolvers puros con RNG y `now` inyectados** (`gathering.ts`, `processing.ts`, `energy.ts`, `durability.ts`) | Ejecutables en servidor y testeables sin DOM. Cumplen `AGENTS.md` §11 en forma | Candidatos a servidor (ver R-series) |
| K3 | **`previewGathering`** | Números previstos = números aplicados; el servidor puede rechazar antes de tirar dados | Conservar tal cual |
| K4 | **Afinidad con presupuesto compartido y topes** | Evita "la especie óptima" con estructura, no con tablas; testeado sobre el roster completo | Conservar; balance pendiente |
| K5 | **`catalogValidation`** | Garantiza faucet y sink por material, referencias válidas y tiers completos | Conservar y correr en CI |
| K6 | **Nodos derivados de la semilla** (`nodePlacement.ts`) | Cero sincronización de entidades. `hash2` usa aritmética entera y `fbm` solo operaciones IEEE básicas: **determinista entre motores JS** (FACT por lectura) | Conservar; ver R4 sobre dónde corre |
| K7 | **Inventario puro de espacios + stacks** con `overflow` explícito y `transferSlot` todo-o-nada | Buen modelo de operaciones; sirve para almacenamiento futuro | Buena, necesita endurecer (§12) |
| K8 | **`SceneOverlay` como puerto** | El motor no importa profesiones (test lo impide); el overlay no conoce el motor más que por tipos | Conservar, reubicar responsabilidades (§14) |
| K9 | **`workerPresence` puro** + `WorkerCompanion` | Posición y pose del trabajador sin colisión ni autoridad | Conservar |
| K10 | **Timelines puras** (`miningAction`, `choppingTimeline`, `fishingTimeline`, `forageTimeline`, `brewTimeline`) | Animación separada del resultado; tests de "cada golpe una sola vez entre frames" | Conservar |
| K11 | **`professionsIsolation.test.ts`** | Impide Supabase, Colyseus, storage, `Math.random`, imports del motor fuera de lo permitido y entradas no-DEV | Conservar; complementar con test de bundle (§16) |
| K12 | **Simulador económico** sobre los resolvers reales | Evidencia cuantitativa (verificado: generado 77.664 / destruido 5.540 = **14,0:1**) | Conservar como herramienta, no como verdad |
| K13 | **Arte procedural sobre las recetas del mundo** | Nodos que conservan footprint y ancla del prop; sin PNG | Conservar (no rediseñar) |
| K14 | **Honestidad de los handoffs** sobre lo no verificado | Útil para auditar | Conservar la práctica; corregir las dos afirmaciones inexactas (§8) |

---

## 5. Qué refactorizaría

### 5.1 Duplicación medida (FACT)

| Duplicado | Copias | Evidencia |
|---|---|---|
| `use{Mining,Logging,Forage,Fishing}Controller` | 4 (+ Alquimia distinta) | 111–154 líneas c/u; mining vs logging: **~37 líneas de diff** tras normalizar nombres |
| `*Overlay.ts` (esqueleto: `ports`/`placements`/`views` caches, `tick`, `rewind`, `celebrate`, `pops`, `summonWorker`, `labels`) | 5 | 313–444 líneas c/u; 20–24 usos de reward pops, rewind o trabajador por archivo |
| `targetAt` / `isStation` / scan de parches | 5 | Misma caché `Map<string, target>` por overlay; **5 cachés paralelas** del mismo `nodeAt` |
| `*ActionCard.vue` | 4 (+ `AlchemyStationCard`) | 171–205 líneas; comparten `NodeOutlook`, `GatheringFeedback`, chips y pie |
| `spawnBeside` | 4 laboratorios | Función idéntica copiada en cada `*FieldLab.vue` |
| Modelo de pesca | 2 | `ui/fishingSession.ts` (R31-B) y `fishing/fishingTimeline.ts` (C2) |
| Banco de Alquimia | 2 | `AlchemyBench.vue` + `RecipeCard.vue` (R31-B) y `AlchemyStationCard.vue` + `recipeBrowser.ts` (C4) |
| Alias de tipos Pokémon | 2 | `professions/domain/affinity.ts` y `wildlands/engine/population.ts` (hay test de equivalencia) |

### 5.2 La abstracción natural (propuesta, NO implementada)

Hay **dos familias**, no una:

```text
                         ┌──────────────────────────────┐
                         │  WorldInteractionHost         │  (uno por mundo)
                         │  - NodeIndex por área         │  ← reemplaza 5 cachés
                         │  - CompositeOverlay ordenado  │
                         │  - input lock / selección     │
                         │  - WorkerCompanion compartido │
                         │  - RewardPops compartidos     │
                         └──────────┬───────────────────┘
               ┌────────────────────┴─────────────────────┐
     GatheringInteraction<K>                       StationInteraction<R>
     (nodo → acción → drops)                       (estación → receta×lote → productos)
     ├─ mining   adapter: arte, timeline, verbo    └─ alchemy adapter: navegador de recetas,
     ├─ woodcut. adapter: + caída en última carga                        brew timeline, lote
     ├─ forage   adapter: mano/hoz según preview       (futuro: fundición, banco de trabajo,
     └─ fishing  adapter: + fase "wait/bite/reel"       fogata → misma familia)
```

**Contrato de `GatheringInteraction` (adapter por profesión):**

| Hook | Responsabilidad | Mining | Logging | Forage | Fishing |
|---|---|---|---|---|---|
| `matches(node)` | Qué nodos del catálogo maneja | `profession==='mining'` | `woodcutting` | `alchemy && tool sickle/none` | `fishing` |
| `approach(player, node, world)` | Dónde pararse y validez de alcance | `isBeside` | `isBeside` | `isBeside` | `fishingApproach` (orilla/agua) |
| `timeline(preview)` | Fases visuales | golpes | hachazos + caída | gesto mano/hoz | lanzar → esperar → pique → recoger |
| `phases` extra | Interacción del jugador durante la acción | — | — | — | `reel()` |
| `nodeArt(state)` / `toolArt(tier, cond)` / `particles` | Arte | … | … | … | … |
| `labels` | Verbo, "Seguir X", textos de bloqueo | … | … | … | … |

El host posee lo común:
- selección;
- adyacencia genérica;
- `setInputLocked`;
- ciclo idle → acting → result;
- caché de nodos;
- trabajador;
- reward pops;
- `rewind`;
- `cancel`/`detach`.

**Por qué Alquimia no entra en `GatheringInteraction`:**
- no tiene nodo ni cargas;
- no tiene herramienta, energía ni durabilidad;
- su entrada es `(receta, cantidad)`;
- su coste son ingredientes;
- su validación de servidor es de **estación + inventario**, no de posición + nodo.

Forzarla requeriría `node?: …` opcionales en todo el contrato. En cambio, **la recolección de Alquimia (forage) sí es Gathering** y ya se comporta así.

La familia `StationInteraction` absorbe hoy solo a Alquimia. Es la forma correcta para refinado y crafting futuros (horno, banco de trabajo, fogata), que el catálogo ya define como `station`.

**Tarjeta:** una `GatheringActionCard` base con slots `chips`, `tool`, `actions` y `result`; `FishingActionCard` agrega el botón de recoger por slot. `AlchemyStationCard` queda aparte.

### 5.3 Otros refactors

| # | Refactor | Severidad |
|---|---|---|
| RF1 | **`NodeIndex` único por área** (numérico, por chunk, con LRU) en lugar de 5 `Map<string>` sin límite | ANTES DE PRODUCCIÓN (perf/memoria, §15) |
| RF2 | **Sacar la aplicación del resultado del render.** `onResult` se dispara dentro de `overlay.ground()` → `tick()`. En multiplayer el resultado lo decide el servidor; la timeline solo debe *presentar* un resultado recibido | BLOCKER para R32 |
| RF3 | **Paquete de reglas compartido** (`domain/`, `catalog/`, `nodePlacement`, `world.ts`, `noise.ts`) compilable para Node | BLOCKER para R32 (§10) |
| RF4 | **Metadata de receta en el catálogo** (`name`, descripción, ícono): hoy la UI la deriva (B-03, H-2/H-3) | PUEDE ESPERAR (antes de UI productiva) |
| RF5 | **Textos de acceso generados desde `AccessRule`** (B-17) | PUEDE ESPERAR |
| RF6 | `game.ts` a 687 líneas: extraer interacción con el mundo (`worldObjectBeside`, input lock, overlay) a `engine/worldInteraction.ts` | ANTES DE PRODUCCIÓN (`AGENTS.md` §6, §24) |
| RF7 | Unificar `TYPE_ALIASES` en `features/pokemon/domain` | PUEDE ESPERAR |

---

## 6. Qué eliminaría

| # | Qué | Evidencia | Cuándo |
|---|---|---|---|
| E1 | **Rama muerta del demo en mundo:** `otherNodeAt`, `target`, backdrop y `NodeInteractionPanel` en `ProfessionWorldDemo.vue` | `OVERLAY_PROFESSIONS = ['mining','fishing','woodcutting','alchemy']` = **todas** las profesiones. `otherNodeAt` siempre devuelve `null` (FACT por lectura) | R31-Z |
| E2 | `ui/fishingSession.ts` + `FishingCast.vue` (modelo de pesca R31-B) | Reemplazados por `fishingTimeline` + `FishingActionCard`. Solo los usa el panel R31-B | R31-Z, tras decidir si el playground conserva el panel genérico |
| E3 | `AlchemyBench.vue` + `RecipeCard.vue` | Reemplazados por `AlchemyStationCard` + `recipeBrowser` | R31-Z |
| E4 | `NodeInteractionPanel` + `EnergyMeter`/`ToolStatus` como panel genérico | Solo lo usa el playground; las cuatro profesiones tienen tarjeta propia | Decidir en R31-Z: o se retira o se convierte en la tarjeta base de §5.2 |
| E5 | Los dos errores de variables sin uso (`brew`, `timeline`) | Rompen typecheck | R31-Z (blocker) |
| E6 | Arte/estados de nodo no usados, si la galería confirma que no se referencian | No medido archivo por archivo | Revisión en R31-Z |

No eliminaría el simulador, la galería ni los laboratorios: son herramientas de balance y revisión visual (dev-only).

---

## 7. Qué debe seguir siendo dev-only

### 7.1 Verificación del build (FACT)

| Prueba | Resultado |
|---|---|
| `npm run build` en el candidato (sin `.env`) | OK, 25 assets |
| Mismo build con el `.env` de la estación principal, comparado contra `main` | Mismos chunks. `index` idéntico (334.533 B). `WildlandsView` 298.300 → **301.948 B (+3.648)**. Total +3.648 B |
| Búsqueda en `dist/` de `profesiones`, `ProfessionPlayground`, `FieldLab`, `AssetGallery`, `Veta de hierro`, `Mineral de Hierro`, `Minando`, `Talando`, `alchemyTable`, `Kit de insumos`, `demoSession`, `BUSH_RECIPES`, `dev/profesiones` | **0 coincidencias** |
| Coincidencias esperadas | `onWorldObject` (7), `isWorldObject` (5), `setSceneOverlay`, `setInputLocked`, `playerSnapshot`, `isInteractive`: hooks del motor, sin callback en producción |
| Ruta `/dev/profesiones` | Se agrega solo con `import.meta.env.DEV`; en producción cae al catch-all → `/` |

### 7.2 Debe seguir dev-only

- Todo `components/playground/`, `components/world/ProfessionWorldDemo.vue`, `demo/`, `simulation/`, `scripts/simulate-economy.ts`.
- Los overlays, controladores y tarjetas **mientras apliquen resultados locales** (hoy todos).
- Controles de tiempo, nivel, energía, durabilidad e inventario del playground.

### 7.3 Riesgos de aislamiento

| # | Riesgo | Severidad |
|---|---|---|
| D1 | El aislamiento se prueba con **regex sobre fuentes**, no sobre el bundle. Un import indirecto (por ejemplo desde `shared/`) no lo detectaría | ANTES DE PRODUCCIÓN: agregar check de `dist/` en CI (§16) |
| D2 | El demo en mundo **muta el juego real** (`setSceneOverlay`, `setInputLocked`, pausa) dentro de `WildlandsView` en dev. Con presencia R30 activa en dev, un bug del overlay puede afectar el movimiento enviado al servidor de staging | PUEDE ESPERAR (dev-only), documentar |
| D3 | El demo de alquimia en WildLands nunca llama `setStation`, así que `brew()` **no valida adyacencia** (`if (player && station && …)` con `station === null`). Se puede preparar lejos de la mesa | Dev-only; relevante como patrón: el alcance vive en la UI |

---

## 8. Problemas y blockers

### 8.1 BLOCKER para integrar (aunque sea dev-only)

| ID | Problema | Evidencia | Acción |
|---|---|---|---|
| **B1** | **Typecheck estricto falla** | `npx vue-tsc --noEmit -p tsconfig.app.json` → exit 2: `alchemyOverlay.ts(216,21) TS6133 'brew'` y `brewTimeline.ts(105,30) TS6133 'timeline'`. En `main` el mismo comando da exit 0. Introducido en `e07ca8b` (C4) | Corregir en R31-Z |
| **B2** | **CI no chequea tipos** | `npm run typecheck` = `vue-tsc --noEmit` sobre `tsconfig.json` (solo `references`, sin `-b`) → exit 0 vacío. Ya estaba documentado en `docs/wildlands/HANDOFF.md`, y así se coló B1 | Cambiar el script a `vue-tsc -b` o `-p tsconfig.app.json`, en PR separado. `tsconfig.node.json` tiene errores previos: acotar |
| **B3** | **Afirmaciones de verificación inexactas en handoffs** | C4 y C4.1: "vue-tsc / npm run typecheck: OK" (falso para `vue-tsc -p`). C4.1: "13 casillas" escaneadas (el código usa `PATCH_RADIUS = 13` → **27×27 = 729 tiles**) | Corregir docs en R31-Z |

### 8.2 BLOCKER para empezar R32 (servidor/persistencia)

| ID | Problema | Detalle |
|---|---|---|
| **B4** | **El servidor no puede ejecutar el dominio** | `services/realtime` es JS ESM sin build (`node src/index.js`). El dominio es TS dentro de `src/features/`. `nodeAt` depende de `wildlands/engine/world.ts`. No hay paquete compartido (§10.2) |
| **B5** | **El servidor no conoce el terreno** | `acceptMove` (`services/realtime/src/presence/movement.js`) solo valida dirección, cadencia y ráfaga. Suma `dx,dy` **sin colisión ni agua**. Un cliente modificado puede caminar sobre sólidos y agua; la posición "autoritativa" no garantiza alcance legítimo a un nodo |
| **B6** | **Spawn wild servidor ≠ spawn del mundo cliente (A VERIFICAR)** | Servidor: `changeArea('pradera')` → `(8,41)` (`WILD_SPAWN`, que coincide con la *llegada al pueblo* en `hearthome.ts`). Cliente: `WildArea` usa `world.findSpawn` → Pradera `(-5,-69)` (`praderaLandmarks.ts`). `setAuthoritativeActor` reubica al jugador si difiere. Si en producción el jugador aparece en `(8,41)`, el portal de vuelta y la mesa derivada del spawn quedan a ~110 tiles. **Verificar en producción antes de validar posiciones** |
| **B7** | **Agotamiento de nodos no apto para servidor** | (a) `consumeCharge` **copia el Map completo** por acción (FACT: 3,6 ms/acción con 50k entradas). (b) La ventana se ancla al **primer uso**: 1 uso en t=0, 3 en R−1 ms y 4 en R+1 ms = **8 acciones en 2 ms** para un nodo de 4 cargas (FACT, `iron_vein`). (c) Solo vive en memoria: un reinicio o reconexión a otra instancia la resetea |
| **B8** | **Resolvers aceptan entradas no validadas** | `resolveProcessing` con `stationSpeedBonus: 3` → `seconds: -8` (FACT). No verifica que el jugador esté en una estación (`recipe.station` se ignora salvo para el tiempo). `removeStacks` con cantidad `-5` o `NaN` devuelve "éxito" sin cambios; `addStacks` acepta ítems inexistentes (FACT). Energía en float (`round2`) |
| **B9** | **Decisión de autoridad sin tomar** | `PROFESSIONS_DESIGN.md` §8.1 recomienda la opción C (secreto Colyseus ↔ Edge Function). Rompe el principio R30 "servicio sin secretos". Requiere aprobación explícita (§10) |

### 8.3 ANTES DE PRODUCCIÓN (feature real)

| ID | Problema |
|---|---|
| P1 | `pending` (recompensas que no entraron) **sin tope ni caducidad**: almacenamiento infinito que evade la capacidad |
| P2 | La hoz se gasta en nodos que no la piden (`minToolTier: 0`): FACT, `durabilityLoss: 1` en `berry_bush`. Decidir la regla en el dominio |
| P3 | Reparar tras 1 punto de desgaste cuesta 1 material y **quita 8 % del máximo** (60 → 55, FACT). Penaliza reparar temprano; el servidor debería exigir un umbral o escalar la pérdida |
| P4 | RNG de demo `mulberry32` con semilla secuencial (`rngSeed + 1`): predecible. En servidor debe ser CSPRNG, con semilla nunca expuesta |
| P5 | Timing de pesca: ventana "perfect" de 350 ms, evaluada en cliente. Con latencia México/Argentina → Miami no se puede calificar en servidor sin compensación. Hoy el grado no cambia el botín (decisión pendiente) |
| P6 | Mesa de Alquimia sin colisión (§14.4) |
| P7 | Caches de overlay sin límite y scan de hierbas (§15) |
| P8 | La estación de Alquimia derivada por espiral usa `findSpawn` (con `Math.cos/sin`). Para servidor, **la posición de estaciones debe ser un dato del catálogo del área**, no trigonometría derivada |

---

## 9. Trust boundary (auditoría adversarial)

**Hoy no hay superficie de ataque productiva:** nada persiste ni viaja por red (FACT, isolation test + bundle). El análisis evalúa **los contratos como futuros insumos del servidor**.

| Ataque del cliente modificado | ¿Qué lo impide hoy en el contrato? | Recomendación concreta |
|---|---|---|
| **Minar desde lejos** | Nada en el dominio; `isBeside` está en el controlador Vue | Servidor: `manhattan(actor.pos, node) === 1` con la posición del actor **en el servidor** y el área correcta. Requiere B5 (colisión) para que la posición sea legítima |
| **Minar un nodo inexistente** | `nodeAt` lo derivaría, si corre en servidor | Servidor recalcula `nodeAt(worldPort(areaSeed), tx, ty)`. **Nunca** aceptar `nodeId` ni `definitionId` del cliente, solo `(areaId, tx, ty)` |
| **Repetir request / replay** | Nada | `actionId` (UUID) generado por el cliente por intento. Servidor: idempotencia por `(user_id, action_id)` en memoria + `gathering_batches`. Cadencia mínima = `actionSeconds` del preview **medida en reloj del servidor** |
| **Cambiar el reloj** | `energy.ts` ignora relojes que retroceden; pero `now` lo pasa el llamador | `now` siempre del servidor. Rechazar cualquier timestamp del cliente |
| **Evitar coste de energía** | `previewGathering` compara con `availableEnergy` provisto por el llamador | El servidor lee `player_energy` persistida, regenera con su reloj y descuenta **en la misma transacción** que otorga ítems |
| **Evitar durabilidad** | `durabilityLoss` depende de `tool` provisto por el llamador | Servidor resuelve la herramienta equipada desde `tool_instances` (FOR UPDATE), nunca desde el cliente. `durability > 0` validado en la transacción |
| **Falsificar Pokémon** | La afinidad acepta cualquier `PokemonProfessionInput` | Servidor: `slots.owner_id = user AND is_locked = false` (mismo patrón que `authorizedCompanion`), tipos de `pokemon`, nivel de `pokemon_xp`, stats del catálogo. Revalidar ownership **en cada commit de lote** (swap/market pueden quitarlo a mitad de sesión) |
| **Falsificar profesión** | El nodo define la profesión | Servidor deduce la profesión del nodo derivado; el cliente no la envía |
| **Falsificar nivel** | `professionLevel` es un número del llamador | Servidor: `levelForXp(player_professions.xp)` |
| **Falsificar herramienta** | `tool` del llamador | Ver durabilidad. Tier y tipo desde `tool_instances.item_id` → catálogo |
| **Duplicar inventario** | `transferSlot`/`addStacks` puros, pero sin concurrencia | Operaciones de servidor por intención (`gather`, `craft`, `transfer`, `discard`, `equip`) dentro de transacción con `SELECT … FOR UPDATE` sobre las filas del contenedor; `quantity CHECK > 0`; `action_id` único |
| **Fabricar sin ingredientes** | `resolveProcessing` valida con `inventory` del llamador | Servidor lee el inventario en la transacción; descuenta y agrega atómicamente. Cantidades enteras 1–100 validadas antes |
| **Duplicar crafting batch** | Nada | `action_id` único + estado del batch (`pending` → `done`); repetir devuelve el resultado original |
| **Craftear lejos de la estación** | **Nada** (B8) | Servidor valida `recipe.station` contra estaciones del área (dato estático) y adyacencia, o estación propia (`structures` del jugador). Tiempo: el servidor aplica el resultado al finalizar `seconds`, no al pedido |
| **Cambiar RNG** | El resolver usa `random` del llamador | Servidor: `crypto.getRandomValues`/`randomInt`. Nunca `createSeededRandom` fuera de tests y simulador |
| **Repetir un rare drop** | Nada | Con idempotencia por `action_id` el resultado queda **fijado en el primer resolve**; repetir devuelve el mismo, sin nuevo roll. Registrar rares en ledger para auditoría |
| **Explotar la frontera de respawn** (B7b) | Nada | Modelo de agotamiento por **token bucket** (regeneración continua de cargas) o ventana desde el **último** uso; persistido o en memoria por usuario con TTL |
| **Números hostiles** (`NaN`, negativos, floats, ítems inexistentes) | Parcial | Capa `validateIntent()` antes del dominio: enteros, rangos, catálogo. Endurecer `removeStacks` y `addStacks` para lanzar ante cantidades no enteras o no positivas e ítems desconocidos |
| **Mantener un Pokémon locked en profesión** | — | Si la party persiste, `is_locked` y "no en otra profesión" se revalidan por lote |
| **Guest ejecutando acciones** | R30 no da actor a guests | Mantener: las acciones de profesión requieren `auth.kind === 'player'` |

**Principio:** el cliente solo envía `intent = { actionId, kind, areaId, tx, ty [, recipeId, quantity] }`. Todo lo que figura en la pregunta del encargo ("gané 5 hierro", "subí XP", "me quedan 40 de energía", "durabilidad 12", "gasté estos ingredientes") **sale del servidor**.

---

## 10. Arquitectura multiplayer propuesta

### 10.1 Punto de partida real (R30, FACT)

- `PresenceRoom` único, estado en memoria (`actors` Map de módulo), un proceso, tope de 100 conexiones.
- Mensajes: `presence:ready`, `move {direction, running, sequence}`, `area`, `observe`. JWT verificado una vez por `authenticateSupabase` (clave publishable).
- Sin credenciales de escritura, sin terreno y sin build step.
- Áreas compartidas: `ciudad-corazon` y `pradera`.

### 10.2 Prerrequisitos (R32-0)

1. **Paquete de reglas compartido:** `packages/game-rules/` (o `src/shared/game-rules/`) con:
   - `world.ts` y `noise.ts` (sin Canvas; hoy `world.ts` no importa nada del DOM, FACT);
   - `professions/domain/**`, `catalog/**`, `nodePlacement`, `nodeDepletion` reescrito;
   - sin Vue ni DOM. `professionsIsolation.test.ts` ya impone gran parte.

   Build con `esbuild` a ESM para `services/realtime` (paso de install en Colyseus Cloud) y consumo directo desde Vite. Un test de CI debe comparar que cliente y servidor derivan los mismos nodos para una muestra de tiles.
2. **Geometría en el servidor:** `acceptMove` consulta `world.isSolid/isWater` (pradera) y la colisión del pueblo. Sin esto, la adyacencia no prueba nada (B5).
3. **Verificar y corregir el spawn wild** (B6).
4. **Contrato de mensajes** versionado en `protocol/messages.js` (o `game-rules/protocol`).

### 10.3 Flujo de una acción de recolección

```text
Cliente                        Realtime (autoridad de posición y acción)           Supabase
───────                        ───────────────────────────────────────────         ────────
tap nodo (tx,ty)
  │ camina (move intents, R30)
  ├─ gather:start {actionId, areaId, tx, ty}
  │                          1. auth player, área compartida, rate limit
  │                          2. actor.areaId === areaId, |actor−tile|₁ === 1
  │                          3. node = nodeAt(worldPort(seed(areaId)), tx, ty) ≠ null
  │                          4. cadencia: now ≥ actor.nextActionAt
  │                          5. cargas: bucket(user, nodeKey).available ≥ 1
  │                          6. contexto (caché por sesión, invalidable):
  │                             nivel prof., energía regenerada, herramienta equipada,
  │                             afinidad del trabajador (ownership revalidado ≤ N s)
  │                          7. previewGathering → rechazo temprano
  │◀─ gather:accepted {actionId, actionSeconds, preview visible}
  │  (animación = presentación; NO aplica nada)
  │                          8. al cumplirse actionSeconds (reloj servidor):
  │                             resolveGathering(ctx, cryptoRandom)
  │                          9. reserva en memoria: energía, cargas, durabilidad
  │                         10. encola resultado en lote del usuario
  │◀─ gather:result {actionId, drops, xp, energyAfter, durabilityAfter, chargesLeft}   (privado)
  │                         11. flush del lote (cada N s o al detenerse)
  │                              ─────────── commit_profession_batch ───────────▶
  │                                                            transacción:
  │                                                            - batch_id único (idempotente)
  │                                                            - revalida topes: energía ≥ 0,
  │                                                              durabilidad ≥ 0, cadencia agregada,
  │                                                              ownership de trabajadores
  │                                                            - aplica XP, energía, herramienta,
  │                                                              inventario (+ pending acotado)
  │                                                            - ledger de rares
  │                              ◀──────────── ok | rejected(reason) ────────────
  │◀─ profession:state {inventory delta, energy, xp}  (confirmado)
  │   si rejected: profession:rollback {batchId, state}
```

**Otros jugadores:** un flag cosmético opcional `activity: {kind, tx, ty}` en `publicActor` para animar. Nunca drops, XP ni inventario. Cuesta bytes en los deltas: medir antes (tope 100 CCU).

### 10.4 Crafting (StationInteraction)

`craft:start {actionId, recipeId, quantity, stationRef}`:
- servidor valida estación (dato estático del área o estructura del jugador) y adyacencia;
- nivel e inventario **leídos en la transacción**;
- `resolveProcessing` con RNG servidor.

Opciones:
- **Recomendado:** reservar insumos al inicio (transacción corta) y otorgar productos al terminar (segunda transacción idempotente). Cancelar libera insumos.
- **Alternativa:** una sola transacción al final, rechazando si los insumos cambiaron.

El crafting **no necesita posición autoritativa si la estación es "pública en la ciudad" y se acepta craftear desde un menú**. Es una decisión de producto que simplifica mucho: permitiría ejecutar crafting como RPC/Edge Function directa, sin Colyseus.

### 10.5 Dónde persistir (decisión B9)

| Opción | Veredicto |
|---|---|
| A. RPC llamada por el cliente | Sirve solo para acciones **sin posición** (crafting en menú, equipar, descartar, transferir) |
| B. Colyseus + RPC con JWT del usuario | **Descartar para recolección**: el cliente puede llamar la misma RPC e inventar resultados |
| **C. Colyseus + Edge Function con secreto servidor-a-servidor** | **Recomendada para recolección.** El secreto vive en Colyseus Cloud env y en Supabase secrets, nunca en el repo. La Edge Function (service role) ejecuta `commit_profession_batch` SECURITY DEFINER. Rotación documentada. Principio R30 actualizado explícitamente |
| D. Colyseus con rol Postgres dedicado | Superficie mayor; descartar por ahora |

### 10.6 Riesgos de escala

- Estado de acciones en memoria del proceso único: reinicio = acciones en vuelo perdidas.
  - Hay que diseñar `gather:result` como **provisional** hasta el commit.
  - El cliente debe tolerar rollback.
- Un solo proceso con 100 CCU: el coste de `nodeAt` por acción es ~2,7 µs (FACT, medido en Node): despreciable. El riesgo real es el ledger O(n) (B7) y los flushes a la Edge Function (latencia Miami ↔ Supabase).
- Con réplicas futuras hace falta afinidad por usuario o estado compartido (Redis). **No habilitar antes** (coherente con el runbook R30).

---

## 11. Persistencia propuesta (contratos, sin migraciones)

> Todas las tablas: RLS con **solo SELECT de filas propias**; ninguna política INSERT/UPDATE/DELETE para `authenticated`. Escrituras solo vía funciones SECURITY DEFINER invocadas por la Edge Function de autoridad (`TRUST_BOUNDARY.md` §7, `AGENTS.md` §21). Todas las migraciones versionadas. **Nota FACT:** el esquema base (`pokemon`, `slots`, `profiles`…) **no está versionado** en `supabase/migrations/` (solo 12 migraciones incrementales): las tablas nuevas no deben repetir ese hueco.

| Tabla | Columnas clave | Notas |
|---|---|---|
| `player_professions` | `user_id`, `profession` (enum), `xp bigint CHECK ≥ 0`, `updated_at` | PK `(user_id, profession)`. Nivel derivado, no almacenado (evita doble fuente) |
| `player_energy` | `user_id` PK, `current_milli int`, `rested_milli int`, `updated_at timestamptz`, `consumable_restored_today_milli`, `consumable_day date` | **Enteros** (milésimas). Regeneración perezosa con `now()` de la base |
| `item_definitions_version` | `catalog_version text` | Registrar con qué versión del catálogo se resolvió un lote (auditoría/rollback de balance) |
| `containers` | `id uuid`, `owner_id`, `kind` (`player_inventory`\|`storage`\|`house_storage`\|`shop_stock`), `capacity int` | Un `player_inventory` por usuario (UNIQUE `(owner_id, kind)` para ese kind) |
| `container_slots` | `container_id`, `slot_index int`, `item_id text`, `quantity int CHECK > 0`, `tool_instance_id uuid NULL` | PK `(container_id, slot_index)`. CHECK: herramienta ⇒ `quantity = 1`. Stack máximo validado en función, no en cliente |
| `tool_instances` | `id uuid`, `owner_id`, `item_id`, `durability int CHECK ≥ 0`, `max_durability int`, `repairs int`, `retired_at NULL` | La instancia vive **en un slot o en equipo**, nunca en ambos (constraint o función) |
| `player_equipment` | `user_id`, `tool_kind`, `tool_instance_id UNIQUE` | PK `(user_id, tool_kind)`. Modelo B de `INVENTORY_DESIGN.md` |
| `profession_workers` | `user_id`, `profession`, `slot` (`leader`\|`assist1`\|`assist2`), `pokemon_id` | Party pendiente de decisión; empezar con `leader`. Ownership **no se guarda aquí**: se revalida contra `slots` |
| `pending_rewards` | `user_id`, `item_id`, `quantity`, `expires_at` | **Con tope** por usuario y caducidad (P1) |
| `profession_batches` | `batch_id uuid` PK, `user_id`, `created_at`, `action_count`, `payload_hash`, `result jsonb`, `catalog_version` | Idempotencia: repetir `batch_id` devuelve `result` |
| `profession_actions` (opcional) | `action_id` PK, `batch_id`, `kind`, `node_key`, `result jsonb` | Solo si se necesita idempotencia por acción más allá del lote; si no, basta el hash del lote |
| `node_charge_state` | `user_id`, `node_key text`, `tokens numeric`, `updated_at` | **Opcional.** Persistir agotamiento solo si se decide que sobreviva reinicios. Alternativa: memoria del servidor + tope por lote en la función. Recomendación: memoria con token bucket + tope agregado en `commit_profession_batch` |
| `crafting_jobs` | `job_id` PK, `user_id`, `recipe_id`, `quantity`, `reserved jsonb`, `status` (`running`\|`done`\|`cancelled`), `completes_at`, `result jsonb` | Solo si el crafting tiene duración real con reserva (§10.4) |
| `player_structures` | `id`, `owner_id`, `item_id`, `condition`, `area_id`, `tx`, `ty` | Futuro (mesa propia, horno). No en la primera fase |
| `recipe_unlocks` | — | **No hace falta:** los desbloqueos se derivan del nivel. Crear solo si aparecen recetas por descubrimiento |

**Funciones (contratos):**
- `commit_profession_batch(batch jsonb)`: solo la Edge Function con secreto.
- `craft_start` / `craft_complete`.
- `inventory_transfer(from, to, slot, qty, action_id)`.
- `equip_tool(instance_id, action_id)`.
- `discard_slot(container, slot, qty, action_id)`: sink explícito, con confirmación en UI.
- `repair_tool(instance_id, action_id)`.

Todas idempotentes por `action_id`/`batch_id`, con `FOR UPDATE` sobre filas afectadas y orden de bloqueo fijo (contenedor → herramienta → energía → profesión) para evitar deadlocks.

---

## 12. Inventario

| Tema | Evaluación |
|---|---|
| **Coherencia con PokeSwap** | Nuevo por completo (no hay ítems hoy, FACT). Pokémon fuera del inventario es correcto: ownership de Pokémon ya tiene autoridad propia (`slots`, INV-OWN) y no debe mezclarse |
| **Modelo** | Espacios + stacks + instancias: correcto y extensible a almacén, casa y tienda |
| **Doble fuente de verdad (demo)** | `bag.slots[i].instanceId` **y** `spareTools[instanceId]` guardan la misma herramienta por separado. `setDemoCapacity` filtra las instancias al recortar y **las pierde de la mochila** sin pasarlas a pendientes. Viola "nunca se descarta nada" para herramientas. En persistencia: la instancia debe tener **una sola ubicación** (§11) |
| **Exploits** | `pending` ilimitado (P1). `removeStacks` negativo o `NaN` = no-op exitoso (B8). Ítems desconocidos aceptados con stack 100 (B8). `transferSlot(qty 0.5)` redondea a 1 (FACT). Descartar sin confirmación (demo) |
| **Autoridad** | Toda mutación debe ser intención de servidor. El cliente conserva solo una **vista** (read model) que se reconcilia con `profession:state` |
| **Concurrencia** | Dos pestañas o dos acciones simultáneas sobre el mismo contenedor: transacción con `FOR UPDATE` sobre `container_slots` del contenedor. El pure model sirve como implementación de referencia para tests de propiedad, no como ejecución concurrente |
| **Idempotencia** | `action_id` en cada operación; `transfer` todo-o-nada ya está en el modelo puro |
| **Casa / cofre / tienda** | `kind` + permisos por dueño en servidor. **Tienda:** precio fuera del contenedor (ya lo dice el diseño); comercio de ítems exige su propia atomicidad y no debe mezclarse con R32 |
| **Capacidad y stacks** | Números de demo (24 espacios; 100/60/20/50/25/1). Son reguladores económicos: decidir con balance, no con UI |
| **INVENTORY_FULL** | Regla "bloquear si no entra el mínimo garantizado + excedente a pendientes" es razonable **solo con pendientes acotados** |

---

## 13. Pokémon: qué existe hoy (FACT)

Fuentes: `src/shared/types/database.ts` (derivado de `BACKEND_INVENTORY.md`), migraciones y el tag `v0-legacy-baseline`.

| Atributo | ¿Existe? | Dónde / nota |
|---|---|---|
| Especie | Sí | `pokemon` (id, nombres ×4, `type1`, `type2`, región, generación, legendario, popular, `base_price`, `sprite_url`, `locked`, `base_aura`) |
| Tipos | Sí | `pokemon.type1/type2` como texto; nombres en español o inglés, normalizados en dos lugares |
| Ownership | Sí | `slots` con **PK `pokemon_id`**: una especie = como máximo un dueño global. `owner_id`, `is_locked`, `energy`, `aura`… |
| Nivel | Sí, **por (usuario, especie)** | `pokemon_xp(user_id, pokemon_id, xp, level, moves)`; curva L³ (Medium Fast) con autoridad `grant_pokemon_xp` (migración 008). **Implicancia:** el nivel sobrevive a perder y recuperar la especie; no pertenece al "individuo" |
| Base stats | **No en la base** | Solo en el legado (`STATS_DB`, 493 especies) → `speciesBaseStats.ts` generado. Ningún otro código productivo los usa (FACT, grep) |
| Abilities | No | — |
| IV / EV | No | — |
| Nature | No | — |
| Peso / altura | No | — |
| `PokemonSpecies` | Implícito (`pokemon`) | Sin tipo de dominio con stats |
| `PokemonInstance` | **No existe** | El "individuo" es el par `(slot de especie, dueño actual)`; `swap_history.was_shiny` es histórico, no una instancia |
| Energía | Sí, de dungeon | `slots.energy` + `energy_updated_at`: **viaja con el Pokémon** en swap/market. No reutilizar para profesiones (D3 correcta) |

**Qué necesita profesiones:** tipos (existe), nivel (existe), base stats (falta en base), ownership + lock (existe) y party (no existe).

| Decisión | Ahora | Puede esperar |
|---|---|---|
| Stats en la base (`pokemon_base_stats`, migración aditiva) | **Sí, antes de autoridad**, para que servidor y cliente lean la misma fuente y el generado quede como seed. Alternativa aceptable: el paquete compartido embebe el catálogo generado con hash verificado | — |
| Adaptador `pokemonProfessionInput(slot, pokemon, xpRow)` | Sí, en R32-0/R32 (retira el fixture `demoWorkers`) | — |
| Unificar alias de tipos | — | Sí |
| `PokemonInstance`, nature, ability, IV/EV | **No.** Cambiaría ownership, market y swap (feature mayor, `AGENTS.md` §17). La firma de `PokemonProfessionInput` ya reserva `nature`/`abilityId` | Sí |
| Party (líder + asistentes) | Empezar con **solo líder** | Asistentes |
| ¿Líder = acompañante R27? | Recomendado como default, no obligatorio | — |

---

## 14. WildLands / overlays

### 14.1 Qué debe permanecer en el motor

- **`SceneOverlay` como puerto de render** (decor replacement, ground, sprites, labels): genérico, pequeño y bien encapsulado.
- `alpha`/`scale`/`depthBias` en drawables.
- `isInteractive` en el navegador: arregla B-15 de forma general.
- `setInputLocked` y `playerSnapshot`: genéricos.
- Recetas de props exportadas (`TREE_METRICS`, `ROCK/BUSH/CRYSTAL_RECIPE`): aceptable **si** se garantiza que el arte del mundo no cambió. Hoy hay tests de footprint y ancla (árboles, rocas, plantas), **no de píxeles**. Agregar en R31-Z un hash de píxeles de cada prop contra `main`.

### 14.2 Qué pertenece a `features/professions`

- Todos los overlays, controladores, timelines, arte, trabajador y `CompositeOverlay`.
- `WorldInteractionHost` + `NodeIndex` propuestos (§5.2).

### 14.3 Qué está demasiado acoplado

| # | Acoplamiento | Severidad |
|---|---|---|
| W1 | **Lógica de acción ejecutada desde el render** (`ground()` → `tick()` → `onResult`). Si el render se pausa (pestaña oculta, `PAUSED_FRAME_MS`), la acción no termina | BLOCKER para R32 (RF2) |
| W2 | Overlays acceden a `(area as { world?: World }).world`: cast estructural a un campo privado de `WildArea` | ANTES DE PRODUCCIÓN: exponer `area.nodeWorld()` o pasar el puerto |
| W3 | `onWorldObject`/`isWorldObject` son un único callback en `GameOptions` que el host multiplexa con cadenas de `if` y `close()` cruzados | ANTES DE PRODUCCIÓN: registro de "interactables" en el host |
| W4 | Un único overlay en el motor → `CompositeOverlay` de orden fijo; si dos profesiones marcan el mismo tile, gana la primera | PUEDE ESPERAR (el catálogo no solapa anclas) |
| W5 | El trabajador es local; otros jugadores no lo ven | PUEDE ESPERAR (activity flag, §10.3) |

### 14.4 Colisiones (mesa de Alquimia)

**Problema (FACT):** `WildArea.isSolid` delega en `World.isSolid` → `isSolidDecor(decorAt)`. El overlay dibuja la mesa en un tile que el mundo considera libre, así que el jugador se para encima. Y parado encima, `worldObjectBeside` (Manhattan = 1) impide abrirla.

**Opciones:**

| Opción | Pros | Contras |
|---|---|---|
| a. Overlay declara sólidos (`SceneOverlay.isSolid?`) | Rápido | Mezcla render con física; el servidor (B5) no lo ve |
| **b. "Estructuras de área" como capa de datos del área**: `Area.structures: {kind, tx, ty, solid}` consultada por `isSolid`, navegador, `nodeAt` (exclusión) y servidor | Una sola fuente para cliente, servidor, colisión y colocación; soporta estaciones públicas, mesa propia e interiores | Toca `Area`/`WildArea` y el paquete compartido |
| c. La mesa como decor del generador (`DecorKind 'alchemyTable'`) | Colisión y render gratis | Contamina el generador procedural con contenido de gameplay; imposible para estructuras de jugador |

**Recomendación: (b).** Las estaciones públicas se definen como datos del área, con coordenadas fijas y no derivadas por espiral (P8). Las estructuras de jugador serán filas persistidas que el servidor inyecta. Implementarlo en R32-0 junto con la geometría del servidor. No antes.

### 14.5 Forage tile scan

**FACT:**
- `PATCH_RADIUS = 13`, cada 0,3 s → **729 tiles por escaneo**, no 13.
- Medido en Node: frío (tiles nuevos) **2,3 ms por escaneo**, caliente 0,014 ms.
- La caché crece ~729 entradas por cada 27 tiles recorridos, **sin límite**. 20 posiciones = 14.580 entradas.

**Evaluación:**
- Caliente es barato.
- Frío, 2,3 ms tres veces por segundo al caminar es ~15 % de un frame de 16 ms en desktop; en móvil gama media, varias veces más (INFERENCE).
- La caché sin límite es una fuga en sesiones largas de mundo infinito.

**Recomendación:**
- `NodeIndex` por chunk (32×32), igual que el horneado de chunks del motor: al hornear un chunk se calculan una vez sus nodos (anclas decor + `tallGrass` + `shore`).
- Se liberan con el mismo LRU de chunks.
- Los overlays consultan "nodos en chunks visibles" y no escanean alrededor del jugador.
- Mismo índice para las 5 profesiones. Elimina el scan, las 5 cachés y el caso especial "terreno no tiene gancho".

Severidad: ANTES DE PRODUCCIÓN.

---

## 15. Performance

| Área | Hallazgo | Medido | Severidad |
|---|---|---|---|
| `nodeAt` | 2,67 µs por tile; 12,85 nodos por cada 1.000 tiles en Pradera (seed 208) | FACT (Node) | OK |
| Overlay `decor()` | Por **cada decor visible, cada frame**, `CompositeOverlay` pregunta a hasta 5 overlays; cada uno arma un string `${area.id}:${tx}:${ty}` y consulta su Map. Con ~300 decor visibles: hasta ~1.500 strings/frame (~90k/s a 60 fps) → presión de GC en móvil | INFERENCE (por lectura) | ANTES DE PRODUCCIÓN (RF1) |
| Caches de overlay (`placements`, `views`) | Sin límite; crecen con el área explorada | FACT (lectura) | ANTES DE PRODUCCIÓN |
| Forage scan | §14.5 | FACT | ANTES DE PRODUCCIÓN |
| Sprites | `toSprite` cacheado por `WeakMap<PixelArt>`; arte memoizado por tipo | FACT | OK |
| Partículas | Pools con tope (40 minería, 26 forage) | FACT (docs + código) | OK |
| Arrays por frame | `sprites()`/`labels()` crean arrays nuevos por frame y por overlay (`flatMap`) | FACT | PUEDE ESPERAR |
| Timers | `setInterval` de pique de pesca (80 ms) siempre activo en el demo; progreso de alquimia con `setInterval` limpiado en `detach`/`onDone` | FACT | Dev-only; en producción, derivar de reloj de juego |
| Trabajador | `framesCache` de módulo (≤ 493 especies); carga async con guardas de carrera | FACT | OK |
| Múltiples sistemas | 5 overlays activos simultáneamente aunque el jugador no esté cerca de sus nodos | FACT | ANTES DE PRODUCCIÓN (host con activación por chunk) |
| Servidor, agotamiento | `consumeCharge` O(n): **3,59 ms por acción con 50k entradas** | FACT | BLOCKER R32 (B7) |
| Servidor, decenas de jugadores | Coste por acción dominado por validación + I/O de lote, no por el dominio | INFERENCE | Medir en R32 con `test:load` extendido |
| Bundle | +3,6 KB en producción | FACT | OK |
| FPS móvil real | **No medido** por ninguna estación | — | ANTES DE PRODUCCIÓN |

---

## 16. Tests

### 16.1 Resultados (candidato `c7f3a77`)

| Check | Resultado |
|---|---|
| `npm ci` | OK |
| `npx vitest run` | **83 archivos, 637 tests, todo verde** (16,3 s) |
| `npx eslint .` | 0 errores, 9 warnings previos (`AuthModal.vue`) |
| `npm run typecheck` | exit 0 (**vacío**, ver B2) |
| `npx vue-tsc --noEmit -p tsconfig.app.json` | **FALLA: 2 errores** (B1). `main`: OK |
| `npm run build` | OK |
| `npm run sim:economy -- --scenario base` | OK; totales coinciden con el handoff (77.664 / 5.540) |
| Servicio realtime | Sin cambios en R31; no se re-ejecutó |

### 16.2 Calidad

**Útiles de verdad:**
- Dominio: `gathering` (incluye preview = resolve), `energy` (reloj que retrocede, tope diario), `durability` (vida finita), `progression` (round-trip de niveles), `affinity` (sin especie óptima sobre el roster completo, legendario no domina), `catalog` (conexión faucet y sink, alineación de biomas con población).
- `nodes`: determinismo y agotamiento por jugador. `slotInventory`: overflow, todo-o-nada, tools no apilables.
- Timelines: "cada golpe una sola vez entre frames", un bug real de rAF.
- `workerPresence` y `fishingApproach`: reglas espaciales puras.
- `professionsIsolation`: guardia arquitectónica.
- `praderaLandmarks`: impide drift silencioso del generador.

**Demasiado ligados a implementación:**
- Tests de arte que cuentan píxeles o colores exactos (`*Art.test.ts`: "builds every icon at 16×16", "uses wood shapes, not recoloured stone chips"). Sirven como snapshot, pero rompen ante cualquier retoque visual legítimo.
- Recomendación: conservar los de **invariantes** (footprint y ancla del prop, estados distinguibles) y convertir el resto en una galería de snapshots con aprobación explícita.
- `demoSession.test.ts` prueba el reducer de demo: útil mientras exista el demo, descartable cuando exista la API real.

**Huecos críticos (antes de producción):**
1. **Adversariales del dominio:** cantidades negativas, `NaN`, float e ítems desconocidos en inventario y processing. Bonus fuera de rango (`stationSpeedBonus` → tiempo negativo). Frontera de respawn (8 acciones en 2 ms).
2. **Invariantes de `AGENTS.md` §20 aplicados a profesiones:** replay de lote, doble envío, concurrencia sobre contenedor, ownership perdido a mitad de lote, energía negativa y reloj del cliente ignorado. Requieren servidor y Supabase local o staging: **no pueden ser solo mocks**.
3. **Propiedad del inventario:** para toda secuencia de operaciones, la suma de ítems solo cambia por gather, craft o discard explícitos. Test de propiedad (fast-check o generador propio).
4. **Equivalencia cliente/servidor:** mismo `nodeAt` desde el bundle del servidor y desde Vite para una muestra de tiles.
5. **Bundle:** script de CI que falle si `dist/` contiene cadenas del playground o demo (hoy solo hay regex sobre fuentes).
6. **Typecheck real en CI** (B2).
7. **Lifecycle:** montar y desmontar `ProfessionWorldDemo` deja el juego sin overlay, sin input lock y sin timers.
8. **Rendimiento:** presupuesto de frame del overlay compuesto con N nodos visibles (bench en vitest o prueba manual documentada) y FPS en móvil real.

---

## 17. Deuda técnica

| # | Deuda | Origen | Severidad |
|---|---|---|---|
| T1 | Typecheck roto y CI vacío | C4 / preexistente | BLOCKER |
| T2 | Quintuplicado de controladores, overlays, tarjetas y labs | C1–C4.1 | ANTES DE PRODUCCIÓN |
| T3 | Resultado aplicado desde el render | C1 | BLOCKER R32 |
| T4 | `game.ts` 687 líneas | R24→R31 | ANTES DE PRODUCCIÓN |
| T5 | Caches sin límite y scan | C1–C4.1 | ANTES DE PRODUCCIÓN |
| T6 | Dos modelos de pesca y dos bancos de alquimia | B vs C | R31-Z |
| T7 | Código muerto en `ProfessionWorldDemo` (`otherNodeAt`) | C4 | R31-Z |
| T8 | Doble fuente de herramientas en el demo | C1 | Dev-only; no portar |
| T9 | Metadata de recetas y textos de acceso en UI | B | PUEDE ESPERAR |
| T10 | `vite-node` como dependencia transitiva | A | PUEDE ESPERAR (declarar si el simulador entra a CI) |
| T11 | Base stats solo en código | A | ANTES DE AUTORIDAD |
| T12 | Esquema base de Supabase no versionado | Preexistente | ANTES DE PRODUCCIÓN (fuera de R31, pero condiciona R32) |
| T13 | Watcher de Vite roto en la ruta virtualizada de la estación secundaria | Entorno | Documentado; no es del repo |
| T14 | Sin audio | — | PUEDE ESPERAR |
| T15 | FPS móvil sin medir | — | ANTES DE PRODUCCIÓN |

---

## 18. Balance pendiente (separado de la arquitectura)

**Arquitectura** (decidir ahora o en R32-0): quién calcula qué (§9–10), qué se persiste (§11), modelo de agotamiento (bucket vs ventana), energía entera, idempotencia, estaciones como datos del área, party solo líder, tope de pendientes.

**Balance** (todo temporal; **no fijar** hasta tener telemetría o un simulador revisado):

| Palanca | Valor actual | Estado |
|---|---|---|
| Faucet/sink | **14,0:1** en 7 días (verificado). T1 sobreofertado (troncos 12.985 en stock, hierbas 7.279, piedra 6.795, pescado 9.642 en el escenario base) | Temporal; sinks con gameplay pendientes (R1–R3 del handoff A) |
| Energía | Máx. 600 (+20 cada 10 niveles totales, tope +200), regen 60/h (barra llena en 10 h), descanso tope 600 con +50 % XP, consumibles 240/día, suelo de coste 60 % | Temporal. B-06 (decimales), B-07 (descanso instantáneo) |
| XP / niveles | 1–60, `40·(L−1)^2,35`; T1 30–60 XP, T2 110–150, T3 200; sobrenivel ≥ 25 → ½ | Temporal; falta escenario de 90 días |
| Eficiencia veterana | −18 % tiempo, −15 % energía, +12 % yield, ×1,5 raros | Temporal |
| Yields | Extra-unit tope 60 %, crítico ×2, raros ×≤3 | Temporal |
| Respawns / cargas | 90–600 s, 3–6 cargas por nodo | Temporal + bug de ventana (B7) |
| Densidad de nodos | `ANCHOR_DENSITY` (rock 0,35 … tallGrass 0,02) | Temporal; T2/T3 lejos del spawn (B-14) |
| Stacks / capacidad | 100/60/20/50/25/1; 24 espacios | Demo |
| Herramientas | Durabilidad 60–150, −8 % máx. por reparación, retiro < 50 % | Temporal + P3 |
| Reparación | Materiales proporcionales, mínimo 1 | Temporal |
| Recetas / processing | 34 recetas; processing sin energía (D7); tope 30 %; estación pública ×1,5 | Temporal; D7 es decisión de producto |
| Rare drops | Hierba Revivir 0,6–3 %, Bonguri 0,3–2 %, Perla 0,1 %, Escama 0,4 % | Temporal |
| Afinidad | `traitScale`/`traitCap` por rasgo; bonus percibidos chicos (B-10) | Temporal |
| Pesca | Ventana 1,1 s (perfect 350 ms, late 300 ms); calidades sin efecto | Temporal + P5 (latencia) |

---

## 19. Estrategia recomendada de integración Git

**Principios:** `Create a merge commit` (nunca squash ni rebase de historia publicada). Una responsabilidad por PR. No mezclar consolidación de cliente con autoridad de servidor.

1. **No mergear las 7 ramas por separado.** La cadena es lineal: integrar desde la punta preserva toda la historia.
2. **Crear `integration/r31` desde `c7f3a77`** (fast-forward, sin reescribir). Las ramas R31 remotas quedan congeladas como registro.
3. **R31-Z (consolidación, sobre `integration/r31`), PRs chicos hacia `integration/r31`:**
   1. `fix(professions): restore strict typecheck` (B1). Una línea por error.
   2. `docs(economy): correct R31-C4/C4.1 verification claims` (B3) + enlace a esta auditoría.
   3. `chore(professions): remove dead world-demo panel path` (E1) y modelos superseded (E2/E3), si se aprueba.
   4. `refactor(professions): extract world interaction host and gathering adapters` (§5.2). **Con test de equivalencia visual** (misma técnica de hashes de `docs/wildlands/HANDOFF.md` §2).
   5. `perf(professions): chunk node index` (RF1 + §14.5).
4. **PR aparte hacia `main`, independiente de R31:** `ci: make typecheck check the app` (B2). Entra primero para que el PR de R31 quede protegido.
5. **PR `integration/r31` → `main`** (merge commit), **solo si se decide que el código dev-only vive en `main`**.
   - **Recomendación: sí**, tras R31-Z.
   - Motivo: los hooks tocan `game.ts`, `renderer.ts` y `navigator.ts`, que la operación de R30 puede modificar. Una rama larga de ~22k líneas acumula conflictos.
   - Condiciones: CI verde con typecheck real, check de `dist/` y revisión de la estación principal.
   - **Alternativa** si no se quiere ese volumen en `main`: integrar solo `domain/` + `inventory/` + hooks del motor, y dejar playground y arte en `integration/r31`. Es más trabajo y menos valor: no recomendada.
6. **`migration`:** decidir formalmente si se retira (está detrás de `main`) o se resincroniza. No bloquear R31 con eso.
7. **R32-0 y R32** nacen desde `main` después del merge, en ramas propias.

---

## 20. Roadmap posterior

| Fase | Responsabilidad única | Salida | Depende de |
|---|---|---|---|
| **R31-Z** | Consolidación cliente de R31 | B1, B3, E1–E3, abstracción §5.2, `NodeIndex`, docs; merge a `main` como dev-only | Aprobación de esta auditoría |
| **CI-TC** (paralelo) | Typecheck real + check de bundle en CI | B2, D1 | — |
| **R30-V** (paralelo, estación principal) | Verificar spawn wild servidor/cliente en producción; beta de presencia (runbook R30) | B6 confirmado o corregido | Acceso a producción |
| **R32-0** | Fundaciones de autoridad, **sin economía persistente** | Paquete `game-rules` compartido; colisión en `acceptMove`; estructuras de área (§14.4); contrato de intents con `actionId`; agotamiento token-bucket; validación de entradas; RNG servidor; resultado desacoplado del render (RF2); decisión B9 aprobada | R31-Z, R30-V |
| **R32-D** | Desglose `AGENTS.md` §17 de la primera profesión persistente | Documento aprobado: tablas, funciones, invariantes, fallos, rollback | R32-0, SEC backlog revisado |
| **R32** | **Una** profesión de recolección persistente en Pradera (recomendado: Minería, la más validada visualmente y sin timing de red) + inventario de solo lectura | Migración aditiva versionada, Edge Function de lote, tests de invariantes contra Supabase local o staging | R32-D |
| **R33** | Crafting persistente (StationInteraction) con estaciones públicas | Reserva/commit de insumos | R32 |
| **R33-B** | Balance con telemetría real + simulador de 90 días | Números no-demo | R32 en beta |
| Después | Resto de profesiones, almacenamiento, party con asistentes, mercado de ítems (feature separada), housing | — | — |

**Dependencia transversal:** el backlog de seguridad (`docs/SECURITY_AND_VERIFICATION_ROADMAP.md`, sin commitear en la estación principal) marca como P0 la recompensa de dungeon con cantidades del cliente. Agregar una segunda economía persistente **sin cerrar ese P0 ni verificar RLS de `profiles`** multiplica la superficie. Recomendación: SEC-VERIFY-01 y DGN-DESIGN-01 antes de R32.

---

## 21. Propuesta de división del trabajo entre estaciones

### 21.1 Reglas de colaboración

1. **Una rama por tarea, nacida del último `integration/r31` o `main`**. Nunca ramas hijas encadenadas de más de un nivel: la cadena de 7 funcionó por disciplina, pero no escala con dos estaciones.
2. **Propiedad de carpetas** (quién puede abrir PR que las modifique sin coordinar):

| Carpeta / archivo | Dueña | La otra estación |
|---|---|---|
| `services/realtime/**`, `supabase/**`, `.github/**`, `packages/game-rules/**` (futuro) | **Principal** | Solo lectura; propone por issue o doc |
| `src/features/wildlands/engine/{game,renderer,navigator,area,world}.ts`, `WildlandsView.vue`, `multiplayer/**` | **Principal** | Cambios mínimos solo con PR revisado por la principal |
| `src/features/professions/{art,components,mining,fishing,logging,forage,alchemy,overworld,ui,demo}/**` | **Secundaria** | Revisión |
| `src/features/professions/domain/**`, `inventory/**` | **Compartida con contrato congelado.** Cambios de firma o semántica: PR revisado por la principal. Datos de catálogo y balance: secundaria | — |
| `docs/economy/**` | Secundaria (handoffs visuales) / principal (auditorías, desgloses de autoridad) | — |
| `AGENTS.md`, `docs/INVARIANTS.md`, `docs/TRUST_BOUNDARY.md` | **Principal** | Propone |

3. **Contrato congelado entre ambas:** interfaz `WorldInteractionHost`/adapters (§5.2) y el `SceneOverlay`. La principal no cambia el puerto sin aviso; la secundaria no agrega hooks al motor sin PR.
4. **Verificación declarada con comandos exactos.** Cada handoff lista las salidas de `vitest run`, `eslint .`, `vue-tsc --noEmit -p tsconfig.app.json` y `npm run build`, más el check de `dist/`. Evita repetir B3.
5. **Sin trabajo sobre la misma fase en paralelo.** Sincronizar `main` → ramas activas al inicio de cada tarea (merge, no rebase de ramas publicadas).

### 21.2 Reparto inmediato (tras aprobar esta auditoría)

| Estación principal | Estación secundaria |
|---|---|
| CI-TC: typecheck real + check de bundle (PR a `main`) | R31-Z.1: fix de los 2 errores de typecheck |
| R30-V: verificar spawn wild en producción; beta de presencia | R31-Z.2: corregir handoffs C4/C4.1 |
| Revisión y merge de cada PR de R31-Z a `integration/r31` | R31-Z.3: retirar código muerto (E1–E3) según decisión |
| Diseño de R32-0: paquete `game-rules`, colisión en servidor, estructuras de área, contrato de intents, decisión B9 (documento para aprobar) | R31-Z.4: extraer `WorldInteractionHost` + adapters de gathering, con equivalencia visual |
| Revisión del backlog de seguridad (SEC-VERIFY-01, DGN-DESIGN-01) | R31-Z.5: `NodeIndex` por chunk y medición de FPS en móvil real |
| Merge final `integration/r31` → `main` | Balance: escenario de 90 días y propuesta de sinks (sin aplicar números) |

**Después de R32-0**, la principal implementa servidor, migraciones y Edge Function de R32. La secundaria adapta las tarjetas y overlays de Minería para **presentar** resultados del servidor (estado provisional, confirmado y rollback) sin tocar la autoridad.

---

## Apéndice A — Comandos y mediciones de esta auditoría

```bash
git fetch --all --prune
git merge-base --is-ancestor <padre> <hija>          # 7 pares, todos OK
git rev-list --count / --merges <padre>..<hija>
git log --format=%H origin/main..c7f3a77 | … git patch-id --stable   # sin duplicados
git worktree add -b audit/r31-integration ../pokeswap-r31-audit origin/feat/r31c4-1-alchemy-gathering-polish
npm ci
npx vitest run                                        # 83 archivos, 637 tests
npx eslint .                                          # 0 errores, 9 warnings previos
npm run typecheck                                     # exit 0 (vacío)
npx vue-tsc --noEmit -p tsconfig.app.json             # exit 2 (2 errores); main: exit 0
npm run build                                         # OK
npx vite build (con .env de la principal, en ambos árboles)   # +3.648 B en WildlandsView
grep -rao <cadenas dev> dist                          # 0 coincidencias
npm run sim:economy -- --scenario base                # 77.664 / 5.540
```

Pruebas puntuales (script temporal con `vite-node` sobre los módulos reales, **borrado al terminar**, sin cambios en el árbol):

| Prueba | Resultado |
|---|---|
| `removeStacks(stone, -5)` / `NaN` | Devuelve contenedor sin cambios (no `null`) |
| `addStacks('__hack__', 9999)` | Acepta ítem inexistente, stacks de 100 |
| `transferSlot(qty 0.5)` | Mueve 1 |
| Cargas `iron_vein` (4): 1 en t=0, 3 en R−1 ms, 4 en R+1 ms | 8 acciones |
| `resolveProcessing(stationSpeedBonus: 3)` | `seconds: -8` |
| `berry_bush` con hoz equipada | `durabilityLoss: 1`, `bareHands: false` |
| Reparar tras 1 punto de desgaste | Máx. 60 → 55, cuesta 1 Piedra |
| Energía 33,33 + 33,33 + 33,34 | 0 (redondeo a 2 decimales, sin error visible aquí) |
| `regenerateEnergy(now = NaN)` | Lanza `RangeError` (falla cerrado) |
| `nodeAt` | 2,67 µs/tile; 12,85 nodos por 1.000 tiles |
| Scan r=13 | 729 tiles; frío 2,33 ms; caliente 0,014 ms; 14.580 entradas tras 20 posiciones |
| `consumeCharge` con 50k entradas | 3,59 ms/acción |
