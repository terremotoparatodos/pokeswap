# CLOUD JOIN-ORDER-2 — Implementación del contrato de orden de joins

**Estado:** implementado en una rama y congelado para revisión. No está integrado ni desplegado, y no hubo SQL hosted. El orden de joins queda **apagado** salvo con `WORLD_JOIN_ORDER=on`, y ningún entorno existente lo tiene. `WORLD_PRESENCE_RECOVERY` sigue apagado en todos.

- **Rama:** `feat/cloud-join-order-2-0.3`, desde `feat/cloud-readiness-3-0.3 @ 5ca9ccd`, que sigue congelada.
- **Diseño de referencia:** `design/cloud-join-order-1 @ 23e04da`, también congelada. El prototipo **no** se aplicó: el código se escribió de nuevo y se probó como producto.
- **Convenciones:** **FACT** (código o prueba ejecutada aquí), **INFERENCE** (deducción), **OPEN QUESTION** (pregunta abierta).
- **Evidencia:** `docs/design/cloud-join-order-2/evidence/`, sin rutas locales ni secretos.

## 1. Qué cambia y una decisión de lectura

El contrato es el de JOIN-ORDER-1:
- cada join de una página lleva su **intento**;
- un intento viejo o repetido de la misma cuenta y página **falla él**: nunca se cierra la conexión vigente;
- cada proceso lo aplica en su memoria, y la base de datos lo aplica entre procesos (claim v3).

**Diferencia deliberada con el prototipo.** El prototipo de JOIN-ORDER-1 dejaba que un intento **más nuevo** de la misma página **tomara** la fila de un dueño activo o inaccesible. Esta implementación **no** lo hace. Las condiciones de esta etapa dicen: «el contador no sustituye autenticación ni autoriza takeover», «"Jugar acá" sigue siendo explícito, nunca automático» y «la regla de toma por "misma página" de M0 sigue fuera de alcance».

Por eso claim v3 solo **agrega rechazos**:
- `stale_attempt` para un intento menor que el del dueño;
- `duplicate_attempt` para uno igual con otra clave.

Toda otra decisión es **exactamente** la de v1 (`recovery = false`) o la de v2 (`recovery = true`). Un diferencial de 30 casos contra v1/v2 lo prueba (§5). La consecuencia está en §3 (L1).

## 2. Garantías

### 2.1 En un proceso, con `WORLD_JOIN_ORDER=on`

FACT: tests `rooms/PresenceRoomJoinOrder.test.js` y mutantes (§5).

**Rechazos en admisión:**
- **Intento viejo o repetido:** la admisión lo rechaza con **4410**, en la cola síncrona de `admit`.
- **Revalidación:** se repite justo antes del reemplazo (`stillLatest`).
- **Efecto sobre la conexión vigente:** no se cierra, no se mueve y no se reintenta.
- **Intento ilegible:** **4422**. Cuenta como ilegible un intento que no es un entero seguro en `[1, 2^31 − 1]`, o que llega sin una página válida.

**Lo que no cambia:**
- La regla de `resume` sigue antes que el orden: un resume de **otra** página es 4409, con cualquier número de intento.
- «Jugar acá» sigue reemplazando como hoy, de forma explícita.
- Los guests y los clientes sin intento siguen como hoy (`legacy`).

**Alcance de la comparación:** solo dentro del mismo `(cuenta, página)`. Otra página u otra cuenta empiezan su propio orden.

**Memoria (D3):** `WORLD_JOIN_ORDER_MAX_PAGES`, por defecto 10 000.
- **Valores admitidos:** un entero en `[CONNECTION_LIMIT, 1 000 000]`; cualquier otro valor usa el defecto.
- **Al pasar el límite:** se olvida la página menos recientemente admitida **sin socket vivo** en este proceso.
- **Páginas con socket vivo:** nunca se olvidan (`keptLive`). Están acotadas por el límite de conexiones. Si aun así se superara el límite, el mapa crece y lo cuenta (`overflow`): ninguna garantía se pierde en silencio.
- **Desalojos:** se cuentan (`evicted`). Una página olvidada pierde solo el rechazo temprano de este proceso; la base sigue ordenándola si tiene v3.

