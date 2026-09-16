# R31-Z / T-S1 — Overlay Trace Baseline

> **Base contractual:** `bb2aec06718753b84a322736f5835bd6b68fa968` (`origin/integration/r31`).
> **Rama:** `test/r31z-overlay-trace-baseline`. **No mergeada, sin PR.**
> **Para qué:** red de equivalencia del refactor gathering/processing ([plan §6.4](R31Z_CONSOLIDATION_PLAN.md)). Congela la salida observable **actual**; no juzga ni corrige comportamiento.
> **Suite en la base, antes de empezar:** 85 archivos / 705 tests verdes (verificado).
> **Revisado en T-S1.1** tras la auditoría de la estación principal: cadencia de hooks, estado observable en vez de phase interna, recorder de dibujos efectivos y tres escenarios nuevos. Lo que sigue hasta §10 es el registro original de T-S1; la revisión está a partir de §11.

## 1. Qué se creó

| Archivo | Qué es |
|---|---|
| `src/features/professions/testing/overlayTrace.ts` | Utilidades: hash de arte, envoltorio de `toSprite`, contexto 2D que registra, reloj de escena con muestreo y estado final de la sesión |
| `src/features/professions/overlayTrace.test.ts` | Los 8 escenarios guionados |
| `src/features/professions/__snapshots__/overlayTrace.test.ts.snap` | El baseline (12.622 líneas, 460 KB) |
| `docs/economy/R31Z_OVERLAY_TRACE.md` | Este documento |

**Ningún archivo existente fue modificado**, ni siquiera temporalmente: `git diff --stat` contra la base solo muestra estos cuatro.

## 2. Qué representa una traza

Una traza es **una acción guionada, muestreada como la vería el renderer**. Por muestra:

- `decor()` del tile del nodo: `kind@tx,ty dx=… dy=… art=<hash>`, o ausente si el overlay no lo reemplaza;
- `ground()`: las llamadas al contexto 2D que describen lo que se ve (`ellipse`, `arc`, `fillRect`, `fillStyle`, `strokeStyle`, `lineWidth`, `globalAlpha`, `drawImage` con el hash del arte);
- `sprites()`: una línea por sprite — `wx,wy lift= a= s= z= art=`;
- `labels()`: una línea por cartel — `wx,wy lift= a= color "texto"`;
- `phase` del controlador y `locked` del puerto del juego.

Al final de cada escenario se registra el estado de la sesión demo: inventario, pendientes, XP por profesión, energía, durabilidad de las cuatro herramientas y cargas restantes del nodo.

**Orden por muestra:** `ground` → `decor` → `sprites` → `labels`. `ground()` se llama en **todos** los pasos (es lo que hace avanzar el reloj del overlay); solo el paso muestreado se escribe.

## 3. Escenarios

| Clave del snapshot | Qué ejecuta |
|---|---|
| `mining · stone_outcrop · double tap` | Una acción completa **y un segundo toque mientras pica**: queda congelado que el segundo devuelve `false` y no altera la escena |
| `logging · common_tree · felled and depleted` | Las 6 cargas del árbol: primer hachazo y **último** (con la caída) muestreados, los intermedios solo avanzan el reloj, más el estado agotado |
| `forage · berry_bush · bare hands` | Recolección **sin hoz** (se desequipa con `equipDemoTool(state, 'sickle', null)`): gesto a mano |
| `forage · berry_bush · sickle` | La misma planta con la hoz del estado demo inicial: el dominio la usa y la gasta |
| `fishing · shore_spot · reel in the window` | Lanzamiento real desde la orilla, espera del pique y recogida **dentro** de la ventana |
| `fishing · shore_spot · reel too early` | Lanzamiento real y recogida **antes** del pique |
| `alchemy · brew_potion · batch 1` | Processing, lote 1, en su propio `describe` |
| `alchemy · brew_potion · batch 3` | Processing, lote 3 |

**La pesca ejecuta de verdad.** El error del arnés anterior (`cast()` rechazado porque el jugador no estaba en la orilla) está cubierto con dos aserciones explícitas: `cast()` debe devolver `true` y la fase debe pasar a `casting`; en el escenario A además se exige que el pique llegue (`biting === true`) antes de recoger, y en el B que **no** haya pique todavía. Si alguna dejara de cumplirse, el test falla en vez de pasar vacío.

