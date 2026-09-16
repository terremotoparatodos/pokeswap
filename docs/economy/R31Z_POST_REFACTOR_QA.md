# T-S2 — Post-Refactor Profession QA

> **Base contractual:** `15075df4dae0137f190ceadb57ead463e70b95c6` (`origin/integration/r31`, Bloque A del refactor).
> **Rama:** `qa/r31z-post-refactor`. **No mergeada, sin PR.** Esta rama no modifica producción: solo agrega este documento.
> **Estado pre-refactor de referencia:** `f2c615e578bf2725d957c15d211ff311382a9a63`.
> **Veredicto:** ninguna regresión encontrada. Ver §12 para el alcance real de la revisión manual, que quedó **incompleto** y es la salvedad principal de este informe.

## 1. Base verificada antes de tocar nada

| Check | Resultado |
|---|---|
| `git log -1 --format=%H` | `15075df4dae0137f190ceadb57ead463e70b95c6` ✔ |
| `npm ci` | OK |
| `npx vitest run` | **88 archivos / 727 tests** verdes ✔ (coincide con lo esperado) |
| `npm run typecheck` | exit 0 ✔ |
| `git status --short` | limpio ✔ |

## 2. Primera parte — automática

| Check | Resultado |
|---|---|
| `npx vitest run src/features/professions/overlayTrace.test.ts` (sin `-u`) | **15 tests verdes**, sin línea de `Snapshots` → 0 escritos, 0 actualizados |
| md5 de `__snapshots__/overlayTrace.test.ts.snap` | `334b1e04eb1e40f528f313573d4ac618` — **idéntico al baseline esperado** |
| `professionsStress.test.ts` | 19 tests verdes |
| `domain/hostileInputs.test.ts` | 49 tests verdes |
| `src/features/professions --sequence.shuffle` | 30 archivos / 328 tests verdes |
| `… --sequence.shuffle --sequence.seed=424242` | 30 archivos / 328 tests verdes |
| `git status --short` tras las corridas | limpio |

**Por qué esto importa más de lo que parece.** El baseline de T-S1.1 registra, cuadro a cuadro y con la cadencia real del renderer, lo que las cinco overlays entregan: el anillo de selección, cada sprite con su posición, altura, alfa, escala y hash de arte, cada cartel con su color y su texto, cada operación de dibujo sobre el suelo, y el estado final de la sesión (inventario, XP, energía, durabilidad, cargas). Que el md5 no se haya movido un byte significa que **la salida observable de Minería, Tala, Forage, Pesca y Alquimia es exactamente la misma que la aprobada antes del refactor**, incluidos los once escenarios guionados: doble toque en minería, las seis cargas del árbol con su caída y su tocón, forage a mano y con hoz, `herb_patch` con su scan de terreno, pesca dentro y fuera de la ventana de pique, alquimia lote 1 y lote 3, y los dos caminos del worker (junto a un nodo y junto a la estación).

Eso cubre de forma objetiva varias de las cosas que el brief pedía mirar: reward pop desplazado, worker en tile incorrecto, acción que termina un frame antes o después, anillo ausente o parpadeante, burbuja de proximidad y destello de prospección fuera de lugar. Ninguna se movió.

## 3. Navegador sirviendo código nuevo (caché de Vite limpia)

1. No había ningún proceso `vite` corriendo (`tasklist` sin coincidencias).
2. `rm -rf node_modules/.vite` ejecutado; se verificó que el directorio no existía después.
3. `.env.local` con placeholders creado; `git check-ignore -v .env.local` → `.gitignore:4:*.local`, así que **no es commiteable**.
4. Dev server levantado de cero en `http://localhost:5200`.
5. Confirmación de que se sirve el código nuevo — hecha por HTTP contra el propio servidor, que es más fuerte que mirar DevTools → Sources:

```
GET /features/professions/overworld/gatheringOverlayCore.ts  → 200, 36.048 bytes (transformado por Vite)
GET /features/professions/overworld/gatheringController.ts   → 200
```

El módulo empieza con los imports reales del core (`TILE`, `bubbleArt/glintArt`, `brighten/toSprite`, `inspectDemoNode`, `NODE_BY_ID`, `detectionRadius/nodeAt/worldNodePort`), así que es el archivo del refactor y no una versión cacheada.

## 4. Minería — **VISUALMENTE EQUIVALENTE**

