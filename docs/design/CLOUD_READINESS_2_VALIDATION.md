# CLOUD READINESS-2 — Validación del diseño de recuperación

**Estado: validación técnica. NO aprueba implementar.** No cambia producto, migraciones reales, configuración PM2 ni dependencias. Lo que aquí figura como «demostrado» lo está **para el prototipo aislado** descrito abajo, no para un código de producto que todavía no existe.

- **Propuesta revisada:** [CLOUD_READINESS_1_PROPOSAL.md](CLOUD_READINESS_1_PROPOSAL.md) (`docs/cloud-readiness-1-proposal @ b24f021`), §9.1–§9.7.
- **Base de producto:** `integration/world-skills-0.3 @ ad6a98e`. Las migraciones reales que usa el prototipo son las de ese commit.
- **Convenciones:** **FACT** (código de `ad6a98e` o resultado reproducido aquí), **INFERENCE**, **OPEN QUESTION**, **DECISIÓN DE PRODUCTO**.

## 0. Resumen

| Tema (§ de la propuesta) | Resultado |
|---|---|
| §9.3 crash y partición | `GRACE` **se elimina**. Ningún plazo prueba que una sesión murió: un host pausado **conserva sus sockets** (FACT) y la pausa del proceso no está acotada. El enfoque recomendado (M0) no usa tiempo para decidir tomas: solo usa (a) la **misma página**, (b) un dueño **`stopped`** y (c) el **join fresco** explícito. La disponibilidad que se pierde queda explícita (P1). |
| §9.1 locks y atomicidad | Demostrado en **Postgres 17.6 real**. El claim v2 **no necesita bloquear al host dueño**: las lecturas desactualizadas de su estado solo pueden retrasar, nunca producir una toma indebida (I1–I3). El `FOR SHARE` sobre el dueño bloquearía su `renew` (detectado). La hipótesis de deadlock con ese lock **se refutó** (I4: 0 deadlocks en todos los builds). |
| §9.2 y §9.5 standby frente al candidato | Se reprodujo el caso en que el standby obtiene una generación superior al candidato que todavía arranca: sin una regla adicional, el candidato queda desplazado (mutante `no-yield`, detectado). Con la regla **«la activación exclusiva cede ante un host `starting` vivo de generación menor»** el candidato activa (X1). Funcionan también los casos de dos standbys (X3), del candidato muerto (X4) y la recuperación completa de D2-A (X6). **No se puede** demostrar desde el proceso que el host recuperado sea el enrutado (§4.3). |
| §9.7 capacidades y rollback | Contrato concreto y verificado contra la **Edge real de `ad6a98e`** (v5 responde `400 unknown_op`) y contra un prototipo v6: capacidad cacheada por proceso, desactivación permanente ante `unknown_op`/`unsupported`, sin degradar ante errores transitorios, kill switch. Orden de despliegue y de rollback con condiciones de corte (§5). |
| Requisito «un resume no desplaza otra pestaña viva» entre procesos | **Incompatible con las garantías disponibles en su forma completa**: la DB no sabe si la sesión dueña sigue viva después de un leave limpio, ni ante un `active` con lease vencido. M0 lo cumple en los casos que puede demostrar y documenta el resto. M1 (liberación al salir) lo amplía con un costo (P3). |

## 1. Reproducción

Todo es local, con datos sintéticos, sin hosted ni secretos.

| Pieza | Ubicación | Qué usa |
|---|---|---|
| Prototipo SQL (no es una migración del repo) | [cloud-readiness-2/pg/prototype.sql](cloud-readiness-2/pg/prototype.sql) | se aplica sobre las migraciones **reales** `20261001220000` + `20261003120000` |
| Batería con barreras | [cloud-readiness-2/pg/run.mjs](cloud-readiness-2/pg/run.mjs) + [session.mjs](cloud-readiness-2/pg/session.mjs) | Postgres de un stack Supabase local, base dedicada `cr2_validation` |
| Contrato de capacidades | [cloud-readiness-2/edge/](cloud-readiness-2/edge/) | `handler.ts` **real** de `ad6a98e` (Node 24 con strip-types) + prototipo v6 + modelo del cliente |
| Resultados | [cloud-readiness-2/results/](cloud-readiness-2/results/) | JSON y texto de las corridas |