**Qué no cubre, y por qué**

- **Herramienta rota, reparación, inventario lleno, pendientes, respawn, cambio de objetivo y toques repetidos en las otras profesiones:** ya los cubre `professionsStress.test.ts`, que es una red de *comportamiento*. Esta es una red de *salida visual*; duplicarlos multiplicaría el snapshot sin agregar señal.
- **Parche de hierbas, arboleda y flor de escarcha:** el escaneo de terreno y los nodos bloqueados por nivel/acceso no cambian la forma de la traza; el arbusto ya ejerce el camino de forage completo (mano y hoz).
- **Pokémon trabajador:** deliberadamente `null` en las cuatro profesiones. Invocarlo carga hojas de sprites del overworld, que es I/O y ruido; su presencia es un sprite más y su posición ya está cubierta por `overworld/workerPresence.test.ts`.
- **Renderer, cámara y proyección:** fuera del contrato de `SceneOverlay`.

## 4. El mock de `toSprite`

```ts
vi.mock('./art/pixelArt', async importOriginal => {
  const actual = await importOriginal<typeof import('./art/pixelArt')>()
  const trace = await import('./testing/overlayTrace')
  return { ...actual, toSprite: trace.traceSprite }
})
```

**Ruta real usada:** `'./art/pixelArt'`. Verificada contra el árbol: el test vive en `src/features/professions/overlayTrace.test.ts` y el módulo en `src/features/professions/art/pixelArt.ts`, así que la ruta relativa desde el test es `./art/pixelArt` (no `../art/pixelArt`, que sería la de los overlays). El factory es *hoisted*, por eso importa el registro con `await import(...)` en vez de referenciar un binding de arriba.

**Cómo se comprueba que intercepta de verdad:** `traceSprite` cuenta cada llamada y **cada escenario** termina con

```ts
expect(spriteInterceptions(), 'toSprite wrapper never ran: the art hashes would be null').toBeGreaterThan(0)
```

con el contador reseteado en cada `beforeEach`. Si el mock dejara de aplicarse, los `art=` del snapshot pasarían a `none` **y** esa aserción fallaría: el test no puede pasar en verde sin interceptar.

## 5. Determinismo

| Fuente | Cómo se controla |
|---|---|
| **Reloj de escena** | Propio, paso fijo `1/30 s`, muestreo cada `50 ms`. Nunca se usa `performance.now()` ni el reloj del runner |
| **Tiempo global** | `vi.useFakeTimers()` + `vi.setSystemTime(2026-01-01T12:00:00Z)` en `beforeEach`; `vi.useRealTimers()` y `vi.restoreAllMocks()` en `afterEach`. La sesión demo sella su estado con `Date.now()` (energía, respawn, semilla), así que sin esto el snapshot cambiaría en cada corrida |
| **Aleatoriedad** | Las partículas usan `createSeededRandom` con semilla fija por overlay (código de producción, no se toca); el dominio usa `state.rngSeed`, determinista desde el estado inicial |
| **Mundo** | `World(PRADERA_SEED)` y los tiles de `PRADERA_LANDMARKS`; se verifica con un `expect` que `nodeAt` devuelve el nodo esperado en cada tile |
| **Decor** | `DecorInstance` construido con el `kind` real de `world.decorAt(tx, ty)`. La `x` se usa sin el jitter por prop del chunk, para que el baseline no dependa de ese detalle |
| **Canvas** | Ninguno: `toSprite` está envuelto y `ground()` recibe un contexto que registra. La pesca además recibe un `getContext` stub por si alguna ruta intentara rasterizar |
| **Trabajador** | `setDemoWorker(..., null)` en las cuatro profesiones |
| **Números** | Todo redondeado a 2 decimales al serializar |

**No determinismo encontrado:** ninguno. Tres corridas seguidas y una con `--sequence.shuffle` dan el mismo archivo (mismo md5). Nada que reportar ni, por tanto, nada que "arreglar" en producción.

## 6. Cómo leer un diff

El formato es JSON indentado con **una línea por sprite, por llamada y por cartel**, justamente para que el diff sea legible. Ejemplos:

- **`lift=7` → `lift=8` en una línea:** cambió la altura de ese sprite. Si el refactor no tocó alturas, es una regresión.
- **Desaparece una línea de `sprites`:** el overlay dejó de emitir ese sprite en ese instante (una partícula, el marcador, la herramienta).
- **Aparece o desaparece la clave `labels` / `ground` / `decor` en un frame:** el hook pasó a producir (o dejó de producir) algo. Las claves vacías se omiten a propósito, para que eso salte.
- **Cambia `art=<hash>`:** cambió el arte dibujado (otro estado del nodo, otro cuadro, otra paleta). Legítimo si el refactor cambió arte a propósito; regresión si no.
- **Cambia `phase` o `locked`:** cambió la máquina de estados del controlador o el bloqueo de input.
- **Cambian los `atMs` de todo el bloque:** cambió el ritmo (timeline). Sospechoso salvo que el cambio sea deliberado.
- **`{ "repeat": N }`:** N muestras idénticas a la anterior. Si en el nuevo aparece una serie donde antes había un `repeat`, la escena dejó de estar quieta.
- **`{ "skippedMs": N, "note": … }`:** tramo que corrió sin muestrear (los hachazos intermedios, la espera del pique). Si cambia su duración, cambió cuánto tardó la acción.

**Ruido esperado:** ninguno hoy. Si un cambio de arte legítimo mueve muchos hashes a la vez, conviene verificarlo con el kit de assets y decirlo en el PR.

## 7. Cómo regenerar

```bash
npx vitest run -u src/features/professions/overlayTrace.test.ts
```

**Este comando borra la evidencia**: solo debe usarse con aprobación explícita de la estación principal y explicando en el PR qué diferencia se aceptó y por qué. Para *comparar* sin regenerar, basta `npx vitest run src/features/professions/overlayTrace.test.ts`.

## 8. Verificaciones ejecutadas

| Check | Comando | Resultado |
|---|---|---|
| Suite en la base, antes de tocar nada | `npx vitest run` | **85 archivos / 705 tests** verdes |
| 1ª corrida | `npx vitest run src/features/professions/overlayTrace.test.ts` | 8 tests verdes · **8 snapshots escritos** · md5 `f000cd4dc0dce1c39c29461c72d4218a` |
| 2ª corrida | ídem | 8 verdes · **sin línea de Snapshots** (0 escritos, 0 actualizados) · mismo md5 |
| 3ª corrida | ídem | 8 verdes · 0 escritos / 0 actualizados · mismo md5 |
| Orden aleatorio | `npx vitest run src/features/professions --sequence.shuffle` | **28 archivos / 314 tests** verdes · snapshot intacto (mismo md5) |
| Suite completa | `npx vitest run` | **86 archivos / 713 tests** verdes (705 de la base + 8 nuevos) · snapshot intacto |
| Typecheck | `npm run typecheck` (`vue-tsc --noEmit -p tsconfig.app.json`) | **exit 0** |
| Lint | `npx eslint .` | **0 errores**; 9 warnings preexistentes de `vue/attributes-order` en `AuthModal.vue`, anteriores a este trabajo |
| Build | `npm run build` | OK |
| Aislamiento | `grep -rao "overlayTrace" dist \| wc -l` | **0** |

## 9. Prueba de detección de regresiones

**Perturbación** (solo en el archivo nuevo `testing/overlayTrace.ts`, nunca en producción): sumar 1 al `lift` al serializar un sprite.

```diff
-  return `${round2(sprite.wx)},${round2(sprite.wy)} lift=${round2(sprite.lift ?? 0)}`
+  return `${round2(sprite.wx)},${round2(sprite.wy)} lift=${round2((sprite.lift ?? 0) + 1)}`
```

**Resultado** de `npx vitest run src/features/professions/overlayTrace.test.ts` (sin `-u`): **exit 1, los 8 snapshots en mismatch.** Fragmento del diff:

```
 FAIL  overlay trace · mining > stone_outcrop · one action and a second tap during it
 Error: Snapshot `… > mining · stone_outcrop · double tap 1` mismatched

 - Expected
 + Received

 @@ -118,11 +118,11 @@
          "atMs": 267,
          "decor": "rock@-5,-77 dx=0 dy=0 art=ad3465bf",
          "locked": true,
          "phase": "mining",
          "sprites": [
 -         "-76,-1202 lift=7 a=1 s=1 z=-0.6 art=ce7d847f",
 +         "-76,-1202 lift=8 a=1 s=1 z=-0.6 art=ce7d847f",
          ],
        },
```