Sesión completa en `/dev/profesiones` → Laboratorio minero, nodo `Afloramiento de piedra`, worker Machamp (68), pico de hierro T2.

| Paso | Observado |
|---|---|
| Encontrar / seleccionar | Toque sobre el tile del nodo abre `MiningActionCard` con encabezado «MINERÍA NV. 16 · REQUIERE 1» y título «Afloramiento de piedra» |
| Preparar | Estado «Listo para recolectar»; chips `×1–2`, `−9 energía`, `−1 durab.`, `+30 XP`; worker «Machamp · Extracción ●●●»; herramienta «En buen estado» con barra; «Ver detalle»; botones **Minar** / **Reparar** |
| Minar | Input se bloquea, el pico golpea, el worker **aparece junto al jugador** y desaparece al terminar |
| Segundo toque durante la acción | No reinicia ni duplica nada; la escena sigue igual (coincide con lo congelado en el baseline) |
| Recompensa | Card de resultado: «+1 Piedra», «+1 Carbón», «+45 XP Minería», «−9,03 energía», «−1 durabilidad»; botón pasa a **Seguir minando** |
| XP / energía / durabilidad | 6 acciones seguidas: energía 680 → 626 (6 × 9,03 ✔), durabilidad 110 → 104 (6 × 1 ✔), mochila 9/24 estable porque los drops apilan |
| Depleción | Tras la 6ª carga: «Agotado para vos · Se recupera en 0:28» y **Seguir minando deshabilitado** |
| Respawn | Al volver más tarde el nodo se puede trabajar de nuevo |
| Herramienta rota | Durabilidad 0 → «Tu pico está roto · Reparalo para seguir», chip «Rota · reparable» en rojo, **Minar** deshabilitado |
| Reparar sin materiales | Rechazo con motivo explícito: «Faltan materiales: 2 Lingote de Hierro, 2 Carbón» |
| Reparar con materiales | «Reparado · usaste 2 Lingote de Hierro, 2 Carbón»; durabilidad **138/138** (el máximo baja por el desgaste de reparación, como en R31); la card vuelve a «Listo para recolectar» y el botón Reparar desaparece |

Sin desbloqueos colgados: después de cada acción el jugador vuelve a caminar y a tocar normalmente.

## 5. Tala, Forage, `herb_patch`, Pesca, Alquimia — **NO VERIFICADO MANUALMENTE**

Los cuatro laboratorios **cargan, renderizan y conservan la sesión correctamente** (§7, §9, §10), pero **no pude completar el recorrido interactivo de cada nodo**. El motivo es del entorno, no del build, y está documentado en §12.

Para estas cuatro profesiones **no doy** un veredicto de «VISUALMENTE EQUIVALENTE» por inspección manual. Lo que sí está verificado para ellas, de forma objetiva, es:

- la **salida observable cuadro a cuadro es idéntica** al baseline aprobado (§2), incluido `herb_patch` con su scan de terreno y la última carga del árbol con su caída y su tocón;
- `professionsStress` (19) y `hostileInputs` (49) verdes;
- la revisión de código pre/post de §6, que no encontró deriva de comportamiento.

## 6. Revisión pre/post del refactor (lectura de código, `f2c615e` → `15075df`)

El diff toca 15 archivos: los cuatro módulos nuevos, sus dos tests, las tres overlays y los tres controllers migrados, Pesca y Alquimia adoptando la infraestructura menor, y el plan.

**`gatheringController.inspect/close/act` vs `useMiningController.inspect/close/mine` (pre):** línea por línea equivalentes, incluidas las guardas — «si estoy ocupado, un segundo toque devuelve `true` sin reiniciar», «si el jugador se alejó, `close()` y `false`», el `session.sync()` antes de releer el nodo, la comprobación `resolveNodeStatus(...) !== 'available' || !inspection.check.ok`, el orden `phase → outcome → setInputLocked(true) → overlay.start`, y el `onDone` que decide `result` vs `idle` según `outcome.value?.ok` y **siempre** desbloquea el input.

**`targetAt` (core) vs `targetAt` (mining pre):** idénticos salvo `ownsNode(node.id)` en lugar de `isMiningNodeId(node.id)`, que es el punto de extensión por profesión. La caché por `${area.id}:${tx}:${ty}` se mantiene.

