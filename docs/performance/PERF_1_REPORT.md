# PERF-1 — Instrumentation, multiplayer fidelity and shared-world baseline

> Fecha: 2026-09-24 · Rama `perf/1-instrumentation`.
> Código de runtime medido: **idéntico a `92ed74a`**. `git diff 92ed74a -- src services` sólo agrega la instrumentación descripta en §1.
> Convención: **DEMOSTRADO** (medido o reproducido con código real), **HIPÓTESIS** (falta medir), **ARQUITECTURA/PRODUCTO** (no es rendimiento).
> Este documento no aplica optimizaciones: §9 es sólo la propuesta de PERF-2.

---

## 1. Qué se agregó para medir

Nada de esto cambia el comportamiento. Todo lo que corre en el navegador existe sólo en builds `VITE_PERF=on`; verificado con `grep` sobre `dist` de los builds normal y playtest (§1.4).

### 1.1 Cliente (`src/features/wildlands/perf/`)

| Módulo | Mide |
|---|---|
| `framePacing.ts` | Intervalo real entre `requestAnimationFrame`, cadencia inferida (60/75/90/120/144/165/240… sin asumir 60), p50/p95/p99/máx, frames tarde (>1,5× presupuesto), vsyncs perdidos, >33/>50/>100 ms, jitter de frames a tiempo, y por separado update/render/tick y "fuera del motor" (intervalo − trabajo). |
| `motionTrace.ts` | Cámara local por frame en movimiento: histograma de paso en px de mundo, frames quietos, error de redondeo contra la posición sin redondear, variación entre frames consecutivos, relación velocidad observada/nominal, saltos de cámara. |
| `remoteTrace.ts` | Por jugador remoto: intervalos de llegada, distancia en casillas y saltos de secuencia entre estados recibidos; creación/destrucción/recreación (y recreación < 2 s = "flapping" de interés); cambios de hoja de sprite (fallback→hoja, **hoja→fallback**, hoja→hoja), fallback trabado > 2 s, correr sin frames de correr, resultado del renderer (dibujado / fuera de pantalla / **sin arte**), cache hit/miss y fallas de hojas; saltos visibles (> ½ casilla en un frame) y esperas cortas entre pasos ("stop-and-go"); **AOI**: entradas/salidas por entidad, distancia al jugador al salir/entrar, tiempo fuera y frecuencia. |
| `chunkTrace.ts` | Builds de chunk por origen (dentro del frame / precarga ociosa / warm), duración, builds ociosos que se pasaron del tiempo libre, evicciones, liberaciones, y si el navegador tiene `requestIdleCallback`. |
| `mainThread.ts` | Long tasks, long animation frames (con atribución de scripts) y heap, cada una con detección de capacidad (Safari no tiene ninguna: se reporta como "no soportado", no como 0). |
| `perfSession.ts` | Orquesta, cuenta entidades (población, drawables), línea de tiempo por segundo (para soak) y exporta **un JSON comparable** por captura. |
| `scenarioDriver.ts` | Recorridos deterministas por la misma entrada que el teclado (dirección + sprint virtuales) con el A* real sobre la colisión real: `city-loop`, `pradera-line`, `traversal`. Un test planifica todos los tramos sobre el `Atlas` real. |
| `PerfPanel.vue` | Panel en pantalla (sirve en iPhone): iniciar/detener, escenario, resumen vivo, **Enviar a PC** y **Descargar**. |

Hooks mínimos en el motor (`engine/perfHooks.ts`, todos `null` fuera de `VITE_PERF`):

| Archivo | Cambio |
|---|---|
| `game.ts` | +17 líneas: sonda de frame (tiempos y referencias ya existentes), `setVirtualSprint` para el driver. 1.043 → 1.060 líneas. |
| `renderer.ts` | Resultado por actor y drawables/zoom por frame; en producción no se agrega ni una llamada por actor (se elige el wrapper sólo si hay sonda). |
| `chunks.ts` | Origen de cada build, tiempo ocioso restante, evicciones y liberaciones. |
| `characters.ts` | Pedido de hoja (hit/miss) y resultado. |
| `colyseusPresence.ts` | Los builds de medición pueden unirse como jugador sintético del benchmark. Sólo el `BenchmarkPresenceRoom` local acepta esa identidad; el servidor de producción registra `PresenceRoom`, que la ignora. |

### 1.2 Servidor

`metrics.js` + `PresenceRoom.sendDelta`: contadores agregados de la ventana de 50 ms (deltas encolados, **paso que pisa a otro paso del mismo actor**, pasos plegados en un upsert, batches, batch máximo), expuestos en `/metrics` interno. El batching no cambió. Test nuevo: dos pasos en la misma ventana → `stepOverStep = 1` y el observador recibe un solo `step` con 2 casillas de salto.

### 1.3 Herramientas

| Herramienta | Uso |
|---|---|
| `scripts/perf/remote-fidelity/run.sh` | Harness determinista: caminar local **real**, `PresenceRoom` **real** con batching, adaptador y cola remota **reales** del observador; sólo la red está modelada (latencia, jitter, orden TCP, agrupamiento en el uplink). Escenarios A–I, redes `lan`/`miami`/`rough`, observador a 60/144 Hz. |
| `npm run benchmark:multiplayer` | Nuevos `--burst N` y `--gait walk\|run`; cada cliente reporta distancia/gaps de lo que recibe; incluye los contadores de batching del servidor. |
| `scripts/perf/local-stack.mjs` | Un comando: construye los dos builds de medición, levanta realtime en modo benchmark y los previews en la LAN (4173 normal, 4174 playtest) con el colector de capturas. |
| `scripts/perf/headless-capture.mjs` | Chrome headless con perfil descartable vía DevTools (sin dependencias): N clientes, escenarios u observadores, `--dump` para comparar mundos. |
| `scripts/perf/run-baseline.sh` | La batería de esta baseline. |
| `scripts/perf/summarize.mjs` | Tablas markdown desde cualquier set de capturas (`baseline → experimento`). |
| `scripts/perf/vitePerfCollector.ts` | Middleware de Vite (dev/preview, sólo con `VITE_PERF=on`) que guarda las capturas enviadas desde otros dispositivos en `docs/performance/baselines/incoming/`. |

### 1.4 Verificación

- `npx vitest run`: **1.959 / 1.959** (1.942 + 17 nuevos). `npm run typecheck` OK. Lint: 0 errores (9 warnings antiguos).
- `services/realtime`: **65 / 65**.
- Aislamiento: en `dist` de los builds **normal** y **playtest** hay 0 apariciones de `pokeswap-perf-v1`, `PerfPanel`, `__perf/report`, `long-animation-frame`; sólo existe el nombre del método `setFrameProbe` del hook.
- Costo propio: sonda de frame p95 0,1 ms por frame (fuera del trabajo medido); sonda de render sin diferencia medible en A/B (§8.7).

---

## 2. Performance baseline (frame, render, chunks, memoria)

### 2.1 Método y límites