### 2.2 Entre procesos: claim v3, `on` y autoridad con v3

FACT: `PresenceRoomJoinOrderClaims.test.js`, batería en Postgres real e integración con procesos reales.

**Qué guarda la fila:**
- La fila de `world_player_locations` registra `owner_page`, `owner_attempt` y `owner_page_session`.
- Esos datos valen **solo** mientras `owner_page_session = owner_session`.
- Un claim v1/v2, de otra versión o de otra página, cambia `owner_session` y los invalida sin ambigüedad.

**Rechazos:**

| Caso | Respuesta | Qué escribe | Qué ve el socket |
|---|---|---|---|
| Intento **menor** que el del dueño, misma página, **cualquier clave** | `stale_attempt` | Nada | Hidratando: cerrado con 4410, **nunca colocado**. Colocado: 4410 en `on`; en persistencia `shadow` solo se cuenta |
| Mismo intento con **otra clave** (replay) | `duplicate_attempt` | Nada | Igual |
| Reintento interno del **mismo** claim (misma clave y sesión) | Adopción, primero | Nada nuevo | Idempotente: misma época |

### 2.3 Cliente (D2, D6, D7)

FACT: `joinAttempt.test.ts` y mutantes.

- **Numeración:** cada join que abre la página toma `++lastAttempt` en el momento de enviarse. Eso incluye la primera entrada, las reconexiones, `renew()` y «Jugar acá». Nunca se reenvía un número. Recargar la página empieza de nuevo con otro `TAB_ID`.
- **4410 sobre un intento abandonado:** silencioso. No cambia el overlay, no reconecta y no deja la room vigente.
  - Hay dos capas: el adaptador ya detenido no emite estado, y el controlador ignora el estado de un socket reemplazado.
  - Por eso el mutante que quita solo la primera capa sobrevive, como se espera.
- **4410 o 4422 sobre el socket propio de la página:** se detiene **sin reintentar**, sin bucle. La espera del ingreso vence hacia la pantalla de error, cuyo botón es la única salida.
- **Sin serialización bloqueante de joins (D6).** La protección contra callbacks abandonados ya existía (adaptador `stopped` y generación del controlador) y ahora tiene tests con 4410.

## 3. Límites (no cubiertos por diseño o por compatibilidad)

**L1 — Orden inverso con dos hosts activos.**
- **Cuándo pasa:** el intento **viejo** reclama **primero** en el host más nuevo, y el intento nuevo llega después al host más viejo.
- **Qué recibe el intento nuevo:** la respuesta de v1/v2, porque el contador no autoriza takeover.
  - Sin recovery: 4409, «reemplazada». Es lo que pasa hoy.
  - Con recovery: 4503 y reintento, porque hay un host más nuevo activo y el viejo drena.
- **Efecto:** la fila queda con el intento abandonado hasta que su host termine.
- **Frecuencia (INFERENCE):** solo ocurre en la ventana de solapamiento de dos hosts activos (D3 de ROLLOUT-1).
- FACT: test `the reverse order …` y escenario J2.
- Cerrarlo exige una regla de toma por intento, que es una decisión del dueño (§9).

**L2 — Flota mixta o autoridad sin v3.**
- **Flota mixta:** un claim v1/v2 de otro proceso invalida el orden de la página. Desde ahí rige el orden por claves hasta el próximo claim v3 (J5 y el test `mixed fleet`).
- **Autoridad sin v3** (Edge v6, o SQL sin la migración): la capacidad se apaga sola (`edge-v6` o `sql-missing`). Queda **solo** el orden dentro del proceso, y R3 entre procesos se comporta como hoy.
- **Rollback del SQL con un proceso vivo:** una llamada v3 falla como `unsupported`, la **misma clave** pasa una vez por v1/v2 y la capacidad queda apagada. Recovery no se toca.

