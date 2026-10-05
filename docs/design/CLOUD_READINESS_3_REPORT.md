# CLOUD READINESS-3 — Implementación acotada de M0 y validación local

**Estado: implementado en una rama, congelado para revisión. No integrado, no desplegado, sin SQL hosted.**
La funcionalidad queda **apagada** salvo con `WORLD_PRESENCE_RECOVERY=on`, y ningún entorno existente la tiene.

- **Rama:** `feat/cloud-readiness-3-0.3`, desde `integration/world-skills-0.3 @ ad6a98e`.
- **Diseño de referencia:** `docs/cloud-readiness-1-proposal @ b24f021` (propuesta) y `validation/cloud-readiness-2 @ 52f72de` (validación). Los prototipos de esas ramas **no** se copiaron: el SQL, la Edge y el realtime de aquí se escribieron y probaron como producto.
- **Convenciones:** **FACT** (código o prueba ejecutada aquí), **INFERENCE**, **OPEN QUESTION**.

## 1. Condición previa: el contrato real de reconexión — el bloque «misma página» se detuvo

**Qué pedía M0 del prototipo.** Una regla de «misma página»: si el `tabId` del claim coincide con el de la sesión dueña, la página puede tomar su propia fila aunque el dueño siga activo o inaccesible.

**Qué muestra el contrato real (FACT, con pruebas):**

1. **Cliente.** `colyseusPresence.overlap.test.ts`: un `WorldEntryController.renew()` (cambio de sesión) con el primer join todavía en vuelo abre un **segundo** join con el **mismo** `TAB_ID`, que es por módulo, es decir, por página. Además, el join **abandonado** puede resolverse **después** del nuevo. La página hace `leave()` de la room abandonada, pero solo cuando el servidor ya la admitió.
2. **Servidor**, en `ad6a98e` (`docs/design/cloud-readiness-3/evidence/lateAbandonedJoin.test.mjs`). En un mismo proceso, ese join abandonado y tardío (un join fresco, sin `resume`, con el mismo `tabId`) **reemplaza al socket vigente de la página**: le manda 4409, y la página queda «reemplazada» sin que exista otra pestaña. **Es un defecto preexistente**, ajeno a este cambio.

**Conclusión.** Un `tabId` igual no distingue la conexión vigente de una abandonada. El servidor no tiene evidencia propia de cuál considera actual la página: solo ve el usuario autenticado, el `sessionId` de Colyseus por socket y el orden de llegada, que no es el orden del cliente. Trasladar la regla extendería el defecto anterior **entre procesos**: un claim tardío de la página quitaría la fila a su propia sesión viva. **No se implementó.**

**Alternativa que no se implementó** porque amplía protocolo y SQL, y requiere aprobación:
- el cliente manda un contador monotónico por página (`connectionSeq`, que crece en cada `connect`);
- el servidor lo compara en la admisión local (corrige además el defecto 2 dentro de un proceso);
- la base lo guarda junto al dueño, y la toma por misma página exige el mismo `tabId` **y** un `connectionSeq` mayor.

Es un dato que declara el cliente y que solo puede perjudicar al mismo usuario. Queda como **requisito pendiente** (§8).

**Sin esa regla, M0 queda así:**
- Un dueño `stopped` se toma: sus sockets se cerraron antes de detenerse.
- Un dueño `draining` hace esperar (4503).
- Un dueño inaccesible devuelve 4503 y, tras reintentos acotados, «Jugar acá» explícito.
- Un dueño vivo mantiene el orden de v1.

## 2. Decisiones aplicadas

