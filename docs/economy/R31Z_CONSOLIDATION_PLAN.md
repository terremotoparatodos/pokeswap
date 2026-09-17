# R31-Z — Consolidación del cliente: estado y plan

> **Dueña:** estación principal. **Rama:** `integration/r31` (desde `c7f3a77`, sin reescribir historia). **No mergeada a `main`.**
> **Base:** [`R31_INTEGRATION_AUDIT.md`](R31_INTEGRATION_AUDIT.md) y [`R31_QA_REPORT.md`](R31_QA_REPORT.md).
> **Convención:** **FACT** = ejecutado o medido en esta sesión. **PROPUESTA** = requiere aprobación antes de implementar.

---

## 1. Revisión de la rama QA (`origin/qa/r31-professions-regression`)

| Commit | Contenido | Veredicto |
|---|---|---|
| `be40d71` | `professionsStress.test.ts` (18 tests, arnés inline; **no existe** un `stressHarness.ts` separado) | **Conservar, corregido** |
| `eb29344` | Pista dev-only "Estás parado sobre la mesa" en `AlchemyFieldLab.vue` | Conservar (dev-only, 16 líneas). Queda obsoleta cuando se resuelva F-1 |
| `20cbca0` | `R31_QA_REPORT.md` | Conservar, con nota de corrección |

Se integró con **merge commit** (`35ee8a4`), así que los tres commits conservan su hash.

### 1.1 Calidad del arnés (FACT)

**Bueno:**
- ejecuta controladores, overlays y sesión demo **reales**, sin mocks del dominio;
- detecta duplicados como inventario incorrecto;
- cubre cancelación, lock de input y timers (`vi.getTimerCount`).

**Problemas encontrados** al forzar las ramas con `throw` en lugar de `return`:

| Test | Problema | Evidencia |
|---|---|---|
| Pesca: "reeling before the bite…" | **Vacuo.** El jugador estaba al sur de la orilla, `cast()` devolvía `false` y el test hacía `return` | `EARLY:cast` en 2/2 |
| Pesca: "a second cast…" | **Vacuo**, misma causa | Ídem |
| Pesca (ambos, tras corregir la posición) | El overlay de pesca **sí** usa canvas dentro de `ground()` (`toSprite` → `getContext`). Nunca había corrido headless | `TypeError … createImageData` |
| "keeps the reward when the bag is full…" | Solo recorría la rama de rechazo; nunca probó pendientes | `FULLBAG:refused-branch` |
| Cruce de profesiones: "XP no se mezcla" | Siempre verdadero: `demoLevel > 0` (el nivel mínimo es 1) | Lectura |
| Doble toque en minería | Afirmaba "una carga consumida" en un comentario, sin assert | Lectura |
| Alquimia | `vi.useFakeTimers()` sin restaurar | Lectura |

**Corregido en `99c61dd`:**
- la pesca lanza de verdad desde la orilla, con `getContext` stub solo para hornear sprites;
- test determinista de desborde a pendientes (elige la semilla con el reducer puro);
- test de rechazo por mochila llena;
- XP comparado por profesión;
- cantidad exacta y una sola carga en el doble toque;
- timers restaurados.

Resultado: **19 tests, estables en 3 corridas.** El arnés es sólido y útil para cuando el resolver pase al servidor. Tras el refactor conviene moverlo a `professions/testing/` (§6).

### 1.2 QA vs auditoría

| Tema | QA | Auditoría | Conclusión |
|---|---|---|---|
| Sin duplicación de consumo o recompensa en cliente | Sí | No lo probó | **Aporte de QA** (ahora respaldado también en pesca) |
| Timers, listeners y canvas sin fugas en labs | Sí (navegador) | No lo midió | **Aporte de QA** |
| F-1 mesa sin colisión | P1 | P6 / §14.4 | Coinciden |
| F-2 navegador del lado opuesto | P1 | No detectado | **Aporte de QA**; causa real distinta a la que propone (§4) |
| F-3 hoz gastada sin requerirla | P2 | P2 | Coinciden; decisión económica |
| F-4 scan de hierbas | P2 ("±13") | 729 tiles, caché sin límite | Coinciden; la auditoría precisa coste y fuga |
| F-5 `CompositeOverlay` orden fijo | P2 | W4 | Coinciden |
| Typecheck roto | No detectado | B1 | La QA repitió el mismo "OK" |
| Spawn servidor/cliente, colisión en servidor, O(n) del ledger, hostile inputs | No | Sí | Fuera del alcance de la QA |

---

## 2. Estado de `integration/r31` (local, sin push)

```text
05ef45a fix(professions): fail closed on hostile numbers in pure resolvers
c4860ed docs(economy): correct R31-C4, C4.1 and QA verification claims
99c61dd test(professions): make the R31-QA stress tests prove what they claim
35ee8a4 Merge branch 'qa/r31-professions-regression' into integration/r31
22f2d93 ci: make npm run typecheck check the app
3df9b66 fix(professions): restore strict app typecheck
942ae98 docs(economy): add the R31 integration audit
c7f3a77 (feat/r31c4-1-alchemy-gathering-polish)
```

