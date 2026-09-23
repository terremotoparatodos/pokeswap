# PokeSwap — Bitácora de rendimiento y estabilidad

> Bitácora acumulativa multi-sesión. Al empezar una sesión: leer `CLAUDE_PERFORMANCE_STABILITY_MASTER.md` y **la última entrada** de este archivo. No reiniciar la investigación.
> Convención: **FACT** (comprobado), **INFERENCE** (deducido), **OPEN QUESTION**.

---

## Sesión 1 — 2026-09-23 (America/Buenos_Aires)

### Punto de partida

- Rama de trabajo: `perf/stability-investigation`, creada desde `origin/docs/performance-stability-handoff` @ `cba10e6`.
- FACT: `cba10e6` difiere de `origin/playtest/community-0.1` @ `26f3b7c428a00769b82a8f0eea1336371ae3a80c` sólo en `CLAUDE_PERFORMANCE_STABILITY_MASTER.md`. El árbol estaba limpio.
- Documentos leídos completos: AGENTS, INVARIANTS, TRUST_BOUNDARY, MASTER, HANDOFF, R30_PRODUCTION_HANDOFF y el README de realtime. Commits revisados: `5ffd09e`, `01037df` y `26f3b7c`, con sus pruebas.

### Entorno de esta sesión (limita lo que se pudo ejecutar)

- Contenedor en la nube: Ubuntu 24.04, 2 vCPU Xeon 2,1 GHz, 7 GB de RAM, Node v22.22.2 y npm 10.9.7.
- **Bloqueo:** la política de egress devuelve 403 para `registry.npmjs.org`, pypi, `pokeswap.lol`, `*.colyseus.cloud` y `api.github.com`. El git proxy **no autoriza push** a `terremotoparatodos/pokeswap`. Consecuencias:
  - No se pudo correr `npm ci`, así que tampoco `npm test` (vitest), `npm run typecheck`, `npm run build`, `npm run lint` ni `npm run benchmark:multiplayer`.
  - No hay medición visual del juego: producción está detrás del código de acceso del playtest. Sólo se hicieron lecturas HTTP desde el navegador integrado del escritorio (ver "Acciones en producción").
  - Los commits son locales. Se entregan como bundle o patch para que el usuario los empuje.
- Verificación sustituta, **marcada como parcial**:
  - Suite del servidor con `node --test`. `@colyseus/core` se reemplazó por un stub de dos métodos mediante un loader hook (sólo `Room`, `ServerError` y `Server`), así que se ejercita la lógica de PokeSwap y no el transporte de Colyseus.
  - Pruebas nuevas del cliente, bundleadas con el esbuild que trae `tsx` y ejecutadas sobre un shim mínimo de la API de vitest.
  - Typecheck parcial con `tsc` global sobre `game.ts`, `colyseusPresence.ts` y las pruebas nuevas, con shims de tipos para dependencias ausentes. **Cero errores nuevos** frente a `26f3b7c`: los dos conjuntos de errores son idénticos y todos vienen de los shims.
  - Lint: no se pudo correr. El harness trae un `eslint-disable` justificado para `no-explicit-any`.

### Hechos comprobados

1. **FACT — causa determinista del "punto seguro" en Pradera.** `PresenceRoom.changeArea` ubicaba Pradera en `WILD_SPAWN = (8, 41)`, que es la llegada de la **ciudad** desde la puerta oeste (`hearthome.ts:141`).
   - El cliente llega a Pradera por `WildArea.arrival()`, que es `World(208).findSpawn(['grassland'])` = **(-5, -69)**.
   - En Pradera, `(8, 41)` **es sólido**. Se comprobó con el `World` y con el `Atlas` reales.
   - Secuencia: el snapshot trae `(8,41)` → `safeAuthoritativePosition` lo rechaza → el cliente se ubica en la llegada y envía `area: pradera` → el servidor vuelve a `(8,41)` → el ciclo sigue **indefinidamente**. Cada vuelta es un RTT e incluye snapshot, historial de chat y toast.
   - Esto explica la observación del handoff: una tecla sostenida cruzó el portal oeste, apareció el mensaje de corrección y el jugador quedó en Pradera. **Clasificación: posición autoritativa inválida por contrato de llegada roto.** No fue foco, rolling deploy ni carrera.