- Build de producción con `VITE_PERF=on` (modo normal, DPR 1 en este equipo), servido con `vite preview`; realtime local en modo benchmark.
- Clientes: **Chrome 147 headless** con perfil descartable, una ventana por cliente, 1280×720. Máquina: Ryzen 5 3600, Windows 10.
- **Límite importante:** headless no tiene pantalla real. Su rAF es un reloj sintético a 60 Hz, así que **frame pacing, cadencia y jitter de estas capturas no representan un monitor ni un iPhone**. Sí son válidos el trabajo del motor, los long tasks, los chunks, la memoria, la red, los sprites y el ciclo de vida. Los datos de dispositivo real dependen de las pruebas de §10.
- El panel de navegador integrado de la app no sirve para medir: bloquea pedidos a otros orígenes (`ERR_BLOCKED_BY_CLIENT`) y, oculto, no entrega animation frames (30 Hz o 0 Hz).
- Crudos: `docs/performance/baselines/2026-09-24/*.json`. Tablas: `node scripts/perf/summarize.mjs docs/performance/baselines/2026-09-24`.

### 2.2 Resultados (headless, 60 Hz sintéticos)

| Captura | Remotos | Intervalo p99 / máx (ms) | >50 ms | Trabajo motor p95 | Render p95 | HUD Vue p50 / p95 | Long tasks | Heap inicio → fin (MB) |
|---|---:|---|---:|---:|---:|---|---:|---|
| SOLO-1 Pradera | 0 | 16,8 / 16,9 | 0 | 2,2 | 2,0 | 1,5 / 3,9 | 0 | 13,2 → 14,6 |
| CITY-1 | 0 | 16,8 / 17,0 | 0 | 2,3 | 2,1 | 2,1 / 2,8 | 0 | 20,9 → 12,3 |
| TRAVERSAL-1 (3 ciclos) | 0–1 | 16,8 / **66,7** | 1 | 2,3 | 2,2 | 1,8 / 2,9 | 1 | 21,5 → 13,3 |
| MULTI-10 (camina) | 11 | 16,8 / 16,9 | 0 | 2,5 | 2,3 | 1,9 / 3,0 | 0 | 21,8 → 15,8 |
| MULTI-20 (camina) | 21 | 16,8 / 16,9 | 0 | 2,3 | 2,0 | 1,6 / 2,7 | 0 | 11,3 → 12,4 |
| MULTI-30 (camina) | 31 | 16,8 / 16,8 | 0 | 2,4 | 2,3 | 1,6 / 2,8 | 0 | 12,5 → 11,8 |
| TRAVERSAL-2 (2 clientes) | 1 | 18,1 / **136,2** | 3 | 2,2 | 2,1 | 1,5 / 2,8 | 0 | 12,6 → 17,6 |
| SOAK 10 min, 20 corredores | 20 | 16,8 / 18,4 | 0 | 2,0 | 2,0 | 1,4 / 2,3 | 0 | 11,6 → 13,3 (máx 35,4, diente de sierra de GC) |

**DEMOSTRADO**
- El trabajo del motor **no escala de forma relevante con la densidad**: p95 2,2 ms sin remotos y 2,4 ms con 31. El render domina, con ~2 ms.
- **Spike por chunks en cambio de área.**
  - En TRAVERSAL, cada entrada a Pradera construye los chunks visibles **dentro del frame**: 12 builds por captura, p95 ~10 ms cada uno, 3 frames afectados.
  - Peor frame: 66,7 ms (1 cliente) y 136 ms (2 clientes).
  - El LoAF lo atribuye al bundle del motor (57 ms).
  - Causa en código: `warmAround` sólo corre en la carga inicial; `enterArea` sólo llama a `prefetch`, que ya no llega a tiempo para el 3×3 visible. Era la hipótesis R9 de PERF-0.
- **Recorrido continuo sin spikes:** en SOLO-1, los 40 chunks nuevos se construyeron por precarga ociosa. 0 dentro del frame, 0 pasados del deadline (máx 9,8 ms).
- **Sin fuga en 10 minutos:** población, remotos y canvases constantes; heap estable con GC normal. Las liberaciones de canvases al salir de un mundo funcionan (48 en 3 ciclos).
- **Vue/HUD:** cada actualización del HUD (cada 150 ms) cuesta p50 1,4–2,1 ms y p95 hasta 3,9 ms entre asignación y flush. Es del **mismo orden que todo el frame del motor**. A 60 Hz de escritorio no genera frames tarde. Su peso en iPhone está por medir.

**HIPÓTESIS (requieren §10)**
- iPhone y monitores de 120/144 Hz.
- Safari sin `requestIdleCallback`: sin él, todo chunk se construiría dentro del frame, no sólo en los viajes.

### 2.3 Dispositivos reales

Pendiente de las capturas PC-1…3 e IP-1…3 (§10).

### 2.4 Movimiento local y cámara

| Captura | Frames en movimiento | Paso de cámara 0/1/2/3/4+ px | Frames quietos | Paso despareja |
|---|---:|---|---:|---:|
| CITY-1 | 3.083 | 0/2.039/1.044/0/0 | 0 | 0 % |
| SOLO-1 Pradera | 3.946 | 0/2.977/969/0/0 | 0 | **20,7 %** |
| TRAVERSAL-2 | 5.716 | 0/1.670/3.802/242/2 | 0 | 9,6 % |

**DEMOSTRADO: el redondeo a píxel entero produce pasos desparejos cuando la velocidad no da un número entero de px por frame.**
- Caso 144 Hz, reproducido con el código real de actores (test `motionTrace.test.ts`): caminando, más del 40 % de los frames en movimiento dejan la cámara quieta y el paso cambia en más del 50 % de los pares de frames. La posición sin redondear avanza perfectamente pareja.
- Caso 60 Hz: al nadar (velocidad ×0,7 → 1,4 px/frame corriendo), el 20,7 % de los pares de frames alterna entre 1 y 2 px.
- A 60 Hz en tierra el paso es exacto: 1 px caminando, 2 px corriendo.
- En TRAVERSAL-2 los pasos de 3 px vienen de frames de 18 ms (dos ventanas headless compitiendo), no del redondeo.

---

## 3. Movimiento remoto (fidelidad)

### 3.1 Cómo funciona hoy (código)

1. **Envío.** El jugador local envía el movimiento **al terminar** cada casilla (`onPlayerArrive`), con `running` = Shift en ese momento.
2. **Servidor.**
   - Aplica el paso: `speed` = 7,5 si `running`, 3,75 si no.
   - Encola por observador y cada 50 ms envía el último estado de cada actor.
3. **Observador.**
   - Si el paso recibido está a 1 casilla, lo anima desde la casilla actual a `speed` o lo encola (hasta 3).
   - Si la distancia ≠ 1 o la cola está llena: **salto** (teletransporte al último estado).
   - No hay timestamps, ni retraso de interpolación, ni aceleración para recuperar atraso: la cola se reproduce a velocidad nominal.
4. **Velocidad local.** El caminar del jugador fija la velocidad sólo cuando está quieto (`game.ts update`). El walker encadena casillas sin detenerse, así que **cambiar Shift en movimiento no cambia la velocidad hasta frenar**, pero sí cambia `running`, lo que ven los demás.