| Check (FACT, en `05ef45a`) | Resultado |
|---|---|
| `npx vitest run` | **85 archivos, 705 tests** verdes |
| `npm run typecheck` (ahora `vue-tsc --noEmit -p tsconfig.app.json`) | OK. **Verificado que falla** (exit 2) si se reintroduce un error |
| `npx eslint .` | 0 errores, 9 warnings previos (`AuthModal.vue`) |
| `npm run build` | OK |
| `dist/` | 0 coincidencias de playground, labs, demo, textos de profesiones, tests nuevos o pista de la mesa |
| `npm run sim:economy` (base, month-100, veterans) | Totales **idénticos** antes y después del hardening |

**CI:** `ci.yml` ya ejecuta `npm run typecheck`, que ahora chequea de verdad. `tsconfig.node.json` (`vite.config.ts`) tiene errores previos por falta de `@types/node`: queda fuera a propósito (agregar una dependencia no es parte de R31-Z).

---

## 3. Spawn de Pradera: conclusión (FACT)

**Método:** `WildlandsGame` real en el navegador (dev server del worktree, sin backend). Se usó un puerto de presencia falso y se inyectaron las respuestas que `PresenceRoom.changeArea` envía.

| Paso | Posición |
|---|---|
| Cliente cruza la puerta oeste hacia Pradera | Llega a **(-5,-69)** (`world.findSpawn`, junto al portal de vuelta en (-5,-70)) |
| Llega el snapshot del servidor (`changeArea('pradera')` → `WILD_SPAWN`) | El cliente reubica al jugador en **(8,41)** |
| (8,41) en el mundo de Pradera | **Tile sólido** (bosque), a **124 tiles** del portal |
| Cliente vuelve de Pradera a la Ciudad | Llega a **(8,41)**, la llegada de la puerta oeste |
| Snapshot del servidor (`changeArea('ciudad-corazon')`) | Reubica a **(31,20)**, el centro de la plaza |

**Conclusiones:**
1. **Mismo sistema de coordenadas:** tiles enteros por área. Ambos lados interpretan `(tx, ty)` igual; el cliente aplica lo que dice el servidor (`setAuthoritativeActor` → `placePlayer`).
2. **Es un bug real de R30**, en los dos sentidos:
   - El servidor usa como spawn wild la **llegada al pueblo desde la puerta oeste** (`hearthome.ts`: `arrival: {tx: 8, ty: 41}`), que coincide numéricamente.
   - Al volver al pueblo ignora la puerta y manda al centro.
   - El caso grave es Pradera: el jugador queda dentro de un árbol y lejos del portal. La presencia R30 **no valida colisión**, así que el servidor nunca lo corrige.
3. **Cómo funciona hoy el multiplayer:** el cliente predice el viaje localmente, marca `pendingPresenceArea` y envía `area`. El servidor fija una coordenada constante por área y responde con un snapshot. El cliente acepta ese `self` (la reconciliación solo filtra snapshots del área anterior y pasos predichos) y hace snap.
4. **Fuente autoritativa correcta:** el **servidor**, pero derivada de los **mismos datos de área** que usa el cliente, no de constantes copiadas a mano.
   - **Corto plazo (PROPUESTA, hotfix R30 separado):** constantes compartidas en `services/realtime/src/protocol/messages.js`, que Vite ya consume: spawn wild (-5,-69) y llegada al pueblo por puerta (8,41). Más un test del cliente que falle si `WildArea('pradera').arrival()` o la llegada de la puerta dejan de coincidir.
   - **R32-0:** el paquete de reglas compartido expone llegadas por área; el servidor valida colisión.
5. **Pendiente:** confirmarlo en producción. Son 2 minutos de prueba manual: entrar a Pradera y ver si el personaje aparece lejos del portal. No se tocó el servidor.

---

## 4. F-2 — Navegación: causa y propuesta

**Causa real (FACT, motor en navegador):**
- `Renderer.pick()` solo tiene *hitboxes* de **actores**.
- Los props (árboles, rocas, arbustos) no participan: el toque se proyecta al **suelo bajo el dedo**.
- Tocar a **≥20 px por encima de la base** de un árbol, roca o arbusto devuelve el tile **detrás** del objeto (norte), y 30 px devuelve dos tiles detrás (medido en `common_tree`, `stone_outcrop` y `berry_bush`).
- Ese tile es caminable y no es el nodo, así que el navegador camina **hasta él**: el jugador termina del lado opuesto, sin interacción. La cámara se mueve y el segundo toque en el mismo punto de pantalla cae en otro tile.

La hipótesis de la QA (A* elige una vecina lejana) **no es la causa principal**. En campo abierto el A* elige la vecina más cercana; los tests existentes en `worldObjectNavigation.test.ts` lo confirman.

**Alcance:** es un problema general del motor (R24/R30). Afecta a **todo prop alto** en la ciudad y en los mundos, en producción. Los edificios ya lo resolvieron con `doorForTap` (footprint + `TAP_REACH_ROWS`).

**PROPUESTA — fuera de R31-Z (decisión 2026-09-16): fix independiente de R30 desde `main`, rama propia, tests antes del fix:**
1. **Tests primero:**
   - extraer `hitTest(hits, sx, sy)` puro;
   - test de proyección que demuestre que un toque en la copa de un sprite de 42 px resuelve el tile ancla;
   - test de caracterización que falle con el código actual.
