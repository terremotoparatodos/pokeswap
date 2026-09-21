# PERF-00 — Playtest 0.1 performance baseline

Fecha de auditoría: 2026-09-20  
Rama: `playtest/community-0.1`  
Commit: `ae2845191071f69cdf3e6c97bc4145b9e5dec394`  
Alcance: diagnóstico read-only del código productivo. Este documento es el único archivo agregado.

## 1. Executive summary

El problema no es un único loop caro. Hay dos rutas críticas que se multiplican en la ciudad:

1. **Fan-out de presencia sin AOI en ciudad.** Cada paso aceptado se publica a todos los clientes de Ciudad Corazón. El coste total crece aproximadamente con el cuadrado de la cantidad de jugadores activos.
2. **Reconstrucción completa de actores remotos por cada delta.** El cliente convierte el delta de un jugador en un array completo y `WildlandsGame` recrea todos los actores remotos, sus acompañantes y sus cargas de arte. Esto destruye interpolaciones en curso, genera allocations y trabajo asíncrono masivo, y puede mostrar repetidamente el sprite fallback.

Esta combinación explica con confianza alta los tres síntomas más específicos del playtest: la ciudad empeora con densidad, los personajes remotos saltan y algunos cambian momentáneamente de apariencia/calidad.

Hay además un coste base importante del renderer: recompone y proyecta el suelo completo cada frame, una fila de canvas por cada fila de pantalla, incluso con cámara quieta. Los modelos 3D de ciudad agregaban rasterización CPU al mover la cámara. La rama actual ya contiene tres mitigaciones posteriores al playtest — DPR 1, NPCs de ciudad desactivados y modelos sustituidos por sprites en la build `VITE_PLAYTEST=on` —, pero son mitigaciones específicas del build, no una solución arquitectónica.

En WildLands existe culling visual y activación por chunks, pero no sleeping por cámara para todos los actores activos. La generación de un chunk es síncrona y costosa; además, cada uno conserva un canvas de 512×512 y cada mundo cacheado puede retener hasta 48 chunks indefinidamente mientras su store no supera ese umbral. Recorrer varios mundos puede acumular una huella de memoria grande.

### Veredicto

- **Causa primaria de ciudad multijugador:** pipeline de presencia `broadcast global → rebuild total del cliente`.
- **Causa primaria de ciudad sin red en la build normal:** rasterización CPU de modelos 3D al mover cámara, ya demostrada por mediciones previas.
- **Coste base compartido:** proyección por filas y composición completa del frame.
- **Causa probable de spikes en wild:** construcción síncrona de chunks y tareas discretas como minimapa/cambio de chunk.
- **No hay evidencia de que pathfinding, colisiones o IA sean hoy el cuello principal.** Tienen ineficiencias, pero su escala actual es menor y no correlaciona tan bien con los síntomas.

## 2. Arquitectura relevante

```text
teclado/tap
   ↓
WildlandsGame.update(dt)
   ├─ movimiento local + navegación
   ├─ companion
   ├─ Population.update + wander/advance
   ├─ advance de remotos
   ├─ cámara, clima y HUD
   ↓
WildlandsGame.scene()                 WebSocket Colyseus
   ├─ concatena actores                  ↓ snapshot/delta/self
   ├─ crea mapa de chat                  ColyseusPresence
   └─ crea snapshot de escena             ↓ setRemoteActors(array completo)
   ↓                                      WildlandsGame recrea actores
Renderer.render(scene)
   ├─ compone suelo visible
   ├─ proyecta el suelo fila por fila
   ├─ obtiene/culla/sortea decor y actores
   ├─ sombras + sprites/modelos
   └─ luz, clima, vignette y fade
   ↓
canvas 2D
```

El loop usa `requestAnimationFrame`. En primer plano intenta seguir el refresh del navegador; con panel abierto se limita aproximadamente a 10 FPS; con el documento oculto conserva el rAF pero omite simulación y render. Render, movimiento, población, animación, cámara y housekeeping de chunks comparten el mismo tick.

## 3. Evidencia obtenida

### Estado y ejecución

- Checkout limpio al iniciar la auditoría.
- Frontend: `npm run dev`, `npm run build`, `npm run test`, `npm run typecheck`, `npm run lint`.
- Build de playtest: variable `VITE_PLAYTEST=on`.
- Realtime: `services/realtime`, `npm start`, `npm test`, `npm run test:load`.
- Tests ejecutados: 49 archivos / 310 tests de WildLands y stress de profesiones, todos verdes; 41 tests del servicio realtime, todos verdes.
- Load preflight existente: 50 jugadores, join 2,14 ms, lote de movimientos 1,59 ms, 2.550 mensajes contados, cleanup completo. Este test mide ejecución síncrona del servidor; no mide bytes de red, parsing, render, GC ni frame pacing de los clientes.

### Medición local posible

Con dependencias reales pero endpoints ficticios, la build de desarrollo normal abrió Ciudad Corazón como espectador offline en un viewport de 1249×720. Cámara quieta: 60 FPS y ~2,1 ms/frame según el contador interno.

Limitaciones:

- no hubo sesión autenticada ni dos sockets reales;
- no se pudo mover el actor local en modo espectador;
- el contador es un EWMA de CPU de `update + render`, no mide 1% lows, GPU, presentación, latencia de input ni red;
- el navegador integrado no expuso el Performance API en su contexto de evaluación;
- por lo tanto este dato sólo demuestra que **la ciudad quieta y sin tráfico no reproduce el fallo**.