Un cambio de un píxel en una sola magnitud aparece como **una línea** del diff, con su instante, su fase y su hash de arte al lado.

**Restauración:** `git restore src/features/professions/testing/overlayTrace.ts` → `git status --short` limpio → el test vuelve a pasar **sin escribir ni actualizar snapshots** (mismo md5 `f000cd4d…`). La perturbación no quedó en ningún commit y el snapshot nunca se regeneró durante la prueba.

## 10. Limitaciones y notas para la estación principal

1. **Tamaño:** 12.622 líneas. El grueso son las partículas, que se mueven en cada muestra y **son** salida observable: recortarlas debilitaría la red. Ya se aplican tres reducciones — una línea por registro, claves vacías omitidas y colapso de muestras idénticas (`repeat`) — y los hachazos intermedios del árbol y la espera del pique corren sin muestrear (`skippedMs`), con el primero y el último hachazo sí muestreados.
2. **El baseline fija el comportamiento actual, incluido lo discutible.** Por ejemplo, la hoz opcional (F-3) aparece en la traza de forage con hoz: si esa decisión de economía cambia, ese snapshot **debe** cambiar. Un mismatch no es automáticamente un bug.
3. **`decor()` se prueba con el tile del nodo.** El renderer llama al hook para cada prop visible; la traza usa el del nodo (y el jitter de `x` del chunk no se reproduce). Si el refactor cambia *qué props* reclama un overlay, esta red no lo verá: eso lo cubren los tests por profesión (`mining/`, `logging/`, `forage/`, `fishing/`, `alchemy/`).
4. **El parche de hierbas dibuja desde `sprites()`, no desde `decor()`.** Si el refactor unifica ese camino, conviene agregar un escenario de `herb_patch` al baseline **antes** de tocarlo.
5. **Tiempo congelado:** con `setSystemTime` fijo no hay regeneración de energía por paso del tiempo real. Los escenarios largos (el árbol completo) gastan energía solo por las acciones, que es justo lo que se quiere medir.
6. **Sin bloqueos.** No hizo falta modificar ningún archivo existente ni apareció ninguna dependencia arquitectónica inesperada.

---

# T-S1.1 — Revisión de fidelidad y cobertura

> Todo lo anterior (§1–§10) es el registro de **T-S1** y se conserva como quedó.
> **Base contractual nueva:** `c4ad6bec3c2d67bc25a5e28ddf9e63367a0b4e26` (`origin/integration/r31`, ya con T-S1 integrada).
> **Rama:** `test/r31z-overlay-trace-fidelity` — commits `153617b` (fidelidad) y `9eaf283` (cobertura), más este documento. **No mergeada, sin PR.**
> **Suite en la base, antes de tocar nada:** 86 archivos / 713 tests verdes (verificado).
> **Snapshot regenerado por corrección del harness; producción sin cambios.**

## 11. Los tres defectos que encontró la estación principal

1. **Cadencia.** T-S1 llamaba `decor()`, `sprites()` y `labels()` **solo en los frames que iba a guardar**. Varios hooks arrastran estado entre frames, así que la traza registraba una escena que no ocurre en el juego.
2. **Phase interna.** El snapshot guardaba `mining`, `chopping`, `gathering`, `casting`, `brewing`. El refactor puede renombrarlos sin mover un píxel, y eso habría producido un diff masivo y falso.
3. **Estilos del contexto 2D.** El recorder anotaba las asignaciones (`fillStyle=…`, `lineWidth=…`) en orden de asignación. Reordenar dos escrituras que pintan lo mismo aparecía como un cambio.

Los tres están corregidos **sin tocar producción**: el diff contra la base solo contiene los cuatro archivos permitidos.

## 12. Cadencia real del renderer (verificada en el código)

`src/features/wildlands/engine/renderer.ts`, dentro de `render(scene, dt)`, que corre una vez por frame desde el bucle de `game.ts` (`requestAnimationFrame`):