### 3.2 Harness determinista (código real + red modelada), 3 semillas

Promedio por escenario; delay = casilla visible en el observador − casilla completada localmente.

| Escenario | Paso local | Red | Saltos (máx casillas) | Casillas nunca vistas | Espera ms / s en movimiento | Delay p50 / p95 (ms) | Pasos pisados en servidor |
|---|---|---|---|---:|---:|---|---:|
| A caminar recto | 267 ms | lan / miami | 0 | 0 | 24 / 17 | 311 / 467 | 0 |
| B correr recto | 133 ms | lan / miami | 0 | 0 | 25 / 53 | 178 / 328 | 0 |
| B correr recto | 133 ms | rough | 0,7 (3) | 1 | 189 | 383 / 400 | 1 |
| **C caminar → Shift sin frenar** | **267 ms** (no acelera) | lan / miami | 0 | 0 | **346 / 333** | 167 / 322 | 0 |
| D correr, frenar, correr | 133 ms | lan / miami | 0 | 0 | 28 / 37 | 177 / 317 | 0 |
| E ida y vuelta | 133 ms | lan / miami | 0 | 0 | 25 / 53 | 178 / 328 | 0 |
| F zig-zag | 133 ms | lan / miami | 0 | 0 | 25 / 53 | 178 / 328 | 0 |
| **G dos pasos por paquete** | 133 ms | lan / miami | **8 (2)** | **8** | **942 / 925** | — | **8** |
| H 10 corredores con cambios de paso | 133 ms | lan / miami | **10 (4)** | **40** | 96 / 105 | 178 / 339 | 0 |
| **I correr → soltar Shift sin frenar** | **133 ms** (no frena) | lan / miami | **1 (4–5)** | **4** | 92 / 100 | 167 / 317 (p95 566 / 716) | 0 |
| J correr 80 casillas | 133 ms | lan / miami | 0 | 0 | 11–41 | 167–184 / 334–350 | 0 |
| J correr 80 casillas | 133 ms | rough | 1–5 (3) | 2–7 | 71–182 | 334–517 / 367–600 | 0 |

Observador a 144 Hz: mismos saltos, menos espera medida por la cuantización de frames. Crudo: `remote-fidelity.json`.

### 3.3 Navegador real (headless), lo que ve un observador

| Captura | Remotos | Updates recibidos (1 / 2 / 3+ casillas) | Gaps de secuencia | Saltos visibles (máx) | Esperas (p95 ms) |
|---|---:|---|---:|---|---|
| MULTI-2 / RUN-2 | 1 | 259 / 0 / 0 | 0 | 2 (4) | 13 (184) |
| MULTI-10 | 11 | 4.087 / 0 / 0 | 0 | 32 (4) | 110 (200) |
| MULTI-20 | 21 | 8.055 / 0 / 0 | 0 | 62 (4) | 128 (201) |
| MULTI-30 | 31 | 11.985 / 0 / 0 | 0 | 92 (4) | 219 (200) |
| SOAK 10 min | 20 | 84.460 / 0 / 0 | 0 | 580 (4) | 1.353 (200) |
| **Ráfagas ×2** | 20 | 0 / **4.460** / 0 | **4.460** | **4.480** (2) | 0 |

### 3.4 Diagnóstico: ¿cola, consumo, batching, interpolación o AOI?

**1. Batching de 50 ms: DEMOSTRADO como causa sólo cuando dos pasos del mismo jugador caen en la misma ventana.**
- Con cadencia estable, el servidor no pisó **ningún** paso: 0 de 121.800 con 30 corredores.
- Con dos pasos por paquete (G, ráfagas ×2), el 100 % de las actualizaciones llegan como saltos de 2 casillas.
- Pasa en producción cada vez que el uplink agrupa movimientos (Wi-Fi, móvil, un tab en segundo plano). La frecuencia real en producción no está medida.

**2. Cola y estrategia de consumo: DEMOSTRADO como causa principal de los saltos de 4 casillas con datos perfectos.**
- En MULTI-10/20/30 y SOAK **todo** llega de a 1 casilla y sin huecos, y aun así hay ~3 saltos por remoto por minuto, todos de 4 casillas, que es la firma de la cola llena (3 + 1).
- Mecanismo:
  - la cola se reproduce exactamente a la velocidad de llegada, sin acelerar;
  - un adelanto de los datos deja un paso encolado que sólo se va con un atraso posterior;
  - la cola hace un paseo aleatorio entre 0 (el remoto espera: *stop-and-go*) y 3 (salto);
  - por eso crece linealmente con los remotos (10 → 32, 20 → 62, 30 → 92) y no con la carga de CPU.
- Con emisor estable y jitter bajo (J lan/miami) no aparece. Con jitter alto (J rough, o el driver sintético con timers de Node) sí.
- Qué jitter real tiene producción es **HIPÓTESIS** pendiente (RUN-2 con dos personas).

**3. Desincronía de velocidad local vs remota: DEMOSTRADO. Es un bug de fidelidad, no de rendimiento.**
- Apretar Shift caminando (C): el local sigue a 267 ms por casilla, pero los demás lo animan a 133 ms y quedan esperando ~35 % del tiempo.
- Soltar Shift corriendo (I): el local sigue a 133 ms, los demás caminan a 267 ms, la cola se llena y hay un salto de 4–5 casillas.
- Explica buena parte de "el correr visto por otro jugador necesita pulido".

**4. Interpolación: no existe como tal. Retraso inherente medido:**
- corriendo, ~180 ms en LAN y ~330 ms a Miami;
- caminando, ~310 / 470 ms.
- Componentes: una casilla completa (se envía al llegar) + latencia + cuantización de 50 ms.

**5. AOI: no causa saltos en movimiento.** Causa ciclos de destrucción/recreación en el borde (§4.1).

---

## 4. AOI, ciclo de vida y sprites

### 4.1 AOI (ciudad: 20 casillas, Chebyshev, sin histéresis)

MULTI-30, jugador que recorre la ciudad a través de 30 corredores:

| Medida | Valor |
|---|---|
| Salidas en 56 s | 28 (**29,8 por minuto**) |
| Entidades que salieron | 14 de 30 |
| Salidas por entidad | máx 2, p95 2 |
| Distancia al salir | **20** casillas en el 100 % de los casos (p50 = p95 = máx = 20) |
| Distancia al volver | 20 (p95) |
| Tiempo fuera | p50 867 ms, p95 983 ms |
| Lo que implica cada vuelta | actor nuevo (objeto nuevo, cola y secuencia nuevas), acompañante nuevo, **1 pedido de hoja: cache hit (28 de 28)**. Sin decodificar imagen ni crear texturas. |
| Efecto visible del fallback | 0 frames con fallback: la hoja cacheada se asigna antes del frame siguiente. |