2. En `Renderer.collect`, registrar hitboxes también para decor con sprite (los mismos rectángulos que ya se proyectan), con tile = ancla del decor. Los actores siguen ganando por orden de profundidad.
3. Resultado: tocar un árbol camina **al costado** del árbol (sólido → `plan` apunta a una vecina) y, si es nodo, lo abre.
4. Tamaño estimado: ~40 líneas en `renderer.ts` + tests. No toca `navigator.ts`.

---

## 5. F-1 — Solidez de estaciones y objetos dinámicos (PROPUESTA)

**Principio:** `SceneOverlay` queda como presentación. La solidez es un **dato** consultado por colisión, navegación, interacción y, en el futuro, el servidor.

**Solución pequeña y limpia para R31-Z:**

```text
engine/obstacles.ts (nuevo, puro)
  interface ObstacleProvider { solidAt(areaId, tx, ty): boolean }

WildlandsGame
  setObstacleProvider(provider | null)     ← igual que setSceneOverlay, inerte en producción
  isBlocked(tx, ty) = area.isSolid(tx, ty) || provider?.solidAt(area.id, tx, ty)
  usa isBlocked en: MoveRules.blocked, TapNavigator.isSolid, worldObjectBeside/interact (sin cambios: ya consultan vecinas)

professions/stations/stationRegistry.ts (nuevo, puro)
  STATIONS: [{ id: 'pradera-alchemy-bench', areaId: 'pradera', tx, ty, kind: 'alchemyTable' }]
  ← posición FIJA como dato (hoy se deriva por espiral con findSpawn, que usa Math.cos/sin: mala base para servidor)
  solidAt(areaId, tx, ty) → ¿hay estación ahí?

AlchemyOverlay / useAlchemyController
  leen la estación del registro (ya no la derivan); el dev demo registra el provider
```

**Qué resuelve:**
- el jugador no puede pararse sobre la mesa;
- el navegador llega al costado (camino sólido existente) y toca → abre;
- la pista `eb29344` pasa a ser innecesaria;
- el servidor en R32-0 importa el mismo `STATIONS` y su `acceptMove` puede rechazarlo.

**Qué no hace:**
- no convierte estaciones en decor del generador;
- no agrega interiores;
- no persiste estructuras de jugador (eso será una fuente adicional del mismo provider en R33).

**Coste:** ~80 líneas + tests (colisión, navegación hacia estación desde 4 lados, provider nulo = comportamiento idéntico). Toca `game.ts` (motor central): **requiere aprobación.**

**Alternativa descartada:** `SceneOverlay.isSolid`. Mezcla render con física y el servidor no lo ve.

---

## 6. Abstracción gathering / processing (PROPUESTA — no implementada)

### 6.1 Evidencia

- Controladores de minería y tala: **~37 líneas** de diferencia tras normalizar nombres.
- Forage: igual más la regla mano/hoz.
- Pesca: agrega espera, ventana de pique, `reel()` y cobro solo al atrapar.
- Los 5 overlays repiten caché de targets, vistas, `tick`/`rewind`, reward pops, trabajador y labels.
- Alquimia no tiene nodo, cargas, herramienta ni energía: receta × lote.

### 6.2 Arquitectura

```text
src/features/professions/
  interaction/
    worldInteractionHost.ts      Registro de interacciones activas; exclusividad de selección
                                 (reemplaza la cadena de if/close() de ProfessionWorldDemo),
                                 input lock, overlay compuesto, provider de obstáculos
    rewardPops.ts                Pops "+N" / "+XP" / rareza (hoy ×5)
    workerSummon.ts              summon/dismiss del trabajador sobre WorkerCompanion (hoy ×5)
  gathering/
    useGatheringController.ts    selección, inspect/close, act() con guardas de fase,
                                 alcance vía adapter, outcome, detach, preload de trabajador
    GatheringOverlay.ts          base: vistas cacheadas, tick/rewind, celebrate → rewardPops,
                                 decor() genérico usando adapter.nodeArt
    adapters/
      mining.ts                  matches, timeline (golpes), pose → shake/flash, pico, partículas
      logging.ts                 + caída en última carga, hojas
      forage.ts                  + gesto mano/hoz según preview.bareHands (el scan de parches se conserva tal cual)
      fishing.ts                 + fase "wait/bite", input "reel", splash, cobro al atrapar
  processing/
    useStationController.ts      estación del registro, receta, cantidad, brew (hoy useAlchemyController)
    StationOverlay.ts            mesa, líquido, burbujas (hoy AlchemyOverlay)
    alchemy/ (recipeBrowser, brewTimeline, arte)   específico
  components/
    GatheringActionCard.vue      base con slots: chips, herramienta, acciones, resultado
    {Mining,Logging,Forage,Fishing}ActionCard.vue → envoltorios finos o eliminados
    AlchemyStationCard.vue       queda (familia processing)
  components/playground/spawnBeside.ts   (hoy ×4)
  testing/professionsHarness.ts  arnés de professionsStress extraído y reutilizable
```

**Regla para no forzar:**
- si el adapter de pesca necesita **más de 2 hooks exclusivos** (hoy se estiman `phase: waiting/biting` y `input: reel`), pesca conserva su controlador y solo comparte overlay base, pops y trabajador;
- Alquimia **no** implementa `GatheringAdapter`;
- `StationController` no se generaliza hasta que exista una segunda estación (horno o banco).

