# R31-Z / T-S1 — Overlay Trace Baseline

> **Base contractual:** `bb2aec06718753b84a322736f5835bd6b68fa968` (`origin/integration/r31`).
> **Rama:** `test/r31z-overlay-trace-baseline`. **No mergeada, sin PR.**
> **Para qué:** red de equivalencia del refactor gathering/processing ([plan §6.4](R31Z_CONSOLIDATION_PLAN.md)). Congela la salida observable **actual**; no juzga ni corrige comportamiento.
> **Suite en la base, antes de empezar:** 85 archivos / 705 tests verdes (verificado).

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