```bash
# Postgres real (contenedor de un stack Supabase LOCAL; la batería crea y recrea solo la base cr2_validation)
node docs/design/cloud-readiness-2/pg/run.mjs --container supabase_db_wlocpg-orig --rounds 5 --out docs/design/cloud-readiness-2/results/pg-validation.json
# Contrato de capacidades (Node 24)
node --test docs/design/cloud-readiness-2/edge/capability.test.mjs
```

**Cómo se fuerza el orden.**
- El prototipo trae hooks `cr2_hook(name)` que solo actúan si la sesión fijó `cr2.hooks`. Cada hook espera un advisory lock propio de su sesión (`cr2.tag`).
- La batería retiene ese lock y verifica en `pg_stat_activity` que la sesión espera en `Lock:advisory`, en `Lock:transactionid|tuple` (fila) o en `Lock:relation` (tabla). Recién entonces ejecuta la acción concurrente y libera.
- Ningún `sleep` decide un orden; solo se espera *observando* el estado.
- El único «viaje en el tiempo» es un fixture que pone `lease_expires_at` en el pasado (crash o partición). Cada escenario empieza sin hosts vivos (fixture de reset sobre hosts sintéticos).

**Códigos de salida:** `0` = resultado esperado en todos los builds, `1` = inesperado, `2` = BLOCKED (sin contenedor local, error del arnés o del setup). Un BLOCKED nunca cuenta como PASS.

**Mutantes.** Cada uno aplica exactamente un reemplazo en memoria y retira una protección:

| Mutante | Protección retirada | Debe fallar |
|---|---|---|
| `owner-share` | (agrega) `FOR SHARE` sobre el host dueño | I1 |
| `draining-takes` | esperar a un dueño `draining` | S4 |
| `unreachable-takes` | no tomar de un dueño `unreachable` para otra página | S2 |
| `draining-expired-stopped` | tratar un drenaje vencido como `unreachable` (no como `stopped`) | S4b |
| `tab-session` | validar que la pestaña registrada corresponda a la sesión dueña **actual** | S7 |
| `no-yield` | la cesión de la activación exclusiva ante un candidato que arranca | X1 |
| `excl-no-lock` | el `LOCK TABLE` de la activación exclusiva | X5 |

## 2. Resultados (FACT, Postgres 17.6 local, 5 rondas por escenario)

Postgres 17.6 (supabase/postgres:17.6.1.158, read committed), 2026-10-05T18:25:31.983Z → 2026-10-05T18:29:35.108Z. Migraciones aplicadas (sha256 del blob de ad6a98e): 20261001220000 = 79365d5fa55186e8…, 20261003120000 = 08d37a3890b2fdca… (los mismos del F2 de WORLD LOCATION-4); prototype.sql = 618d07bf6ebb3c0e…. Salida del runner: exit 0.

| Escenario | prototype | owner-share | draining-takes | unreachable-takes | draining-expired-stopped | tab-session | no-yield | excl-no-lock |
|---|---|---|---|---|---|---|---|---|
| S1 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 |
| S2 | pass 5/5 | pass 5/5 | pass 5/5 | **FAIL** 0/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 |
| S3 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 |
| S4 | pass 5/5 | pass 5/5 | **FAIL** 0/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 |
| S4b | pass 5/5 | pass 5/5 | pass 5/5 | **FAIL** 0/5 | **FAIL** 0/5 | pass 5/5 | pass 5/5 | pass 5/5 |
| S5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 |
| S6 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 |
| S7 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | **FAIL** 0/5 | pass 5/5 | pass 5/5 |
| S8 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 |
| I1 | pass 5/5 | **FAIL** 0/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 |
| I2 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 |
| I3 | pass 5/5 | pass 5/5 | pass 5/5 | **FAIL** 0/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 |
| I4 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 |
| I5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 |
| X1 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | **FAIL** 0/5 | pass 5/5 |
| X2 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 |
| X3 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | **FAIL** 0/5 | pass 5/5 |
| X4 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 |
| X5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | **FAIL** 0/5 |
| X6 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 | pass 5/5 |
| **Veredicto** | **PASS** | **DETECTED** | **DETECTED** | **DETECTED** | **DETECTED** | **DETECTED** | **DETECTED** | **DETECTED** |