| Decisión | Aplicación |
|---|---|
| **P1** dueño inaccesible | 4503 con `presence:closing` = `owner-unreachable`. El cliente reintenta como en un drenaje y, tras **4** cierres seguidos (backoff 0,5 → 4 s, ≈ 7,5 s), se detiene en el estado `held`: «El servidor donde estaba tu partida no responde.», con **«Jugar acá»**. Solo ese botón manda un join fresco con `takeover: true`. Nunca es automático y nunca va con `resume`: el servidor lo ignora si viene con `resume`. 4409 queda para los reemplazos que el contrato identifica: join fresco que reemplaza en el mismo proceso, resume local frente a otra pestaña viva, `superseded` sin `newerActive` y save `stale`. |
| **P2** ubicación | La recuperación restaura la **última casilla que confirmó la base** (la fila), y solo posición y área: XP, materiales, capturas y recompensas no se tocan (otros caminos, con su propio CAS). La fila restaurada pasa por `restoreFromRow` igual que cualquier otra (área persistible, `layoutVersion`, tile seguro) y después rigen las reglas de movimiento (test P2: un layout viejo se repara a la llegada del área). Checkpoints y pérdida esperable: §2.1. |
| **P3** M0 | Sin liberación de filas al desconectar (M1). **Sin `GRACE`**: ninguna toma depende solo del vencimiento del lease. Un dueño `active` vencido o un `draining` vencido son `unreachable`: un resume y un join fresco común **no** toman la fila; solo el takeover explícito lo hace. Un dueño vivo nunca se toma con clave menor, ni con takeover. |
| **P4** standby | La recuperación validada: un proceso desplazado que **no** recibió SIGINT/SIGTERM sondea `world_presence_any_active()`. Sin hosts activos, adquiere una **identidad nueva** y la activa con `world_presence_activate_exclusive`, que se niega con otro host activo y **cede** ante un candidato `starting` de generación menor. La identidad desplazada no se resucita nunca. No hay promoción «bajo demanda». |
| **P5** kill switch | `WORLD_PRESENCE_RECOVERY=on` activa; cualquier otro valor, incluido no definirla, la deja **apagada**. Se lee una vez, al cargar los módulos (después de CLOUD ENV-1, así que vale desde `.env.cloud` o el proceso), y **cambiarla requiere reiniciar el proceso**. Con la recuperación apagada, el comportamiento es exactamente el de WORLD LOCATION-4: sin sondeo, sin v2, sin standby, mismos códigos de cierre (tests y control negativo). No se activó en ningún entorno. |
| **P6** C2 | Fuera del mínimo: no se implementó la retención del proceso viejo. |
| C1 y CLOUD STARTUP-1 | Separados. `ecosystem.config.js` no cambia y `7823f14` no se integra. |

### 2.1 Checkpoints y pérdida esperable (P2)

- **Escritura de ubicación** (FACT, `locationJournal.js`): un tick por segundo, con un lote en vuelo como máximo.
  - Un portal o una desconexión es **urgente**: se guarda en el siguiente tick (≤ 1 s).
  - Cualquier otro movimiento es un checkpoint: **10 s** desde la última escritura del jugador más un jitter en `[0, 2 s)`.
  - En un apagado ordenado, el drenaje guarda todo lo pendiente con un plazo de **3 s** (`SHUTDOWN_LOCATION_FLUSH_MS`).
- **Pérdida esperable en condiciones normales:**
  - en un apagado ordenado dentro de plazo, ninguna;
  - en un **crash**, los movimientos posteriores al último guardado: hasta unos **12 s** de recorrido (10 s + 2 s de jitter + el tick).
- **Sin autoridad no hay cota.** Los guardados fallan y se reintentan, y el jugador sigue sin persistencia. No se promete ningún límite temporal durante una caída de la autoridad.

## 3. Diff de producto (22 archivos, +832 / −44, sin tests ni docs)