2. **FACT — regreso a la ciudad.** Al volver de Pradera, el servidor ubicaba al jugador en `(31,20)` mientras el cliente estaba en `(8,41)`, junto a la puerta. El jugador se teletransportaba a la plaza, o quedaba desfasado si seguía caminando.
3. **FACT — reinicio de secuencia.** `returnToLobby()` y la recuperación a spawn seguro ponían `nextMoveSequence = 0`, pero la secuencia del servidor nunca retrocede. Cada paso dado antes del snapshot de respuesta se rechazaba como replay y el jugador volvía bruscamente a la posición anterior.
   - Además, el rechazo por replay se reportaba como `rate` ("movement rate denied"), lo que ocultaba la causa.
4. **FACT — la ventana deslizante de 10/s rechaza pasos legítimos después de un stall.** Simulación: 20 s corriendo a 7,5 casillas/s, latencia de 60 ms más jitter. Las cifras son rechazos por corrida:

   | Stall | Ventana 10/s (prod) | Bucket C15 R10 |
   |---|---|---|
   | 200 ms | 0 | 0 |
   | 350 ms | 1 | 0 |
   | 500 ms | 2 | 0 |
   | 1000 ms | 5 | 0 |
   | 1500 ms | 9 | 0 |
   | 2500 ms | 16–17 | 5 |

   - Cada rechazo deja al servidor una casilla atrás **para siempre**, porque el cliente nunca se entera: el ack de esa secuencia no llega.
   - Tope contra abuso: ambos permiten 100 casillas cada 10 s sostenidos. La ráfaga máxima tras estar quieto pasa de 10 a 24 casillas en el primer segundo.
   - El servidor no tiene colisión: la transitabilidad la decide el cliente en ambos casos, así que el cambio no modifica la frontera de confianza.

### Reproducción determinista (harness)

`scripts/presence-harness/run.sh` usa el `PresenceRoom` real (con la base de Colyseus en stub) y la reconciliación real de `WildlandsGame` (instancia por prototipo, sin DOM). Hay colas de mensajes en ambos sentidos que preservan el orden del socket. Resultados:

| Escenario | 26f3b7c (prod) | Servidor nuevo + cliente viejo | Servidor viejo + cliente nuevo | Rama |
|---|---|---|---|---|
| S1 entrar a Pradera, 20 RTT | **20 recuperaciones**, 21 `area`; server (8,41) ≠ cliente (-5,-69) | 0 recuperaciones, convergen | 20 recuperaciones | 0, convergen |
| S2 "Ciudad" y seguir caminando 3 pasos | **3 rechazos**, vuelve a (31,20) | 3 rechazos | 0, (31,23) = server | 0, (31,23) = server |
| S3 ida y vuelta a Pradera | 4 recuperaciones, 1 rechazo, llega a (31,20) | 0, (9,41) = server | 4 recuperaciones | 0, (9,41) = server |
| S4 stall de 1,6 s con 12 pasos encolados | **2 rechazos; cliente (32,25) ≠ server (31,24) permanente** | — | — | 0, convergen |

**Compatibilidad (FACT por harness):** el fix de servidor sólo elimina el bucle de Pradera para el cliente **ya publicado**, sin redeploy del frontend. El fix de cliente es compatible con ambos servidores. Orden de publicación recomendado: **primero Colyseus, después el frontend.**

### Cambios y commits (locales, sin push)