**DEMOSTRADO**
- Las recreaciones rápidas son **cruces del borde exacto** por remotos que se mueven cerca de 20 casillas.
- No es una entidad rebotando sin control: como máximo 2 por entidad en ~1 min.
- Cada cruce destruye y recrea el actor: pierde cola, secuencia y estado visual, y reaparece con un paso de retraso.
- El costo de CPU es pequeño (hit de caché). El costo de **continuidad** existe (aparición y desaparición a 20 casillas, al borde de la pantalla con zoom 3).
- El observador quieto, en cambio, no tuvo ninguna salida en 10 minutos de SOAK.
- En TRAVERSAL-2 cada viaje produce una salida y reentrada de ~5,3 s: es el cambio de área, no el AOI.

### 4.2 Sprites de jugadores remotos (P0 del playtest)

| | Resultado |
|---|---|
| **Bug histórico** | Documentado en PERF-00 sobre `ae28451`: cada delta reconstruía **todos** los actores remotos con el sprite procedural de fallback, y la hoja se recargaba sin caché. Las generaciones viejas descartaban la carga. Explica "sprites que desaparecen o cambian al caminar con mucha gente". Corregido en `5ffd09e` (actores incrementales por id y caché de hojas). |
| **Escenarios actuales donde NO se reproduce** | 0 hoja→fallback, 0 frames sin arte, 0 fallback trabado, 0 reconstrucciones del mismo actor sin salida de AOI en: MULTI-2, MULTI-10, MULTI-20, MULTI-30 (+ AOI), ráfagas ×2, TRAVERSAL-2 y SOAK de 10 min (721.020 dibujos de remotos). Los mismos 3 personajes (`lucas`, `dawn-pink`, `dawn-yellow`) rotando. |
| **Mecanismos observados que podrían explicarlo** | (a) Recreación en el borde de AOI (§4.1): hoy sin fallback visible porque la hoja está en caché. (b) Salto de 4 casillas con la cola llena (§3.4): a zoom 3 un salto de 4 casillas son 192 px, que se lee como "desapareció y apareció". (c) Primer avistaje de un personaje cuya hoja no está en caché: fallback hasta que decodifica (no medido en frío: el pre-warm lo evita). |
| **Condiciones todavía no reproducidas** | Hoja que falla al cargar (red móvil real, `sheetFailures` = 0 en local); iPhone (memoria y decodificación en Safari); más de 3 tipos de personaje; acompañantes remotos (el benchmark no los tiene); más de 31 remotos simultáneos; pestaña en segundo plano que vuelve con cientos de deltas encolados. |

Conclusión prudente: el mecanismo que explicaba el P0 original ya no está y no se reproduce en ninguno de los escenarios medidos. **No lo declaro resuelto**: faltan dispositivo real, red real y las condiciones de la última fila.

---

## 5. Shared World audit (código, verificado en §6 con dos clientes)

Leyenda: **LOCAL** (cada cliente decide), **DETERMINISTA** (misma función de la semilla en todos, sin autoridad), **SERVER** (el servidor decide y difunde), **NO IMPLEMENTADO**.

### 5.1 Pokémon salvajes

| Pregunta | Hoy | Dónde |
|---|---|---|
| ¿Quién decide que aparece? | Cada cliente, al activar el chunk (3×3 alrededor del jugador). | `engine/population.ts` `populate()` |
| Posición de aparición | DETERMINISTA: `hash2(chunk, i, seed)`. | idem |
| Especie | **LOCAL**. Sale del *pool wild* de 25 especies que cada cliente sortea con `Math.random` al cargar y rota cada hora desde su propia carga (`rollWildPool`, `usePlazaData.ts`). Además `spawnedPokemonIds` evita repetir especie entre chunks activos: el resultado depende del **orden** en que ese cliente pobló los chunks. | `pokemon/domain/wildPool.ts`, `population.ts` |
| Shiny | DETERMINISTA por casilla. | `population.ts` |
| ID | `${cx},${cy}:p${i}`: estable sólo dentro del cliente; nadie más lo conoce. | idem |
| Movimiento | **LOCAL**: `wander()` con `Math.random`. Diverge desde el primer segundo. | `engine/actors.ts` |
| Estado en servidor | **NO IMPLEMENTADO**. | — |
| Interacción | Tarjeta de sólo lectura (`wildHitAt` → `onInspect`). No hay captura ni combate compartido. | `engine/wildTaps.ts` |
| ¿Qué ve otro jugador? | Otro Pokémon (especie distinta con alta probabilidad), en otra posición. | §6 |

### 5.2 NPC

| NPC | Spawn/posición | Movimiento | Autoridad |
|---|---|---|---|
| Residentes de ciudad | DETERMINISTA (definición de `hearthome.ts`), `stationary`. | Ninguno. | Ninguna; coinciden por construcción. |
| Wanderers de ciudad | DETERMINISTA el hogar. | **LOCAL** (`wander` + `Math.random`). | Ninguna. |
| Pokémon de plaza | Qué Pokémon: datos compartidos (slots más caros en Supabase). Hogar: DETERMINISTA dado el mismo orden. | **LOCAL**. | Datos de Supabase, posición local. |
| Entrenadores wild | DETERMINISTA por chunk (cantidad, casilla, aspecto). | **LOCAL**. | Ninguna. |

### 5.3 Recursos y profesiones

| Aspecto | Hoy | Dónde |
|---|---|---|
| Nodo (árbol, roca, arbusto, pesca) | DETERMINISTA: `nodeAt(world, tx, ty)` desde la semilla, `nodeId` estable. Diseñado para que el servidor lo recalcule ("Client and server compute the same node"). | `professions/domain/nodePlacement.ts` |
| Agotamiento | **LOCAL y por usuario por diseño**: `chargeKey(nodeId, userId)` dentro de la sesión demo; no persiste y no se comparte. | `domain/nodeDepletion.ts`, `demo/demoSession.ts` |
| Talar/minar/pescar (animación, caída del árbol, rebrote) | **LOCAL** (overlays del cliente). | `logging/*`, `mining/*`, `overworld/gatheringOverlayCore.ts` |
| Trabajador Pokémon (p. ej. Scizor talando) | **LOCAL**: actor efímero `workerSummon`, distinto del acompañante de presencia. | `overworld/workerSummon.ts` |
| Cristales recolectables (wild) | Posición DETERMINISTA; recolección **LOCAL** (`removeDecor`, sólo sesión). | `engine/chunks.ts` |
| Entradas de dungeon | DETERMINISTA desde la semilla del área ("the same for everyone"). La corrida es local. | `dungeonEntrances/domain/entranceSpawns.ts` |

### 5.4 Jugadores y acompañante

| Propiedad | Hoy |
|---|---|
| Identidad (id, username, characterId) | SERVER (Colyseus, desde el JWT; `characterId` validado contra 3 valores). |
| Posición, dirección, velocidad, secuencia | SERVER (ritmo y secuencia; **no** colisión). |
| Animación caminar/correr | Derivada en cada cliente de `speed` (> 3,75 ⇒ correr). |
| Acción (talar, minar, pescar…) | **NO IMPLEMENTADO**: el protocolo sólo tiene `ready`, `move`, `area`, `observe`, `chat`. `publicActor` no tiene campo de acción. |
| Acompañante | Identidad SERVER: `companionId` (especie) validado contra la propiedad en Supabase y difundido en la presencia. Posición **LOCAL en cada cliente**: el propio usa `CompanionFollower` (rastro con 1 casilla de retraso); los demás lo dibujan en la casilla de origen del dueño (`upsertRemoteCompanion`). No tiene id propio ni estado de acción. |
| Chat | SERVER (difusión por área, historial en memoria). |