| Orden | Hook | Dónde | Cuántas veces por frame |
|---|---|---|---|
| 1 | `ground(g, area, x0, y0, seconds)` | `composeGround()`, línea 198 — sobre el buffer de suelo, después del agua, la grilla, los pads y la ruta | 1 |
| 2 | `decor(d, area, seconds)` | `collect()`, línea 247 — dentro del bucle `for (const d of scene.area.decorIn(x0, y0, x1, y1))` | **una vez por prop visible** |
| 3 | `sprites(area, seconds)` | `collect()`, línea 258 — justo después del bucle de decor | 1 |
| 4 | `labels(area, seconds)` | `drawSprites()`, línea 363 — al final, tras dibujar props, actores y nameplates | 1 |

Es decir **ground → decor(×N) → sprites → labels, los cuatro en todos los frames**. El orden que T-S1 documentaba era correcto; lo que estaba mal era que tres de los cuatro solo corrían al muestrear.

**Ejemplo confirmado del daño.** `miningOverlay.ground()` (y sus gemelos de tala y forage) hace `this.previous = this.visible; this.visible = new Map()` y dibuja el anillo de selección recorriendo `previous`. Quien llena `visible` es `decor()` (y `sprites()` para el parche de hierbas). Con muestreo cada 50 ms sobre pasos de 33,3 ms, dos frames muestreados casi nunca son consecutivos, así que `previous` llegaba vacío y **el anillo no aparecía nunca**. Hoy el mismo instante del snapshot de minería trae sus dos líneas:

```
"fill [ellipse(-72 -1222 10.58 6.35 0 0 6.28)] fill=rgba(255, 210, 122, 0.16) alpha=1",
"stroke [ellipse(-72 -1222 10.58 6.35 0 0 6.28)] stroke=#ffd27a lw=1.5 alpha=1",
```

## 13. Cómo se corrigió el runner

`SceneTrace.step()` ejecuta ahora los cuatro hooks en el orden del renderer **en cada paso de 1/30 s**, y la decisión de muestrear se toma **después**, justo antes de serializar. Las dos cadencias quedaron separadas:

- **frame normal no muestreado:** corren los hooks, sus efectos quedan, la representación se descarta;
- **frame muestreado:** el mismo pipeline, y la representación se conserva;
- **tramo con `sample: false`:** idéntico — los hooks corren en todos los frames — y el tramo entero se resume en una línea `{ skippedMs, note }`.

El reloj sigue en `1/30 s` y la captura en `50 ms`.

`SceneTrace` expone `hookRuns` (`{ frames, ground, decor, sprites, labels }`) y `spriteRunTimes`, que son lo que asertan los tests nuevos: que ningún hook corra menos veces que los frames, y que entre dos muestras guardadas separadas por más de un frame haya corrido cada hook.

## 14. Estado observable: tabla phase interna → estado serializado

La normalización vive en `observableState()` dentro de `testing/overlayTrace.ts`. La señal extra (`window`) la aporta el test leyendo `fishing.biting.value` vía `syncBite()`, sin tocar el controller.

| Profesión | Phase interna | Estado serializado |
|---|---|---|
| Minería | `idle` → `mining` → `result` | `idle` → `active` → `resolved` |
| Tala | `idle` → `chopping` → `result` | `idle` → `active` → `resolved` |
| Forage | `idle` → `gathering` → `result` | `idle` → `active` → `resolved` |
| Pesca | `idle` → `casting` (sin pique) | `idle` → `active` |
| Pesca | `casting` **con `biting === true`** | `window` |
| Pesca | `result` | `resolved` |
| Alquimia | `idle` → `brewing` → `result` | `idle` → `active` → `resolved` |

La regla es deliberadamente tolerante: `idle`/`none`/`closed` → `idle`, `result`/`resolved`/`reward`/`done` → `resolved`, **cualquier otro nombre** → `active` (o `window` si la señal está abierta). Renombrar la fase ocupada no mueve el snapshot, que es el objetivo. Renombrar `idle` o `result` a algo fuera de esas listas sí lo movería; está documentado aquí a propósito.

El campo del frame se llama ahora `state` (antes `phase`), el estado final de la sesión pasó a la clave `session` para no chocar con él, y los marcadores de guion son `{ atMs, mark }` — describen el test (`"mine() → true"`), no la implementación.

## 15. El recorder de operaciones efectivas