La documentación pre-R34 contiene una medición anterior, en desarrollo, con modelos 3D habilitados:

| Escenario previo | frameMs promedio | máximo |
|---|---:|---:|
| Desktop quieto | 1,79 | 2,13 |
| Desktop caminando por ciudad | 11,79 | 14,28 |
| Móvil DPR 2 caminando | 11,94 | 14,63 |

La propia documentación atribuye el incremento a re-rasterización de modelos al mover cámara. Es consistente con `townModel.ts` y con el commit posterior `22dd25b`, que desactiva modelos sólo para el playtest.

## 4. Hallazgos

### PERF-00-01 — Cada delta reconstruye todos los actores remotos

- **Código:** `src/features/wildlands/multiplayer/api/colyseusPresence.ts:132-137`; `src/features/wildlands/engine/game.ts:380-420`.
- **Sistema:** multiplayer cliente, lifecycle de actores, sprites, GC.
- **Comportamiento:** un `presence:delta` actualiza un `Map`, pero `emit()` materializa todos sus valores y llama `setRemoteActors`. El juego crea dos maps temporales, filtra y mapea el array dos veces, crea nuevamente cada actor y acompañante y hace búsquedas lineales adicionales.
- **Evidencia:** no hay actualización in-place por id. La identidad de objeto de todos los actores cambia con el movimiento de cualquiera.
- **Impacto:** CPU/GC proporcional a todos los actores por cada delta; en ciudad se multiplica por la frecuencia agregada de movimientos. También corta animaciones de actores que no generaron el delta.
- **Confianza:** **muy alta**.

### PERF-00-02 — Las hojas de entrenador no están cacheadas y se reprocesan por delta

- **Código:** `src/features/wildlands/engine/game.ts:392-396`; `src/features/wildlands/engine/characters.ts:121-128, 131-161, 231-244`.
- **Sistema:** assets/sprites, memoria, GC.
- **Comportamiento:** cada actor recién recreado arranca con `renderer.playerSprites`, llama `loadTrainerSheet`, crea un `Image`, un canvas de análisis alfa y 16 o 32 frames; cada frame crea su canvas y su silueta. A diferencia de `loadPokemonInfo`, `loadTrainerSheet` no tiene cache por URL.
- **Evidencia:** la única protección es una `generation` que evita aplicar resultados viejos; no cancela ni evita el trabajo ya lanzado.
- **Impacto:** ráfagas de imágenes, canvases, buffers y Promises. Bajo tráfico continuo, las generaciones pueden quedar obsoletas antes de terminar y el actor permanece/reaparece con el fallback.
- **Confianza:** **muy alta**.

### PERF-00-03 — Interpolación remota frágil y sin buffer temporal

- **Código:** `src/features/wildlands/engine/game.ts:384-414, 661-662`; `src/features/wildlands/engine/actors.ts:112-119`; `services/realtime/src/presence/movement.js`.
- **Sistema:** movimiento multiplayer.
- **Comportamiento:** no hay timestamps de snapshot, buffer, delay de interpolación ni extrapolación. Cada posición aceptada es un tile autoritativo; al llegar se recrea el actor desde el tile anterior y se avanza con `dt`.
- **Evidencia:** si otro jugador genera un delta mientras un actor estaba interpolando, ese actor no cambiado también es recreado con `progress = 1` y salta al destino. Si varios deltas del mismo actor llegan juntos, la animación se reinicia desde estados discretos sin conservar el progreso visual.
- **Impacto:** saltos correlacionados con densidad, jitter de red y frames largos.
- **Confianza:** **muy alta** para el salto por reconstrucción; **alta** para jitter adicional por ausencia de buffer.

### PERF-00-04 — Ciudad hace broadcast total y escala aproximadamente O(N²)

- **Código:** `services/realtime/src/presence/interest.js:5-12`; `services/realtime/src/rooms/PresenceRoom.js:158-172`.
- **Sistema:** networking/interest management.
- **Comportamiento:** `isVisible` devuelve `true` para cualquier par de actores de ciudad. Cada paso publica a todos los observadores salvo el emisor y además envía `presence:self` al emisor.
- **Evidencia cuantitativa:** con N jugadores corriendo a 7,5 tiles/s, el orden de magnitud es `N × 7,5 × N` entregas/s: ~18.750 a N=50 y ~75.000 a N=100. Cada cliente puede recibir ~368 deltas/s a 50 y ~743 deltas/s a 100.
- **Impacto:** ancho de banda, parsing, callbacks, rebuilds y GC crecen juntos. Es el mejor correlato de “la ciudad se vuelve intransitable”.
- **Confianza:** **muy alta**.

### PERF-00-05 — El AOI wild existe, pero no se recalcula al moverse el viewer

- **Código:** `services/realtime/src/rooms/PresenceRoom.js:159-172`; `services/realtime/src/presence/interest.js`.
- **Sistema:** multiplayer/AOI.
- **Comportamiento:** el set visible de un cliente se actualiza cuando cambia el actor remoto evaluado. Cuando el propio viewer se mueve, `broadcastDelta` lo salta para ese mismo cliente; no se recalculan entradas/salidas de otros actores que estaban quietos.
- **Impacto:** sets de interés temporalmente obsoletos: actores cercanos pueden no aparecer hasta moverse y actores ya lejanos pueden permanecer. Además de consistencia, retiene trabajo visual innecesario.
- **Confianza:** **alta** por lectura del flujo; requiere prueba E2E específica para medir duración real.