### 5.5 Mundo y ambiente

| Sistema | Hoy |
|---|---|
| Terreno, props, chunks | DETERMINISTA (semilla). Ciudad estática. |
| Hora del día | **LOCAL**: `clock = 0.4` al cargar la página y avanza con el tiempo de esa sesión. |
| Clima | **LOCAL**: `weatherAt(tx, ty, biome, seconds, seed)` con `seconds` = tiempo desde que cargó ese cliente. |
| Portales / áreas compartidas | SERVER sólo para `ciudad-corazon` y `pradera` (contrato de llegada común). Las otras zonas no tienen presencia. |

### 5.6 ¿Dónde debería vivir cada cosa? (dirección, no implementación)

- **Estado mutable compartido** (Pokémon salvajes vivos, agotamiento/rebrote de nodos, NPC con estado relevante, acciones de jugador): servidor, por área/AOI, reutilizando el mismo canal de presencia y su interés espacial.
- **Lo que ya es determinista** (terreno, posición y tipo de nodos, entradas de dungeon): no transmitirlo; el servidor sólo difunde el *delta* de estado (agotado, en uso por X, rebrota en T).
- **Cosmético** (hora/clima): o una hora de servidor (`serverTime` en el snapshot) o aceptarlo como local por decisión de producto.
- **Acciones visibles**: un estado de acción por actor dentro de la presencia (`{ type, targetId, companion, seq, startedAt }` + evento de fin), reproducido localmente con la misma animación; no frames. El acompañante forma parte del actor, no un segundo canal. Detalle en §7.

---

## 6. SHARED-2: dos clientes en el mismo lugar (evidencia)

Dos clientes headless en la misma casilla durante 20 s. Al final cada uno vuelca lo que ve en un radio de 20 casillas (`scripts/perf/world-snapshot.js`). Crudos: `shared-2-pradera.json`, `shared-2-town.json`.

| Sistema | Cliente A vs Cliente B | Fuente de verdad hoy | ¿Consistente hoy? |
|---|---|---|---|
| Terreno, props, nodos de recursos, entradas de dungeon | Idénticos por construcción (misma semilla; no se volcaron porque no varían) | DETERMINISTA | **Sí** |
| Pokémon salvajes (Pradera) | En las 2 posiciones de spawn que ambos veían, la especie difiere (431 vs 300, 69 vs 193): 0/2 misma especie, 0/2 misma posición | LOCAL (pool sorteado por cliente + orden de población + `Math.random`) | **No** |
| NPC wild (Pradera) | Mismos IDs de spawn; 0 en la misma posición | DETERMINISTA el spawn, LOCAL el movimiento | **No** (identidad sí, posición no) |
| Residentes de ciudad | 11/11 en la misma posición | DETERMINISTA, estáticos | **Sí** |
| Wanderers de ciudad | 4/4 misma identidad, 0/4 misma posición | LOCAL | **No** |
| Pokémon de plaza | 7/7 misma especie, 0/7 misma posición | Qué: Supabase (compartido). Dónde: LOCAL | **Parcial** |
| Recursos: agotamiento / en uso / rebrote | No compartido: sesión demo local, cargas por usuario | LOCAL | **No** (por diseño actual) |
| Jugadores remotos: presencia, posición, dirección | Cada uno ve al otro en la misma casilla | SERVER | **Sí** (con 180–470 ms de retraso, §3) |
| Locomoción (caminar/correr) | Igual salvo el caso Shift-en-movimiento (§3.4, punto 3) | SERVER (`speed`) | **Parcial** |
| Acompañante | Misma especie; posición derivada en cada cliente | Identidad SERVER, posición LOCAL | **Parcial** |
| Acción de jugador (talar, minar…) | No se transmite | NO IMPLEMENTADO | **No** |
| Hora del día / clima | 0,501 vs 0,497; lluvia en ambos, sólo porque cargaron con segundos de diferencia | LOCAL (reloj desde la carga de cada página) | **No** en general |
| Chat | Mismo historial y líneas | SERVER | **Sí** |

Invariantes del objetivo (§6 del pedido):

| Invariante | Hoy |
|---|---|
| Pokémon: misma instancia, mismo id, misma posición aproximada, mismo estado | **No se cumple** ninguna de las cuatro. |
| Recurso: ambos ven `tree-X`; si A tala, B lo ve; si se agota, para ambos; respawn coherente | Sólo la primera (el nodo existe para ambos con el mismo `nodeId`). |
| NPC: una sola copia lógica | Sólo los residentes estáticos. |
| Jugadores: presencia, posición, dirección, locomoción, acción | Presencia, posición y dirección sí; locomoción con la excepción de §3.4; acción no. |

---

## 7. Acciones visibles y acompañante

### 7.1 Qué existe hoy

| Pieza | Existe | Nota |
|---|---|---|
| Canal en tiempo real por área con interés espacial (AOI 20 casillas en ciudad, sectores en wild) | Sí | `PresenceRoom` + `interest.js`. Es el lugar natural para difundir acciones: ya filtra por cercanía. |
| Identidad visual del actor (personaje, acompañante) en la presencia | Sí | `publicActor`: `characterId`, `companionId`. |
| Id estable del objetivo de una acción de recurso | Sí | `nodeId` determinista (`nodePlacement.ts`), recalculable en el servidor. |
| Línea de tiempo visual de cada profesión | Sí, local | `choppingTimeline.ts`, `miningAction.ts`, `forageTimeline.ts`, `brewTimeline.ts`: ya describen una acción como inicio + duración + resultado, que es lo que un observador necesita para reproducirla. |
| Trabajador Pokémon que acompaña la acción | Sí, local | `workerSummon.ts` (efímero, independiente del acompañante de presencia). |
| Estado de acción en el protocolo | **No** | Ni mensaje ni campo. |
| Estado compartido del recurso (en uso, agotado, rebrota en T) | **No** | Las cargas son por usuario y viven en la sesión demo. |
| Autoridad de resultado (drop, XP, agotamiento) | **No** | Todo es la sesión demo local. |

### 7.2 Datos que faltan para que B vea a A talar con Scizor

Mínimo por actor, dentro de la presencia existente (no un segundo canal):

```text
action: { type: 'chop'|'mine'|'fish'|'forage'|..., targetId: nodeId, phase: 'start'|'end',
          seq, startedAt (hora de servidor), durationMs, companionRole?: 'worker'|'follower', outcome?: 'felled'|'done'|'cancelled' }
```

Y por recurso, sólo cuando cambia (el nodo en sí es determinista y no se transmite):