| Capa | Archivos | Qué |
|---|---|---|
| **SQL** | `supabase/migrations/20261005120000_world_presence_recovery.sql` | Aditiva: cinco funciones solo para `service_role`, `SECURITY INVOKER`, `search_path` fijo. Son `recovery_version` (marcador de capacidad), `owner_state` (sin lock), `claim_keyed_v2` (con `p_takeover`), `activate_exclusive` (lock de tabla y cesión) y `any_active`. Sin tablas, columnas ni índices, y sin tocar funciones v1. Scripts: `recovery-grants-check.sql` y `rollback_world_presence_recovery.sql`. |
| **Edge** | `world-authority/handler.ts`, `index.ts` | v6: `capabilities` (según el SQL real), `location_claim_v2` (solo forma keyed, con `takeover` booleano explícito), `presence_activate_exclusive` y `presence_any_active`. Una función ausente (`PGRST202`/`42883`) da **501 `unsupported`** en las ops nuevas; las ops v5 conservan su contrato exacto (una función ausente sigue dando 500). `index.ts` pasa el código de error, nunca el mensaje. |
| **Realtime** | `presence/recoveryCapability.js` (nuevo), `world/persistence/playerData.js`, `playerDataMetrics.js` | Capacidad por proceso: un sondeo, desactivación permanente ante `RecoveryUnsupported` y sin degradar ante errores transitorios. `withRecovery` hace v2 y, si es `unsupported`, la **misma clave** una vez por v1. Adaptadores SQL y Edge para las ops nuevas. El decorador de métricas las deja pasar. |
| | `presence/locationJournal.js`, `locationService.js`, `rooms/locationJoin.js` | `owner_draining`/`owner_unreachable` son reintentables, nunca finales. Mapa de cierres (§2), takeover por sesión y contadores de shadow (`wouldRetry`). |
| | `presence/hostLifecycle.js`, `rooms/presenceHosting.js`, `rooms/PresenceRoom.js`, `realtimeServer.js`, `observability/metrics.js` | Activación exclusiva (identidad nueva y terminal). Standby. El apagado lo desactiva y detiene la identidad en promoción, también directo a la autoridad. `onShutdown` detiene el host promovido. `/metrics` agrega `hosting` (agregados, sin ids). |
| **Cliente** | `closePolicy.ts`, `presence.ts`, `worldEntry.ts`, `worldEntryController.ts`, `colyseusPresence.ts`, `WorldEntryOverlay.vue`, `WildlandsView.vue` | Razón `owner-unreachable`, reintentos acotados, estado `held` con «Jugar acá» y `takeover` solo desde ese botón. |

## 4. Pruebas y controles negativos