| Commit | Qué |
|---|---|
| `5c65765` fix(realtime) | `protocol/arrival.js` (+ `.d.ts`): contrato único de llegada que espeja `Area.arrival(from)`. `changeArea` lo usa y también fija `dir`. Prueba de servidor más prueba de contrato en el cliente (`arrivalContract.test.ts`). Se actualizó la expectativa de interés wild (tx 12, ty -69, seq 17). |
| `f4d0e1f` fix(realtime) | Token bucket de 10/s con ráfaga de 15 (`applyMove` devuelve la razón: `invalid`/`replay`/`rate`). Pruebas de stall, tope sostenido y razones. |
| `5f0c911` feat(realtime) | `GET /version` en el puerto público: `{service, commit, protocol: 2, startedAt}`, con commit validado por regex y nunca eco del entorno. `/metrics` interno suma moves, areaChanges, reconnectRestores, uptime, memoria y lag del event loop. Se agregaron pruebas. |
| `487ffb8` fix(playtest) | `requestPresencePlacement()`: conserva la secuencia y agrega la barrera `awaitingAreaSnapshot`, que ignora `presence:self` hasta el snapshot que responde. El adaptador indica la fuente (`snapshot`/`self`). Pruebas en `presenceReconciliation.test.ts`: las 3 fallan en 26f3b7c y pasan en la rama. |
| `752b5bf` test(playtest) | Harness determinista reutilizable. |

Estado de pruebas por commit (cada uno verificado en un worktree aislado):

- Servidor: 52 → 55 → 60 → 60 → 60 aprobadas, 0 fallidas (base: 49).
- Cliente, pruebas nuevas y de reconciliación: todas aprobadas.
- Diff escaneado: sin secretos.

### Acciones en producción

- Ninguna escritura: no hubo push ni deploy.
- Observación de sólo lectura, hecha desde el navegador integrado del escritorio del usuario (viewport 526×606, DPR 1):
  - FACT: `https://us-mia-2a460f24.colyseus.cloud/` → 200 "Colyseus 0.18.13".
  - FACT: `/version` → **404**. Es el baseline de protocolo 1; tras el deploy debe responder 200 con `protocol: 2`.
  - FACT: `https://pokeswap.lol/` muestra "COMMUNITY PLAYTEST 0.1 · 26F3B7C" y la pantalla de **código de acceso**.
- La reproducción en vivo del bucle en Pradera requiere que el usuario ingrese el código del playtest y tenga una sesión autenticada. Quedó pendiente.

### Gates pendientes antes de publicar (no cumplidos todavía)

1. `npm ci && npm test && npm run typecheck && npm run build && npm run lint` en el cliente (CI o una máquina con acceso a npm). El objetivo son 1.922 + 5 pruebas y cero warnings nuevos.
2. `cd services/realtime && npm ci && npm test` con Colyseus real (60 pruebas).
3. Verificar que Colyseus Cloud 0.18.13 sirve `/version` con la opción `express` (la API existe en el tag `@colyseus/core@0.18.13`, `Server.ts:68`; `express@5.2.1` está en el lockfile). La raíz `/` debe seguir respondiendo "Colyseus 0.18.13".
4. Recorrido visual de Ciudad y Pradera, menús, chat y skills (§12–13 del prompt). **No se hizo.**
5. Matriz de benchmark de 1, 10, 30, 50 y 100 jugadores (§14). **No se hizo**, bloqueada por npm.

### Runbook propuesto (cuando los gates estén verdes)

1. **Servidor:**
   - Fusionar `5c65765..5f0c911` en `playtest/community-0.1` sin los commits de cliente, o todo junto: el frontend se redespliega solo, pero es compatible.
   - Redeploy en Colyseus Cloud. Esto requiere que el usuario inicie sesión.
   - Verificar: `curl https://us-mia-2a460f24.colyseus.cloud/version` → `protocol: 2`. `/` debe responder 200 y el matchmaking también.
   - Entrar a Pradera: no debe aparecer el toast "punto seguro".