- **Builds:** un prototipo y 7 mutantes × 20 escenarios × 5 rondas.
- **Cada mutante falla exactamente donde debe.** Algunos además fallan en otros escenarios relacionados: `unreachable-takes` también en S4b e I3 (un drenaje vencido es `unreachable`), `no-yield` también en X3.
- **Deadlocks:** I4 mide `pg_stat_database.deadlocks` y los errores `deadlock detected`. Resultado: 0 en todos los builds, incluido `owner-share`.
- **Contrato de capacidades:** 10/10 (`results/edge-capabilities.txt`).

### 2.1 Escenarios

| Id | Qué prueba | Propiedad |
|---|---|---|
| S1 | Crash del dueño; **la misma página** reanuda en una generación menor | toma inmediata, restaura la última casilla guardada; un save tardío del dueño no cambia nada |
| S2 | Partición: **otra página** reanuda con el dueño `unreachable`; después la partición sana | `owner_unreachable` (sin toma); el dueño revivido sigue guardando |
| S3 | Dueño `stopped` | cualquier página toma la fila con su última casilla |
| S4 | Dueño `draining` | `owner_draining`; su flush final se conserva y luego se restaura |
| S4b | Drenaje vencido con el proceso todavía vivo | otra página no toma |
| S5 | Join **fresco** de otra página contra un dueño `unreachable` | toma (reemplazo explícito, regla de producto) |
| S6 | Dueño vivo en un host más nuevo y otra página reanuda en el viejo | `superseded` con `newerActive` (orden de v1) |
| S7 | Flota mixta: un claim v1 toma la fila | la pestaña registrada de la sesión anterior ya no autoriza nada |
| S8 | Comportamientos de v1 | adopción por clave igual; clave mayor |
| I1 | Claim en pausa tras leer `unreachable` ‖ `renew` del dueño | el `renew` no espera; la misma página toma; el dueño revivido queda `stale` |
| I2 | Claim de la misma página (dueño leído como activo) ‖ `drain` del dueño | se linealiza antes del drain; el flush zombi queda `stale` |
| I3 | Claim de otra página en pausa tras leer `unreachable` ‖ `stop` del dueño | la lectura vieja solo retrasa (`owner_unreachable`); el reintento toma |
| I4 | Claim (A < B) con fila y lock propio ‖ `save` de B esperando la fila ‖ `renew` de B | sin deadlock |
| I5 | La misma página reintenta en dos hosts a la vez | el último es el dueño y el epoch avanza una vez por toma |
| X1 | El standby adquiere una generación **mayor** que el candidato que arranca | el standby cede y el candidato activa |
| X2 | El candidato adquiere después del standby | ambos activos; el standby oye `newerActive` y drena |
| X3 | Dos standbys | exactamente uno activa (gana el menor; sin livelock) |
| X4 | El candidato murió en `starting` | el standby no queda bloqueado más allá del lease de ese candidato |
| X5 | La activación exclusiva en pausa tras sus chequeos ‖ su propio `stop` | responder `active` implica que la activación se aplicó (sin TOCTOU) |
| X6 | D2-A de punta a punta | sin host activo y después exactamente uno, con identidad nueva |

## 3. Crash, partición y propiedad de la sesión (§9.3)

### 3.1 Hechos que deciden

- **FACT.** Un host que no logra renovar se **pausa** y **no cierra sus sockets** (`hostLifecycle.js` `#pause`, N1). Sus jugadores siguen conectados sin guardar.
- **FACT.** Un dueño `stopped` cerró sus sockets antes en todas las vías actuales:
  - F1: `#hostChanged` drena, cierra con 4503 y recién después llama a `displace()` → `stop`;
  - apagado: `onShutdown` corre después del cierre de las rooms de Colyseus;
  - activación rechazada e identidades tardías (`#late`): nunca tuvieron sesiones.

  Esto se mantiene **mientras solo el proceso dueño detenga su identidad**. Un «reaper» u operador que marque `stopped` a otro host rompería la premisa (I-9).