**L3 — Memoria.** Una página **sin** socket vivo olvidada por el límite (§2.1) pierde el rechazo temprano en ese proceso. Si el proceso tiene v3, la base lo cubre.

**L4 — `shadow` solo observa en memoria.**
- No manda página ni intento a la base y nunca usa v3. Por eso no puede medir lo que v3 rechazaría.
- Cuenta `wouldRefuse`, `stale`, `duplicate`, `invalid` y `legacy`.

**L5 — Garantía condicionada al cliente.** Un cliente viejo, sin intento, no recibe ninguna garantía nueva. Un cliente nuevo contra un realtime viejo tampoco: el campo se ignora.

**L6 — Recovery retirado fuera de orden.** Si se revierte el SQL de recovery con un realtime que todavía tiene recovery habilitado, la llamada v3 con `p_recovery = true` falla. Se apaga el orden y se cae a v2/v1 con la misma clave.
- INFERENCE: el orden documentado (§8) lo evita.
- El rollback de recovery ahora se **niega** mientras exista v3.

**L7 — Host activo no es host enrutado.** Igual que en READINESS-3: la integración local no tiene NGINX.

## 4. Decisiones del dueño, aplicadas

| | Decisión | Implementación |
|---|---|---|
| D1 | `WORLD_JOIN_ORDER=off\|shadow\|on`, apagado; shadow solo observa | `joinOrderMode`, que se lee una vez al cargar el módulo. Shadow no rechaza, no cierra y no llama a v3 (test `modes`, mutante `shadow-enforces`, integración SHADOW) |
| D2 | 4410 viejo o repetido, 4422 inválido; tratamiento del cliente y compatibilidad | `closeCodes.js` y `closePolicy.ts`. No chocan con Colyseus (4000–4003, 4010, 4217) ni con 4001/4409/4503. Un cliente sin intento nunca los recibe. Los dos códigos viajan por el SDK real (integración SAME) |
| D3 | Memoria acotada y configurable; nunca desalojar una página viva | §2.1; tests D3; mutante `live-page-forgotten` |
| D4 | Migración nueva, separada de recovery | `20261006120000_world_location_join_order.sql`. Ninguna migración histórica cambió; el golden de las 14 funciones anteriores es idéntico |
| D5 | Sin A2 separado: contrato completo | Así se hizo |
| D6 | Contador y protección contra callbacks abandonados; sin serialización bloqueante | §2.3 |
| D7 | 4410 silencioso para el intento descartado; 4422 vigente sin bucle | §2.3; mutantes `client-4410-reconnects` y `client-4410-unmapped` |

## 5. Pruebas y resultados reales

Corridas en Node 22.23.2 salvo indicación. Un timeout, una cancelación o un fixture roto nunca contaron como detección: los runners los reportan como BLOCKED.