### 6.3 Qué se elimina / qué queda específico

| Se elimina | Queda específico |
|---|---|
| 4 controladores de gathering (→ 1 + 4 adapters) | Timelines (`miningAction`, `choppingTimeline`, `forageTimeline`, `fishingTimeline`, `brewTimeline`) |
| Andamiaje duplicado de 4 overlays (cachés, pops, trabajador, rewind) | Kits de arte, paletas, VFX, estados visuales por profesión |
| — (las cachés `placements` y el scan de hierbas **no se tocan** en el refactor; ver §7) | `fishingApproach`, caída del árbol, hojas, splash |
| 4 copias de `spawnBeside` | `recipeBrowser`, `stationPlacement` → registro |
| Rama muerta `otherNodeAt` + backdrop en `ProfessionWorldDemo` (E1) | Tarjeta de estación de Alquimia |
| `ui/fishingSession.ts` + `FishingCast.vue`, `AlchemyBench.vue` + `RecipeCard.vue` (E2/E3), si el playground no los necesita | Laboratorios (solo pierden duplicación) |

### 6.4 Cómo se demuestra la equivalencia

1. **Antes del refactor:** snapshot de **traza de escena** por profesión (tarea delegada, §9).
   - Acciones guionadas con reloj fijo.
   - Se muestrea cada 50 ms la salida de `decor()`, `ground()` (llamadas al contexto stub), `sprites()` y `labels()`: posición, lift, alpha, scale, depthBias y hash de los píxeles del `PixelArt`.
   - También el estado de la sesión demo después de cada acción.
2. **Durante:** `professionsStress.test.ts`, `hostileInputs.test.ts` y los tests de dominio/arte sin tocar deben pasar.
3. **Después:** snapshots **idénticos**. Cualquier diferencia se explica en el PR o se corrige.
4. **Manual:** recorrido de los 4 laboratorios en escritorio y a 375 px.

**Coste estimado:** −1.400 / +850 líneas aproximadamente, 5 commits (host + pops + trabajador → gathering controller → overlay base + adapters → tarjeta base → borrados de código muerto real).

**Aprobado conceptualmente (2026-09-16). Orden obligatorio:** baseline T-S1 revisado e incorporado → refactor de controllers → equivalencia comprobada → recién después se evalúa el índice de nodos. El playground, los laboratorios y la galería **se conservan**; solo se retira código muerto real.

---

## 7. Node index (DISEÑO DOCUMENTADO — NO IMPLEMENTAR TODAVÍA)

> **Decisión (2026-09-16):** el índice **no** entra en el refactor, para aislar variables. El scan actual es feo pero no muestra un problema de rendimiento medible (FPS y heap estables en la QA). Después del refactor se decide si entra en R31-Z tardío o en R32-0.

**Hoy (FACT):**
- `nodeAt` cuesta 2,67 µs por tile;
- el scan de hierbas recorre 729 tiles cada 0,3 s (2,3 ms en frío);
- 5 overlays mantienen cachés `Map<string>` **sin límite** (14.580 entradas tras 20 posiciones, por overlay).

**Diseño:**

```ts
// professions/interaction/nodeIndex.ts — puro, sin canvas
class NodeIndex {
  constructor(port: NodeWorldPort, options?: { maxChunks?: number })  // LRU, p. ej. 64 chunks
  at(tx, ty): NodePlacement | null            // tile → chunk → Map<localIndex, placement>
  inRect(tx0, ty0, tx1, ty1): NodePlacement[] // para overlays: lo visible, sin escanear alrededor del jugador
}
// Un índice por área (seed), compartido por todas las profesiones del host.
```

- **Por chunk (32×32):** primera consulta del chunk = `nodesInChunk` (~2,8 ms, 1.024 × 2,7 µs); después O(1).
- **Memoria:** ~13 nodos por chunk; 64 chunks ≈ 850 entradas (vs. decenas de miles sin límite).
- **Parche de hierbas:** `inRect(viewport)` filtrado por `anchor === 'tallGrass'`. Desaparece el scan periódico y el caso especial del terreno.
- **Servidor:** **no necesita el índice.** Valida un tile por acción con `nodeAt` O(1). Lo que se comparte es la función, no la caché. Por eso el índice vive en `professions/interaction` (cliente) y `nodeAt` en el paquete de reglas (R32-0).
- **Pico de coste** al entrar a un chunk nuevo: comparable al horneado de chunks que el motor ya hace. Si hiciera falta, se reparte en `requestIdleCallback`. Medir antes de optimizar.
- **Coste de implementación:** ~120 líneas + tests (igualdad con `nodeAt` en una muestra, evicción LRU, `inRect`), más la migración de las cachés de los overlays que existan después del refactor.
- **Alternativa por tile** (sin chunk): `Map<tileKey, placement>` con LRU por entradas. Más simple, pero no permite `inRect` sin recorrer tiles y sigue necesitando el scan para el pasto alto. Descartada salvo que el refactor deje una sola caché.
- **Alternativa por área** (precalcular todo): imposible en un mundo infinito.

---

## 8. Hardening: clasificación