- **FACT.** El cliente abre **una sola room por página**: `connect()` no hace nada si ya hay `room` o un `connecting` en curso (`colyseusPresence.ts:80`), y `TAB_ID` es un UUID por carga de página. Una página reanuda solo después de que su socket anterior se cerró **del lado del cliente**.

### 3.2 Por qué no sirve `GRACE` ni el autocercado como prueba

- **Un plazo no prueba la muerte.** Un `active` con lease vencido puede ser un crash (sin sockets) o una partición o pausa (sockets vivos). Ningún `GRACE` distingue esos casos.
- **El autocercado** (cerrar las sesiones propias tras `lease + T`, medido localmente) solo sería seguro con **pausas acotadas del proceso y deriva de reloj acotada**, y ninguna de las dos se garantiza:
  - pausas del event loop o del GC;
  - CPU disputada (en la emulación, el arranque pasó de 6 a 20 s);
  - `SIGSTOP`, suspensión de la VM.

  Se descarta como mecanismo de **seguridad**. Como mecanismo de **UX** («si no tengo autoridad hace mucho, cierro con 4503 para que los clientes vayan a otro host») podría estudiarse aparte, pero cambia N1 y no forma parte de M0.

### 3.3 Enfoque M0: tomar solo cuando no depende del tiempo

Cuando la clave del llamador es menor que la del dueño:

| Estado del dueño (DB `now()`) | La misma página (`tabId` registrado para la sesión dueña actual) | Otra página, `resume` | Join fresco |
|---|---|---|---|
| `active` con lease vivo | **toma** | `superseded` (+ `newerActive`) | `superseded` (+ `newerActive`) |
| `draining` con ventana viva | `owner_draining` | `owner_draining` | `owner_draining` |
| `active` vencido, o `draining` vencido (`unreachable`) | **toma** | `owner_unreachable` | **toma** (reemplazo explícito) |
| `stopped` o inexistente | **toma** | **toma** | **toma** |

Con clave mayor, se toma exactamente como v1 (sin cambios).

**Propiedades:**
- **Seguridad de datos** (garantizada por la DB, sin supuestos temporales del proceso; solo el reloj de Postgres):
  - un escritor viejo nunca pisa a un dueño nuevo (CAS epoch/seq, dueño, lease);
  - el flush final de un dueño `draining` se respeta (S4, I2).
- **No desplazar otra página viva:**
  - otra página que **reanuda** solo toma de un dueño `stopped`, cuyos sockets se cerraron (I-9), o por clave mayor (comportamiento v1 vigente; §3.4);
  - la toma por «misma página» se apoya en el invariante del cliente de una room por página. Ese invariante no es de confianza, pero solo afecta las sesiones del **mismo usuario**: un cliente adulterado solo puede perjudicarse a sí mismo;
  - la pestaña registrada se valida contra `owner_session`, así que un claim v1 la invalida (S7).
- **Disponibilidad:**
  - la misma página recupera de inmediato tras un crash, sin esperar ningún lease (S1). Solo espera a un dueño `draining`, y como mucho la ventana de drenaje (`HOST_DRAIN_WINDOW_MS` = 10 s, fijada por la DB);
  - D2-B (el caso reproducido) se resuelve: el dueño g3 se detuvo, así que cualquier página toma.

**Lo que se sacrifica:**
- **Otra página** que reanuda frente a un dueño `unreachable` (por ejemplo, dos pestañas con una en un host caído) **no progresa sola**. Cómo se le presenta es la **DECISIÓN P1**.
- **Una toma por misma página frente a un dueño activo y vivo** pierde las posiciones que ese zombi no guardó (como mucho un intervalo de checkpoint). Es la **DECISIÓN P2**.

### 3.4 Alcance exacto de la protección del resume entre procesos (§9.4)

M0 **no garantiza** «un resume no desplaza otra pestaña viva» entre procesos en estos casos. Algunos son anteriores a esta propuesta:

1. **Clave mayor (v1 vigente).** Si una página reanuda en un host **más nuevo** mientras otra página está viva en uno más viejo, toma la fila y la otra recibe `stale` → 4409. Corregirlo exige saber si esa sesión sigue viva.
2. **Leave limpio.** La fila conserva al dueño después de que su sesión se fue. Otra página que reanuda frente a ese dueño «activo y vivo» recibe `superseded`, aunque la sesión ya no exista. Falla hacia el lado seguro: no desplaza a nadie, pero bloquea.
3. **`stopped` marcado por alguien que no es el dueño.** Hoy no existe (I-9).

**M1 (opcional):** el realtime **libera** la propiedad al cerrar una sesión limpiamente (una escritura por desconexión) y la regla de otra página se aplica también con clave mayor. Cierra los casos 1 y 2 salvo cuando la liberación se pierde (autoridad caída al salir); en ese caso el bloqueo se resuelve con un join fresco explícito. Es la **DECISIÓN P3**.

## 4. Locks y atomicidad (§9.1, §9.2)

### 4.1 Claim v2

**Orden de locks del prototipo:**
1. host **llamador** `FOR SHARE` (igual que v1; protege I17, demostrado en el F2 de WORLD LOCATION-4);
2. fila de ubicación (`INSERT … ON CONFLICT` y, si no tomó, `SELECT … FOR UPDATE`);
3. lectura **sin lock** del host dueño;
4. registro de pestaña (siempre después de la fila).

**Por qué no hace falta bloquear al dueño** (argumento, más I1–I3 como evidencia). Las transiciones del dueño que pueden ocurrir entre la lectura y el commit son:
- `active → draining → stopped`, monótonas;
- la expiración del lease, que depende de la DB;
- la **reactivación** por `renew` de un `active` vencido.

Las decisiones se clasifican así:
- **Tomas que dependen del estado** (otra página o join fresco): solo con `stopped`/inexistente, que es terminal, o con `unreachable` en un join fresco, que es un reemplazo explícito y no depende de si el dueño vive.
- **La misma página no depende del estado**, salvo `draining`. Leer `active` cuando en realidad ya drena equivale a linealizar el claim antes del drain (I2). El flush posterior del dueño queda `stale` por el CAS.
- **Todas las demás lecturas desactualizadas devuelven una respuesta reintentable** (`owner_unreachable`, `owner_draining`, `superseded`), sin efecto (I3).

**Ganancia:** el claim no bloquea el `renew`, el `drain` ni el `stop` de otro host. Con `FOR SHARE` sobre el dueño, el `renew` queda esperando (`owner-share`: I1 detectado, `Lock:transactionid`).

**Deadlocks:**
- **I4** cubre la cadena sospechada: claim (A < B) con su fila → save de B esperando la fila → renew de B esperando a B. Hubo **0 deadlocks**, también en `owner-share`, porque Postgres concede un `FOR SHARE` compatible sin encolarlo detrás de un `FOR UPDATE` en espera. La hipótesis de la propuesta queda **refutada** para ese patrón.
- **INFERENCE:** en la ruta de clave menor, la adquisición de locks de host va de generación menor a mayor (llamador < dueño), así que no hay ciclos entre claims. No se probaron otros patrones con pooler (Supavisor) ni otros niveles de aislamiento: la batería usa `read committed`, el de Supabase.

### 4.2 Activación exclusiva frente a la normal

- Ambas toman `LOCK TABLE … SHARE ROW EXCLUSIVE`.
- Sin ese lock, la exclusiva tiene el mismo TOCTOU que RV1 tenía en `activate`: responde `active` sobre una fila que su propio `stop` ya marcó `stopped` (`excl-no-lock`: X5 detectado).
- **Regla de cesión.** La exclusiva responde `candidate_starting` si existe otro host `starting` con lease vivo y **generación menor**:

| Situación | Resultado demostrado |
|---|---|
| El candidato arranca antes que el standby (c < s) | el standby cede y el candidato activa (X1; sin la regla, `newer_active` para el candidato) |
| El candidato adquiere después (c > s) | ambos activos; el standby oye `newerActive` y drena (X2) |
| Dos standbys | gana el de generación menor; el otro recibe `candidate_starting` y después `other_active` (X3) |
| El candidato murió en `starting` | el standby espera como mucho a que venza el lease de ese candidato (X4) |
| Autorestart (D2-A) | X6: candidato `newer_active` → el agente detiene ambos slots viejos → cero activos → el standby con identidad nueva → exactamente uno |

**Dos candidatos concurrentes** (deploys solapados o autorestarts): la activación normal no cambia (gana el más nuevo; F2 de WORLD LOCATION-4). Un standby cede ante el menor de ellos mientras arranque.

**Límite de la cesión:** un host `starting` vivo que **nunca** activa (un proceso colgado que sigue renovando su lease de `starting`) bloquearía la promoción. **OPEN QUESTION:** si el realtime renueva leases de `starting` durante un arranque colgado. Hay que comprobarlo en `hostLifecycle` durante la implementación.

### 4.3 Host activo no es host enrutado (§9.5)

- **Lo que se puede afirmar:** con la regla de cesión, la recuperación **converge hacia el proceso más nuevo que arranca**. Un proceso que recibe SIGINT/SIGTERM nunca promueve.
- **Lo que no se puede afirmar:** que el proceso promovido sea el que NGINX publica.
  - El proceso no conoce la configuración de NGINX del agente.
  - Recibir un join solo demuestra que **esa** conexión llegó; no que lleguen todas.
- **Casos residuales:**
  - un proceso viejo desplazado y todavía no detenido por el agente puede promover si el candidato enrutado murió y no arrancó otro. Converge cuando el agente detiene ese slot o cuando arranca un candidato más nuevo;
  - si el slot enrutado entra en bucle de reinicios o queda `errored` (`max_restarts`), el mundo puede quedar servido por un proceso no enrutado mientras NGINX responde 502. Solo la plataforma puede evitarlo.
- **«Promoción bajo demanda»** (promover solo tras rechazar joins): reduce promociones inútiles, pero **no** prueba enrutamiento. No se recomienda en M0 (P4).
- **Soluciones descartadas** por cambiar solo un timeout sin resolver la carrera:
  - `restart_delay` (ROLLOUT-1: reduce la ventana, no la elimina);
  - alargar `listen_timeout` o el período de sondeo;
  - un `GRACE` antes de promover.

## 5. Capacidades y rollback (§9.7)

### 5.1 Contrato (verificado: E1–E10)

**Edge v6 (prototipo [prototypeV6.mjs](cloud-readiness-2/edge/prototypeV6.mjs)):**
- Pasa **sin cambios** todas las ops v5: respuestas byte a byte idénticas y las mismas RPC (E2). Los realtime anteriores no notan nada.
- `op: 'capabilities'` → `200 { recovery: { version: 1 } }` solo si existe la función marcador SQL `world_presence_recovery_version()`. Si no existe, `200 { recovery: null }`. Una Edge v5 responde `400 unknown_op` (FACT, E1).
- Ops de recuperación cuya función SQL falta (PostgREST `PGRST202` o Postgres `42883`) → `501 { error: 'unsupported' }`. Cualquier otro error, `500 authority_failed`, igual que hoy (E3).

**Realtime (modelo [capabilityClient.mjs](cloud-readiness-2/edge/capabilityClient.mjs)):**
- **Sondeo:** una vez por proceso. Queda `enabled` solo con `recovery.version === 1`; `unknown_op` o `recovery: null` → `disabled`; un error transitorio deja `unknown` y se vuelve a sondear.
- **Invalidación:** una op de recuperación respondida `unknown_op` o `unsupported` desactiva **hasta el fin del proceso**, sin flapping (E6). Ese mismo claim se repite **una vez** en v1 con la **misma clave**: el intento v2 no se ejecutó, así que no hay efecto doble.
- **Un `500` nunca desactiva** (E8). Desactivar por un error transitorio degradaría en silencio (E10, control del diseño rechazado).
- **Una promoción interrumpida** por `unsupported` detiene la identidad que adquirió (E7).
- **Kill switch** `WORLD_PRESENCE_RECOVERY=off`: no sondea ni llama ninguna op nueva (E9). Se lee después de CLOUD ENV-1, así que vale tanto desde `.env.cloud` como desde el proceso; su cambio requiere reiniciar el proceso.
- **Reactivación:** solo en un proceso nuevo.