| Capa | Prueba | Resultado (FACT) |
|---|---|---|
| Reproducciones originales **sin cambios** | `design/cloud-join-order-1: repro/barriers.test.mjs` contra este árbol; `cloud-readiness-3/evidence/lateAbandonedJoin.test.mjs` | 4/4 y 1/1. Sin intento, el comportamiento es el de hoy (compatibilidad de clientes viejos) |
| Las mismas formas **con** intento | R1/R2 en `PresenceRoomJoinOrder.test.js`; R3/R4 en `PresenceRoomJoinOrderClaims.test.js` (también sin intento) | Corregidas: el viejo recibe 4410 y el vigente queda intacto. Sin intento, las expectativas originales siguen iguales |
| Un proceso | `PresenceRoomJoinOrder.test.js` | **19/19**: casos 1 (estacionado y tardío), 5 (revalidación), 6, 7, 8, D3, 9, modos, guests y métricas |
| Dos procesos y Edge → RPC → realtime | `PresenceRoomJoinOrderClaims.test.js` | **13/13**: 3/4/5 con recovery off y on; orden inverso (L1); R4 entre procesos; socket colocado desde el caché (on y shadow); replay; respuesta perdida reintentada con la misma clave; 6/7; flags; autoridad v6; rollback con proceso vivo; camino adaptador Edge → handler v7 → RPC → SQL con dos procesos |
| Capacidad y ruteo | `joinOrderCapability.test.js` | **6/6** |
| SQL en PGlite | `worldLocationJoinOrder.database.test.js` | **13/13**, incluidos el diferencial de **30 casos** contra v1/v2 (estado del dueño × claves × takeover × recovery), permisos (0 filas, con control no vacío), golden de las 14 funciones anteriores, restricción de forma y rollback con reaplicación doble |
| SQL en **Postgres real** 17.6 (`supabase/postgres:17.6.1.158`, base dedicada `cr5_joinorder`) | `scripts/world-location/join-order-concurrency/run.mjs`, 5 rondas, barreras deterministas | Ver §5.1 |
| Integración local (staging del candidato) | `scripts/world-location/join-order-integration.mjs`: procesos reales, sockets del SDK real, autoridad local con el handler v7 sobre PGlite | **4/4 PASS** (§5.2) |
| Mutantes del realtime, cliente y Edge | `docs/design/cloud-join-order-2/evidence/joinOrderMutants.mjs` | **16 DETECTED y 1 SURVIVED esperado** (§5.3); restauración limpia |
| Edge | `deno test supabase/functions/world-authority/`; `deno check` | **31/31** (base: 26). Control: los tests v7 contra el handler v6 de `5ca9ccd` fallan 4/4 en los positivos, y el de compatibilidad pasa en los dos |
| Realtime completo | `node --test "src/**/*.test.js"` | Corrida 2: **708 tests, 674 pass, 0 fail, 34 skipped**. Corrida 1: **1 fail** en `realtimeProcess.test.js` («rollout: … both survive», `fetch failed`, procesos y puertos reales); aislado pasa 3/3, y el archivo no cambió desde `5ca9ccd`. Es intermitencia por carga, preexistente, y no se cuenta como resultado. Base `5ca9ccd`: 657/623/34. Los 34 skips son los gates de staging RC-0.3, preexistentes. En Node 24.19: 708/674/0/34 |
| Cliente | Vitest completo | **207 archivos, 1951 tests** pass (base: 206/1941) |
| typecheck | `npm run typecheck` | **5 errores, todos preexistentes**, en `ownerUnreachable.test.ts`: `.at()` con `lib: ES2020`. El archivo y `tsconfig` no cambiaron desde `5ca9ccd`, así que fallan igual en la base. Los archivos de esta rama tipan limpio. Queda como hallazgo para coordinar (§10) |
| Lint | `npx eslint .` | **0 errores**; 9 warnings preexistentes de `AuthModal.vue` |
| Build | `npm run build` | OK; `dist/` está en `.gitignore` |
| `git diff --check` | rango `5ca9ccd..HEAD` | limpio |

### 5.1 Batería en Postgres real

Fuente: `evidence/join-order-concurrency.{txt,json}`.

**Cómo corre:**
- Toma el SQL commiteado (`git show HEAD:`), con barreras de advisory lock en las líneas `-- @hook` observadas en `pg_stat_activity`.
- Parte de los privilegios por defecto de Supabase. `join-order-grants-check.sql` y `location-grants-check.sql` deben dar 0 filas.