```text
resource: { nodeId, state: 'ready'|'busy'|'depleted', busyBy?, respawnAt? }
```

Cada cliente reproduce la animación con las líneas de tiempo que ya existen, alineadas a `startedAt`. No se mandan frames. Sin `serverTime` en los mensajes (hoy no existe), la alineación sería por llegada, con el retraso medido en §3 (~180–470 ms).

### 7.3 Dónde debería vivir

- **Servidor**: aceptar o rechazar la intención (`startAction(nodeId)`), estado del recurso, fin y resultado. Con la misma regla de AGENTS §2/§10: el cliente pide, el servidor decide.
- **Presencia**: difundir `action` y `resource` con el mismo interés espacial y el mismo batch de 50 ms. Una acción es un cambio de estado raro (segundos), no un stream: el costo de red es marginal frente al movimiento.
- **Acompañante**: el `companionId` ya viaja; falta un **rol** (`follower` / `worker`) y, para la acción, la casilla/orientación de trabajo, derivable del `nodeId` y del lado desde el que actúa el jugador. No hace falta un id de red propio mientras sea "el acompañante del actor X".

### 7.4 Costo esperado (HIPÓTESIS a medir en su fase)

Un evento de inicio y uno de fin por acción, del orden de decenas de bytes, más un cambio de estado de recurso. Con 30 jugadores en AOI y una acción cada ~5 s por jugador: ~12 eventos/s por cliente, contra los ~200 updates/s de movimiento por cliente medidos con 30 corredores (§4). No es el cuello; el diseño importa más por consistencia que por ancho de banda.

---

## 8. Clasificación de candidatos (sólo desde las mediciones)

### 8.1 Frame / render

| | |
|---|---|
| **Demostrado** | Spike en **cambio de área** por chunks construidos dentro del frame: peor frame de 66–136 ms, 12 builds de ~10 ms cada uno. Costo del HUD Vue del orden del frame del motor (p50 ~1,5–2 ms cada 150 ms). |
| **Descartado (escritorio, 60 Hz)** | Degradación con densidad: trabajo p95 2,2 → 2,4 ms de 0 a 31 remotos; 0 frames tarde en todas las capturas continuas; 0 long tasks salvo en viajes. Fuga de memoria en 10 min: no. |
| **Hipótesis** | Comportamiento real a 120/144 Hz y en iPhone (§10). Safari sin `requestIdleCallback` (chunks dentro del frame también al recorrer). Redondeo a píxel entero como fuente de "no fluye" en pantallas rápidas (demostrado en código y test; falta verlo en tu monitor). |
| **Peso** | Bajo en continuo; **alto en transiciones**. |

### 8.2 Movimiento remoto: cola e interpolación

| | |
|---|---|
| **Demostrado** | Cola de 3 sin recuperación: ~3 saltos de 4 casillas por remoto por minuto con datos perfectos bajo jitter, y esperas cortas constantes. Desincronía de velocidad al cambiar Shift en movimiento. Sin interpolación temporal: retraso fijo ~180–470 ms. |
| **Hipótesis** | Magnitud en producción (depende del jitter real Buenos Aires ↔ Miami y de redes móviles): lo cierra RUN-2 con personas (§10.4). |
| **Peso** | **El candidato principal para "el correr remoto no se ve fluido".** |

### 8.3 Batching

| | |
|---|---|
| **Demostrado** | Pisa el paso intermedio cuando dos pasos del mismo actor llegan en una ventana: el 100 % de esos casos es un salto de 2 casillas. Con cadencia estable no pisa nada: 0 de 121.800. |
| **Hipótesis** | Frecuencia de agrupamiento en el uplink real. El contador `stepOverStep` ya está en `/metrics` y lo mediría en producción. |
| **Peso** | Medio. Es fácil de aislar y se suma al punto anterior. |

### 8.4 AOI lifecycle thrashing

| | |
|---|---|
| **Demostrado** | Destrucción y recreación en el borde exacto de 20 casillas: ~30 por minuto con 30 remotos en movimiento cerca del borde, hasta 2 por entidad, reentrada a <1 s. Cada vez se pierde el estado de movimiento del actor. |
| **Descartado** | Costo de CPU o texturas: todo hit de caché, sin fallback visible. |
| **Peso** | Medio-bajo en rendimiento; medio en continuidad (actores que parpadean al borde de la vista). |

### 8.5 Sprite lifecycle

| | |
|---|---|
| **Demostrado** | El mecanismo del P0 original (rebuild total + recarga sin caché) ya no existe en el código y no se reprodujo. |
| **Hipótesis** | Condiciones no reproducidas (§4.2). Los saltos de 4 casillas (§8.2) son hoy el mecanismo más probable de "el sprite desaparece mientras camina". |
| **Peso** | Bajo con la evidencia actual. |

### 8.6 Shared-world authority

| | |
|---|---|
| **Demostrado** | Pokémon salvajes, NPC móviles, estado de recursos, acciones, hora y clima **no son compartidos**. Sólo lo son terreno, nodos, residentes, jugadores y chat. |
| **Clasificación** | **Arquitectura/producto, no rendimiento.** Es la mayor distancia entre el juego actual y "un mundo compartido". |
| **Peso** | El más grande en producto; no afecta frame time. |

### 8.7 Sospechas descartadas o acotadas

- "Con más jugadores cae el frame": no, hasta 31 remotos en escritorio (2,2 → 2,4 ms p95).
- "El batching rompe el movimiento siempre": no; sólo con pasos agrupados.
- "Los chunks tiran el frame al caminar": no en Chrome escritorio (40 builds ociosos, 0 en el frame). Sí al cambiar de área.
- "La memoria crece en sesiones largas": no en 10 min con 20 corredores ni en 3 ciclos de área.
- "El AOI recarga texturas": no; hit de caché.
- "El P0 de sprites sigue igual que en el playtest": el mecanismo de entonces ya no está; no reproducido.
- "La instrumentación altera lo medido": sonda de frame p95 0,1 ms fuera del trabajo medido; sonda de render sin diferencia medible (A/B: trabajo medio 1,40 vs 1,42 ms, p95 2,2 vs 2,2).

---

## 9. Propuesta de PERF-2 (no implementada)

Secuencia basada en la evidencia, en líneas separadas; cada una con su medición de antes y después usando estas mismas herramientas.

1. **PERF-2a — Fidelidad de locomoción remota** (mayor efecto visible, cambio acotado):
   - que la velocidad enviada sea la velocidad real del paso (arregla C/I sin tocar la red);
   - una estrategia de consumo de la cola que recupere atraso en lugar de saltar (una recuperación moderada al estar por detrás, o un pequeño buffer temporal);
   - gate: harness A–J con 0 saltos en `lan`/`miami` y `rough` acotado; MULTI-30 con saltos ≈ 0.