`beginPath`, `moveTo`, `lineTo`, `rect`, `ellipse`, `arc`, `closePath` y las curvas **solo acumulan camino**. `fillStyle`, `strokeStyle`, `lineWidth`, `globalAlpha`, `lineCap`, `lineJoin`, `globalCompositeOperation` y las transformaciones (`translate`/`scale`/`rotate`/`setTransform`) **solo cambian estado**, y `save()`/`restore()` lo apilan y lo restauran. Nada de eso escribe una línea.

Escriben línea únicamente `fill`, `stroke`, `fillRect`, `strokeRect`, `clearRect` y `drawImage`, y cada una lleva el camino acumulado y el **estilo efectivo** en ese momento:

```
fill [ellipse(-72 -1222 10.58 6.35 0 0 6.28)] fill=rgba(255, 210, 122, 0.16) alpha=1
stroke [move(0 0) line(4 3)] stroke=#a4e27c lw=1.5 alpha=0.5
drawImage art=ce7d847f [12 -4] alpha=1
```

Un `xf=[…]` aparece solo si la matriz no es la identidad, y `op=…` solo si el modo de composición no es `source-over`; ningún `ground()` de las cinco profesiones los usa hoy, y así un refactor que los introduzca se vería en el diff en vez de perderse. Los degradados se serializan por su definición y sus paradas.

El test `records the drawing, not the style assignments that led to it` demuestra la propiedad: un guion con dos `fillStyle` y un `lineWidth` que nunca llega a un trazo produce **exactamente la misma línea** que el guion mínimo equivalente.

## 16. `herb_patch`

Arquitectónicamente distinto: está anclado a `tallGrass`, así que **no tiene prop** y `decor()` nunca lo ve; aparece desde `sprites()`, que rescanea una ventana de 27×27 tiles alrededor del jugador cada 0,3 s (`PATCH_RADIUS = 13`, `PATCH_SCAN_SECONDS = 0.3` en `forageOverlay.ts`).

Escenario `forage · herb_patch · scan and gather`, con el jugador en `(-19, -67)`, junto al parche de `PRADERA_LANDMARKS` en `(-19, -68)`. Se verifica explícitamente, antes de snapshottear:

- que `nodeAt` devuelve ese nodo y que su `definitionId` es `herb_patch`;
- que **no hay prop**: `decorProbe(-19, -68)` devuelve lista vacía, así que no se inventa ningún `DecorProbe`;
- que el camino real lo detecta: se dejan correr 0,4 s de escena (más de un intervalo de scan) con los hooks corriendo cada frame y se exige que alguna línea de `sprites` empiece en `-296,-1073`, que es el centro-inferior del tile del parche.

Cubre aparición, estado ready, la acción y su resultado visual. La acción dura 13 s de catálogo: el primer segundo y el final están muestreados y el medio corre sin muestrear (`skippedMs`), con los hooks igualmente activos.

## 17. Worker Pokémon

Dos caminos distintos, un escenario cada uno; en ambos la especie es la que el demo ya trae (`START_WORKERS` en `demoSession.ts`), así que no entra ninguna variable nueva.

| Escenario | Especie | Sitio |
|---|---|---|
| `mining · stone_outcrop · worker` | **Machamp (68)** | junto a un nodo de Gathering |
| `alchemy · brew_potion · worker` | **Blissey (242)** | junto a la **estación**, no a un nodo |

La posición la decide `workerSpot()` (`overworld/workerPresence.ts`) desde el `summonWorker` de cada overlay. En minería el jugador trabaja el tile de arriba, así que el worker cae en `(-4, -76)` — al lado del jugador `(-5, -76)`, nunca en el nodo `(-5, -77)` — y conserva el facing `up` por el desempate diagonal. Los tests asertan las cuatro cosas: que apareció, que queda a un tile del jugador, que evita el tile del nodo (o del banco) y el del jugador, y que **no cambia de tile durante toda la acción**. La desaparición queda congelada tal como es hoy: `WorkerCompanion.dismiss()` con su fundido y su ráfaga de destellos.

Blissey tiene afinidad con Alquimia y puede ahorrar insumos; ese comportamiento es determinista con el `rngSeed` fijo del demo y queda congelado como está, no juzgado.

**`spawnBeside` queda fuera de este baseline** por indicación de la estación principal: vive solo en los `*FieldLab.vue` del playground y coloca al jugador al abrir un laboratorio. Su extracción se verificará aparte.

## 18. Carga de sprites del worker y espera de promesas