| Hallazgo | Clase | Estado |
|---|---|---|
| `removeStacks`/`transferSlot`/`hasItems` con NaN, ±∞, fracciones, 0 o negativos | **FIX R31-Z** | ✅ `05ef45a` (rechazan) |
| `addStacks`/`addItems` con cantidades inválidas | **FIX R31-Z** | ✅ lanzan `RangeError` (antes descartaban o inventaban unidades) |
| Nivel o energía NaN pasaban las validaciones (`NaN < x` es falso) | **FIX R31-Z** | ✅ comparaciones fail-closed |
| Tiempo de procesado negativo o no finito con bonus inválidos | **FIX R31-Z** | ✅ reducciones fuera de [0,1) cuentan como 0 |
| Stacks consumidos con cantidad 0 | **FIX R31-Z** | ✅ se omiten |
| `spendEnergy(NaN)` / `wearTool(NaN o fracción)` | **FIX R31-Z** | ✅ |
| Ítems inexistentes aceptados por `addStacks` | R32-0 (validación contra catálogo en la intención del servidor) | Pendiente |
| Distancia al nodo, presencia en estación, ownership del trabajador, posición autoritativa, replay/idempotencia, reloj de servidor, RNG autoritativo | **R32-0** | Pendiente |
| Crafting sin validar estación | **R32-0** (y registro de estaciones de §5) | Pendiente |
| Ledger de cargas: copia O(n) y ráfaga en la frontera de ventana | **R32-0** (modelo token-bucket) | Pendiente |
| Colisión en `acceptMove`, spawn servidor/cliente | **Hotfix R30** (spawn) / **R32-0** (colisión) | Pendiente |
| Velocidad máxima de acciones, energía, rare drops, tope exacto de pendientes, pérdida de máximo al reparar | **BALANCE** | Sin tocar |
| Tope de pendientes | **Invariante:** los pendientes **no pueden ser ilimitados en producción**. El número exacto es **BALANCE** (economía / R32). Hoy el demo local no tiene tope | Documentado; sin implementar |
| Hoz opcional (F-3): con hoz equipada se gasta durabilidad aunque la planta no la pida | **Decisión de diseño/economía**, junto con el resto de herramientas. Se **mantiene el comportamiento actual** (`preview.bareHands === false`, la tarjeta lo muestra como "opcional") | Documentado; sin cambios |

---

## 9. Primera tarea delegada a la estación secundaria

> **Precondición:** la estación principal hace push de `integration/r31`. La base es ese commit exacto.

### T-S1 — Snapshot de traza de escena (red de equivalencia para el refactor)

| Campo | Valor |
|---|---|
| **Rama base exacta** | `origin/integration/r31` en el HEAD publicado por la estación principal (el hash exacto se entrega junto con el prompt; es la base contractual) |
| **Rama a crear** | `test/r31z-overlay-trace-baseline` |
| **Objetivo** | Congelar, **antes** del refactor, la salida observable de los 5 overlays y de la sesión demo, para demostrar equivalencia después |
| **Puede crear** | `src/features/professions/testing/overlayTrace.ts` (utilidades), `src/features/professions/overlayTrace.test.ts`, `src/features/professions/__snapshots__/overlayTrace.test.ts.snap`, `docs/economy/R31Z_OVERLAY_TRACE.md` |
| **Puede leer** | Todo el repo |
| **Prohibido modificar** | Cualquier archivo existente. En particular `src/features/professions/**` (salvo los nuevos), `professionsStress.test.ts`, `src/features/wildlands/**`, `services/**`, `supabase/**`, `.github/**`, `package.json`, `docs/economy/*` existentes |
| **Entregables** | 1) Por profesión (minería, tala, forage mano, forage hoz, pesca; alquimia lote 1 y 3 como baseline separado de processing si aporta valor): guion determinista (trabajador `null`, semilla fija, reloj de escena fijo a 1/30 s, muestreo cada 50 ms). 2) Traza serializada: `decor()` (tile, dx, dy, hash de píxeles del arte), `ground()` (llamadas al contexto stub con args redondeados), `sprites()` (wx, wy, lift, alpha, scale, depthBias, hash de píxeles), `labels()` y estado de la demo al final (inventario, XP, energía, durabilidad, cargas). 3) Snapshot commiteado. 4) Doc breve: cómo regenerar y qué significa una diferencia |
| **Técnica sugerida** | Reutilizar la idea del stub de `professionsStress.test.ts` (copiar, no importar ni modificar). Para hashear arte sin canvas: `vi.mock` parcial de `art/pixelArt` que envuelva `toSprite` y registre el `PixelArt` → FNV-1a sobre `pixels`. Pesca necesita `getContext` stub (ver `99c61dd`) |
| **Tests / checks** | `npx vitest run` (todo verde), `npm run typecheck`, `npx eslint .`, `npm run build`, y búsqueda en `dist/` de `overlayTrace` = 0. **Determinismo:** correr el test 3 veces y además `--sequence.shuffle`; los snapshots no deben cambiar |
| **Condición de stop** | Snapshot estable en 3 corridas + shuffle, o bloqueo documentado (por ejemplo, un overlay no determinista: reportarlo, **no** arreglarlo) |
| **Prohibido** | Refactorizar, "arreglar" código de producción o dev, cambiar balance, tocar el motor. **NO MERGE.** No abrir PR hacia `main` ni hacia `integration/r31`; solo push de la rama y aviso con hash y resultados |