2. **Frontend:**
   - Push a `playtest/community-0.1` para que se despliegue.
   - Verificar que el HUD muestre el commit nuevo.
   - Probar "Ciudad" caminando y el regreso desde Pradera junto a la puerta oeste.
3. **Rollback:**
   - Servidor: redeploy de `26f3b7c` en Cloud.
   - Frontend: `git revert` del merge en `playtest/community-0.1`.
   - Sin force-push.

### Problemas abiertos

- OPEN QUESTION: después de un rechazo real (abuso o stall > 1,5 s), el cliente no se entera y el desfase persiste. Opciones:
  - que el servidor consuma la secuencia rechazada y envíe `presence:self`;
  - que el cliente reconcilie cuando el ack llega con `moveSequence < next` y hay un timeout sin acks.
  - Requiere un diseño cuidadoso con `keepsPredictedStep`. Prioridad media ahora que el bucket evita los falsos positivos.
- OPEN QUESTION: el servidor no conoce la colisión. Toda posición es "autoritativa" sólo en ritmo y secuencia. Documentado. No se cambia sin decisión de producto.
- OPEN QUESTION: si Colyseus Cloud no inyecta un commit, `/version` informará `commit: unknown`. Habría que definir `PRESENCE_BUILD_COMMIT` en el panel al desplegar; no es un secreto.
- El `(8,41)` de Pradera también afectaba a `BenchmarkPresenceRoom` (hereda `changeArea`). Los benchmarks previos en Pradera arrancaban en un sólido del servidor. Esto no invalida el RTT, pero sí cualquier métrica de reconciliación de esos benchmarks.

### Próximo experimento exacto

En una máquina con npm:

1. `git fetch` de esta rama (o aplicar el bundle).
2. `npm ci && npm test && npm run typecheck && npm run build && npm run lint`.
3. `cd services/realtime && npm ci && npm test`.
4. `npm run benchmark:multiplayer -- --players 30 --area pradera` (antes y después), registrando reconciliaciones.
5. Recién entonces, recorrido visual de Pradera: entrar, esperar 10 s y contar mensajes `area` en la pestaña Network (esperado: 1).

---

## Sesión 1, continuación — 2026-09-23

Inicio: `12ab150`. El entorno sigue igual: push, npm y la API de GitHub devuelven 403 (se verificó de nuevo).

### Hechos y correcciones

5. **FACT — un rechazo real dejaba desfase permanente.** Con un stall de 3,2 s y 24 pasos encolados (harness S5) se rechazan 9 pasos. El último ack corresponde a una secuencia menor que la del cliente, así que el cliente lo ignora para siempre: cliente (35,28) ≠ server (34,26).
   - Fix `1fd49ac`: el servidor consume la secuencia rechazada sin mover al actor y responde `presence:self`.
   - Resultado: el cliente converge a (34,26). La secuencia consumida no puede repetirse.
6. **FACT — 68 casillas de la ciudad son transitables pero inalcanzables desde el spawn** (BFS ortogonal sobre la colisión estática real):
   - el patio cercado entre Silph Co. y el departamento 1, (36–38, 7–12);
   - las franjas x=6 y x=57, filas 14–29;
   - fragmentos de la fila 0 junto a los portones norte.
   - La restauración de posición y la reconciliación las aceptaban: se comprobó con `(37,9)`.
   - Fix `40e672f`: `TownArea.isReachable()` (flood fill cacheado). La restauración las rechaza y la reconciliación las trata como colisión.
   - Resto de la auditoría estática: las 6 puertas, sus umbrales y la fila frente a cada una son transitables y alcanzables. Los 5 portones y sus llegadas también. Hay 21 casillas sin salida, todas umbrales o rincones de fachada, esperables.
