# PokeSwap / WildLands — Handoff operativo de sesión (post R31-Z, gate pre-R32 en curso)

> Fecha: 2026-09-16. Escrito por la estación principal.
> Uso: primer documento que lee una sesión nueva de Claude en la estación principal.
> Estado: versionado en `integration/r31`. **`PRE-R32 HUMAN PROFESSION GATE: PASSED`** (2026-09-18, tras R31-H1; ver [`PRE_R32_HUMAN_GATE.md`](PRE_R32_HUMAN_GATE.md) §1.1).
> **Para R32 en adelante, el documento contractual es [`../wildlands/R32_INTEGRATION_AUDIT.md`](../wildlands/R32_INTEGRATION_AUDIT.md):** estado real de la rama, clasificación A/B/C/D del prototipo de Dungeon, T-S3 congelado, I-1 cerrado, brechas de catálogo y modelo, authority split, definición de R32 y roadmap R33+.

---

## 1. Estado actual del repo

### 1.1 Checkouts en esta PC

| Checkout | Ruta | Rama | HEAD | Árbol |
|---|---|---|---|---|
| Worktree de integración (donde se trabaja R31) | `C:\Users\Rodri\Proyectos\pokeswap-r31-audit` | `integration/r31` | commit `docs(economy): add R31 session handoff` (hijo directo de `25bcc1f`) | Limpio; solo el `.env.local` placeholder, ignorado por `.gitignore:4:*.local` |
| Checkout principal | `C:\Users\Rodri\Proyectos\pokeswap` | `feat/wildlands-r30-cloud-deploy` | `bf44f41` | Solo archivos sin trackear **previos y ajenos a R31**: `.claude/`, dos archivos con nombre roto (`C\357\200\272…launch.json`, `C\357\200\272champions-scoutcalibration-data.json`), `agents/CLAUDE_SECURITY_AND_VERIFICATION_BACKLOG.md`, `docs/SECURITY_AND_VERIFICATION_ROADMAP.md`, `supabase/.temp/`. No tocarlos sin preguntar |

### 1.2 Remoto (`origin`, verificado con `git fetch` el 2026-09-16)

| Ref | Hash | Nota |
|---|---|---|
| `origin/main` | `7e474c6` | Merge PR #21 (`feat/wildlands-r30-cloud-deploy`). R30 en producción. **Sin nada de R31** |
| `origin/integration/r31` | commit de este handoff, sobre `25bcc1f53e0b60bdf30d19a287bdab0bc1589456` | Igual al local. Merge-base con `origin/main` = `7e474c6` |
| `main` **local** | `b50064e` | **Desactualizado a propósito**: 18 commits detrás de `origin/main @ 7e474c6`. No se actualiza por ahora. Cualquier trabajo futuro desde main debe partir de `origin/main` |

### 1.3 Qué está mergeado y qué no