**Por qué primero:**
- es la precondición de §6;
- no toca ningún archivo existente, así que no puede pisarse con la estación principal;
- aprovecha su fortaleza en tests y overlays.

### Mientras tanto, la estación principal (sin solaparse)

- Verificar el spawn en producción y, si se reproduce, fix **independiente de R30** desde `main` (`fix/wildlands-authoritative-spawn`).
- F-2 **independiente de R30** desde `main` (`fix/wildlands-prop-tap-picking`), tests primero.
- F-1 (`ObstacleProvider` + registro de estaciones) en `integration/r31`, tests primero.
- Refactor §6 **solo después** de revisar e incorporar T-S1.

---

## 10. Decisiones tomadas (2026-09-16)

1. **Push de `integration/r31`:** aprobado. Su HEAD publicado es la base contractual para la estación secundaria. No se mergea a `main`.
2. **QA:** se conservan el arnés, los tests de estrés reforzados, el informe y la pista dev de la mesa (inocua).
3. **Spawn:** bug independiente de R30. Primero verificar en producción; si se confirma, rama desde `main`, tests, fix mínimo, verificación multiplayer y PR independiente **sin merge automático**. R31/R32 consumen el comportamiento corregido.
4. **F-2:** bug independiente de R30 (`pick` no reconoce props altos). Rama desde `main`, tests antes del fix, PR separado del de spawn. No va dentro del refactor.
5. **F-1:** aprobado conceptualmente. La solidez es un **dato del mundo** consultable por colisión, navegación, interacción y (después) el servidor; `SceneOverlay` solo representa. Tests antes: estación sólida, pathfinding alrededor, interacción adyacente, sin estación, dos obstáculos, limpieza y cambio de área. Si hacerlo bien exige un cambio mucho mayor, detenerse y proponer.
6. **Refactor:** aprobado conceptualmente (Gathering: Minería, Tala, Forage; Pesca solo si no deforma la abstracción; Processing: Alquimia aparte). Empieza después del baseline.
7. **Node index:** fuera del refactor. Solo diseño y coste (§7).
8. **T-S1:** aprobada para la estación secundaria.
9. **Playground, laboratorios y galería:** se conservan. Solo se retira código muerto real.
10. **Hardening:** aprobado mientras no cambie resultados válidos y el simulador siga idéntico. Autoridad (posición, distancia, ownership, reloj, replay, RNG, estación real, catálogo autoritativo) queda para R32-0.
11. **Pendientes:** deben tener tope en producción; el número es balance.
12. **Hoz opcional:** sin cambios; se decide con el resto de herramientas.

---

## 11. Baseline congelado y Bloque A (2026-09-16)

**`PRE-REFACTOR BASELINE FROZEN`** sobre `origin/integration/r31 @ f2c615e578bf2725d957c15d211ff311382a9a63`.

- Snapshot: `src/features/professions/__snapshots__/overlayTrace.test.ts.snap`, md5 `334b1e04eb1e40f528f313573d4ac618` (idéntico en las dos estaciones).
- **Regla:** el snapshot solo se actualiza por una regresión corregida intencionalmente, un cambio visual o de gameplay aprobado, o una autorización explícita. **Un refactor interno nunca justifica `-u`.**

### Bloque A — refactor productivo (estación principal, sin delegación)

Objetivo: **mismo comportamiento observable**, menos duplicación estructural.

| # | Commit | Alcance |
|---|---|---|
| 0 | Este documento | Freeze y plan |
| 1 | `overworld/rewardPops.ts` | Las cinco overlays |
| 2 | `overworld/workerSummon.ts` | Las cinco overlays; sigue usando `workerSpot` y `WorkerCompanion` |
| 3 | Núcleo de overlay de gathering + Minería | Solo Minería |
| 4 | Tala sobre el núcleo | Incluye la caída y la regla de última carga, específicas |
| 5 | Forage sobre el núcleo | Mano/hoz, motas y el scan de `herb_patch` **sin cambios** |
| 6 | Núcleo de controller de gathering detrás de la fachada de Minería | API pública intacta |
| 7 | Tala y Forage sobre el núcleo de controller | API pública intacta |
| 8 | Ciclo de vida compartido con Pesca y Alquimia | Solo si es pequeño y natural; si no, se omite |

**Reglas:** trace sin `-u` después de cada paso (si cambia un snapshot, detenerse y explicar); stress y `hostileInputs` en verde; suite de professions en cada paso y suite completa en los checkpoints; fachadas (`useMiningController`, `useLoggingController`, `useForageController`), nombres de función, refs y literales de phase **sin cambios**. Pesca conserva su controller (opción B) y Alquimia sigue siendo processing.

**Fuera del Bloque A:** node index, tarjetas de acción, interaction host, `spawnBeside` compartido y retiro de `otherNodeAt` (R31-Z.1), economía, balance, timings, VFX, assets, motor de WildLands, servicio realtime, Supabase y `main`.

### Resultado del Bloque A (2026-09-16)

**Estructura final**