El camino real es `new Image()` → `alphaOf` (`getImageData`) → `crop` (canvas + `drawImage`), que jsdom no puede recorrer: un worker podía estar activo y no dibujar nada. Stubear `Image` daría canvases sin `artHash`, y entonces "apareció el worker" no sería verificable.

Por eso se reemplaza **solo `loadOverworldFrames`**, con `vi.mock` e `importOriginal` sobre `'../wildlands/engine/characters'` (ruta comprobada contra el árbol: el test está en `src/features/professions/`, el módulo en `src/features/wildlands/engine/`). Los frames son `PixelArt` sintéticos de 8×8, uno distinto por **(especie, dirección, índice)**, acuñados con `traceSprite` — el mismo registro que todo lo demás — así que cada frame del worker tiene su propio hash y el aserto es por hash, no por presencia genérica.

El mock vive en `overlayTrace.test.ts`, no en `testing/overlayTrace.ts`: `professionsIsolation.test.ts` no permite que un archivo no-test de esa capa importe módulos del motor salvo `world` y `noise`. El estado compartido con la factoría hoisted se pasa con `vi.hoisted`.

**Promesas.** `WorkerCompanion.summon` asigna los frames dentro de un `.then`, y el runner es síncrono. Los dos escenarios con worker son `async` y hacen, en este orden: la acción (`mine()` / `brew()`) → **un** frame (`trace.run(STEP_SECONDS)`), que es donde `sprites()` llama a `summonWorker` → `await flushPromises()` (cuatro vueltas de `await Promise.resolve()`, suficientes para `load().catch().then()`) → el resto del reloj. `flushPromises` vive en `testing/overlayTrace.ts`.

Aserciones que impiden un test vacío: el loader mockeado debe haber sido llamado con esa especie (`workerFixtures.loaded`) **y** alguna línea de `sprites` debe terminar en el `art=` de uno de sus frames.

## 19. Escenarios finales (11 + 4 tests del harness)

| # | Clave del snapshot | Qué cubre |
|---|---|---|
| 1 | `mining · stone_outcrop · double tap` | Acción completa y segundo toque durante el picado |
| 2 | `logging · common_tree · felled and depleted` | Las 6 cargas, la caída y el tocón |
| 3 | `forage · berry_bush · bare hands` | Recolección sin hoz |
| 4 | `forage · berry_bush · sickle` | La misma planta con la hoz |
| 5 | `forage · herb_patch · scan and gather` | **Nuevo.** Terreno, scan 27×27, aparición y recolección |
| 6 | `fishing · shore_spot · reel in the window` | Lanzamiento real, pique y recogida dentro de la ventana |
| 7 | `fishing · shore_spot · reel too early` | Recogida antes del pique |
| 8 | `alchemy · brew_potion · batch 1` | Processing, lote 1 |
| 9 | `alchemy · brew_potion · batch 3` | Processing, lote 3 |
| 10 | `mining · stone_outcrop · worker` | **Nuevo.** Worker de Gathering (Machamp) |
| 11 | `alchemy · brew_potion · worker` | **Nuevo.** Worker de Processing (Blissey) |

Además, cuatro tests sin snapshot que protegen el propio harness: hooks en frames no serializados; hooks durante un tramo `sample: false`; recorder indiferente a asignaciones redundantes; y ningún nombre interno de phase en lo serializado.

## 20. Tamaño del snapshot

| | Líneas | Tamaño |
|---|---|---|
| T-S1 | 12.622 | 460 KB |
| T-S1.1 | **14.665** | **564 KB** |

**+2.043 líneas (+16 %)**, por tres causas, en orden de peso: los tres escenarios nuevos, el anillo de selección que ahora sí aparece en cada frame de minería, tala y forage (dos líneas por muestra donde antes no había ninguna), y en sentido contrario una reducción: una operación efectiva por línea reemplaza a las tres o cuatro líneas de asignación de estilo que T-S1 escribía por dibujo.

## 21. Verificaciones ejecutadas