| Escenario | Qué prueba |
|---|---|
| J1 | El intento viejo desde un host **más nuevo** no toma la fila; el vigente sigue guardando. Con recovery off y on |
| J2 | Orden inverso: v1/v2 deciden, sin takeover por intento. Off y on |
| J3 | Concurrencia con lock de fila, en los dos órdenes y con los dos juegos de reglas |
| J4 | Duplicado simultáneo desde dos hosts: uno solo reclama |
| J5 | Flota mixta: tras un claim v1, la información de página no vale |
| J6 | Dueño drenando: `owner_draining`, y su flush final se conserva |
| J7 | Reintento del **mismo** claim compitiendo consigo mismo: idempotente |
| J8 | Un claim rechazado que sostiene la fila no hace perder el save del dueño |
| J9 | El drain del host que llama espera al claim en vuelo (`FOR SHARE`) |
| D | Deadlocks sobre J3, J4, J7 y J8 |

**Mutantes y el escenario que debe atraparlos:**

| Mutante | Escenario |
|---|---|
| `no-same-page-refusal` | J1 |
| `no-page-session-binding` | J5 |
| `duplicate-takes` | J4 |
| `attempt-authorizes-takeover` (la regla del prototipo) | J2 |
| `no-row-lock` | J4 |
| `adoption-removed` | J7 |
| `caller-no-share` | J9 |

**Resultado:** corrida final en `bf3a081` (el SQL y la batería son idénticos desde `45056a6`), Postgres 17.6, 5 rondas, exit 0.
- La **migración pasa**: J1–J9 y D 5/5, **0 deadlocks**, permisos cerrados (0 filas en los dos checks).
- Los **7 de 7 mutantes son DETECTED**, cada uno en su escenario. Algunos fallan además en otros escenarios: por ejemplo, `no-row-lock` también rompe J3, J7 y J8.
- Una corrida anterior en `45056a6` dio lo mismo.

**Aclaración del conteo «seis/siete escenarios» de JOIN-ORDER-1** (FACT, `design/cloud-join-order-1: evidence/claim-v3-postgres.json`):
- La batería del prototipo tenía **7 entradas**: P1–P6, seis escenarios de comportamiento, y **D**, una verificación de deadlocks que vuelve a correr P3 y P4 y compara `pg_stat_database.deadlocks`.
- Todas dieron 5/5. «6/6 escenarios» contaba solo los de comportamiento; «P1–P6 y D 5/5» las siete entradas. Las dos frases describen la misma corrida.
- Además, la propuesta de JOIN-ORDER-1 escribe «P1–P6 de READINESS-3» refiriéndose a las **decisiones** P1–P6 de READINESS-3, no a esos escenarios. Es una colisión de nombres.
- Aquí la batería definitiva tiene **10 entradas**: J1–J9, nueve de comportamiento, y D.

### 5.2 Integración local

Fuente: `evidence/join-order-integration.{txt,json}`.

**SAME:**
- **`on`:**
  - El SDK real recibe **4410** en el join viejo y **4422** en un intento ilegible.
  - El socket vigente sigue abierto y se mueve.
  - `/metrics` muestra solo agregados.
- **Control** (sin flag): el join viejo reemplaza al vigente con **4409**, como hoy.

**TWO:** A es el host viejo y B el nuevo. A no se entera de B durante la prueba, porque su renew falla.
- **`on`:**
  - El intento viejo en B se cierra con **4410** y nunca se coloca.
  - La fila queda con A y el intento 2.
  - El vigente nunca se cerró, y su casilla es la guardada.
  - Claims observados: `A: location_claim_v3 → claimed` y `B: location_claim_v3 → stale_attempt`.
- **Control:** el abandonado se coloca y toma la fila por clave, y el vigente recibe 4409.

**NO_V3:** con el SQL sin v3, la capacidad queda `disabled (sql-missing)`, el orden en proceso sigue rechazando con 4410 y los claims van por v1.

**SHADOW:** se comporta como hoy (4409), cuenta `wouldRefuse = 1` y nunca llama a v3.

### 5.3 Mutantes del realtime, cliente y Edge

Fuente: `evidence/join-order-mutants.txt`. Cada uno quita una protección y corre el test que debe atraparlo.