**`RewardPops`:** conserva las constantes exactas de las implementaciones inline — deriva 14 px, desvanecido en el último 30 % (`t > 0.7 ? (1-t)/0.3 : 1`), espaciado 14 px entre stacks, stagger 0,12 s, XP con retardo 0,2 s / vida 1,3 / color `#ffd27a`, `depthBias: 2` para los iconos y el cartel del item desplazado `+12` en x y `+4` en lift. Alquimia **no** pasó a usar el camino con rareza: sigue empujando sus productos con su color propio `#ffe9c9`, stagger 0,1 y vida 1,4, y conserva el pop «Ahorró N» de `savedInputs`. Pesca sí usa `pushGathered` con `lift` base 18, que es el valor que tenía inline.

**`summonWorkerOnce`:** marca `summoned = true` antes de mirar la especie, igual que antes, así que un frame posterior no reintenta. La regla de posición sigue viviendo en `workerSpot`. El predicado de tile libre se tradujo correctamente: donde el código viejo pasaba `(tx, ty) => … && !this.targetAt(area, tx, ty)` (aprovechando que `null` es falsy), el nuevo pasa `openGround(area, (tx, ty) => this.targetAt(area, tx, ty) !== null)`, que da el mismo booleano.

**Tala fuera del core:** la caída en la acción que consume la última carga sigue siendo local a `loggingOverlay`. El único cambio en ese camino es el renombre de la variable `elapsed` → `elapsedMs`. El baseline congela ese escenario completo y no se movió, así que el *timing* de la caída y del tocón está probado idéntico.

**Alquimia no se convirtió en Gathering:** `AlchemyOverlay` conserva su propio ciclo (`brew`, `celebrate`, puffs, `stationAt`), no usa `gatheringOverlayCore` ni `gatheringController`, y solo comparte `RewardPops` y `summonWorkerOnce`. Pesca igual: mantiene su controller y su `ground()` que hornea sprites.

## 7. Cross-profession (sin recargar la página)

Recorrido continuo Minería → Pesca → Tala → Alquimia → Minería → Tala → Pesca → Alquimia, y luego un segundo recorrido en otro orden, **sin recargar**: en total ~18 saltos entre laboratorios.

- **Mochila compartida:** los materiales del kit de insumos y los drops de minería viajan entre labs (9/24 → 20/24 y se mantiene).
- **XP y niveles por profesión:** el HUD cambia correctamente de «Minería 16» a «Tala 9», «Alquimia 12», etc.
- **Herramientas:** cada lab muestra la suya (pico 138/138 en minería, hacha 40 en tala, hoz 15 en alquimia).
- **Workers:** cada lab trae el suyo (Machamp en minería, Bibarel en tala, Blissey en alquimia).
- **Overlays:** no quedó ninguna overlay fantasma; siempre hay **exactamente 1 canvas** en el DOM.
- **Input lock:** nunca quedó pegado; después de cada salto el jugador camina.

Una diferencia menor de UI, **preexistente y no del refactor**: el panel «CONTROLES» de la izquierda sigue mostrando «Profesión: Minería» y el selector de pico aunque el lab activo sea otro. Es el panel compartido del playground; cada lab usa sus propios controles de la derecha.

## 8. Tarjetas de acción

`MiningActionCard` revisada en detalle (§4): textos, iconos, chips de recompensa/energía/durabilidad/XP, worker con su rasgo, estado de la herramienta con barra, nivel requerido, estados deshabilitados (botón ocupado, herramienta rota), motivo de rechazo de la reparación y cantidades. Todo correcto y coherente con R31-C1.

`LoggingActionCard`, `ForageActionCard`, `FishingActionCard` y `AlchemyStationCard` **no se revisaron manualmente** por el motivo de §12. Ninguna fue tocada por el refactor; los datos que reciben provienen de `inspectDemoNode` y de `outcome`, que el core pasa sin transformar (§6), y el baseline congela lo que el dominio produce en cada escenario.

## 9. Desktop

Viewport de escritorio (1024×768 en el panel). Interacción por click, caminata, overlays y apertura/cierre de tarjetas correctas. **Cero errores de consola** durante toda la sesión: `read_console_messages` con `onlyErrors` no devolvió nada, y el contador propio terminó en `errors: 0`, `rejections: 0`.

## 10. 375 px

Viewport emulado 375×812:

- `document.documentElement.scrollWidth === window.innerWidth === 375` → **sin scroll horizontal**;
- el canvas mide 323 px dentro del viewport, con márgenes parejos;
- los chips «IR A» envuelven en dos filas sin recortarse;
- el HUD («Minería 16 · ⚡680 · ●138»), la píldora «Motor real · local» y «Mochila 20/24» quedan legibles y no se superponen;
- la tira de pestañas de laboratorios hace scroll horizontal propio, como está diseñada.

No se probó en un navegador móvil real.

## 11. Timers, listeners, canvas, performance gruesa

Instrumentación de sesión (envolviendo `setInterval`/`clearInterval`, `setTimeout`/`clearTimeout`, `addEventListener`/`removeEventListener` de `window` y `document`, más `window.onerror` y `unhandledrejection`). Medición al inicio, después de la sesión de minería y después de ~18 saltos entre laboratorios:

| Momento | canvases | intervals | timeouts | listeners netos | errores | heap |
|---|---|---|---|---|---|---|
| Inicio | 1 | 0 | 0 | solo los míos | 0 | 13 MB |
| Tras la sesión de minería | 1 | 0 | 0 | solo los míos | 0 | 13 MB |
| Tras 8 saltos | 1 | 1 | 0 | solo los míos | 0 | 15 MB |
| Tras 18 saltos | 1 | **0** | 0 | solo los míos | 0 | 15 MB |
| Final (viewport restaurado) | 1 | 0 | 0 | solo los míos | 0 | 13 MB |

**Sin fugas.** El único `setInterval` observado es el poll del pique de Pesca mientras su lab está montado, y se limpia al desmontarlo (por eso vuelve a 0). Ningún canvas queda vivo al cambiar de laboratorio, ningún listener de `window`/`document` queda sin remover, y el heap se mantiene plano entre 13 y 15 MB. La animación se vio fluida en todo momento; no se hizo medición de FPS instrumentada.

## 12. Limitación del alcance manual (importante)

**Qué pasó.** El playground se maneja tocando el mundo, y el motor resuelve el toque contra el **tile de suelo** bajo el cursor, no contra el sprite dibujado (`Renderer.pick` → `Game.tap` → `worldObjectBeside`, que además exige `|dx| + |dy| === 1` respecto del jugador). Con la cámara en perspectiva, el sprite de una roca o un árbol se dibuja bastante más arriba que el punto de suelo de su propio tile, así que apuntar «a la roca» cae sistemáticamente en el tile de atrás. En Minería conseguí la calibración correcta y ejecuté el recorrido completo; en Tala, Forage, Pesca y Alquimia la cámara, el zoom y la posición relativa del nodo cambian lab por lab y no logré una selección estable dentro de un presupuesto razonable de intentos.

Se intentó, sin éxito, las siguientes alternativas: teclado (`E` / `Espacio`), incluido un `KeyboardEvent` sintético sobre `window` — `KeyboardInput` no está adjunto en los field labs, que son solo de toque; y barrido sistemático de coordenadas usando los chips de depuración del lab de Alquimia («mesa en -9, -73 / jugador en -10, -72») como realimentación, que confirmó que el jugador camina pero no logró dejarlo ortogonalmente adyacente a la mesa.

**Qué NO significa.** No hay evidencia de que nada de esto sea un bug del refactor: es una dificultad de automatizar el apuntado, agravada por F-2. En Minería, con la calibración correcta, la selección funcionó siempre a la primera.

**Comparación pre/post en `f2c615e`: no probada en navegador.** Intenté el worktree paralelo que pide el brief (`git worktree add ../pokeswap-pre f2c615e…`). Su `npm ci` falla en esta ruta virtualizada de Windows (`spawnSync … ENOENT` dentro de npm), y copiando `node_modules` desde el repo principal el dev server tampoco arranca: Vite no puede lanzar `esbuild.exe` desde la copia (`Error: The service was stopped: spawn …\@esbuild\win32-x64\esbuild.exe ENOENT`), aunque el mismo binario corre a mano desde la shell. Es el mismo problema de virtualización ya documentado en fases anteriores de esta estación. **El worktree fue eliminado** (`git worktree remove --force`, verificado con `git worktree list`). La comparación pre/post quedó entonces resuelta por otras dos vías, que son objetivas: el **md5 idéntico del baseline de overlays** (§2) y la **lectura comparada del código** (§6).