| Capa | Prueba | Resultado (FACT) |
|---|---|---|
| SQL, Postgres **real** 17.6 (`supabase/postgres:17.6.1.158`, base dedicada `cr3_validation`) | `scripts/world-location/recovery-concurrency/run.mjs`: SQL commiteado, barreras deterministas inyectadas en memoria, 15 escenarios × 5 rondas. Incluye claim contra renew, drain, stop y el save del dueño; dos claims; exclusiva contra normal y contra su propio stop | migración **PASS**; **8/8 mutantes DETECTED** (owner-share, caller-no-share, draining-takes, unreachable-takes, takeover-ignored, draining-expired-stopped, no-yield, excl-no-lock); permisos cerrados (0 filas) partiendo de los privilegios por defecto de Supabase. `evidence/recovery-concurrency.{json,txt}`. El SQL no cambió desde `27b75d4`. |
| SQL, PGlite | `worldPresenceRecovery.database.test.js` | 18/18: decisiones, D2-A, exclusiva, permisos con control no vacío, **golden de las funciones v1** (definición y ACL contra una base sin la migración), rollback y re-aplicación. |
| Rollback de ordering | `worldLocationOrdering.database.test.js` | El rollback de ordering se **niega, todo o nada**, mientras existan las funciones de recuperación (test nuevo); los tests de rollback siguen el orden documentado. |
| Edge | `deno test supabase/functions/world-authority/`; `deno check` de `handler.ts` e `index.ts` | 26/26; control: los tests v6 contra el `handler.ts` de `ad6a98e` fallan 5/5 en los positivos. |
| Capacidades contra el handler **definitivo** | `presence/recoveryCapability.test.js`, incluido el camino adaptador Edge → handler v6 real → SQL, con el SQL revertido bajo un proceso vivo | 7/7 en Node 22 y 24. |
| Realtime (room, lifecycle, journal, cierres, standby) | `rooms/PresenceRoomRecovery.test.js` | 15/15 (×3): D2-B corregido (control: con el switch apagado reproduce el 4409 falso), P1/P3, draining, dueño vivo, P2, shadow, kill switch, rollback de capacidad, D2-A con identidad nueva, cesión, SIGINT antes y durante la promoción, dos procesos y SQL eliminado en standby. |
| Controles negativos del realtime | `evidence/realtimeMutants.mjs` (mutantes aislados, restaurados con `git`; el runner se niega a correr con cambios sin commitear) | 9 DETECTED y 1 SURVIVED **esperado**: la re-comprobación de apagado es una segunda capa, y sin la primera queda detectada. `evidence/realtime-mutants.txt`. |
| Realtime completo | `node --test` (Node 22.23.2), los 67 archivos | **657 tests, 623 pass, 0 fail, 34 skipped** en dos corridas seguidas (base `ad6a98e`: 615/581/34). En una tercera, corrida justo al detener el contenedor de emulación, falló 1 test **de tiempo real**: `a claim slower than 1.5 s plays on in Ciudad` midió 2612 ms frente a 1,5 s. Aislado pasa 5/5 y esa ruta (el timeout de hidratación) no cambió aquí: es intermitencia por carga, preexistente. |
| Integración local | `scripts/world-location/recovery-integration.mjs`: procesos **reales** + la autoridad real local (handler v6 sobre PGlite) | **7/7 PASS** (detalle en §5). |
| Emulación PM2 + NGINX + agente | arnés de CLOUD ROLLOUT-1 (copia `harness-r3`, árbol `r3`) | Rollout normal PASS. D2 con join (`old-crash-early-join` ×3): **ningún 4409 y todos los jugadores conectados**; el control (switch apagado) reproduce `4409/replaced` y deja a un jugador fuera (§6). |
| Cliente | Vitest completo; `npm run typecheck`; `npx eslint .`; `npm run build` | 206 archivos y **1941 tests** pass; typecheck sin errores; eslint **0 errores** (9 warnings preexistentes de `AuthModal`); build OK. El cliente no cambió después de estos gates (`0e5842c`). |
| `git diff --check` | rango `ad6a98e..HEAD` | limpio |

**Timeouts, fixtures rotos y errores del arnés nunca contaron como detección:** las baterías los reportan BLOCKED.

Fallos del arnés que aparecieron y se corrigieron, ninguno contado como resultado:
- un escenario X6 que se bloqueaba con su propio `acquire`;
- un spy que filtraba su barrera al adaptador compartido;
- el `maxBuffer` del runner de mutantes;
- un check leído después de `leave()`;
- el trazado de `location_claim_v2` en la autoridad local;
- esperar `ready` de un candidato desplazado;
- el runner de mutantes restauró con `git checkout` un archivo que tenía una corrección **todavía sin commitear**, y la borró. Se rehizo y se commiteó antes de repetir los mutantes, y desde entonces el runner se niega a correr con cambios sin commitear.

### 4.1 Defectos de producto encontrados por la validación integrada (corregidos)

1. **El decorador de métricas descartaba las ops nuevas.** En todo despliegue real la recuperación quedaba `disabled (store)` (`fb3245b`). Los tests unitarios no lo veían porque usan el adaptador sin decorar; la integración con procesos reales sí.
2. **Activación tardía tras un SIGTERM.** Si el proceso salía con la activación exclusiva en vuelo, esa activación llegaba después y dejaba una identidad `active` **sin proceso** durante un lease. Ahora la parada también va directa a la autoridad: la activación tardía responde `host_inactive` (`dba2e13`; test e integración).

## 5. Validación integrada (procesos reales, autoridad local real)