### PERF-00-06 — El renderer recompone y reproyecta todo cada frame

- **Código:** `src/features/wildlands/engine/renderer.ts:149-185, 196-225, 268-277`.
- **Sistema:** renderer base.
- **Comportamiento:** crea la geometría, recompone el ground buffer y ejecuta un `drawImage` por fila de pantalla en cada frame. No hay fast path para cámara/ground estáticos. También crea gradients de cielo, fog, luces y vignette.
- **Impacto:** coste base dependiente de resolución, incluso con escena estática. Explica por qué las zonas mejores todavía no se sienten óptimas y por qué limitar DPR ayudó.
- **Confianza:** **alta** como coste sostenido; falta perfil de CPU/GPU para asignarle porcentaje exacto.

### PERF-00-07 — Rasterizador 3D de ciudad en CPU

- **Código:** `src/features/wildlands/engine/townModel.ts:75-269`; `src/features/wildlands/engine/renderer.ts:409-420`.
- **Sistema:** ciudad/renderer.
- **Comportamiento:** cada modelo proyecta vértices, calcula caras visibles, ordena triángulos, crea/limpia depth buffers y rasteriza texel por texel cuando cambia su clave de cámara. La clave se invalida cada 2 píxeles de mundo.
- **Evidencia:** mediciones históricas pasan de ~1,8 ms quieto a ~11,8 ms caminando. El commit `22dd25b` lo desactiva para `VITE_PLAYTEST=on`.
- **Impacto:** P0 en la build normal con cámara móvil; mitigado en el playtest actual, no resuelto para el producto.
- **Confianza:** **muy alta**.

### PERF-00-08 — El playtest desactiva el dibujo 3D pero todavía carga modelos y texturas

- **Código:** `src/features/wildlands/engine/renderer.ts:85-89, 303, 410`; `src/features/wildlands/areas/townArea.ts:232-267`; `src/features/wildlands/engine/townModel.ts:272-303`.
- **Sistema:** carga de assets/memoria.
- **Comportamiento:** el flag sólo evita pasar/dibujar `d.model`. `TownArea.ensureArt()` sigue llamando `loadTownModel` para props, fuentes y edificios; se descargan/parsing JSON y texturas y se guardan texels aunque no vayan a renderizarse.
- **Impacto:** coste de arranque, memoria y posibles spikes asíncronos en ciudad sin beneficio visual para el playtest.
- **Confianza:** **muy alta**.

### PERF-00-09 — Chunks grandes retenidos por mundo

- **Código:** `src/features/wildlands/engine/chunks.ts:17-21, 186-239`; `src/features/wildlands/areas/atlas.ts:25-38`.
- **Sistema:** chunks/memoria/lifecycle.
- **Comportamiento:** cada chunk hornea un canvas 512×512. No se intenta evicción mientras el store tenga 48 o menos. `Atlas` cachea cada `WildArea`; al salir, el `ChunkStore` queda retenido y deja de ejecutar `tick()`.
- **Impacto:** sólo el backing RGBA equivale aproximadamente a 1 MiB por canvas; 48 chunks son ~48 MiB por mundo, sin contar arrays temporales, decor, objetos del canvas y overhead. Cinco mundos pueden acercarse a ~240 MiB de backing en una sesión exploratoria extrema.
- **Confianza:** **alta** para retención; **media** para memoria real porque el navegador puede gestionar backing stores de manera distinta.

### PERF-00-10 — Generación síncrona de chunk en ruta de render

- **Código:** `src/features/wildlands/areas/wildArea.ts:59-76`; `src/features/wildlands/engine/chunks.ts:60-183, 204-218`.
- **Sistema:** world generation/frame spikes.
- **Comportamiento:** `drawGround`/`decorIn` llaman `ChunkStore.get`; si falta un chunk, el mismo frame resuelve terreno pixel a pixel, colorea 512×512, genera decor y crea el canvas.
- **Evidencia:** el test de construcción de chunk tardó ~1,16 s bajo jsdom, valor no comparable con navegador pero suficiente para confirmar que no es trabajo trivial. No existe presupuesto incremental ni precarga fuera del frame.
- **Impacto:** freeze puntual al cruzar límites o cambiar de zona; no explica por sí solo lag sostenido de ciudad.
- **Confianza:** **alta** para existencia del spike, **media** para su magnitud real.

### PERF-00-11 — Simulación y render recorren actores fuera de cámara

- **Código:** `src/features/wildlands/engine/population.ts:77-103`; `src/features/wildlands/engine/game.ts:655-662, 732`; `src/features/wildlands/engine/renderer.ts:313-342`.
- **Sistema:** entidades/AI/culling.
- **Comportamiento:** wild activa el 3×3 alrededor y conserva chunks hasta una distancia de dos; todos sus actores ejecutan `wander/advance` cada frame. Luego todos entran en la escena y recién el renderer los rechaza por pantalla.
- **Impacto:** trabajo off-camera y arrays/sort innecesarios. Está acotado y hoy parece secundario frente a multiplayer/renderer.
- **Confianza:** **alta**.

### PERF-00-12 — Allocations recurrentes por frame