| Check | Comando | Resultado |
|---|---|---|
| Suite en la base | `npx vitest run` | **86 archivos / 713 tests** verdes |
| Regeneración autorizada | `npx vitest run -u …/overlayTrace.test.ts` | 15 tests verdes, 11 snapshots |
| Corrida 1 | `npx vitest run …/overlayTrace.test.ts` | 15 verdes · **sin línea de Snapshots** · md5 `334b1e04eb1e40f528f313573d4ac618` |
| Corrida 2 | ídem | 15 verdes · 0 escritos / 0 actualizados · mismo md5 |
| Corrida 3 | ídem | 15 verdes · 0 escritos / 0 actualizados · mismo md5 |
| Shuffle aleatorio | `npx vitest run src/features/professions --sequence.shuffle` | **28 archivos / 321 tests** verdes · mismo md5 |
| Shuffle con semilla | `… --sequence.shuffle --sequence.seed=424242` | **28 / 321** verdes · mismo md5 |
| Suite completa | `npx vitest run` | **86 archivos / 720 tests** verdes (713 + 7 nuevos) |
| Typecheck | `npm run typecheck` | **exit 0** |
| Lint | `npx eslint .` | **0 errores**; 9 warnings preexistentes de `vue/attributes-order` en `AuthModal.vue` |
| Build | `npm run build` | OK |
| Aislamiento | `grep -rao <needle> dist` para `overlayTrace`, `traceSprite`, `recordingContext`, `SceneTrace`, `observableState`, `workerFixtures`, `flushPromises` | **0** en los siete |
| Git en Windows | `git status --short` tras volver a correr el test | limpio; el `.gitattributes` de la base mantiene el `.snap` en LF |

## 22. Prueba de localidad

Perturbación temporal **solo** en `testing/overlayTrace.ts`, acotada a un escenario mediante `TraceHost.label` (campo que no se serializa): sumar 1 al `lift` de cada sprite cuando la etiqueta empieza por `mining`.

Resultado de `npx vitest run …/overlayTrace.test.ts` sin `-u`: **2 fallos de 15**, y son exactamente los dos de minería — el de doble toque y el del worker, que comparten el prefijo de etiqueta. Los otros nueve escenarios y los cuatro tests del harness quedaron **verdes**.

```
@@ -117,11 +117,11 @@
         "fill [ellipse(-72 -1222 10.58 6.35 0 0 6.28)] fill=rgba(255, 210, 122, 0.16) alpha=1",
         "stroke [ellipse(-72 -1222 10.58 6.35 0 0 6.28)] stroke=#ffd27a lw=1.5 alpha=1",
       ],
       "locked": true,
       "sprites": [
-        "-76,-1202 lift=7 a=1 s=1 z=-0.6 art=ce7d847f",
+        "-76,-1202 lift=8 a=1 s=1 z=-0.6 art=ce7d847f",
       ],
       "state": "active",
     },
```

**Restauración:** `git restore src/features/professions/testing/overlayTrace.ts` → `git status --short` limpio → 15 tests verdes **sin escribir ni actualizar snapshots** (mismo md5 `334b1e04…`). La perturbación no quedó en ningún commit y el snapshot no se regeneró durante la prueba.

## 23. Limitaciones que siguen abiertas

1. **`spawnBeside` queda fuera del baseline**, por indicación de la estación principal (§17).
2. **`decor()` se sigue probando con el tile del nodo**, no con todos los props visibles del chunk, y sin el jitter de `x`. Si el refactor cambia *qué* props reclama un overlay, esta red no lo verá.
3. **El baseline congela decisiones discutibles**, como la hoz opcional (F-3). Un mismatch no es automáticamente un bug.
4. **`observableState` es tolerante con la fase ocupada pero no con `idle`/`result`** (§14): renombrar esas dos fuera de las listas conocidas sí movería el snapshot.
5. **El recorder no aplica la matriz a los puntos del camino**; la anota aparte (`xf=`). Alcanza para detectar un cambio, no para leer coordenadas ya transformadas. Ningún `ground()` la usa hoy.
6. **La lectura del pique se hace en el frame muestreado**, no en el intervalo de `BITE_POLL_MS` con el que la vista real refresca la tarjeta. Es una lectura observable y pura (`syncBite()` solo copia `overlay.biting`), pero no reproduce esa cadencia de UI.
7. **El worker se prueba con dos especies**, no con todas, y con hojas sintéticas: la red cubre la posición, la presencia y el ciclo de vida, no el recorte real de la hoja.
8. **Sin bloqueos.** No hizo falta modificar ningún archivo de producción ni apareció ninguna dependencia arquitectónica inesperada.