| Módulo compartido (`overworld/`) | Qué contiene | Usado por |
|---|---|---|
| `rewardPops.ts` | Pops "+N"/"+XP": layout, stagger, deriva, fundido, poda, íconos y labels | Las 5 overlays |
| `workerSummon.ts` | `summonWorkerOnce` (una vez por acción sobre `workerSpot` + `WorkerCompanion`) y `openGround` | Las 5 overlays |
| `gatheringOverlayCore.ts` | Caché de targets, vistas cacheadas, ciclo de vida de la acción (start/resultado/linger/done/cancel/rewind), anillos, burbujas y destellos, herramienta en mano, worker, pops | Minería, Tala, Forage |
| `gatheringController.ts` | attach/detach, sonda del navegador, inspect, close y la acción (adyacencia, re-chequeo del nodo, lock de input, arranque, aplicación del resultado) | Fachadas de Minería, Tala, Forage |

Vive en `overworld/` porque es la carpeta de infraestructura compartida que el test de aislamiento ya autoriza a usar los puertos del motor. El núcleo de controller no importa Vue (recibe los refs como `{ value }`), así que no hizo falta tocar ese test.

**Lo que siguió siendo específico:** arte, timelines y poses; chips (Minería); astillas, hojas y caída en la última carga (Tala); mano/hoz, motas y el scan de `herb_patch` sin cambios (Forage); todo el flujo de lanzar/esperar/pique/recoger (Pesca); estación, recetas, lote y progreso (Alquimia).

**Paso 8 — no se extrajo un ciclo de vida compartido con Pesca y Alquimia.** `detach` de Alquimia necesita `stopProgress()` en medio (un hook propio) y la precarga del worker usa `watch` de Vue: compartirla obligaría a ampliar la lista de composables del test de aislamiento o a inyectar `watch`. Ganancia estimada: ~12 líneas. No compensa.

**Equivalencia**

| Evidencia | Resultado |
|---|---|
| Overlay trace (11 escenarios + 4 del arnés), sin `-u`, después de cada commit | md5 `334b1e04eb1e40f528f313573d4ac618` en todos los pasos |
| `professionsStress.test.ts` + `hostileInputs.test.ts` | Verdes en todos los pasos |
| Suite completa | 88 archivos / 727 tests (720 + 7 unitarios nuevos de pops y worker) |
| Simulador (base, month-100, veterans) | Totales idénticos |
| Build de producción vs `f2c615e` | **Idéntico byte a byte** (1.061 archivos) |
| Cambios fuera de `src/features/professions` y `docs` | Ninguno |

**Líneas (controllers y overlays afectados)**

| Archivo | Antes | Después |
|---|---|---|
| `miningOverlay.ts` | 348 | 141 |
| `loggingOverlay.ts` | 377 | 172 |
| `forageOverlay.ts` | 444 | 234 |
| `fishingOverlay.ts` | 432 | 397 |
| `alchemyOverlay.ts` | 313 | 287 |
| `useMiningController.ts` | 115 | 56 |
| `useLoggingController.ts` | 111 | 59 |
| `useForageController.ts` | 117 | 65 |
| `useFishingController.ts` | 154 | 154 |
| `useAlchemyController.ts` | 172 | 172 |
| **Subtotal** | **2.583** | **1.737** |
| Módulos compartidos nuevos (sin tests) | — | 615 |
| **Total** | **2.583** | **2.352 (−231, −9 %)** |

La duplicación estructural eliminada es mayor que el neto: las tres overlays de gathering bajaron 622 líneas y sus controllers 163, reemplazadas por 479 líneas compartidas (núcleo de overlay + núcleo de controller); los pops y el summon repetidos cinco veces pasaron a 136 líneas.

---

## 12. Cierre de R31-Z (2026-09-16)

### 12.1 Estado

| Hito | Estado | Referencia |
|---|---|---|
| Baseline pre-refactor congelado | ✅ | `f2c615e`, snapshot md5 `334b1e04eb1e40f528f313573d4ac618` |
| Bloque A: refactor productivo | ✅ | `781fc74`…`15075df` (§11) |
| T-S2: QA post-refactor (estación secundaria) | ✅ Aprobada, **APTO PARA R31-Z.1** | `7aa153c`, integrada por merge `e89f150`; informe en [`R31Z_POST_REFACTOR_QA.md`](R31Z_POST_REFACTOR_QA.md) |
| R31-Z.1: limpieza dev-only | ✅ | Ver §12.2 |

T-S2 no encontró P0, P1 ni P2 atribuibles al refactor. Minería se validó manualmente de punta a punta; **Tala, Forage, Pesca y Alquimia no pudieron recorrerse manualmente** en el entorno de la estación secundaria. Eso no bloquea R31-Z.1, pero queda como gate antes de R32 (§12.3).

### 12.2 R31-Z.1 — limpieza dev-only

| Tarea | Resultado | Commit |
|---|---|---|
| A. `spawnBeside` compartido | Función pura en `components/playground/spawnBeside.ts` (recibe un puerto `isSolid`/`isWater`), con 6 tests. Igual a la copia anterior en 4.553 tiles de Pradera. Los 4 field labs la usan. `workerSpot` no se tocó | `af77efe` |
| B. Camino muerto del demo en mundo | Retirados `otherNodeAt`, el ref `target`, el backdrop, `close()` y el uso de `NodeInteractionPanel` en `ProfessionWorldDemo.vue`. El componente sigue existiendo (lo usa el playground). El evento `overlay` sigue declarado para no cambiar el contrato con `WildlandsView` | `289a412` |
| C. Mover `OverlayPlayer` a `overworld/` | **No se hizo.** Obligaba a cambiar los imports de `gatheringOverlayCore.ts` y `gatheringController.ts`, que esta fase no debía tocar. Sigue exportado desde `mining/miningOverlay.ts` | — |