2. **PERF-2b — Pasos agrupados**: que la ventana de 50 ms no pise pasos intermedios (enviar la secuencia de pasos de la ventana, o dejar que el cliente la reconstruya). Gate: ráfagas ×2 sin saltos; bytes por cliente medidos con `benchmark:multiplayer`.
3. **PERF-2c — Transiciones de área**: preparar los chunks del área de destino antes o durante el fade, en vez de construirlos en el primer frame. Gate: TRAVERSAL-1/2 sin frames > 33 ms.
4. **PERF-2d — Borde del AOI**: medir con el mismo trace el efecto de una histéresis o de conservar el actor unos segundos. Gate: salidas/min y reentradas < 2 s ≈ 0 en MULTI-30-AOI.
5. **Aparte, fuera de PERF-2: Shared World** (arquitectura/producto): responsabilidad propia con breakdown AGENTS §17. Autoridad de Pokémon salvajes y NPC por área, estado de recursos y acciones en la presencia, hora del servidor.

Antes o junto a PERF-2a: las capturas de dispositivo real (§10), para confirmar que el ritmo en 120/144 Hz y en iPhone no pide adelantar el redondeo de cámara o el HUD.

---

## 10. Pruebas físicas que necesito de vos

Todo corre en tu PC, contra un servidor realtime **local** en modo benchmark: no toca producción, no hace falta cuenta (cada ventana es un jugador sintético). El build **playtest** (puerto 4174) es igual al de producción (DPR 1) y te pide el código de acceso de siempre.

### 10.1 Preparación (una vez)

1. En una terminal, en la carpeta del repo, en la rama `perf/1-instrumentation`:
   `node scripts/perf/local-stack.mjs`
2. Esperá la línea `[perf] playtest  http://192.168.1.6:4174/?benchmarkId=pc-a`. Si Windows pregunta por el firewall de Node, permitilo en **redes privadas** (el iPhone lo necesita).
3. Dejala corriendo. Ctrl+C al terminar todo.

Cada captura aparece como un archivo en `docs/performance/baselines/incoming/` cuando tocás **Enviar a PC** (o se envía sola en los recorridos automáticos).

### 10.2 PC principal (monitor real)

Anotá la frecuencia del monitor (Configuración → Pantalla → Pantalla avanzada). Chrome en ventana normal, **pantalla completa** con F11, sin otras pestañas pesadas.

| # | Abrí | Qué hacer |
|---|---|---|
| PC-1 | `http://192.168.1.6:4174/?benchmarkId=pc-a&x=31&y=20&perfScenario=city-loop&perfLabel=pc-city` | Ingresá el código. El recorrido arranca solo (~1 min) y se envía solo. No toques nada. |
| PC-2 | `http://192.168.1.6:4174/?benchmarkId=pc-a&area=pradera&x=-5&y=-69&perfScenario=pradera-line&perfLabel=pc-pradera` | Igual (~70 s). |
| PC-3 | `http://192.168.1.6:4174/?benchmarkId=pc-a&x=31&y=20&perfLabel=pc-manual` | En el panel PERF-1 tocá **Iniciar**, caminá y corré a mano 60 s por la ciudad (Shift para correr, soltalo y volvé a apretarlo mientras caminás), **Detener**, **Enviar a PC**. |

Si tu monitor es de más de 60 Hz, repetí PC-1 con el monitor a 60 Hz (misma URL, `perfLabel=pc-city-60hz`).

### 10.3 iPhone 15 Pro

Wi-Fi de la misma red que la PC. **Modo Bajo Consumo apagado** (limita a 30 Hz). Safari, vertical, sin zoom.

| # | Abrí en Safari | Qué hacer |
|---|---|---|
| IP-1 | `http://192.168.1.6:4174/?benchmarkId=ip-a&x=31&y=20&perfScenario=city-loop&perfLabel=iphone-city` | Código, esperar ~1 min. Se envía solo; el panel dice "Guardado en la PC". |
| IP-2 | `http://192.168.1.6:4174/?benchmarkId=ip-a&area=pradera&x=-5&y=-69&perfScenario=pradera-line&perfLabel=iphone-pradera` | Igual. **Importante**: Safari no tiene `requestIdleCallback`; esta captura dice cuántos chunks se construyen dentro del frame en iPhone. |
| IP-3 | Ajustes → Accesibilidad → Movimiento → **Limitar frecuencia de cuadros** activado, y repetir IP-1 con `perfLabel=iphone-city-60hz` | Para comparar ProMotion (120 Hz) con 60 Hz. Después volvé a desactivarlo. |

### 10.4 Dos jugadores lado a lado (MULTI-2, RUN-2, TRAVERSAL-2)

Dos ventanas de Chrome en la PC, una al lado de la otra (o PC + iPhone):

- Ventana A: `http://192.168.1.6:4174/?benchmarkId=duo-a&x=31&y=20&perfLabel=duo-a`
- Ventana B: `http://192.168.1.6:4174/?benchmarkId=duo-b&x=31&y=20&perfLabel=duo-b`

1. En **B** tocá **Iniciar** y no la toques más (B observa).
2. En **A**, durante ~90 s: caminá recto 10 casillas, corré recto 10, caminá y sin frenar apretá Shift, corré y sin frenar soltá Shift, zig-zag corriendo, frená de golpe, y cruzá el portón oeste a Pradera y volvé.
3. En B: **Detener** → **Enviar a PC**.
4. Si podés, grabá la pantalla con las dos ventanas (Win+Alt+R en la barra de juegos) para comparar cuadro a cuadro.
5. Mirando las dos ventanas, anotá: ¿los Pokémon salvajes de Pradera son los mismos en A y B? ¿los wanderers de la ciudad están en el mismo lugar? ¿la hora del día y el clima coinciden?

Con esas capturas completo la tabla de dispositivos real (§2.3).

---

## 11. Clasificación del diff de PERF-1 (`68f35cb..perf/1-instrumentation`)

| Tipo | Archivos |
|---|---|
| **Instrumentación / tooling puro** (no corre en producción) | `src/features/wildlands/perf/*` (sin tests), `scripts/perf/*`, `scripts/benchmark-presence.mjs`, `vite.config.ts` (plugin sólo con `VITE_PERF=on`), `.gitattributes` |
| **Tests** | `perf/*.test.ts` (6 archivos), `PresenceRoom.test.js` (+1 test) |
| **Hooks mínimos en runtime** | `engine/perfHooks.ts` (nuevo, +39), `game.ts` (+17/−0), `renderer.ts` (+14/−1), `chunks.ts` (+16/−4), `characters.ts` (+3), `WildlandsView.vue` (+14/−2), `colyseusPresence.ts` (+4/−1) |
| **Hooks mínimos en servidor** | `observability/metrics.js` (+6/−1), `rooms/PresenceRoom.js` (+8/−2) |
| **Modificaciones que alteran comportamiento real** | **Ninguna en builds normal ni playtest.** En builds `VITE_PERF=on`: el cliente puede unirse como jugador sintético del benchmark (sólo lo acepta el room local de benchmark). |

**Confirmación explícita, revisada línea por línea:**
- **`PresenceRoom.js`:**
  - `pending.set(...)` recibe exactamente el mismo valor: la condición `folds` es la misma expresión, extraída a una variable.
  - Se agregan `metrics.deltaQueued(...)` y `metrics.batchSent(...)`, contadores en memoria sin efectos sobre el envío.
  - **Sin cambio** en frecuencia de envío, ventana de 50 ms, contenido de los batches, AOI (`interest.js` intacto), movimiento (`movement.js` intacto) ni ciclo de vida de actores.