| Escenario | Resultado |
|---|---|
| D2-A | El proceso viejo, desplazado, recupera un host con **identidad nueva** (generación 1 → 3) **5,1 s** después de detenerse el otro; `/readyz` 200; un jugador entra. **Control** (switch apagado): 25 s después, sin ningún host activo y 503. |
| D2-B | El resume en el host más viejo restaura la casilla guardada por el dueño detenido. **Control:** el mismo resume recibe el **4409 falso** (`replaced`). |
| Dueño caído (crash, lease vencido) | Un resume y un join fresco común reciben **4503 `owner-unreachable`** sin escribir nada; «Jugar acá» (takeover) restaura la casilla. |
| SIGTERM durante la promoción | El proceso sale con 0. La activación tardía encuentra la identidad ya detenida (`host_inactive`) y no queda ningún host activo sin proceso. |
| Autoridad caída en standby | Sin promoción mientras falla (3 sondeos fallidos); promueve cuando vuelve. |
| SQL revertido bajo un proceso vivo | Una sola llamada v2 recibe 501; la **misma clave** (seq 1) se reclama por v1; la recuperación queda `disabled (sql-missing)`. |
| Dos candidatos concurrentes | Exactamente un host activo, el mismo durante 20 s (sin alternancia entre standbys). |

**Host activo no es proceso enrutado.** Aquí no hay NGINX: «recuperó el host» significa que **un proceso** tiene la identidad activa. Qué proceso publica NGINX lo decide el agente de Cloud; eso se mira en la emulación (§6) y queda como límite (§7).

## 6. Emulación PM2 + NGINX + agente (CLOUD ROLLOUT-1)

**Entorno.** El mismo de CLOUD ROLLOUT-1, solo local: contenedor `pokeswap-rollout1`, Node 22.23.3, PM2 6.0.14, el agente real `@colyseus/tools` 0.18.3 y NGINX 1.22.1. Corre con un árbol nuevo `r3` (este commit) y una copia del arnés (`harness-r3`, salidas en `runs-r3`), sin tocar el arnés ni las corridas anteriores. La configuración PM2 es la variante `tuned` de esa emulación, que **no** es el `ecosystem.config.js` del repo (sin cambios) y solo aísla D1. Al terminar, el contenedor quedó detenido y sus datos conservados.

| Corrida | Recuperación | 4409 | Jugadores conectados al final | Host activo vivo al final | Otras fallas (comunes al control) |
|---|---|---|---|---|---|
| `rollout` | on | 0 | todos | 1 (el más nuevo) | ninguna: **PASS** |
| `old-crash-early-join` r1 | on | **0** | **5/5** | 1 | 1006 por el `kill -9`, posiciones no guardadas antes del crash, 502 hacia el socket muerto |
| `old-crash-early-join` r2 | on | **0** | **5/5** | 1 | ídem |
| `old-crash-early-join` r3 | on | **0** | **5/5** | 1 | ídem |
| `old-crash-early-join` control | **off** | **1 (`replaced`)** | **4/5** | 1 | ídem: **D2-B reproducido** |
| `old-crash-early` (D2-A) | on | 0 | 4/4 | 1 | ídem |

**Lectura (FACT y sus límites):**
- Con la recuperación encendida desaparece el 4409 falso de D2, y nadie queda fuera.
- **La promoción del standby no se produjo en la emulación:** con los tiempos del agente, el slot desplazado nunca quedó sin un host activo. Esa ruta está demostrada en la integración (§5), no aquí.
- El check «el activo es la generación más nueva» del arnés falla cuando la identidad más nueva quedó `stopped` y otra más vieja sigue activa (una sola viva). Es el mismo criterio estricto que ROLLOUT-1 ya documentó como falso positivo.
- Las posiciones «no conservadas» corresponden a jugadores que se movieron menos de un checkpoint antes del `kill -9`: es la pérdida esperada de §2.1.

## 7. Límites residuales