**Verificación:**
- overlay trace sin `-u` (md5 `334b1e04…` después de cada commit);
- stress y hostile inputs en verde;
- suite completa, typecheck, lint y build;
- aislamiento de `dist/`.

**Pasada manual (Vite dev, caché limpia, variables placeholder):**
- En los 4 labs, cada selector de ubicación (17 en total) dejó al jugador exactamente donde indica `spawnBeside`, en escritorio (1280 px) y a 375 px, con 1 canvas vivo, sin scroll horizontal y sin errores más allá de la red del Supabase placeholder.
- En el demo en mundo (`/?area=pradera`) los 16 tipos de nodo siguen siendo interactuables, un tile vacío no lo es, tocar un nodo abre su tarjeta y no aparece ningún backdrop, también a 375 px.

### 12.3 PRE-R32 GATE

Antes de empezar R32 productivo, una **persona** recorre manualmente, en un entorno donde se pueda interactuar establemente con los nodos:

| Profesión | Recorrido mínimo |
|---|---|
| **Tala** | `common_tree` hasta agotarlo: cada carga, la última con caída y tocón, respawn, worker, hacha, reparación |
| **Forage** | `berry_bush` a mano y con hoz; **`herb_patch`**: aparición, selección, recolección, cambio de estado, respawn; worker, desgaste de hoz |
| **Pesca** | Orilla: lanzar, espera, pique, recogida válida y temprana, agotamiento, respawn, worker, reward pop, caña |
| **Alquimia** | Estación: receta, cantidad 1, 3 y máximo, ingredientes suficientes e insuficientes, proceso, reward y "Ahorró N", worker, cancelar durante el proceso |

Resultado esperado por profesión: `VISUALMENTE EQUIVALENTE` o `DIFERENCIA DETECTADA` (comparando con `f2c615e` ante dudas). No hace falta un atajo nuevo de selección para esto.

### 12.4 Bugs de R30 separados (ramas propias desde `main`)

| Bug | Estado | Rama propuesta |
|---|---|---|
| Spawn autoritativo: el servidor manda Pradera a (8,41) y la ciudad a (31,20) (§3) | Confirmado en el motor real; falta verificar en producción | `fix/wildlands-authoritative-spawn` |
| Pick de props: tocar la parte alta de árboles, rocas o arbustos selecciona el tile de atrás (§4) | Confirmado en el motor real | `fix/wildlands-prop-tap-picking` |

### 12.5 R32-0 — fundaciones de autoridad

- Autoridad de servidor para las acciones de profesión y paquete de reglas compartido cliente/servidor.
- Trust boundary: intención del cliente, resultado del servidor.
- Posición y distancia autoritativas; colisión autoritativa en `acceptMove`.
- Replay e idempotencia (`actionId`/`batchId`).
- Reloj de servidor.
- RNG autoritativo (CSPRNG, semilla nunca expuesta).
- Validación contra catálogo autoritativo (ítems, recetas, estaciones).
- Ledger de cargas: modelo token-bucket, sin copia O(n) ni ráfaga en la frontera.
- Estaciones como dato del área (F-1, `ObstacleProvider`).

### 12.6 Economía pendiente (balance)

Energía y regeneración, curva de XP y niveles, **tope de pendientes** (debe existir en producción; el número es balance), **hoz opcional** (F-3, sin cambios), yields, rare drops, respawns, stacks y capacidad, herramientas y reparación, y la relación faucet/sink (~14:1) en general.

### 12.7 Deuda técnica restante (no bloquea)

- Node index por chunk (§7), postergado: el scan de `herb_patch` y las cachés de targets sin límite siguen iguales.
- Tarjetas de acción duplicadas (4 `.vue`), sin cubrir por el baseline.
- `OverlayPlayer` exportado desde `mining/`.
- Harness: `fillText` etiquetado como `fillRect`; `workerFixtures.loaded` sin reinicio entre tests.
- `game.ts` sobre el umbral de tamaño (extraer la interacción con el mundo cuando se toque).
- `tsconfig.node.json` con errores previos por falta de `@types/node`.
- 9 warnings de lint previos en `AuthModal.vue`.

### 12.8 R31-Z COMPLETADO

| Etapa | Estado |
|---|---|
| Systems foundation (R31-A) | ✅ |
| UX / prototype (R31-B) | ✅ |
| Cuatro profesiones y sus visuales (R31-C1–C4.1) | ✅ |
| QA (R31-QA, T-S2) | ✅ |
| Hardening puro de dominio | ✅ |
| Overlay baseline congelado (T-S1, T-S1.1) | ✅ |
| Refactor productivo (Bloque A) | ✅ |
| Post-refactor QA (T-S2) | ✅ |
| Dev cleanup (R31-Z.1) | ✅ `spawnBeside` extraído, dead path eliminado, validado en escritorio y a 375 px |

`OverlayPlayer relocation deferred because it would touch the frozen production core.`

La pasada humana de §12.3 **no invalida R31-Z**: es el gate obligatorio antes de R32 productivo.