### 5.2 Compatibilidad

| Combinación | Comportamiento |
|---|---|
| Realtime v1 (dark env `e09591a`) + Edge v6 + SQL nuevo | idéntico a hoy (E2; las funciones v1 no cambian) |
| Realtime v2 + Edge v5 | `disabled` en el sondeo; todo v1 (E4) |
| Realtime v2 con la capacidad cacheada y Edge revertida a v5 | una llamada por proceso hasta desactivar; luego todo v1 (E6) |
| Realtime v2 + Edge v6 + SQL eliminado (orden incorrecto) | `501` → desactiva y vuelve a v1; ninguna promoción a medias (E7) |
| Flota mixta v1/v2 sobre la misma fila | un claim v1 invalida la pestaña registrada (S7) |
| Procesos vivos durante cada paso | ningún paso cambia la respuesta de una op que un proceso vivo ya usa |

### 5.3 Orden y condiciones de corte

**Despliegue** (cada paso con su autorización):
1. **SQL:** la migración aditiva (incluye `world_presence_recovery_version()`).
   - Corte si falla `recovery-grants-check.sql`, o si los golden de las funciones v1 cambiaron.
   - **Condición:** la caché de esquema de PostgREST debe ver las funciones nuevas; si no, v6 responde `unsupported` y todo sigue en v1, que es lo seguro.
2. **Edge v6.** Corte si una op v5 cambia de respuesta (E2 contra el despliegue) o si `capabilities` no refleja el SQL.
3. **Realtime v2**, primero con el kill switch `off` y después `on`. Corte ante:
   - cualquier `unsupported` inesperado;
   - un aumento de 4409;
   - más de un host activo fuera de un rollout.

**Rollback:**
1. Realtime: kill switch `off` (reinicio) o la versión anterior.
2. Edge v5.
3. SQL: DROP de las funciones.

Revertir el SQL **antes** que la Edge degrada pero no rompe (E7). Aun así, el orden se mantiene para no depender de esa degradación.

**Estado residual tras un rollback:**
- las filas tomadas por v2 quedan válidas para v1 (epoch y dueño coherentes);
- `world_location_owner_tabs` queda huérfana pero inofensiva hasta el DROP;
- los hosts creados por promociones quedan `stopped`.

## 6. Qué quedó demostrado y qué no

| Demostrado (en el prototipo, Postgres 17.6 local real) | No demostrado |
|---|---|
| Tabla de decisión M0 (S1–S8) con sus controles negativos | Comportamiento del **realtime** real: standby, mapa de cierres, plumbing de `tabId`/`resume` (solo modelado) |
| Lecturas desactualizadas del dueño seguras sin lock (I1–I3) | Edge v6 real desplegada y el comportamiento de la caché de esquema de PostgREST (solo prototipo y stub) |
| Sin deadlock en la cadena sospechada (I4) | Pooler en modo transacción, niveles de aislamiento distintos de `read committed` |
| Cesión del standby y recuperación D2-A (X1–X6) | Que el host recuperado sea el enrutado (no demostrable desde el proceso) |
| TOCTOU de la exclusiva cubierto por su lock (X5) | Comportamiento del agente y del PM2 parcheado de Cloud |
| Contrato de capacidades contra la Edge real v5 (E1–E10) | Emulación PM2 + NGINX con el diseño (requiere implementación) |

## 7. Enfoque mínimo recomendado

1. **M0 en SQL** (aditivo):
   - tabla `world_location_owner_tabs` (pestaña de la sesión dueña actual);
   - `world_presence_owner_state` (sin lock);
   - `world_location_claim_keyed_v2(…, p_tab, p_resume)` con la tabla de §3.3;
   - `world_presence_activate_exclusive` con lock de tabla y la regla de cesión;
   - `world_presence_any_active`;
   - `world_presence_recovery_version`.

   Las funciones v1 no cambian. **Sin `GRACE`.**