- **En `main`:** R24–R30 (incluye el multiplayer R30 y sus arreglos operativos, PRs #16, #19, #20, #21).
- **En `integration/r31`, NO en `main`:** todo R31 (A → C4.1), QA, auditoría, hardening, baseline, Bloque A, T-S2, R31-Z.1.
- **Nada de R31 se mergea a `main`** hasta pasar el gate humano y recibir la orden explícita.

### 1.4 Ramas relevantes que siguen existiendo en `origin`

| Rama | Hash | Estado |
|---|---|---|
| `feat/r31-professions-foundation` (R31-A) | `bd33e3e` | Contenida en `integration/r31` |
| `feat/r31b-professions-ux` (R31-B) | `721fd2a` | Contenida |
| `feat/r31c-mining-visual-design` (C1) | `93edd32` | Contenida |
| `feat/r31c2-fishing-visual-design` (C2) | `2e29ddf` | Contenida |
| `feat/r31c3-logging-visual-design` (C3) | `9b587e6` | Contenida |
| `feat/r31c4-alchemy-visual-design` (C4) | `8d665e2` | Contenida |
| `feat/r31c4-1-alchemy-gathering-polish` (C4.1) | `c7f3a77` | Contenida; es la base desde la que se creó `integration/r31` |
| `qa/r31-professions-regression` | `20cbca0` | Mergeada (`35ee8a4`) |
| `test/r31z-overlay-trace-baseline` (T-S1) | `4d77396` | Mergeada (`a218dc7`) |
| `test/r31z-overlay-trace-fidelity` (T-S1.1) | `e7cba23` | Mergeada (`f2c615e`) |
| `qa/r31z-post-refactor` (T-S2) | `7aa153c` | Mergeada (`e89f150`) |
| `feat/wildlands-r30-cloud-deploy` | `bf44f41` | Mergeada a `main` (PR #21) |

Las ramas R31 apiladas y las de QA/test **pueden borrarse más adelante**, pero no se borran sin orden del usuario.

---

## 2. R30 — multiplayer existente

**Qué hay en producción (pokeswap.lol, Cloudflare Pages):**
- Presencia multijugador **efímera** en Ciudad Corazón y Pradera Brisa.
- Servicio Node/Colyseus separado en Colyseus Cloud (`services/realtime`, `PresenceRoom`). Instancia única en Miami, tope de 100 conexiones.
- El servicio verifica el JWT con Supabase (clave publishable) y guarda actores solo en memoria. Sin persistencia ni escrituras de cliente a Supabase.
- El cliente manda **intención de dirección**. El servidor deriva posición, área, velocidad y secuencia. Los invitados son espectadores.
- `acceptMove` **no valida colisión con el terreno**.
- El cliente predice el cambio de área (`pendingPresenceArea`) y acepta el `self` del snapshot del servidor (snap).
- `WildlandsGame` está aislado de Colyseus/Supabase mediante un puerto de actores remotos.
- Detalle: `docs/wildlands/R30_PRODUCTION_HANDOFF.md`, `docs/wildlands/R30_MULTIPLAYER_PLAN.md`.

### 2.1 Bugs heredados (separados de R31, NO tocados)

| Bug | Diagnóstico actual | Rama prevista (sin crear) | Estado |
|---|---|---|---|
| **Spawn autoritativo** | Al entrar a Pradera, el cliente llega a **(-5,-69)** (junto al portal). El snapshot del servidor lo reubica en **(8,41)**, un tile sólido de bosque a 124 tiles del portal: el servidor usa como spawn wild la llegada al pueblo por la puerta oeste (`hearthome.ts` `arrival {8,41}`). Al volver al pueblo, el servidor manda a **(31,20)** (plaza) e ignora la puerta. Como no hay colisión server, nunca se corrige | `fix/wildlands-authoritative-spawn` desde `origin/main` (prevista, **no creada**) | **PENDIENTE DE VERIFICAR EN PRODUCCIÓN.** Reproducido solo en el motor local con respuestas del servidor inyectadas; no se considera bug confirmado hasta verificarlo en producción (2 min: entrar a Pradera y ver dónde aparece) |
| **F-2 prop tap/picking** | `Renderer.pick()` solo tiene hitboxes de actores. Tocar ≥20 px sobre la base de un árbol, roca o arbusto proyecta al suelo y devuelve el tile **detrás** (30 px → dos tiles). El navegador camina hasta ese tile y no hay interacción. Afecta a todo prop alto, en producción. Los edificios ya lo resuelven con `doorForTap` | `fix/wildlands-prop-tap-picking` desde `origin/main` (prevista, **no creada**) | Reproducido en el motor real (navegador). No es el A* |

**Fix propuesto para el spawn:**
- **Corto plazo:** constantes compartidas en `services/realtime/src/protocol/messages.js`, con spawn wild (-5,-69) y llegada por puerta (8,41).
- Un test de cliente que falle si `WildArea('pradera').arrival()` o la llegada de la puerta dejan de coincidir.
- **R32-0:** llegadas por área dentro del paquete de reglas compartido y validación de colisión en el servidor.

**Fix propuesto para F-2:**
- Tests primero: extraer `hitTest(hits, sx, sy)` puro y agregar un test de caracterización que falle hoy.
- Registrar hitboxes de decor con sprite en `Renderer.collect`, con tile = ancla. Los actores siguen ganando por profundidad.
- Tamaño: ~40 líneas en `renderer.ts` + tests. No toca `navigator.ts`.

**Reglas para los dos:** PR independiente cada uno, **sin auto-merge**, y verificación multiplayer. Referencia: `R31Z_CONSOLIDATION_PLAN.md` §3, §4, §12.4.

---

## 3. R31 — estado final por etapa

| Etapa | Qué dejó (lo que sobrevive) |
|---|---|
| **R31-A** | Dominio puro en `src/features/professions/domain/`: `previewGathering`/`resolveGathering`, `resolveProcessing`, energía, durabilidad, XP, inventario por slots, catálogo, workers Pokémon. Simulador económico (`npm run sim:economy`) |
| **R31-B** | UX: action cards, HUD, inventario, workers, feedback. Playground dev-only `/dev/profesiones` (gate `import.meta.env.DEV`). Test de aislamiento `professionsIsolation.test.ts` |
| **R31-C1** | Minería: overlay y arte (nodos, pico, prospección, reward pops, worker) |
| **R31-C2** | Pesca: orilla, lanzamiento, espera, pique, recogida con ventana, caña |
| **R31-C3** | Tala: árboles con cargas, caída en la última carga, tocón, respawn, hacha |
| **R31-C4** | Alquimia: estación (mesa), recetas, lotes, proceso con timeline, "Ahorró N" |
| **R31-C4.1** | Recolección de ingredientes de alquimia (forage: `berry_bush`, `herb_patch` sobre pasto alto, hoz opcional) |
| **QA (R31-QA)** | Arnés de estrés + informe. Reforzado por la principal porque varios tests eran vacuos |
| **Auditoría de integración** | `R31_INTEGRATION_AUDIT.md`: blockers, trust boundary, propuestas de multiplayer/persistencia, roadmap. Handoffs corregidos (typecheck no era real; el scan de hierbas recorre 729 tiles, no 13) |
| **R31-Z** | `npm run typecheck` real (`vue-tsc --noEmit -p tsconfig.app.json`) + 2 fixes TS6133. Hardening fail-closed del dominio (49 hostile inputs). `.gitattributes` `*.snap text eol=lf`. Diagnóstico de spawn y F-2 |
| **T-S1** (secundaria) | Traza de escena de las overlays como snapshot (`overlayTrace.test.ts`, `testing/overlayTrace.ts`) |
| **T-S1.1** (secundaria) | Fidelidad del arnés: hooks en cada frame real, sin nombres internos. Congelado como baseline (`f2c615e`) |
| **Bloque A** (principal) | Refactor productivo en 8 pasos con el md5 intacto en cada paso. Módulos compartidos en `overworld/` (§4). LOC de overlays/controllers 2.583 → 1.737 (+615 compartidos, neto −231). Build de producción **idéntico byte a byte** (1.061 archivos, `f2c615e` vs `15075df`). Simulador idéntico |
| **T-S2** (secundaria) | QA post-refactor: **APTO PARA R31-Z.1**, sin P0/P1/P2 (§6) |
| **R31-Z.1** (principal) | `components/playground/spawnBeside.ts` (puro, 6 tests, equivalente en 4.553 tiles) usado por los 4 FieldLab. Camino muerto retirado de `ProfessionWorldDemo.vue` (se conserva `emit('overlay')`). `OverlayPlayer` **no** se movió |

**Números al cierre (`25bcc1f`):**
- 89 archivos / 733 tests.
- typecheck 0 errores.
- lint 0 errores (9 warnings previos de `AuthModal.vue`).
- build OK.
- `dist/` sin código dev.

---

## 4. Arquitectura final de profesiones

Raíz: `src/features/professions/`.

| Pieza | Ubicación | Qué es | Quién la usa |
|---|---|---|---|
| `rewardPops` | `overworld/rewardPops.ts` | Clase `RewardPops`: `push`, `pushGathered`, `pushXp`, `prune`, `clear`, `iconSprites`, `labels` | Las 5 overlays |
| `workerSummon` | `overworld/workerSummon.ts` | `summonWorkerOnce(companion, action, player, target, isFree)`, `openGround(area, taken)`. Usa el `workerSpot` de cada overlay | Las 5 overlays |
| `gatheringOverlayCore` | `overworld/gatheringOverlayCore.ts` | Clase abstracta `GatheringOverlayCore<Start, Action, View, Visible>`. Comparte targetAt, start/cancel/busy, viewFor, anillos de suelo, markers, sprite de herramienta, worker, flash y labels. Cada subclase implementa ownsNode, buildView, rewardLift, ring, stepEffects, resetEffects, actionFrame y celebrationEffects | Minería, Tala, Forage |
| `gatheringController` | `overworld/gatheringController.ts` | `gatheringController({session, game, profession, overlay, selection, phase, outcome, busyPhase, timeline})` → attach/detach/isTarget/inspect/close/act. `ValueBox` estructural, **sin Vue** | Minería, Tala, Forage |
| **Minería** | `mining/miningOverlay.ts`, `mining/useMiningController.ts` | Subclase del core + fachada Vue (`isNode`, `mine`). `miningOverlay.ts` **sigue exportando `OverlayPlayer`** | — |
| **Tala** | `logging/loggingOverlay.ts`, `logging/useLoggingController.ts` | Subclase del core (`fellStarted` vía override de `activate`) + fachada (`isTree`, `chop`, timeline de la última carga) | — |
| **Forage** | `forage/forageOverlay.ts`, `forage/useForageController.ts` | Subclase del core. El scan de `herb_patch` quedó **igual** (en sprites). Fachada: `isPlant`, `gather`, `forageStyle` | — |
| **Pesca** | `fishing/…` | Overlay y controller **propios**. Solo comparte `rewardPops` y `workerSummon` | — |
| **Alquimia** | `alchemy/alchemyOverlay.ts`, `brewTimeline.ts`, `useAlchemyController.ts` | **Processing**, no Gathering. Solo comparte `rewardPops` y `workerSummon` | — |

Las APIs públicas de las fachadas no cambiaron.

### 4.1 Por qué Pesca queda fuera del core de gathering

- No apunta a un **nodo** en un tile: apunta a **orilla/agua** (`fishingSpots`).
- Su acción no es "N golpes → resultado". Es una máquina de estados temporal: lanzar → espera → pique → recogida dentro o fuera de la ventana, donde recoger temprano es un resultado válido distinto.
- Meterla en `GatheringOverlayCore` exigía abrir hooks específicos de pesca en el core. Eso **deforma la abstracción**, y la decisión §10.6 la aceptaba solo si no la deformaba.
- Se eligió la opción B: compartir solo pops y worker.

### 4.2 Por qué Alquimia sigue como Processing

- Consume ingredientes y produce por **receta** (lotes 1/3/máx y ahorro "Ahorró N"). Usa `resolveProcessing`, no `resolveGathering`.
- El objetivo es una **estación** colocada (`stationPlacement.ts`), no un nodo del mundo con cargas y respawn.
- Tiene timeline propio (`brewTimeline.ts`) y hook `stopProgress` para cancelar a mitad del proceso.

### 4.3 Helper de ciclo de vida

No se extrajo un helper común para Pesca y Alquimia:
- el `stopProgress` de Alquimia no encaja;
- el `watch` de Vue está restringido por las reglas de `professionsIsolation.test.ts` (Vue solo en composables listados).

---

## 5. Baseline congelado

- **Regla:** `PRE-REFACTOR BASELINE FROZEN` desde `f2c615e`.
- **Snapshot:** `src/features/professions/__snapshots__/overlayTrace.test.ts.snap`, md5 **`334b1e04eb1e40f528f313573d4ac618`**.
- **Un refactor interno NUNCA justifica `vitest -u`.** Si el snapshot cambia: detenerse, explicar y esperar decisión. Solo un cambio visual **aprobado explícitamente** puede regenerarlo, en un commit propio.
- Line endings: `.gitattributes` `*.snap text eol=lf` (sin eso Windows ensucia el snapshot).

**Tests relevantes:**

| Test | Qué garantiza |
|---|---|
| `src/features/professions/overlayTrace.test.ts` (15 tests, 11 escenarios guionados) | Salida observable por frame de las 5 overlays: anillos, sprites (pos, altura, alfa, escala, hash de arte), labels, operaciones de suelo y estado final de sesión |
| `src/features/professions/professionsStress.test.ts` (19) | Estrés: pesca en orilla, overflow a pendientes determinista, cantidad y carga exactas, deltas de XP por profesión, timers reales restaurados |
| `src/features/professions/domain/hostileInputs.test.ts` (49) | Fail-closed ante NaN, Infinity, negativos y no enteros en inventario, gathering, processing, energía y durabilidad |
| `src/features/professions/professionsIsolation.test.ts` | Allow-list de imports del motor por carpeta; Vue solo en composables listados |
| `overworld/rewardPops.test.ts`, `overworld/workerSummon.test.ts`, `components/playground/spawnBeside.test.ts` | Módulos compartidos y helper dev |

**Verificación estándar** (en el worktree):

```bash
npx vitest run src/features/professions/overlayTrace.test.ts src/features/professions/professionsStress.test.ts src/features/professions/domain/hostileInputs.test.ts
md5sum src/features/professions/__snapshots__/overlayTrace.test.ts.snap
npx vitest run && npm run typecheck && npx eslint . && npm run build
npm run sim:economy -- --scenario base   # 77664 generado / 5540 destruido
```

Otros escenarios del simulador:
- `month-100`: 293536 / 19933.
- `veterans`: 61097 / 1143.

---

## 6. QA

**T-S2 confirmó** (base `15075df`, informe `R31Z_POST_REFACTOR_QA.md`):
- 88/727 tests verdes y typecheck 0.
- Overlay trace sin `-u` y md5 idéntico.
- Stress 19 y hostile 49 verdes, también en orden aleatorio (dos semillas).
- Dev server con caché de Vite limpia sirviendo el core nuevo, verificado por HTTP.
- **Minería validada manualmente de punta a punta:** selección, card, minar, doble toque, worker, recompensa, y energía/durabilidad exactas en 6 acciones.
- Sin P0, P1 ni P2 atribuibles al refactor. Veredicto: **APTO PARA R31-Z.1**.

**Sin firma manual:**
- **Tala, Forage (incl. `herb_patch`), Pesca y Alquimia.** La estación secundaria no pudo interactuar establemente con esos nodos en su entorno.
- Están cubiertas objetivamente por el baseline, pero falta el ojo humano: es el gate §7.

---

## 7. Gate humano pre-R32 — ESTADO ACTUAL

**Todavía NO se declaró `PRE-R32 HUMAN PROFESSION GATE: PASSED`.** Falta la prueba manual del usuario.

Entorno: `http://localhost:5188/dev/profesiones`, un laboratorio por profesión. Probar primero en escritorio y después a **375 px** (DevTools, modo responsive).

| Profesión | Qué probar exactamente |
|---|---|
| **Tala** | `common_tree`: seleccionar y abrir la card. Talar **carga por carga** hasta agotarlo, con la última carga mostrando **caída del árbol y tocón**. Esperar el **respawn**. Ver el **worker** aparecer junto al jugador y desaparecer al terminar. Revisar desgaste del **hacha** y **reparación** |
| **Forage** | `berry_bush` **a mano** y **con hoz**. **`herb_patch`**: aparece sobre pasto alto, se selecciona, se recolecta, cambia de estado, respawn. Worker. **Desgaste de la hoz** (F-3: gasta durabilidad aunque sea opcional, conocido) |
| **Pesca** | En la **orilla**: lanzar, espera, pique, recogida **dentro de la ventana** y **temprana** (resultado distinto y válido). Agotamiento del spot y respawn. Worker. Reward pop. Desgaste de la **caña** |
| **Alquimia** | En la **mesa**: elegir receta. Cantidad **1, 3 y máximo**. Ingredientes **suficientes e insuficientes** (debe bloquear). Proceso completo. Reward y **"Ahorró N"**. Worker junto a la estación. **Cancelar durante el proceso** |
| **375 px** | Lo anterior en móvil: cards legibles, sin scroll horizontal, un solo canvas, toques que seleccionan lo esperado (salvo F-2 conocido) |

**Criterio por profesión:**
- `VISUALMENTE EQUIVALENTE` o `DIFERENCIA DETECTADA`.
- Ante dudas, comparar con el pre-refactor `f2c615e` levantado en otro puerto (opcional, solo si el usuario lo pide).

**Protocolo mientras el usuario prueba:**
- No cambiar código ni corregir lo que aparezca.
- Registrar las observaciones **textuales** del usuario.
- Clasificar cada una como **conocida/preexistente** (§8.3) o **regresión nueva**.
- Inspeccionar consola o estado solo si el usuario lo pide.

**Cierre del gate:**
1. Documentar el resultado por profesión y el de móvil en `R31Z_CONSOLIDATION_PLAN.md` §12.3 (o en una sección nueva "Resultado del gate").
2. Declarar `PRE-R32 HUMAN PROFESSION GATE: PASSED` o `FAILED`. Si es FAILED, documentar la diferencia **antes** de cualquier cambio de código.
3. Commit + push solo en `integration/r31`.
4. Limpieza del entorno (§8.2).

### 7.1 Registro del gate y decisiones de producto (2026-09-16)

- **Registro de hallazgos:** [`PRE_R32_HUMAN_GATE.md`](PRE_R32_HUMAN_GATE.md). Clasifica cada observación (REGRESIÓN, BUG PREEXISTENTE, UX / POLISH, SISTEMA INCOMPLETO, DECISIÓN DE DISEÑO, DEUDA TÉCNICA). Hasta ahora hay **0 regresiones**.
- **Decisiones de producto:** [`PRE_R32_DESIGN_DECISIONS.md`](PRE_R32_DESIGN_DECISIONS.md), separadas en APPROVED y OPEN. Nada está implementado.
- **Party activo de hasta 6 Pokémon**, compartido por exploración, combate, dungeon y profesiones: `worker ∈ activeParty`, 1 worker por acción. R32-0 debe contemplarlo.
- **Dungeon legacy descartada** como base (`src/features/dungeon/` queda LEGACY: no se borra, no se reutiliza).
- **WILDLANDS DUNGEON / PVE — CLEAN-SLATE DESIGN:** reservada a la **estación secundaria**. No iniciada, sin rama; el usuario prepara el brief. La principal audita la integración.
- **Economía sin balancear** hasta definir el loop PvE/Dungeon.
- **Resultado del gate (2026-09-18): `PASSED`.** Las cinco pasadas (Tala, Forage, Pesca, Alquimia y 375 px) quedaron **visualmente equivalentes**, y **0 regresiones** atribuibles al refactor. Tala pasó tras **R31-H1**: la reaparición del árbol entre la caída y el tocón era deuda visual **preexistente**, corregida de forma aislada en `logging/loggingOverlay.ts` con test de invariante y snapshot local nuevo (md5 `a62f2ebb8372073d1d669d4217a84f3e`), integrada por el merge `150ac01`.
- **UX nueva aprobada (`A-16`):** la recolección debe verse continua, sin cartel que la interrumpa; Alquimia conserva el suyo. Sin implementar.

---

## 8. Entorno local actual

### 8.1 Dev server

| Dato | Valor |
|---|---|
| URL | `http://localhost:5188/dev/profesiones` |
| Puerto | `5188` (`--strictPort`) |
| Origen del código | Worktree `pokeswap-r31-audit`, `integration/r31` @ `25bcc1f`, caché `node_modules/.vite` limpiada antes de arrancar |
| Cómo se lanzó | Entrada temporal `r31-gate-dev` en `C:\Users\Rodri\Proyectos\pokeswap\.claude\launch.json` (`npm --prefix C:/Users/Rodri/Proyectos/pokeswap-r31-audit run dev -- --port 5188 --strictPort`) vía `preview_start`. Una sesión nueva **no hereda** el proceso: si se cayó, relanzar con esa entrada |
| Placeholders | `.env.local` en el worktree con `VITE_SUPABASE_URL=http://127.0.0.1:1` y una anon key falsa. Ignorado por Git. **No** es un `.env.local` real del usuario. Nunca poner secretos reales |

### 8.2 Cambios temporales no versionados y limpieza al terminar el gate

1. Parar el dev server de 5188 (`preview_stop`, o matar el proceso vite si la sesión es nueva).
2. Quitar la entrada `r31-gate-dev` de `C:\Users\Rodri\Proyectos\pokeswap\.claude\launch.json`. Deben quedar solo `pokeswap-dev` y `champions-scout`.
3. Borrar `C:\Users\Rodri\Proyectos\pokeswap-r31-audit\.env.local` (placeholder creado por la principal).
4. `git status --short` en el worktree → limpio.

### 8.3 Comportamiento esperado / conocido (NO son regresiones)

- **Errores de red de Supabase y WebSocket en consola:** son esperados con los placeholders (conexión rechazada a `127.0.0.1:1`, `ERR_UNSAFE_PORT`). En los labs no hay realtime.
- **F-1:** la mesa de alquimia **no es sólida**; se puede caminar sobre ella. Preexistente. Fix conceptual: `ObstacleProvider` (§9).
- **F-2:** tocar la parte alta de un árbol, roca o arbusto selecciona el tile de **atrás** y el jugador camina al otro lado. Bug R30 preexistente. Workaround para probar: tocar la **base** del prop.
- **F-3:** la **hoz opcional desgasta durabilidad**. Preexistente, sin cambios hasta decidir herramientas.
- **`herb_patch`:** se detecta con un scan de 27×27 = 729 tiles cada 0,3 s. Es lento pero sin impacto medible. Preexistente.

---

## 9. Deuda técnica pendiente

### 9.1 R30 bugs (ramas previstas, sin crear, desde `origin/main`)
- Spawn autoritativo: `fix/wildlands-authoritative-spawn`. **PENDIENTE DE VERIFICAR EN PRODUCCIÓN.**
- F-2 prop tap/picking: `fix/wildlands-prop-tap-picking`. Tests primero.

### 9.2 R31 deuda (no bloquea)
- **Node index** por chunk (diseño en `R31Z_CONSOLIDATION_PLAN.md` §7, **no implementado**): eliminaría el scan de `herb_patch` y las 5 cachés `Map` sin límite. ~120 líneas + tests. Se decide si entra en R31 tardío o en R32-0.
- **ActionCards duplicadas:** `MiningActionCard.vue`, `LoggingActionCard.vue`, `ForageActionCard.vue`, `FishingActionCard.vue`. **No cubiertas por el baseline**: unificarlas necesita su propia red (snapshot de DOM o gate visual).
- **`OverlayPlayer`** exportado desde `mining/miningOverlay.ts`. Moverlo a `overworld/` toca imports del core congelado.
- **F-1 mesa sólida / `ObstacleProvider`:** la solidez debe ser dato del mundo (colisión, navegación, interacción, servidor). Tests previos definidos en §10.5 del plan.
- **F-3 hoz opcional:** comportamiento sin cambios; es decisión de balance/herramientas.
- Harness: `fillText` etiquetado como `fillRect`; `workerFixtures.loaded` sin reinicio entre tests.
- `game.ts` por encima del umbral de tamaño.
- `tsconfig.node.json` con errores previos (`@types/node`).
- 9 warnings de lint en `AuthModal.vue`.

### 9.3 Economía (balance, decisión de diseño pendiente)
- **Tope de pendientes:** debe existir en producción; el número es balance.
- Energía y regeneración, curva de XP, yields, rare drops, respawns, stacks y capacidad, herramientas y reparación, hoz.
- Relación faucet/sink ~14:1 según el simulador.

### 9.4 R32-0 — fundaciones de autoridad (diseño antes de código)
- **Server authority** de acciones de profesión + paquete de reglas compartido cliente/servidor.
- **Trust boundary:** el cliente manda intención; el servidor decide el resultado.
- **Colisiones server:** posición y distancia autoritativas; colisión en `acceptMove`.
- **Replay / idempotencia:** `actionId` / `batchId`.
- **Server clock** para duraciones, energía y respawn.
- **RNG** autoritativo: CSPRNG con semilla nunca expuesta.
- **Catálogo** autoritativo: ítems, recetas, estaciones.
- **Ledger** de cargas: token-bucket, sin copia O(n) ni ráfagas en la frontera.
- Estaciones como dato del área (F-1).

### 9.5 Postergable
- Borrar ramas R31 apiladas y QA ya mergeadas.
- Mover `OverlayPlayer`.
- Limpieza del harness.
- Unificar ActionCards.
- Warnings de `AuthModal`.

---

## 10. Decisiones que NO deben reabrirse sin motivo nuevo

1. **Pesca no se fuerza dentro de Gathering** (§4.1). Comparte solo pops y worker.
2. **Alquimia sigue como Processing** (§4.2).
3. **El worker in-game usa `workerSpot`**, no `spawnBeside`.
4. **`spawnBeside` es dev-only**, para posicionar al jugador en los labs.
5. **Node index quedó fuera del refactor**: diseño documentado, sin implementar.
6. **Playground, laboratorios y galería se conservan.** Solo se retira código muerto real. El playground no llega a `dist/`.
7. **No merge a `main`** de `integration/r31` hasta el gate humano y la orden explícita.
8. **Baseline congelado:** un refactor no justifica `-u`.
9. **Bugs R30** (spawn, F-2) van en ramas y PRs propios desde `main`, sin auto-merge. **Nunca** dentro de R31.
10. **La autoridad** (posición, distancia, ownership, reloj, replay, RNG, estación real, catálogo) es R32-0. El hardening de R31 fue solo fail-closed puro, sin cambiar resultados válidos.
11. **Pendientes con tope** obligatorio; el número se decide en balance.
12. **Hoz opcional sin cambios** hasta la decisión de herramientas.
13. **Git:** merge commits que conservan los hashes de la secundaria. Sin squash, sin rebase de historia publicada, sin force push, sin PRs no pedidos.
14. **Helper de ciclo de vida** Pesca/Alquimia no extraído (§4.3).

---

## 11. Hashes importantes

| Qué | Hash |
|---|---|
| Último HEAD de código/docs R31-Z en `integration/r31` (este handoff va en el commit siguiente, solo docs) | `25bcc1f53e0b60bdf30d19a287bdab0bc1589456` |
| `origin/main` (base de fixes R30 y merge-base de R31) | `7e474c6` |
| Tope de R31 original (C4.1), origen de `integration/r31` | `c7f3a77` |
| Merge QA R31 | `35ee8a4` (rama `20cbca0`) |
| Hardening fail-closed | `05ef45a` |
| Merge T-S1 | `a218dc7` (rama `4d77396`) |
| **Baseline pre-refactor congelado** (merge T-S1.1) | **`f2c615e578bf2725d957c15d211ff311382a9a63`** (rama `e7cba23`) |
| Inicio del Bloque A (doc de congelamiento) | `781fc74` |
| **HEAD post-refactor** (base contractual de T-S2) | **`15075df4dae0137f190ceadb57ead463e70b95c6`** |
| Merge T-S2 | `e89f150` (rama `7aa153c`) |
| R31-Z.1 `spawnBeside` / dead path | `af77efe` / `289a412` |
| Cierre R31-Z (docs) | `82a8ade`, `25bcc1f` |
| Snapshot contractual (md5, no es commit) | `334b1e04eb1e40f528f313573d4ac618` |

---

## 12. Documentos a leer, en orden

1. **Este archivo:** `docs/economy/R31_SESSION_HANDOFF.md`.
2. `AGENTS.md` en la raíz: reglas del repo; §17 para descomponer fases.
3. `docs/economy/R31Z_CONSOLIDATION_PLAN.md`: §10 decisiones, §11 Bloque A, **§12 cierre + gate + deuda**. §3/§4 para los bugs R30 y §7 para el node index.
4. `docs/economy/R31Z_POST_REFACTOR_QA.md`: T-S2.
5. `docs/economy/R31Z_OVERLAY_TRACE.md`: qué captura el baseline.
5b. `docs/economy/PRE_R32_HUMAN_GATE.md` y `docs/economy/PRE_R32_DESIGN_DECISIONS.md`: hallazgos del gate y decisiones de producto (APPROVED / OPEN).
5c. **`docs/wildlands/R32_INTEGRATION_AUDIT.md`: qué es R32, en qué orden y con qué gates.** Después, `DUNGEON_PROTOTYPE_INTEGRATION.md`, `DUNGEON_D1_QA.md`, `F1_OBSTACLE_PROVIDER_DESIGN.md`, `BATTLE_DATA_GAP_REPORT.md` y `docs/economy/STATION_VISUAL_LANGUAGE.md` (esta última solo en la rama `art/station-visual-language`).
5d. R32 en curso: `docs/wildlands/BATTLE_CATALOG.md` (R32.1, HUMAN APPROVED), `docs/wildlands/POKEMON_SPECIES_INSTANCE_MODEL.md` (R32.2 + R32.2.1: modelo, corte Identidad/Condition/Runtime y **Legacy Migration Contract** §10, que **no se ejecuta sin aprobación**) y `docs/wildlands/LEGACY_MOVE_AUDIT.md` (generado).
6. `docs/economy/R31_INTEGRATION_AUDIT.md`: auditoría profunda, trust boundary, propuestas de persistencia y multiplayer.
7. `docs/wildlands/R30_PRODUCTION_HANDOFF.md`: multiplayer en producción.
8. Según la tarea:
   - interacción por profesión: `docs/economy/*_INTERACTION_SPEC.md`;
   - diseño: `PROFESSIONS_DESIGN.md`;
   - economía: `ECONOMY_LOOPS.md`, `RESOURCE_ECONOMY.md`, `ENERGY_DURABILITY.md`;
   - inventario: `INVENTORY_DESIGN.md`;
   - trust boundary: `docs/TRUST_BOUNDARY.md`, `docs/INVARIANTS.md`.

---

## 13. Próximos pasos exactos

1. **Completar el gate humano** (§7): el usuario prueba Tala, Forage, Pesca, Alquimia y 375 px; la principal registra textual y clasifica.
2. **Documentarlo:** resultado por profesión, declaración `PASSED`/`FAILED`, commit + push en `integration/r31`, limpieza del entorno (§8.2).
3. **Bugs R30 independientes, solo con orden del usuario:**
   - verificar el spawn en producción (hoy **PENDIENTE DE VERIFICAR EN PRODUCCIÓN**);
   - solo si se confirma, crear `fix/wildlands-authoritative-spawn` y `fix/wildlands-prop-tap-picking` desde `origin/main`, tests primero, PRs separados, sin auto-merge.
4. **Economía:** no se balancea hasta definir el loop PvE/Dungeon (`PRE_R32_DESIGN_DECISIONS.md` A-12). La Dungeon nueva la diseña la estación secundaria con un brief del usuario (A-14).
5. **Diseñar R32-0** (§9.4): descomposición según `AGENTS.md` §17 y aprobación, **antes** de escribir código.
6. **R32 = Battle + Authority Foundations**, en cuatro subfases (`R32_INTEGRATION_AUDIT.md` §9). No arranca hasta aprobar la fuente del Battle Catalog (Q-1). Ningún gameplay productivo entra en R32.
7. Merge de `integration/r31` a `main`: solo cuando el usuario lo ordene explícitamente.

---

## 14. Reglas de colaboración

- **Esta es la estación PRINCIPAL:** el usuario, con ChatGPT como apoyo de diseño/revisión, en esta PC. **Integra** y es dueña de `integration/r31`.
- Existe una **estación SECUNDARIA** (otro Claude) en **otra PC**. **GitHub es la única frontera compartida.** El usuario pasa los prompts entre estaciones.
- **La secundaria recibe tareas aisladas.** Cada prompt de delegación incluye:
  - base = hash remoto exacto recién pusheado;
  - rama a crear;
  - archivos permitidos y prohibidos;
  - entregables;
  - comandos de verificación exactos;
  - condición de parada;
  - "NO MERGE / NO PR".
  Si el usuario edita un prompt y lo pide, devolver el prompt completo fusionado.
- **Nunca confiar en informes:** `git fetch`, verificar ancestría y `git diff --name-status base..rama`, leer el código y buscar tests vacuos.
- **Evitar solapamiento:** mientras la secundaria trabaja, la principal no toca esos archivos. Durante refactors productivos de la principal no se delega.
- **Integración:** merge commit que conserva los hashes de la secundaria. Push de `integration/r31` e informe del HEAD remoto (`git ls-remote`).
- **Detenerse al final de cada fase** y esperar la orden. Presentar un plan antes de cualquier refactor transversal.
- **Seguridad:** nunca exponer secretos. Solo placeholders en `.env.local` ignorado. No tocar un `.env.local` real del usuario. No commitear temporales. Restaurar `launch.json`.
- Idioma: español rioplatense, como los docs del repo.

---

## 15. Mensaje de arranque para una conversación nueva

```text
Sos la estación PRINCIPAL de PokeSwap / WildLands (hay una estación secundaria en otra PC; GitHub es la única frontera).
Trabajá en el worktree C:\Users\Rodri\Proyectos\pokeswap-r31-audit, rama integration/r31 (HEAD esperado: el commit "docs(economy): add R31 session handoff", hijo de 25bcc1f; verificalo con git ls-remote).

Leé primero, en orden:
1. docs/economy/R31_SESSION_HANDOFF.md (handoff operativo completo)
2. AGENTS.md
3. docs/economy/R31Z_CONSOLIDATION_PLAN.md §10–§12

Estado: R31 completo y consolidado en integration/r31 (no mergeado a main). Baseline congelado: snapshot md5 334b1e04eb1e40f528f313573d4ac618; un refactor nunca justifica -u. Estamos en el PRE-R32 HUMAN PROFESSION GATE: todavía NO está declarado PASSED; falta mi prueba manual de Tala, Forage (incl. herb_patch), Pesca y Alquimia, más 375 px, en http://localhost:5188/dev/profesiones.

NO hagas: cambios de código, fixes, cleanup, R32, fixes de R30 (spawn, F-2), node index, cambios de balance, merge a main, force push ni PRs, salvo que yo lo ordene.

Acción inmediata:
- verificá git status, el HEAD local y remoto de integration/r31, y si el dev server de 5188 responde (si no, relanzalo con la entrada r31-gate-dev de launch.json y .env.local placeholder);
- confirmame el estado en pocas líneas y esperá mi feedback del gate;
- registralo textual, clasificando conocido/preexistente (F-1, F-2, F-3, herb_patch scan, errores de red Supabase) vs regresión nueva.
```