- **Plataforma (sin cambios):** el agente cambia NGINX y manda SIGINT por `ready` o al vencer `listen_timeout`, aunque el candidato no sirva; las conexiones nuevas van al candidato; deploys solapados (D3). Este trabajo **no** garantiza conservar el deployment anterior.
- **Host activo frente a enrutado:** la recuperación converge hacia un proceso con identidad activa, cediendo ante candidatos que arrancan. Si el proceso enrutado queda en bucle de reinicios o `errored`, el mundo puede quedar servido por un proceso no publicado.
- **Dueño inaccesible:** no hay progreso automático; hace falta la decisión del jugador («Jugar acá»). Si ese dueño estaba **particionado** y vuelve, su próxima escritura es `stale` y su sesión recibe 4409. Ahí sí había otra sesión viva, y el jugador eligió esta.
- **Misma página:** sin regla de misma página, un crash con la misma pestaña también requiere «Jugar acá» tras ≈ 7,5 s de reintentos, salvo que el host que la atiende sea más nuevo que el dueño muerto (orden de claves de v1) o el standby recupere con una identidad nueva.
- **Defecto preexistente** (§1): en un mismo proceso, un join abandonado y tardío de la página reemplaza a su socket vigente (4409). No se corrigió aquí; la alternativa de §1 lo cubre.
- **Entre procesos, «un resume no desplaza otra pestaña viva»** sigue sin garantizarse en los casos documentados en la propuesta (§3.4 de CLOUD READINESS-2; sin M1).
- **Sin autoridad:** nadie admite ni guarda en `on`. No hay cota de pérdida de posición.

## 8. Compatibilidad y orden de despliegue y rollback

| Combinación | Comportamiento |
|---|---|
| Realtime anterior (dark env `e09591a`, `ad6a98e`) + Edge v6 + SQL nuevo | Idéntico a hoy: ops v5 byte a byte iguales (Deno) y funciones v1 iguales (golden). |
| Realtime nuevo, switch apagado | Idéntico a WORLD LOCATION-4 (toda la suite anterior pasa; control en tests). |
| Realtime nuevo, switch encendido, Edge v5 | El sondeo da `unknown_op` → `disabled`; todo v1. |
| Capacidad cacheada y Edge revertida, o SQL revertido | Una llamada `unsupported` → la misma clave por v1 una vez → `disabled` hasta reiniciar (integración y tests). |
| Clientes anteriores | No conocen `owner-unreachable`: reintentan con backoff como en cualquier 4503, nunca hacen takeover y no muestran «Jugar acá» para este caso. |

**Despliegue** (cada paso con autorización propia; ninguno se hizo):
1. Migración. Corte si `recovery-grants-check.sql` ≠ 0 filas o si cambian los golden v1.
2. Edge v6. Corte si cambia alguna respuesta v5. Condición: la caché de esquema de PostgREST ve las funciones (si no, `capabilities` responde `recovery: null` y todo sigue en v1).
3. Realtime con el switch apagado.
4. Encender el switch con un reinicio controlado. Corte ante `unsupported` inesperados, más 4409 o más de un host activo fuera de un rollout.

**Rollback:** realtime (switch apagado y reinicio) → Edge v5 → `rollback_world_presence_recovery.sql` → y solo entonces, si hiciera falta, el rollback de ordering, que se niega mientras existan las funciones de recuperación.

## 9. Requisitos pendientes antes de cualquier despliegue o activación

1. Revisión independiente de esta rama.
2. Decidir la alternativa de §1 (contador por página) y, aparte, corregir el defecto preexistente del join abandonado.
3. C1 (`ready` real) y CLOUD STARTUP-1 antes de considerar `on`.
4. Medir en un entorno de prueba de Cloud (no producción): arranque, enrutado de `/<puerto>/` y comportamiento del agente con el standby.
5. Autorizaciones separadas para la migración hosted, la Edge v6, el realtime y el switch.
6. `WORLD_LOCATION_PERSISTENCE` sigue en `shadow`; activar `on` es una decisión aparte.