7. **FACT — `KeyboardInput.detach()` no limpiaba las teclas sostenidas.** Un keyup ocurrido con un panel abierto o la pestaña oculta se perdía y, al volver, el jugador caminaba solo.
   - Nota: la pausa por visibilidad hace `detach` sin que haya `blur`.
   - Fix `fa852ba`: `detach()` llama a `clear()`. La prueba nueva falla en 26f3b7c.
   - **INFERENCE — cadena completa de la observación original:** cambio de visibilidad con una tecla apretada → la tecla queda pegada → el jugador camina hasta el portón oeste → entra a Pradera → bucle de "punto seguro" (hecho 1). Cada eslabón está demostrado por separado; la secuencia exacta de aquella automatización no se puede reproducir.
8. **FACT — el ancho de banda de presencia es O(N²) con el payload completo.** Soak con la lógica real del room: 60 s virtuales, todos corriendo en la plaza a 7,5 pasos/s, flush cada 50 ms. Tamaño estimado en JSON (Colyseus usa msgpack, que pesa menos, pero la proporción se mantiene).

   | Jugadores | CPU lógica p50 / p99 (ms por s) | Mensajes/s | KB/s por cliente (legacy → step) |
   |---|---|---|---|
   | 1 | 0,03 / 0,7 | 8 | 1,2 |
   | 10 | 1,1 / 6,8 | 150 | 13,3 → 7,7 |
   | 30 | 6,6 / 22,7 | 451 | 40,2 → — |
   | 50 | 18 / 39 | 752 | 67,2 → 36,4 |
   | 100 | 76 / 138 | 1.503 | **134,4 → 72,2** |

   - Fix `c8f121b`: deltas `step` compactos para clientes que declaran `presenceProtocol: 2`, con fusión con un `upsert` pendiente en la misma ventana. Los clientes legacy siguen recibiendo `upsert`.
   - Resultado: −46 % de bytes y el mismo CPU. Con 100 jugadores la CPU de lógica es ~7,7 % de un núcleo: no es el cuello de botella.
9. **FACT — sin fuga de memoria en el room.** Soak de 15 min virtuales con 100 jugadores y 850 joins, mitad de recambio por minuto. El heap después de GC pasa de 5,2 MB a 4,8 MB. Al salir todos queda en 4,2 MB y, tras expirar el caché de reconexión (timers reales de 15 s), en 3,7 MB. El crecimiento aparente de ~30 KB/min era el caché bajo el reloj virtual.

### Commits de esta continuación (locales)

`1fd49ac`, `40e672f`, `fa852ba`, `c8f121b`, más esta bitácora.

- Servidor: 64 pruebas, 0 fallidas.
- Cliente: las pruebas tocadas pasan con el shim local (colyseusPresence 5, presenceReconciliation 4, keyboard 2, townPosition 2, arrivalContract 2, remoteActors 4, movementReconciliation 3).
- Typecheck parcial: sin errores nuevos.
- Harness: los 5 escenarios convergen.

### Compatibilidad cliente/servidor (actualizada)

| Servidor \ Cliente | 26f3b7c | rama |
|---|---|---|
| 26f3b7c (protocolo 1) | producción actual | funciona, pero sigue el bucle de Pradera (es del servidor). El servidor viejo ignora `presenceProtocol` y envía `upsert` |
| rama (protocolo 2) | sin bucle. Recibe `upsert`, sin deltas `step` | todo |

El orden sigue siendo: **servidor primero, frontend después.**

### Próximo experimento exacto (sin cambios de prioridad)

1. En una máquina con npm, correr los gates completos: vitest, typecheck, build, lint, suite del servidor con Colyseus real y `npm run test:load`.
2. `npm run benchmark:multiplayer -- --players 100 --duration 120` antes y después, para medir bytes reales con msgpack y confirmar el −46 %.
3. Recorrido visual de Ciudad y Pradera (§12–13) con el código del playtest: tecla sostenida más cambio de pestaña; esperado: el jugador no camina solo.