- **`game.ts`:**
  - dos `performance.now()` y una llamada a la sonda, sólo si hay sonda instalada;
  - `setFrameProbe`/`setVirtualSprint` sólo los llama el módulo de medición.
  - Loop, `dt`, movimiento, reconciliación y cola remota intactos.
- **`renderer.ts`:** sin sonda, `collectActor` **es** la función original (`collectOne`); la sonda de frame es `this.probe?.frame(...)`. Orden, culling y dibujo intactos.
- **`chunks.ts`:**
  - los builds ociosos pasan por `buildInIdle` (mismo `get()` y mismo `lastUsed = frame - 1`);
  - `timeRemaining()` sólo se lee con sonda;
  - LRU, evicción, precarga y generación del mundo intactas.
- **`characters.ts`:** la caché de hojas no cambió; el `.then` extra sólo se agrega con sonda.
- **`WildlandsView.vue`:** sin `VITE_PERF`, el port es el juego y el HUD se asigna igual que antes.
- **Interpolación / cola remota:** sin cambios (`queueRemoteStep`, `advanceRemoteActors`, `MAX_REMOTE_STEP_BACKLOG`).
- **Verificado:**
  - 1.959 tests del cliente y 65 del servidor en verde;
  - typecheck OK; lint con 0 errores;
  - builds normal y playtest sin rastros del módulo de medición (`grep` de 6 marcadores = 0).
- **Overhead:** §8.7 (sonda de frame p95 0,1 ms; sonda de render sin diferencia medible).

---

## 12. Experimento: ¿contribuyen los NPC a los saltos remotos? (2026-09-24)

Motivo: en la prueba física PC + iPhone, correr remoto "no llega a 10/10" y los dos clientes ven los NPC en posiciones distintas.

### 12.1 Qué dice el código (FACT)

- La colisión con NPC existe **sólo en el cliente**: el walker (`game.ts` `rules.occupied`) y el navegador de toques (`nav.occupied`) consultan `populace.actors` del propio cliente.
- El servidor **no conoce ni valida colisiones**: `movement.js` sólo valida dirección, secuencia y ritmo ("bounds pace, not collision").
- Los jugadores remotos no chocan con nada (no están en `occupied`).
- Si A y B tienen el mismo NPC en posiciones distintas (demostrado en §6):
  - cuando A choca con un NPC que en B no está ahí, A no envía movimiento (se envía al completar una casilla); B lo ve frenar o girar sin motivo; no hay corrección ni rechazo, porque el servidor no sabe del choque;
  - al revés, A puede atravesar una casilla donde B tiene un NPC, y B ve a A superpuesto.
  - No produce saltos: no hay un paso de más ni de menos, sólo una pausa real de A.
- Los corredores sintéticos del benchmark corren sólo en el servidor: los NPC de cualquier cliente **no pueden afectarlos por construcción**.

### 12.2 Variante `VITE_PERF` (no existe en los builds normal ni playtest)

- `?perfNpc=off` reemplaza la población del cliente por una vacía. El walker, el navegador y el renderer leen esa misma lista, así que se van a la vez el dibujo, la simulación y la **colisión**. Se reaplica cada frame (una población nueva al cambiar de área vive a lo sumo un frame).
- Se quitan residentes, wanderers y Pokémon de plaza en la ciudad; Pokémon salvajes y entrenadores en wild.
- Traza de bloqueos del jugador local: momento (reloj de pared), causa (NPC / Pokémon / terreno), id del actor, casilla.
- Saltos remotos con reloj de pared, para cruzarlos con los bloqueos del otro cliente.
- También se exportan las correcciones y los rechazos de presencia.
- Tests: `collisionTrace.test.ts`, `perfSession.test.ts` (la población se vacía también tras un cambio de área).

### 12.3 Resultados (headless, 10 corredores sintéticos con el mismo patrón en cada corrida, 2 repeticiones)

A recorre la ruta (`city-loop` / `pradera-loop`, cerca de los corredores); B mira desde el spawn con la misma configuración de NPC. Crudos en `baselines/2026-09-24/npc-experiment/`; tabla con `node scripts/perf/npc-analyze.mjs …`.

| Corrida | NPC | Saltos de corredores/min (B) | Esperas (B) | Saltos de A vistos por B | Bloqueos de A por NPC | Saltos de A ≤ 1,5 s tras un bloqueo | Esperado por azar | Reconc. / rechazos de A | Trabajo p95 A / B |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| ciudad r1 | sí | 33,1 | 129 | 2 | 2 | 0 | 0,1 | 0 / 0 | 2,3 / 2,0 |
| ciudad r2 | sí | 33,0 | 70 | 2 | 2 | 0 | 0,1 | 0 / 0 | 2,3 / 2,1 |
| ciudad r1 | no | 34,4 | 70 | 4 | 0 | — | — | 0 / 0 | 2,2 / 2,0 |
| ciudad r2 | no | 34,4 | 85 | 4 | 0 | — | — | 0 / 0 | 2,3 / 2,1 |
| Pradera r1 | sí | 31,3 | 26 | 1 | 0 | — | — | 0 / 0 | 2,4 / 2,1 |
| Pradera r2 | sí | 31,3 | 25 | 1 | 0 | — | — | 0 / 0 | 2,3 / 2,1 |
| Pradera r1 | no | 31,3 | 55 | 1 | 0 | — | — | 0 / 0 | 2,3 / 2,1 |
| Pradera r2 | no | 31,3 | 66 | 2 | 0 | — | — | 0 / 0 | 2,3 / 2,1 |

### 12.4 Conclusión

- **DEMOSTRADO**: los saltos de los jugadores remotos **no cambian** con o sin NPC. En la ciudad, 33,0–33,1 saltos/min con NPC contra 34,4 sin NPC; en Pradera, 31,3 en los dos casos. Tampoco cambian el trabajo del frame ni los drawables de forma relevante.
- **DEMOSTRADO**: no hay correlación `choque con NPC → corrección → salto`. Hubo 4 choques de A con NPC y 0 saltos de A vistos por B en la ventana posterior; tampoco hubo reconciliaciones ni rechazos.
- Las esperas cortas de B varían bastante entre repeticiones (25–129), sin patrón a favor de una variante. Son ruido de la cola (§3.4), no un efecto de los NPC.
- Lo que sí producen los NPC divergentes es **inconsistencia**, no saltos: A frena ante un NPC que B no ve, o B ve a A atravesar un NPC. Es un problema de mundo compartido (§6, WORLD-1), no de locomoción.
- La causa de los "pequeños saltos al correr" sigue siendo la de §3.4: la cola sin recuperación, la ventana de 50 ms con pasos agrupados y el desfase de Shift en movimiento.

Pendiente: tu comparación visual en PC e iPhone de las cuatro variantes (URLs en el chat de 2026-09-24).