- **Código:** `src/features/wildlands/engine/game.ts:713-739`; `src/features/wildlands/engine/renderer.ts:149-185, 280-342, 345-432`; `src/features/wildlands/engine/compositeOverlay.ts`.
- **Sistema:** GC.
- **Comportamiento:** por frame se crean, entre otros, un `Map` de chat, arrays concatenados de actores, route tiles, array de placed objects, objeto Scene, lente por spread, FrameInfo con cuatro arrays, drawables, `visibleActors`, nameplates, chat bubbles, objetos de proyección y `eye` por drawable. Los overlays compuestos usan `flatMap` por consulta.
- **Impacto:** presión constante de GC; con muchos actores/deltas se superpone con allocations de red y sprites, aumentando spikes.
- **Confianza:** **alta** para allocations; **media** para porcentaje de tiempo hasta perfilar heap/GC.

### PERF-00-13 — Búsquedas/colisiones con arrays completos

- **Código:** `src/features/wildlands/engine/game.ts:118, 203-207, 557`; `src/features/wildlands/engine/placedObjects.ts:236-256`.
- **Sistema:** colisiones, navegación, interacción.
- **Comportamiento:** ocupación usa `.some()` y la regla de movimiento crea `[player, ...actors]`; placed objects recorre objetos y footprints. No hay índice espacial.
- **Impacto:** puede acercarse a O(E²) cuando muchos wanderers deciden moverse, pero remotos no participan en colisión y el playtest actual quitó NPCs de ciudad. No es P0 con la evidencia presente.
- **Confianza:** **alta** sobre complejidad, **baja-media** como cuello actual.

### PERF-00-14 — El HUD de performance no mide lo que necesitamos

- **Código:** `src/features/wildlands/engine/game.ts:607-612`; `src/features/playtest/components/PlaytestPerformanceHud.vue`.
- **Sistema:** observabilidad.
- **Comportamiento:** FPS y frameMs son promedios exponenciales. No hay histograma, percentiles, long tasks, GC, entity/chunk counts ni separación update/render. “Red” es un GET HTTP `no-cors` cada 10 s, no RTT WebSocket ni edad de snapshot.
- **Impacto:** pudo ocultar 1% lows, picos periódicos y saturación de mensajes aunque el promedio pareciera aceptable.
- **Confianza:** **muy alta**.

## 5. Top bottlenecks

### P0 — crítico

1. **Rebuild total de actores + recarga de trainer sheets por cada delta remoto** (`PERF-00-01/02`).
2. **Broadcast sin AOI en ciudad, multiplicado por el rebuild del cliente** (`PERF-00-04`).
3. **Movimiento remoto sin estado visual persistente ni buffer de interpolación** (`PERF-00-03`).
4. **Rasterización CPU de modelos 3D al mover cámara en la build normal** (`PERF-00-07`). Está mitigada sólo para el playtest.

### P1 — alto

1. **Renderer de suelo completo por fila y por frame** (`PERF-00-06`).
2. **Generación síncrona de chunks en el frame** (`PERF-00-10`).
3. **Retención de canvases de chunks a través de mundos** (`PERF-00-09`).
4. **Carga de assets 3D que el playtest no dibuja** (`PERF-00-08`).

### P2 — medio

1. **Simulación/culling tardío de actores off-camera** (`PERF-00-11`).
2. **Allocations sostenidas por frame y por overlays** (`PERF-00-12`).
3. **Minimapa reconstruido por tile en ciudad y cada seis tiles en wild** (`WildlandsView.vue:374-387`).
4. **AOI wild obsoleto al cruzar sectores si los otros actores están quietos** (`PERF-00-05`).

### P3 — bajo por ahora

1. Búsquedas lineales de colisión/interacción (`PERF-00-13`).
2. Timers del HUD, gate, pesca y horno: están limpiados al desmontar y no hay evidencia de fuga acumulativa.
3. Pathfinding A*: síncrono pero sólo por tap/replan, con radio 40 y máximo 5.000 nodos. Debe medirse antes de tocarlo.

## 6. Ciudad — diagnóstico específico

Composición medida desde el módulo actual:

| Elemento | Cantidad |
|---|---:|
| Tiles | 3.264 (64×51) |
| Edificios | 15 |
| Fuentes | 3 |
| Props declarados | 180 |
| Hedges | 56 |
| Vallas H/V | 47 / 50 |
| Faroles | 14 |
| Bancos | 4 |
| Carteles | 9 |
| NPCs normales | 14 residentes + 5 wanderers |
| Plaza Pokémon | hasta 10 |

En la build de playtest actual los 19 NPCs normales están desactivados. Eso reduce draw/sim, pero no toca jugadores remotos. La ciudad conserva visibilidad global de presencia, por lo que el componente que crece desproporcionadamente no es el terreno estático: es la cantidad agregada de deltas y reconstrucciones de actores.

La densidad visual sí importa para el renderer: `TownArea.decorIn()` filtra el array entero por frame; los elementos visibles se proyectan, se cullan, se ordenan, generan sombra y se dibujan. En build normal, edificios/fuentes/props con modelo suman rasterización CPU al movimiento de cámara. En playtest se dibujan sprites, pero los modelos siguen cargándose en memoria.

Conclusión: **antes de los hotfixes, la ciudad combinaba 3D CPU + densidad + multiplayer; en el HEAD actual, el mayor riesgo restante es multiplayer y lifecycle de sprites.** Quitar más NPCs o props sería degradar producto sin atacar el multiplicador principal.

## 7. Multiplayer — movimiento y saltos

No se aplican posiciones de red directamente a un sprite DOM, pero el efecto práctico es cercano:

- el servidor avanza en tiles por intención aceptada;
- envía `tx`, `ty`, dirección, velocidad y secuencia, sin tiempo de servidor;
- el cliente crea un actor nuevo desde el tile anterior y anima hasta el nuevo;
- cualquier delta de cualquier jugador vuelve a crear también a los actores no cambiados.

Por eso hay tres fuentes superpuestas de saltos:

1. **snap de actor no cambiado:** pierde `progress` cuando se reconstruye por el delta de otro;
2. **ráfaga/batch:** varios tiles recibidos tarde reinician segmentos discretos sin timeline común;
3. **reconciliación local:** si el servidor discrepa, `placePlayer` teletransporta y resetea cámara/nav. La protección por secuencia evita acks viejos, pero no suaviza una corrección real.

No existe prediction para remotos, delay de interpolación, buffer de snapshots, clock sync ni extrapolación. Antes de diseñarlos hay que corregir el rebuild total: agregar interpolación sobre objetos descartables sólo escondería parte del problema.

## 8. Sprites — cambio/pixelado

Pipeline actual de entrenador remoto:

```text
RemotePresenceActor.characterId
  → playerCharacter(...).sheetUrl
  → createActor(... trainer = renderer.playerSprites fallback)
  → loadTrainerSheet(url)
  → Image
  → alphaOf/cellBounds
  → crop por dirección/frame
  → canvas + silhouette por frame
  → actor.trainer / actor.trainerRun
```

Hipótesis principal, respaldada por código:

- cada delta recrea el actor con el fallback procedural;
- la carga asíncrona reemplaza después el fallback por la hoja correcta;
- la siguiente generación puede invalidar el resultado antes de aplicarlo;
- la operación se repite incluso si URL/personaje no cambió.

Esto produce exactamente “cambia visualmente / vuelve a una versión pixelada o incorrecta”. No se encontró un LOD deliberado ni swapping por distancia. `imageSmoothingEnabled = false` e `image-rendering: pixelated` son coherentes con pixel art; no explican por sí solos cambios espontáneos de identidad o escala.

En Pokémon sí hay otro cambio posible: si falta el overworld sheet, se usa el front sprite con `FRONT_SPRITE_SCALE = 0.5`. Ese fallback tiene un solo frame y una escala distinta, pero `loadPokemonInfo` sí está cacheado por especie/shiny; es una diferencia estable por asset, no un cambio recurrente esperado durante el movimiento. Para remotos, el acompañante comienza con `pokeballInfo` y luego recibe `loadPokemonInfo`, de modo que también puede cambiar una vez al cargar; el rebuild por delta puede volver a exponer el fallback.

## 9. Lifecycle y memoria

### Correcto o acotado

- `WildlandsGame.destroy()` cancela rAF y teclado.
- `WildlandsView` elimina listeners, desconecta presencia, chat y juego.
- `ColyseusPresence` evita conexiones duplicadas y limpia reconnect timer.
- timers de gate/HUD/profesiones y canales Supabase tienen cleanup de unmount.
- chat server mantiene 60 líneas por área.
- reconnect cache expira a los 15 s.
- al cambiar de área se reemplaza `Population`; sus actores viejos quedan colectables.

### Riesgos

- `Atlas` conserva cada área visitada y con ella su `ChunkStore`.
- `ChunkStore` no reduce stores de ≤48 chunks y sólo hace housekeeping cuando su área está activa.
- `removed` crece por cada decor recogido durante la sesión y no tiene límite.
- caches globales de imágenes/modelos/Pokémon no tienen eviction. Es razonable para catálogos finitos, pero debe entrar en el presupuesto de memoria.
- cargas asíncronas de trainer sheets obsoletas siguen consumiendo trabajo aunque `generation` impida su aplicación.

No se encontró una fuga clásica de listeners duplicados en el flujo principal. La degradación entrar→salir→volver es más probable por caches retenidas y assets/canvases que por subscriptions huérfanas.

## 10. Qué debemos medir

La fase siguiente necesita instrumentación temporal, separada y fácil de retirar. No alcanza con FPS promedio.

### Cliente, por frame

- `updateMs`, `sceneBuildMs`, `groundComposeMs`, `groundProjectMs`, `collectMs`, `sortMs`, `spriteDrawMs`, `lightingMs`;
- frame time p50/p95/p99, 1% low y cantidad de frames >16,7 / >25 / >50 ms;
- long tasks y pausas de GC;
- drawables antes/después de culling, sombras, draw calls aproximados;
- actors totales/visibles/simulados, remotos y companions;
- chunks cargados/visibles/generados/evictados y tiempo de build por chunk;
- bytes estimados de canvases y texturas;
- número de `loadTrainerSheet` solicitado/completado/descartado y canvases creados;
- deltas/s, actores por `emit`, tamaño JSON y edad desde recepción hasta frame;
- correcciones locales, snaps remotos y discontinuidades >1 tile;
- heap usado y crecimiento tras 10 ciclos ciudad↔pradera.

### Servidor

- moves aceptados/rechazados por segundo;
- mensajes enviados y bytes por segundo, global y por cliente;
- fan-out por área;
- tiempo p50/p95/p99 de `broadcastDelta`;
- conexiones/jugadores/observadores por área;
- event-loop lag y memoria;
- tamaño de visible set y cambios de sector.

### Instrumentación propuesta