## 13. Hallazgos

### P0
**Ninguno.**

### P1
**Ninguno.**

### P2
**Ninguno atribuible al refactor.** La única diferencia de UI anotada (el panel «CONTROLES» del playground que no sigue al lab activo, §7) ya existía y no forma parte del código refactorizado.

## 14. Preexistentes confirmados

| Id | Qué es | Estado | ¿Verificado en `f2c615e`? |
|---|---|---|---|
| **F-2** | El toque resuelve el tile de suelo bajo el cursor, no el sprite del prop; tocar «la roca» cae en el tile de atrás | **Igual, no empeoró.** Es el mismo `Renderer.pick` de R30, que el refactor no toca | **No probado en navegador** (§12). Verificado por código: el diff no toca `src/features/wildlands/**` |
| **F-1** | Mesa de Alquimia sin colisión | **Igual.** El lab deja al jugador a dos tiles de la mesa y hay que caminar | No probado en navegador; `stationPlacement` no está en el diff |
| **F-3** | Hoz opcional en forage | **Sin cambios**, como pide el brief: sigue siendo decisión económica pendiente | Congelado en el baseline, que no se movió |
| — | Scan de `herb_patch` dentro de `sprites()` (ventana 27×27 cada 0,3 s) | **Igual.** Sigue siendo específico de Forage y está cubierto por el escenario del baseline | Congelado en el baseline, que no se movió |
| — | Spawn autoritativo R30 | Fuera del alcance de este bloque; el diff no toca multiplayer ni presencia | n/a |
| — | `vue/attributes-order` ×9 en `AuthModal.vue` | Warnings de lint anteriores a R31 | n/a |

`spawnBeside` queda fuera de este QA por indicación previa de la estación principal.

## 15. Verificación final

| Check | Resultado |
|---|---|
| `npx vitest run` | **88 archivos / 727 tests** verdes |
| `npm run typecheck` | exit 0 |
| `npx eslint .` | 0 errores, 9 warnings preexistentes (`vue/attributes-order`, `AuthModal.vue`) |
| `npm run build` | OK |
| md5 del snapshot | `334b1e04eb1e40f528f313573d4ac618` (sin cambios) |
| `git status --short` | limpio |
| `git diff --name-status 15075df…` | vacío antes del commit de este documento |
| `git worktree list` | solo el repo principal; `../pokeswap-pre` eliminado |
| `.env.local` | ignorado por `*.local`, nunca staged |

Aislamiento en `dist` — `grep -rao -- "<needle>" dist | wc -l`:

| needle | resultado |
|---|---|
| `gatheringOverlayCore` | 0 |
| `gatheringController` | 0 |
| `RewardPops` | 0 |
| `summonWorkerOnce` | 0 |
| `overlayTrace` | 0 |
| `professionsStress` | 0 |
| `profesiones` | 0 |
| `FieldLab` | 0 |
| `demoSession` | 0 |

## 16. Recomendación

**APTO PARA R31-Z.1**, con una salvedad explícita.

Lo que respalda el apto: la salida observable de las cinco profesiones es byte a byte la misma que la aprobada antes del refactor; la suite completa, el stress, los hostile inputs y ambos shuffles pasan; la lectura comparada del código no encontró ninguna deriva de comportamiento en los cuatro módulos extraídos ni en los tres controllers migrados; Minería se recorrió entera a mano y se comportó igual que en R31-C1, incluidos los casos feos (segundo toque, agotamiento, herramienta rota, reparación sin materiales); y no hay fugas de canvas, timers ni listeners tras 18 saltos entre laboratorios, con cero errores de consola.

La salvedad: el recorrido manual de Tala, Forage, `herb_patch`, Pesca y Alquimia **no se completó** (§12), y la comparación visual lado a lado contra `f2c615e` **no se pudo montar** en esta máquina. Si la estación principal quiere el «VISUALMENTE EQUIVALENTE» firmado para esas cuatro profesiones antes de empezar R31-Z.1, esa pasada conviene hacerla en una PC donde el worktree pre-refactor levante, o con un atajo de dev en los field labs que permita seleccionar el nodo sin depender del apuntado sobre el canvas. No recomiendo bloquear R31-Z.1 por esto: no hay ni un indicio de regresión, solo cobertura manual faltante.