2. **Edge v6** con el contrato de §5.1.
3. **Realtime:**
   - capacidad y kill switch;
   - `tabId`/`resume` en la sesión;
   - mapa de cierres: `owner_draining` → 4503, `superseded` + `newerActive` → 4503 y el resto como en la propuesta; `owner_unreachable` según P1;
   - standby con identidad nueva, cesión y desactivación por apagado.
4. **No forman parte de M0:** C1 (`ready` real, antes de `on`), C2, autocercado, M1, promoción bajo demanda.

## 8. Decisiones de producto pendientes

| Id | Decisión | Opciones y consecuencias |
|---|---|---|
| P1 | Otra página reanuda y el dueño es `unreachable` | (a) **4409** con «Jugar acá»: el usuario decide y un join fresco toma; honesto, pero pide un clic. (b) **4503** y reintentos: no molesta, pero puede quedar reintentando indefinidamente si la otra pestaña nunca vuelve. (c) Tomar tras un plazo: **rechazada** por seguridad (§3.2). |
| P2 | Toma por la misma página frente a un dueño zombi activo | Aceptar perder como mucho un checkpoint sin guardar (recomendado: la otra opción es esperar sin cota) |
| P3 | Protección completa del resume entre procesos | M0 (límites de §3.4), o M1 con liberación al salir (una escritura por desconexión; cierra los casos 1 y 2) |
| P4 | Promoción bajo demanda | No en M0. No prueba enrutamiento; solo reduce promociones |
| P5 | Kill switch | Su nombre y si C1 queda bajo el mismo switch |
| P6 | C2 (retener al viejo) | Sigue fuera del mínimo; se decide con CLOUD STARTUP-1 |

## 9. Plan de implementación por bloques (si se aprueba)

| Bloque | Contenido | Pruebas necesarias |
|---|---|---|
| B1 SQL | la migración de §7.1; rollback; `recovery-grants-check.sql` | PGlite: S1–S8 y X1–X4, X6 como tests del repo. Postgres real: portar I1–I5 y X5 a `scripts/world-location/postgres-concurrency`, inyectando los hooks **en memoria** (la función de producto solo lleva comentarios marcador, igual que los mutantes del F2). Los 7 mutantes de §1 como controles. Golden de v1 y control de grants |
| B2 Edge v6 | ops nuevas y `capabilities` | E1–E10 portados a `handler.test.ts`; E2 contra todas las ops v5 |
| B3 Realtime | capacidad, `tabId`/`resume`, mapa de cierres, standby | unitarios con `hostAuthority.js` y reloj manual (las mismas tablas, más SIGINT antes y durante la promoción, dos procesos, cesión); golden sin capacidad (idéntico a hoy); mutantes: mapa revertido y standby apagado |
| B4 Integración | emulación dirigida | D2-A y D2-B en `on`, rollout y autoridad caída; control: `ad6a98e` reproduce D2 |
| B5 Hosted | migración y Edge | autorización aparte; cortes de §5.3 |
| B6 C1 | `ready` real | antes de `on`, con STARTUP-1 |

## 10. Límites que requieren cambios de la plataforma

- Que el agente espere salud o revierta un deploy fallido, en lugar de enrutar al vencer `listen_timeout` aunque el candidato esté muerto.
- Que el proceso pueda saber si NGINX lo publica (o que la plataforma solo publique procesos sanos).
- Que no se reinicie el proceso recién arrancado en deploys solapados (D3).
- Que un slot en bucle de reinicios o `errored` no siga publicado.

## 11. Huella de esta validación

- **Base de datos:** `cr2_validation`, dentro del stack local `supabase_db_wlocpg-orig`. La batería la recrea en cada build y **no toca** la base `postgres` del stack ni sus datos. Se deja en su lugar para reproducir.
- **Producto:** sin cambios en producto, migraciones reales, configuración, dependencias, hosted, flags, pokeswap-int1 ni el entorno oscuro.