- marcas `performance.mark/measure` alrededor de fases del loop, agregadas en un buffer de diagnóstico, no logs por frame;
- `PerformanceObserver` para `longtask` y, donde esté disponible, eventos de GC/measure;
- contadores internos expuestos en un overlay sólo DEV/PERF;
- envelope de red con `serverTime` y secuencia para medir edad/jitter, sin cambiar aún el movimiento;
- script de carga que emita volumen de mensajes/bytes y no sólo duración del método;
- export JSON/CSV de una corrida para comparar commits.

## 11. Benchmark reproducible propuesto

Duración: 90 s por escenario, tres repeticiones, misma build de producción local, mismo viewport/DPR, misma máquina y navegador limpio. Descartar 10 s de warm-up y reportar mediana de las tres corridas.

### A. Zona ligera

- `pradera`, punto fijo acordado con baja densidad;
- 1 jugador, sin otros clientes;
- 20 s quieto, 50 s recorrido determinista, 20 s quieto;
- prewarm de chunks separado de una corrida “cold” para distinguir render sostenido de generación.

### B. Zona media

- `pradera`, recorrido que cruce al menos dos límites de chunk y una zona con agua/clima/decor;
- 10 actores remotos sintéticos o clientes reales dentro de AOI;
- misma secuencia de 90 s, incluyendo caminar y correr;
- registrar spikes de chunk y carga de sprites por separado.

### C. Ciudad / stress

- Ciudad Corazón, recorrido spawn → plaza/fuentes → Tienda → Gimnasio → centro;
- corridas con 1, 10, 25, 50 y, sólo para capacidad, 100 clientes;
- 60% corriendo, 30% caminando, 10% quietos; direcciones deterministas;
- medir una variante sin red para aislar renderer y otra con red para medir el multiplicador.

### Salidas mínimas

```text
build/commit, escenario, viewport, DPR, hardware
FPS promedio, 1% low, frame p50/p95/p99/max
frames >16.7/25/50 ms, long tasks
update/render por fase
heap inicial/final/max
actors total/visible, chunks total/visible
deltas/s, mensajes/s, bytes/s, jitter
trainer loads, sprite swaps, snaps detectados
```

No usar un recorrido manual libre como única comparación. Puede acompañar, pero el gate de regresión debe repetir input, spawn, duración y carga.

## 12. Gate recomendado

Los objetivos deben medirse en hardware objetivo y uno sensiblemente inferior. Propuesta inicial:

- zona normal: p95 ≤16,7 ms y p99 ≤25 ms;
- ciudad con carga objetivo: p95 ≤16,7 ms, p99 ≤33 ms, ningún freeze >100 ms recurrente;
- 1% low ≥50 FPS en desktop objetivo y ≥40–45 FPS en hardware bajo acordado;
- cero discontinuidades visuales remotas >4 px entre frames salvo teleport/cambio de área explícito;
- cero cambios de character sheet después del warm-up;
- heap post-GC tras 10 ciclos de zona dentro de ±10% del plateau;
- sin crecimiento monotónico de chunks, listeners, timers o canvases;
- fan-out y bytes/s dentro de un presupuesto fijado para 50 jugadores; 100 es capacity test, no necesariamente densidad visual objetivo.

`16,7 ms` sigue siendo el presupuesto correcto para 60 Hz, pero no debe usarse solo: un promedio de 12 ms puede coexistir con 1% lows malos y freezes visibles.

## 13. Plan PERF-01+

### PERF-01 — Baseline e instrumentación

1. Añadir medición por fases y export reproducible.
2. Implementar los tres recorridos y cargas A/B/C.
3. Capturar baseline en HEAD actual, build playtest y build normal.
4. No optimizar todavía durante esta microfase.

### PERF-02 — Lifecycle remoto, una responsabilidad

1. Mantener actores por id y mutarlos in-place.
2. Cachear trainer sheets por URL y compartir sprites inmutables.
3. Evitar cualquier reload si `characterId` no cambió.
4. Benchmark ciudad con 10/25/50 jugadores.

Éste debe ser el primer fix: ataca rendimiento, saltos y pixelado con una sola frontera clara.

### PERF-03 — Transporte/AOI ciudad

1. Definir interés visual para ciudad sin romper la sensación de mundo único.
2. Separar presencia lógica global de updates de movimiento visibles.
3. Reducir/coalescer frecuencia de movimiento y medir bytes/fan-out.
4. Corregir recomputación de AOI al cruzar sectores.
5. Repetir benchmark 10/25/50/100.

### PERF-04 — Interpolación remota

1. Incorporar tiempo/secuencia suficiente al mensaje.
2. Buffer corto de snapshots y render con delay controlado.
3. Reconciliar pérdida/ráfagas; extrapolación sólo si la evidencia la requiere.
4. Gate automático de continuidad visual.

### PERF-05 — Renderer base

1. Perfilar composición/proyección/sprites/luz por separado.
2. Probar fast path/caches sólo sobre la fase dominante.
3. Decidir con números el futuro de modelos 3D; no migrar renderer por intuición.
4. Rehabilitar contenido de ciudad uno a uno con benchmark.

### PERF-06 — Chunks y memoria

1. Medir tiempo real de build y memoria por chunk.
2. Presupuesto global entre mundos, no 48 por store.
3. Preparación incremental/prewarm sólo si el spike aparece en p99.
4. Sleeping/update throttling para actores fuera de cámara/AOI.
5. Prueba de 10 ciclos y travesía larga.

### Secuencia de control