| Capa | Mutantes |
|---|---|
| Un proceso | `admission-order-removed`, `duplicate-admitted`, `invalid-attempt-accepted`, `shadow-enforces`, `recheck-removed`, `live-page-forgotten` |
| Entre procesos | `v3-never-used`, `stale-claim-not-final`, `stale-hydrating-placed`, `stale-answer-unread`, `fallback-disables-recovery`, `takeover-without-recovery` |
| Edge | `edge-takeover-without-recovery` |
| Cliente | `client-attempt-not-advanced`, `client-4410-reconnects`, `client-4410-unmapped` |
| SURVIVED, esperado | `client-abandoned-status-layer`: segunda capa, porque el controlador ignora un socket reemplazado |

**Sobre la revalidación:** en JOIN-ORDER-1 el mutante `recheck-removed` **sobrevivía**. Aquí se **detecta**, porque el caso 5 introduce un await entre la admisión y el reemplazo.

**Sobre las esperas:** la primera corrida dio cuatro mutantes entre procesos BLOCKED, porque se atrapaban por timeout de espera. Se corrigió el test: ahora espera con límite y **afirma** el resultado (`ebea745`). Nunca se contaron como detección.

## 6. Bloques y commits

| Commit | Bloque |
|---|---|
| `a734356` | 1. Cliente y tratamiento de respuestas tardías |
| `8aeea49` | 2. Admisión y orden por proceso |
| `0997671` | 3. SQL persistente y permisos (migración, grants check, rollback, PGlite) |
| `45056a6` | 3. Batería en Postgres real |
| `198a7df` | 4. Operación Edge v7 y negociación de capacidad |
| `358c5b8` | 5. Integración (capacidad, ruteo, respuestas finales) y compatibilidad |
| `f515133` | 5. Integración con procesos reales (harness aditivo: `connect({ attempt })`, traza de `location_claim_v3`) |
| `ebea745` | Esperas acotadas con aserción explícita |
| `bf3a081` | Mutantes |
| *(este)* | Informe y evidencia |

**Cambios en archivos de READINESS-3**, mínimos y obligados por la superposición:
- `rollback_world_presence_recovery.sql` ahora se niega mientras exista v3.
- Sus tests revierten primero el orden de joins.
- La forma de `capabilities()` gana `joinOrder` y `joinOrderReason`.
- `localDatabase.js` aplica la migración nueva.

Ninguna regla de READINESS-3 cambió.

## 7. Compatibilidad

| Combinación | Resultado (FACT salvo indicación) |
|---|---|
| Cliente viejo (sin intento) + realtime nuevo | Comportamiento de hoy en todos los modos: reproducciones originales y tests R1/R2/R3 sin intento |
| Cliente nuevo + realtime viejo | El realtime viejo ignora `attempt`. FACT por `git grep` en `5ca9ccd`: ningún código lee `options.attempt`; el único `attempt` es un campo interno del journal (`pending.attempt`). El cliente nunca recibe 4410/4422 de él |
| Realtime nuevo + autoridad sin v3 (Edge v5/v6 o SQL sin migración) | Capacidad apagada (`edge-v5`, `edge-v6`, `sql-missing`); orden solo en proceso; claims v1/v2 como hoy (test y NO_V3) |
| Realtime viejo + autoridad nueva (Edge v7 + SQL) | Las ops v5/v6 responden igual (Deno: v2 y v5 no pasan campos de página); las funciones v1/v2 están intactas (golden) |
| Dos procesos, ambos v3 | Orden global por la fila (J1–J9, TWO) |
| Flota mixta | L2: un claim v1/v2 invalida el orden de la página; nunca hay dos dueños |
| `off` | Exactamente hoy: no lee intentos, no recuerda nada y no llama a v3 |
| `shadow` | Admite como hoy y cuenta; nunca llama a v3 ni cierra por esto |
| `on` | Aplica 4410/4422 y v3 si la autoridad lo tiene |

## 8. Rollback