```text
baseline → PERF-02 → benchmark
         → PERF-03 → benchmark
         → PERF-04 → benchmark
         → PERF-05 → benchmark
         → PERF-06 → benchmark y soak
```

Cada etapa debe conservar un commit/baseline comparable y revertirse si no mejora su métrica objetivo o degrada continuidad visual.

## 14. Preguntas abiertas

1. ¿Cuántos jugadores concurrentes estuvieron realmente en Ciudad Corazón durante el peor momento y cuántos corrían?
2. ¿Los hotfixes `8a6d443`, `41f3bd5` y `22dd25b` fueron desplegados durante o después de los clips reportados? Cambia qué síntomas corresponden al HEAD actual.
3. ¿El pixelado observado afectó principalmente trainers remotos, companions o Pokémon de plaza? El código soporta hipótesis distintas, aunque la de trainers remotos es la más fuerte.
4. ¿Cuál es el hardware mínimo real y su refresh rate?
5. ¿La build normal debe conservar 3D en CPU o el producto acepta sprites/baked renders? Esa decisión debe esperar al perfil de PERF-05.

## 15. Conclusión

La hipótesis “la ciudad es lenta por tener muchos NPCs” es incompleta y, para el HEAD de playtest actual, probablemente falsa como causa principal: esos NPCs ya están desactivados. La evidencia apunta a que la densidad de **jugadores y mensajes** dispara un lifecycle de cliente extremadamente caro. El renderer 3D fue otra causa real, separada, ya mitigada de forma temporal.

El primer arreglo no debería ser una reescritura, Web Workers ni un cambio de renderer. Debe ser hacer incremental el estado remoto y cachear su arte; después, limitar el fan-out mediante interés espacial/coalescing. Sólo entonces el perfil permitirá decidir cuánto del presupuesto restante pertenece al suelo, overlays, chunks y efectos.

## 16. Estado de implementación posterior al baseline

PERF-01 y la primera parte de PERF-02 se implementaron después de tomar este baseline:

- los deltas actualizan un actor remoto en lugar de reconstruir la multitud completa;
- las hojas de trainer se cargan, recortan y cachean una sola vez por variante;
- los pasos remotos usan secuencia y una cola acotada para absorber jitter sin reiniciar animaciones en curso;
- el HUD de playtest muestra promedio, p95, porcentaje de trabajo mayor a 33 ms, remotos y updates/s;
- Ciudad Corazón aplica interés espacial de 20 tiles alrededor del observador;
- moverse reconcilia entradas y salidas aunque los otros actores permanezcan quietos;
- el servidor coalesce el último delta de cada actor durante ventanas de 50 ms y lo envía como `presence:batch`.
- el playtest deja de descargar y parsear modelos urbanos que su renderer no utiliza;
- renderer, navegación, chat visible y objetos colocados reutilizan colecciones estables del hot path;
- cada mundo conserva como máximo 16 canvases de chunk mediante LRU, frente al límite anterior de 48.

El rollout del batching debe desplegar el cliente compatible con `presence:batch` antes que el servidor. El cliente nuevo sigue aceptando `presence:delta`, por lo que ese orden mantiene compatibilidad durante el despliegue.

El load harness acepta `npm run test:load -- 25`, `50` o `100` y separa mensajes físicos de updates contenidos en batches. Esto mide el servicio en proceso; los percentiles de frame deben recogerse en un navegador real mediante el HUD.

En la verificación visual local posterior a PERF-03, Ciudad Corazón renderizó correctamente a 1249×720, sin overlay de Vite, a 60 FPS y 1.4–1.7 ms de CPU por frame estando quieta. Es una comprobación de regresión visual, no sustituye el perfil con jugadores remotos y movimiento colectivo.

PERF-04/05 añadió dos cambios conservadores al renderer sin alterar su salida:

- la geometría de proyección por fila se conserva mientras viewport y lente no cambien; sigue existiendo exactamente un `drawImage` por fila, pero desaparecen las divisiones y objetos temporales repetidos en frames estables;
- el HUD de playtest separa medias suavizadas de composición del suelo, proyección, recolección, ordenamiento y dibujo de sprites, e iluminación. Los cronómetros sólo existen cuando `VITE_PLAYTEST=on`, respetando la frontera del motor productivo.

PERF-06 comenzó con precarga conservadora: al entrar en un mundo o cruzar de chunk, los ocho vecinos se preparan de a uno mediante `requestIdleCallback`. Sin tiempo ocioso disponible no se genera nada; no existe fallback con timer que pueda competir con un frame activo. Los chunks especulativos quedan como primeros candidatos del LRU hasta que el renderer los usa.

La comprobación visual de Pradera Brisa a 724×900 mostró terreno, clima, sprites, overlays y minimapa correctos, sin errores nuevos en consola, a 60 FPS y aproximadamente 1.7 ms/frame en reposo. La suite posterior quedó en 166 archivos / 1911 tests, con typecheck y build de producción correctos.

### Perfil local PERF-05/06

Se añadió `VITE_PERF=on` como flag local de medición. Muestra el HUD y activa los cronómetros sin convertir la build en playtest ni depender del gate remoto. La build normal lo elimina por constante de compilación.

Medición estable a 1265×712, DPR del navegador local, un jugador y sin servidor realtime:

| Escenario | Frame promedio | p95 | Fase dominante |
| --- | ---: | ---: | --- |
| Ciudad Corazón | 1.4 ms | 6.2 ms | proyección, ~0.8 ms |
| Pradera Brisa | 1.7–2.3 ms | 2.6–3.0 ms | proyección, ~0.8–1.2 ms |

La proyección es la fase sostenida más cara, pero queda muy por debajo del presupuesto de 16.7 ms. No se agruparon filas ni se degradó calidad por una ganancia marginal.

La entrada fría a Pradera sí reveló un spike real: nueve chunks se construían antes/durante los primeros frames, con 5.2 ms en el último build, 12.9 ms en el peor y un frame máximo de 51.5 ms. El arreglo prepara el 3×3 inicial de a un chunk por ventana ociosa mientras la pantalla de carga sigue visible. Repetida la misma entrada fría, el primer período jugable quedó en p95 2.7 ms, p99/máximo 3.3 ms y 0% de frames mayores a 33 ms. Los nueve builds siguieron ocurriendo —máximo observado 13.2 ms— pero fuera del loop jugable.

El HUD ahora expone p99, máximo, chunks vivos/generados/evictados y último/máximo tiempo de build. La precarga inicial incluye un timeout sólo mientras la pantalla de carga está montada, para no quedar bloqueada en una pestaña en segundo plano; la precarga durante gameplay continúa requiriendo tiempo ocioso real.

La precarga de travesía se adelanta ocho tiles antes de cada límite, incluyendo coordenadas negativas. De ese modo la nueva columna/fila del siguiente 3×3 puede generarse durante varios segundos de movimiento previo y no después de cruzar, cuando el primer render ya podría necesitarla.

El presupuesto de canvases pasó a ser efectivamente global por área activa: al abandonar un mundo se cancelan sus trabajos ociosos pendientes y se liberan todos sus bitmaps. El `World`, el seed y el registro de decor recolectado permanecen en Atlas, por lo que regresar reconstruye la misma zona sin restaurar pickups. Esto evita que visitar los cinco mundos retenga hasta cinco caches independientes de 16 MiB (~80 MiB).

### Benchmark multiplayer WebSocket

El nuevo `npm run benchmark:multiplayer` usa el transporte Colyseus real y
produce JSON comparable para 1–100 jugadores: mensajes físicos, updates dentro
de batches, bytes serializados estimados, RTT de acknowledgements, retraso del
driver y rechazos. Las identidades sintéticas sólo existen en un room registrado
con `PRESENCE_BENCHMARK=on` fuera de producción; no se añadió un bypass de auth
al room productivo.

La matriz local inicial confirmó que el batching contiene los mensajes físicos,
pero una multitud completamente agrupada conserva el crecimiento cuadrático de
updates lógicos: 25 jugadores produjeron ~3.955 updates/s, 50 ~16.619/s y 100
~65.170/s. A 100, el RTT p95 fue 16,03 ms, p99 20,68 ms y no hubo movimientos
rechazados.

Con el navegador observando esos mismos 50 jugadores en Ciudad Corazón, el HUD
midió 60 FPS, 1,5 ms promedio, p95 1,9 ms, p99 2,2 ms, máximo 2,6 ms, 0% de
frames >33 ms y 369,2 updates remotos/s. La salida reproducible y las
limitaciones están en `docs/performance/MULTIPLAYER_BENCHMARK.md`.

### PERF-05 — Ciudad en movimiento

El perfil específico del lobby mostró que el buen resultado en reposo ocultaba
un costo dependiente del desplazamiento. Con 30 jugadores sintéticos cerca del
spawn, mover la cámara elevaba el frame promedio a 10,6 ms, p95 a 21,4 ms y la
fase de sprites/modelos a 9,7 ms. La causa era el rasterizador 3D por CPU de los
edificios y props urbanos, no la multitud ni los NPC ambientales.

La ruta 3D se retiró del gameplay normal y de playtest. Ciudad Corazón conserva
las mismas fachadas y props mediante sus sprites 2D pre-renderizados; los modelos
y sus metadatos quedan únicamente como fuentes para tooling de arte. Al eliminar
el costo dominante se reactivaron también los residentes y wanderers que el
playtest había ocultado como mitigación temporal.

Repetido el recorrido a 724×900 con los mismos 30 remotos visibles, el lobby
mantuvo 60 FPS, 1,4 ms promedio, p95 2,2 ms, p99 3,1 ms, máximo 3,3 ms y 0% de
frames mayores a 33 ms. La fase de sprites quedó en 0,3 ms. En reposo, con los
NPC ya activos, midió 1,9 ms promedio y p95 2,6 ms. La comparación confirma que
la corrección resuelve específicamente la degradación al mover la cámara sin
vaciar el lobby.

### Menús y clima

Los paneles principales antes reducían deliberadamente el motor a 10 FPS detrás
de la interfaz. Aunque el costo de cada frame fuera bajo, ese canvas visible
avanzaba a saltos y hacía que una capa integral del HUD pareciera desconectada.
Ahora menú, panel, autenticación y superficies principales sólo bloquean los
controles del personaje: mundo, clima, NPCs y presencia continúan renderizando
a la cadencia normal. Sólo una pestaña realmente oculta suspende el loop.

La precipitación conserva lluvia y nieve, pero su densidad base bajó a cerca del
40% y tiene un máximo independiente del ancho de pantalla. El clima despejado
sale inmediatamente sin recorrer partículas. Esto evita que monitores anchos o
zoom/DPR altos multipliquen el costo cosmético sin aportar legibilidad.