1. **Inmediato:** `WORLD_JOIN_ORDER` sin definir u `off`, y reinicio del realtime (lo decide el dueño). Nada se lee ni se escribe con la página después.
2. **Edge:** volver a la versión sin `location_claim_v3`. Es opcional: si la función SQL falta, v7 ya responde 501 y el realtime cae a v1/v2 con la misma clave.
3. **SQL:** `scripts/world-location/rollback_world_location_join_order.sql`. Va en una transacción y borra las dos funciones, la restricción y las tres columnas. Debe ir **antes** de `rollback_world_presence_recovery.sql`, que ahora se niega si v3 existe. El rollback de ordering también se niega: su post-check ve las columnas `owner_page*`.
4. **El cliente** con `attempt` es inocuo frente a cualquier servidor.

El orden de despliegue (INFERENCE, ningún paso se ejecutó) es el inverso del rollback. Primero la migración, luego Edge v7 y luego el realtime en `shadow`; después el cliente y, por último, `on`, por decisión del dueño.

## 9. Decisiones pendientes del dueño

| # | Decisión | Nota |
|---|---|---|
| P-1 | ¿Cerrar L1 con una regla de toma por intento, misma página e intento mayor? | Es la regla del prototipo, que aquí se **retiró** porque el contador no autoriza takeover. El mutante `attempt-authorizes-takeover` muestra exactamente qué cambiaría (J2) |
| P-2 | ¿Qué hace el cliente con 4410/4422 en su **propio** socket? | Hoy se detiene y espera la pantalla de error. ¿Mensaje propio? |
| P-3 | ¿Probar `shadow` en un entorno local dedicado antes de `on`? | Por ejemplo, PM2 + NGINX de ROLLOUT-1 con dos slots. No se hizo aquí: no se pidió repetir esas baterías |
| P-4 | La regla de «misma página» de M0 | Sigue sin autorizar; este contrato no la habilita |

## 10. Hallazgos para coordinar (no corregidos aquí)

> **Errata** (rama `fix/cloud-candidate-h1-typecheck-0.3`, `docs/design/CLOUD_CANDIDATE_FIXES_REPORT.md` §2). Aquí y en §5 el typecheck se atribuyó a READINESS-3 **deduciéndolo** de que el archivo no cambió, sin correrlo sobre la base. Después se **comprobó**: con el mismo entorno, `5ca9ccd` y `0e5842c` dan los mismos 5 errores. La causa es el `.at()` del test con `lib` ES2020, y se corrigió en `7580844`.

- **READINESS-3 (`5ca9ccd`):** `npm run typecheck` falla en `src/features/wildlands/multiplayer/api/ownerUnreachable.test.ts`, con 5 usos de `.at()` y `lib: ES2020`. El informe de READINESS-3 dice «typecheck sin errores». No se tocó ese archivo: le corresponde a la revisión de READINESS-3.
- `presence/recoveryCapability.test.js` conserva el nombre «… world-authority v6 handler …», pero ahora corre contra el handler v7. Solo es el nombre; el contenido se ajustó a la forma nueva de `capabilities()`.
- **JOIN-ORDER-1:** la colisión de nombres «P1–P6» (§5.1).

## 11. Entorno dejado

- **Worktree** `pokeswap-joinorder2` con `node_modules` como junction a int1. **No se debe correr `vite dev` ahí.** `dist/` quedó construido localmente y está ignorado.
- **Base `cr5_joinorder`** en el contenedor local `supabase_db_wlocpg-orig`. Es dedicada; la base `postgres` del stack no se tocó.
- **Ramas congeladas, intactas:** `feat/cloud-readiness-3-0.3 @ 5ca9ccd` y `design/cloud-join-order-1 @ 23e04da`.
- **No se tocó:** int1, el entorno oscuro, producción, PM2, flags existentes, secretos, hosted, CLOUD STARTUP-1, C1 ni el ecosistema de la secundaria.
