# CLOUD READINESS-1 — Propuesta de recuperación de host y sesiones (para revisión independiente)

**Estado: PROPUESTA. No aprobada para implementar.** Nada de este documento está implementado. Las propiedades que se enuncian son **objetivos de diseño**, salvo que se marquen como FACT. Los puntos de la §9 son **decisiones pendientes**, no garantías. El valor de `GRACE` **no está fijado**.

- **Base:** `integration/world-skills-0.3 @ ad6a98e` (incluye HEALTH PORT-1 `f204598` y CLOUD ENV-1 `0f86bd8`).
- **Modo vigente:** `WORLD_LOCATION_PERSISTENCE=shadow`.
- **Fuera de alcance:** CLOUD STARTUP-1 (`fix/realtime-cloud-timeouts-0.3 @ 7823f14`, manifiesto PM2, sin integrar), D4 (contabilidad del log de flush), pagos.
- **Convenciones:** **FACT** (código en `ad6a98e` o experimento local), **INFERENCE**, **OPEN QUESTION**, **DECISIÓN PENDIENTE**.
- **Antecedentes:** [WORLD_LOCATION_4_DESIGN.md](WORLD_LOCATION_4_DESIGN.md), `docs/design/world-location-4/evidence/6-cloud-topology.md` (rama documental `docs/world-location-4-cloud-topology @ 2a42881`, no integrada en esta base), las evidencias de CLOUD ROLLOUT-1 y CLOUD STARTUP-1 (emulación local PM2 + NGINX + agente, fuera del repo) y el README del realtime.

---

## 1. Problema

En `on` hay tres situaciones que se observaron en la emulación local de Colyseus Cloud (FACT, CLOUD ROLLOUT-1):

| Id | Situación | Efecto |
|---|---|---|
| D1 | El agente cambia NGINX y detiene el host anterior antes de que el candidato escuche (`ready` o `listen_timeout`) | 502 y 4503 durante el arranque del candidato |
| D2-A | Un slot viejo relanzado por PM2 durante el arranque del candidato adquiere una generación **mayor**. El candidato ve `newerActive` y queda desplazado (F1, terminal). Después el agente detiene el slot viejo | **ningún host activo** hasta el próximo deploy |
| D2-B | Un jugador reclamó en esa generación mayor, que el agente detuvo. Al reanudar en el candidato (generación menor, activo) el claim responde `superseded` | **4409 falso** («otra pestaña»): el cliente deja de reintentar |

D2 se reprodujo de forma determinista contra las migraciones reales en PGlite, sin temporizadores (FACT local). El script de esa reproducción no está en el repo: se portará como test en la fase de implementación (§8).

## 2. Qué cambió con los fixes ya integrados (FACT, `ad6a98e`)

| Antes | Ahora |
|---|---|
| El entorno de Cloud (`.env.cloud`, `/etc/environment`) se cargaba dentro de `listen`, después de que `PresenceRoom` y los adaptadores capturaran la configuración | `services/realtime/src/index.js` carga el entorno antes de importar el realtime (`src/cloudEnvironment.js`) |
| El servidor de salud compartía puerto entre slots: EADDRINUSE **después** de `activate` → exit 1 → autorestart de PM2 → generación nueva (generador sistemático de D2) | Puerto por slot y no fatal; orden salud → acquire → listen → activate (`src/realtimeServer.js:84-96`). D2 queda limitado a crashes reales del slot viejo durante el arranque del nuevo |
| Un SIGINT durante el arranque no lo detenía | El arranque se corta en cada paso y libera lo adquirido |

Consecuencia para esta propuesta: C0 (entorno primero) está resuelto. Lo demás (C1, C3, C4, C5) sigue abierto.

## 3. Qué se puede garantizar desde nuestro código y qué no

### 3.1 Dentro de nuestro control

- **Proceso.** Un proceso no sale por estar desplazado ni por no tener autoridad (F1/N1, `src/rooms/presenceHosting.js` cabecera y `#stopped`, línea 163). Tampoco muere por el puerto de salud.
- **Base de datos** (solo `now()` de Postgres), en `supabase/migrations/20261003120000_world_location_ordering.sql`:
  - estados monótonos `starting → active → draining → stopped`;
  - activación serializada: `LOCK TABLE … SHARE ROW EXCLUSIVE` (línea 105);
  - claim por orden estricto de claves `(generation, seq)` desde un host activo con lease vivo (líneas 218-273);
  - save con CAS `(epoch, seq)` y dueño (líneas 285-370);
  - respuestas tardías sin efecto.
- **Cierres.** Qué código recibe cada socket (4409 o 4503) lo decide el realtime (`src/rooms/locationJoin.js`, `src/rooms/presenceHosting.js`).
- **Objetivo de diseño:** que un fallo de infraestructura nunca produzca 4409 y que el mundo vuelva a tener un host activo **bajo condiciones explícitas** (§9.6).

### 3.2 Fuera de nuestro control (agente de Colyseus Cloud y PM2)

- **Cambio de NGINX.** El agente lo hace cuando PM2 da el proceso por iniciado: con `ready` **o** al vencer `listen_timeout`, incluso si el candidato ya murió (FACT con PM2 6.0.14 y el agente 0.18.3/0.18.7 en local). Unos 1,5 s después manda SIGINT al proceso anterior. **Ningún valor de timeout convierte esto en una garantía de readiness.**
- **Conexiones nuevas.** Tras el cambio de NGINX van al candidato, esté listo o no. Que el proceso viejo conserve sus sockets **no** impide que NGINX envíe conexiones nuevas al candidato.
- **Deploys solapados.** El agente reinicia el proceso recién arrancado (D3).
- **Autorestart.** PM2 puede relanzar un slot durante un deploy y ese proceso adquiere una generación nueva. Se tolera, no se evita.
- **Configuración efectiva de la plataforma:** `kill_timeout`, el PM2 parcheado de Cloud (`updateProcessConfig`), la versión del agente y la ruta `/<puerto>/` hacia el socket de cada proceso (supuesto S1 de la topología).
- **Rollback de plataforma.** «El deploy falla y se conserva el anterior» solo es posible si la plataforma consulta salud o revierte. Es un pedido a Colyseus, fuera del repo.

## 4. Diseño propuesto

### 4.1 C5 — standby con readquisición exclusiva (D2-A)

- **Identidad terminal.** El desplazamiento sigue siendo terminal **para la identidad** (hostId y generación; I-1). Lo que se recupera es el **proceso**.
- **Quién entra en standby.** Un proceso desplazado (`#hostChanged` / `#stopped` en `src/rooms/presenceHosting.js:163-191`) que **no** recibió SIGINT/SIGTERM.
- **Sondeo.** Periódicamente consulta una función de solo lectura, `world_presence_any_active()`.
- **Promoción, si no hay ningún host `active` con lease vivo:**
  1. adquiere una **identidad nueva** (`world_presence_acquire`; generación nueva de la secuencia);
  2. la activa con `world_presence_activate_exclusive`, que rechaza (`other_active`) si existe otro host activo;
  3. si gana, la instala como host del proceso, levanta el `draining` del proceso (hoy nunca se revierte, `presenceHosting.js` constructor) y vuelve a admitir;
  4. si pierde, detiene esa identidad (`starting → stopped`) y sigue en standby.
- **Apagado.** Un SIGINT/SIGTERM desactiva el standby. Si llega durante la promoción, detiene la identidad nueva, igual que el arranque interrumpido de `realtimeServer.js`.
- **Convivencia con deploys.** Un candidato posterior activa con la `activate` normal. El host promovido ve `newerActive` y drena como en cualquier rollout.
- **Variante crash** (kill -9 del slot viejo): ese host queda `active` con el lease vivo hasta su vencimiento (`HOST_LEASE_MS = 15_000`, `src/presence/hostLifecycle.js:62`); recién después el standby puede promover.

Puntos abiertos: §9.2 (convivencia con `activate`), §9.5 (enrutado) y §9.6 (cotas).

### 4.2 C3 — claim v2 con estado del dueño (D2-B)

Es una función nueva, `world_location_claim_keyed_v2`, con la misma firma que la v1, que **no se modifica**. Solo difiere cuando la clave del llamador es **menor** que la del dueño de la fila. En ese caso consulta el estado del host dueño:

| Estado del dueño | Condición propuesta | Respuesta v2 |
|---|---|---|
| `active` | `state='active'` y lease vivo | `superseded` + `newerActive` (igual que v1) |
| `draining` | `state='draining'` y ventana de flush viva | `owner_draining` (reintentable) |
| `unreachable` | `state='active'`, lease vencido hace menos de `GRACE` | `owner_unreachable` (reintentable) |
| `orphan` | `stopped`, `draining` vencido, `active` vencido hace al menos `GRACE`, o generación inexistente | **toma la fila** (epoch+1, dueño = llamador) y devuelve la última casilla guardada |

- **Sin cambios respecto de v1:** la clave mayor, la adopción por clave igual (`key_reused`), `unknown_user` y la puerta del host llamador.
- **Por qué hace falta una función nueva:** `readClaim` (`src/world/persistence/playerData.js:127`) lanza ante estados desconocidos. Cambiar la v1 rompería los realtime desplegados.

Puntos abiertos: §9.1 (atomicidad), §9.3 (`GRACE`) y §9.4 (alcance del resume).

### 4.3 C4 — mapa de cierres en el realtime

| Respuesta | Sesión hidratando (`on`) | Sesión ya colocada (`on`) | Shadow |
|---|---|---|---|
| `owner_draining` / `owner_unreachable` | 4503, `presence:closing` = `draining` | `unclaimed` y reintento en segundo plano (`#retryClaims`, `src/presence/locationJournal.js:440`), sin cierre | contador |
| `superseded` + `newerActive: true` | 4503 | 4503 | contador |
| `superseded` + `newerActive: false` | 4409 (como hoy) | 4409 (como hoy) | `wouldReplace` |
| save `stale` (fence, `locationJoin.js:210`) | 4409 (como hoy) | 4409 (como hoy) | `wouldFence` |
| resume local con otra pestaña viva (`presenceHosting.js:98`) | 4409 (como hoy) | — | — |

- **Hoy:** `superseded` siempre cierra con 4409 (`locationJoin.js:136` y `#superseded`, línea 154).
- **Sin cambios de cliente ni de protocolo:** se reutilizan 4503 y la razón existente `draining`. `src/features/wildlands/multiplayer/domain/closePolicy.ts` ya trata 4503 como reconexión.
- **Argumento a revisar sobre `newerActive: false`:** la clave del dueño es mayor que la del llamador, y `newerActive: false` indica que no hay un host activo con generación mayor. Entonces el dueño es de la **misma** generación (este proceso) o de una generación mayor que ya no está activa. El segundo caso es exactamente el `orphan`/`draining`/`unreachable` que v2 separa antes. La revisión debe confirmar que no queda otro caso.

### 4.4 C1 — `ready` real (fase posterior, solo antes de `on`)

- **Hoy:** con `COLYSEUS_CLOUD`, `@colyseus/tools` 0.18.x escucha en `/run/colyseus/<2567+slot>.sock` y envía `process.send('ready')` incondicionalmente (`build/index.mjs`, función `listen`).
- **Propuesta:**
  - escuchar con `listen(socketPath, 0)` de `@colyseus/core` (la misma llamada que hace tools);
  - en `on`, enviar `ready` nosotros, una sola vez y solo con el host admitiendo;
  - en shadow/off, inmediatamente después de `listen`, como hoy;
  - nunca si el arranque se interrumpió.
- **Alcance:** C1 solo cambia **cuándo** se da el proceso por listo **antes** de que venza `listen_timeout`. No impide el comportamiento del agente descrito en §3.2.

## 5. Alternativa descartada del mínimo: C2 (retener al host viejo tras SIGINT)

**Propuesta original.** Tras un SIGINT y mientras no hubiera un host más nuevo activo, el viejo seguía sirviendo y renovando hasta ver `newerActive` o hasta un tope menor que `kill_timeout`.

**Motivos para dejarla fuera del mínimo:**
- solo protege las sesiones **existentes**, por un tiempo acotado;
- no impide que NGINX mande conexiones nuevas al candidato (§3.2);
- no corrige D2;
- cambia la semántica de apagado de `onBeforeShutdown` (`realtimeServer.js:61`);
- depende de `kill_timeout`, que pertenece a CLOUD STARTUP-1.

**Esta exclusión no es una decisión de producto aprobada.** C2 se puede retomar junto con STARTUP-1.

## 6. SQL — separado del resto

**Migración nueva y aditiva** (`supabase/migrations/<ts>_world_presence_recovery.sql`). Contiene solo funciones:

- `world_presence_owner_state(generation)` (helper);
- `world_location_claim_keyed_v2`;
- `world_presence_activate_exclusive`;
- `world_presence_any_active`.

**Lo que no cambia:**
- tablas, columnas e índices;
- las funciones de `20261001220000_world_player_locations.sql` y `20261003120000_world_location_ordering.sql`;
- no hay backfill;
- las filas v1 (`owner_generation = 0`) se tratan como hoy.

**Privilegios.** Mismo patrón que la migración de ordering: `SECURITY INVOKER`, `search_path` fijo, `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` y `GRANT EXECUTE … TO service_role`. Además, un chequeo nuevo `scripts/world-location/recovery-grants-check.sql` análogo a `ordering-grants-check.sql`.

**Rollback.** `scripts/world-location/rollback_world_presence_recovery.sql`: DROP de las cuatro funciones. El orden respecto de Edge y realtime está en §9.7.

**Compatibilidad (INFERENCE, a demostrar):**
- un realtime que no llama a las funciones nuevas no ve ningún cambio;
- las tomas de huérfanos solo las hace v2, y solo sobre filas cuyo dueño no puede escribir. Ver §9.3 y §9.4 sobre el host particionado, que es justamente la excepción.

## 7. Archivos afectados (implementación futura)

**SQL y scripts:**
- la migración y el rollback de §6;
- `scripts/world-location/recovery-grants-check.sql`;
- escenarios nuevos en `scripts/world-location/postgres-concurrency/`.

**Edge Function** `supabase/functions/world-authority/handler.ts` (+ `handler.test.ts`):
- ops nuevas `location_claim_v2`, `presence_activate_exclusive`, `presence_any_active` y, según §9.7, una op de capacidades;
- las ops v5 quedan idénticas. Hoy una op desconocida responde `400 unknown_op` (`handler.ts:239-240`).

**Realtime:**
- `src/world/persistence/playerData.js`: métodos v2 en los adaptadores SQL y de autoridad; `readClaimV2`; `readClaim` v1 sin cambios.
- `src/world/persistence/dev/localDatabase.js`: incluir la migración nueva.
- `src/presence/locationJournal.js`: estados reintentables nuevos (`HOST_REFUSALS`, línea 97).
- `src/rooms/locationJoin.js`: el mapa de §4.3.
- `src/presence/hostLifecycle.js`: activación exclusiva e identidad nueva.
- `src/rooms/presenceHosting.js`: standby.
- `src/realtimeServer.js`: avisar del apagado al standby.
- `src/presence/testing/hostAuthority.js`: estados del dueño y activación exclusiva en el doble de pruebas.

**Emulación:** `scripts/world-location/localAuthority.mjs` con las ops nuevas.

**C1 (fase posterior):** `src/realtimeServer.js` y un test de paridad con `@colyseus/tools`.

## 8. Invariantes objetivo y pruebas

### 8.1 Invariantes objetivo (a demostrar)

- **I-1.** Estados monótonos. Una identidad `stopped` nunca vuelve a `active`, y sus claims y saves tardíos no tienen efecto.
- **I-2.** Como mucho un host `active` con lease vivo entre los **activados en exclusivo**. La activación normal conserva el solapamiento acotado de un rollout, que se resuelve por `newerActive`.
- **I-3.** Un proceso que recibió SIGINT/SIGTERM nunca promueve. Una promoción interrumpida detiene su identidad.
- **I-4.** Toda identidad promovida tiene una generación mayor que cualquier otra existente en el momento de su `acquire`.
- **I-5.** Entre dueños vivos el orden de claves es estricto: v2 solo difiere de v1 cuando el dueño no puede escribir.
- **I-6.** Un dueño `draining` conserva su flush final: v2 nunca le quita la fila.
- **I-7.** 4409 solo por:
  - reemplazo por un join nuevo;
  - resume local con otra pestaña viva en el mismo proceso;
  - `superseded` con `newerActive: false`;
  - fence `stale`.

  Todo lo demás cierra con 4503.
- **I-8.** En shadow nada cambia para los jugadores (solo contadores).
- **I-9.** Un host se marca `stopped` solo después de cerrar sus sockets: F1 (`#hostChanged`), apagado (`onShutdown`, después del cierre de Colyseus) y activación rechazada (nunca tuvo sesiones). **Hay que verificarlo vía por vía.** La excepción conocida es el host `active` con el lease vencido (§9.3).
- **I-10.** Las funciones v1 no cambian (golden de `pg_get_functiondef`).

### 8.2 Pruebas deterministas y controles negativos

**SQL en PGlite.** Nuevo `services/realtime/src/world/persistence/worldPresenceRecovery.database.test.js`:
- D2-A y D2-B (portados de la reproducción local);
- la tabla de estados del dueño, avanzando el tiempo de la DB con el lease, sin `sleep`;
- un dueño vivo y más nuevo sigue ganando;
- la clave mayor y la adopción sin cambios;
- golden de las funciones v1.

**Controles negativos:**
- la misma batería sin la migración (debe fallar como hoy);
- mutantes que deben fallar:
  - sin la regla de huérfano;
  - `draining` tratado como huérfano;
  - sin `other_active`;
  - `unreachable` tratado como huérfano inmediato.

**Grants:** `recovery-grants-check.sql` debe dar 0 filas. Control: un `GRANT … TO authenticated` debe detectarse.

**Postgres real** (arnés `scripts/world-location/postgres-concurrency`): los escenarios de §9.1 y §9.2, más variantes sin locks que deben producir dos activos o una toma indebida.

**Edge:** ops nuevas, validación de forma, ops v5 idénticas y `unknown_op` para lo que no exista.

**Realtime** (unit, con `presence/testing/hostAuthority.js` y reloj manual):
- el mapa de §4.3;
- el standby: promoción, `other_active`, SIGINT antes y durante la promoción, dos procesos;
- sin capacidad, contadores y cierres idénticos a hoy (golden).
- Mutantes: C4 revertido y standby apagado deben fallar los tests de D2.

**Emulación dirigida** (no la batería completa):
- caída del viejo durante el arranque con un join, ×3 en `on`;
- un rollout normal;
- autoridad caída en el arranque;
- control: `ad6a98e` debe seguir reproduciendo D2.

## 9. Decisiones pendientes para la revisión independiente

### 9.1 Atomicidad de `claim_keyed_v2` frente a renew, stop, drain y cambios de dueño

**Locks actuales (FACT):**

| Función | Lock |
|---|---|
| `claim_keyed` | `FOR SHARE` sobre la fila del host **llamador** (línea 236); después el `INSERT … ON CONFLICT DO UPDATE … WHERE`, que bloquea la fila de ubicación |
| `save_keyed` | `FOR SHARE` del host escritor (línea 306) y luego `UPDATE` por fila |
| `renew` | `FOR UPDATE` de su propia fila (línea 138) |
| `drain` | `FOR UPDATE` de su propia fila (línea 172) |
| `stop` | `UPDATE` de su propia fila (línea 201) |
| `activate` | `LOCK TABLE … SHARE ROW EXCLUSIVE` (línea 105) |

**El riesgo de v2.** v2 lee el estado de **otro** host (el dueño). Si lo lee sin lock, puede ver «vencido hace al menos `GRACE`» mientras un `renew` concurrente del dueño lo revive. Hoy `renew` revive un `active` vencido si no hay un host más nuevo activo (líneas 144-149), y el llamador de v2 tiene una generación menor que el dueño. Resultado: toma de la fila + dueño revivido → el save siguiente del dueño da `stale` y su sesión recibe 4409.

**Orden de adquisición propuesto (a validar):**
1. host llamador `FOR SHARE` (igual que hoy);
2. fila de ubicación `FOR UPDATE` (un `SELECT … FOR UPDATE` explícito, con inserción si falta, en lugar de depender solo del `ON CONFLICT`);
3. host dueño `FOR SHARE`;
4. decidir y `UPDATE`.

El `FOR SHARE` del dueño bloquea su `renew`/`drain`/`stop` (que usan `FOR UPDATE`/`UPDATE`) hasta el commit del claim, y viceversa: la decisión se toma sobre un estado que no cambia hasta el commit.

**Ciclos de espera revisados a mano (INFERENCE, hay que probarlos):**
- `save_keyed` del dueño: `FOR SHARE` del dueño y luego la fila de ubicación. Comparte el lock del dueño con el claim, así que solo espera la fila.
- `renew`/`stop`/`drain` del dueño no tocan filas de ubicación.
- `activate` usa un lock de tabla que no conflictúa con `FOR SHARE`.

No se ve ningún ciclo, pero **debe demostrarse en Postgres real**, en particular dos claims cruzados entre dos usuarios cuyos dueños son los hosts llamadores opuestos.

**Decisión pendiente:** este orden de locks, o una alternativa (por ejemplo, que `renew` no revive a un `active` vencido hace al menos `GRACE` mientras exista cualquier otro host activo; ver §9.3).

### 9.2 Convivencia de `activate_exclusive` con `activate`

- **Serialización.** Las dos tomarían el mismo `LOCK TABLE … SHARE ROW EXCLUSIVE`, así que nunca corren a la vez.
- **Diferencia de reglas:**
  - `activate` rechaza solo si hay un activo **más nuevo**;
  - `activate_exclusive` rechaza si hay **cualquier otro** activo.

**Casos:**

| Orden | Resultado | Valoración |
|---|---|---|
| candidato C activa, después el standby S intenta | S recibe `other_active` | correcto |
| S activa en exclusivo y **después** C (deploy) activa | si `s > c` (S adquirió después de C), C recibe `newer_active` y **queda desplazado**: el proceso al que el agente va a enrutar | **problema** |
| S activa en exclusivo y después C, con `s < c` | ambos activos; S ve `newerActive` y drena | correcto |
| dos exclusivos | el segundo recibe `other_active` | correcto |
| exclusivo contra el `renew` de un `active` vencido | `renew` (`UPDATE`) conflictúa con el lock de tabla. Si gana `renew`: `other_active`. Si gana el exclusivo: `renew` ve `newerActive` y no revive | a probar |

**Decisión pendiente para el caso problemático.** Opciones:
- (a) `activate_exclusive` también cede si existe algún host `starting` con lease vivo (un candidato arrancando). Un `starting` que murió deja de contar al vencer su lease.
- (b) `activate` normal deja de rechazar ante un activo exclusivo.
- (c) Promoción solo bajo demanda (§9.5).

La recomendación inicial es (a) + (c). Requiere revisión.

### 9.3 `GRACE`: justificación y host detenido frente a host particionado

**Valores actuales (FACT):**
- lease 15 s (`HOST_LEASE_MS`), renovación cada 5 s (`HOST_RENEW_MS`);
- recuperación con backoff de 1 s a 30 s (`RECOVERY_*`);
- un host que no logra renovar durante un lease se **pausa** y sigue renovando (`#pause`, `hostLifecycle.js`);
- tras `EXPIRED_RENEWALS` = ceil(2·lease/renovación) = 6 renovaciones vencidas, solo informa (`onExpired`).

**Lo decisivo (FACT):** un host pausado **no cierra sus sockets**. Los jugadores conectados siguen ahí, sin guardar, y en `on` los joins nuevos reciben 4503.

**Qué significa cada estado:**
- **`stopped` es seguro:** en las tres vías, `stopped` llega después de cerrar los sockets (I-9, a verificar).
- **`active` vencido es ambiguo:**
  - **crash:** no hay sockets; tomar la fila es correcto;
  - **partición** entre el realtime y la autoridad: los sockets pueden estar vivos. Tomar la fila puede desplazar una sesión viva, que recibiría 4409 al reconectarse la autoridad (save `stale`).

**Ningún valor de `GRACE` distingue esos dos casos por sí solo.** Opciones:
- (a) **Autocerco:** un host que no obtuvo ninguna renovación durante `lease + T_cerco`, medido con su reloj monotónico desde el **envío** de la última renovación exitosa, cierra sus sesiones con 4503. La DB declara huérfano solo pasado `lease + GRACE`, con `GRACE > T_cerco + margen`. El envío precede al `now()` de la DB que fijó el lease, así que el lease visto por el host vence antes que el de la DB, asumiendo una deriva de frecuencia acotada. Esto cambia el comportamiento N1 de hoy (pausado sin cerrar), que tiene su propia justificación en WORLD LOCATION-4.
- (b) **Nunca tomar filas de un `active` vencido** (solo de `stopped` y `draining` vencido). Entonces el caso crash queda en 4503 hasta que alguien detenga esa identidad. Con C5, un standby no la detiene: solo crea otra.
- (c) **`GRACE` largo**, sin autocerco. Reduce la probabilidad, pero no la elimina.

**Decisión pendiente:** opción y valor. `GRACE = 15 s` **no está aprobado**.

### 9.4 Alcance de la protección del resume entre procesos

**Hoy (FACT):** «un resume no desplaza otra pestaña viva» se aplica **dentro de un proceso**. Si en el mismo proceso hay un socket vivo del mismo usuario con otro `tabId`, el resume se rechaza con 4409 (`presenceHosting.js:98`). Entre procesos la DB no conoce ni el `tabId` ni si la sesión dueña sigue viva: la fila conserva al dueño después de que esa sesión se va.

**Casos en que v2 podría tomar una fila cuya sesión anterior sigue viva:**
1. Dueño `active` vencido y particionado con sockets vivos (§9.3).
2. Dueño en `draining` con su ventana vencida pero sockets todavía abiertos: el drenaje cierra sockets antes de terminar (`#hostChanged` y el apagado de Colyseus), pero hay que verificar que ninguna vía deje sockets abiertos más allá de la ventana.
3. Un `stopped` con sockets vivos: lo excluye I-9, a verificar vía por vía.

**Casos que v2 no cambia:** un join o resume en un host **más nuevo** toma la fila por orden de claves exactamente como hoy (v1). Eso ya puede desplazar una sesión viva en un host más viejo, que recibe `stale` → 4409. Es comportamiento vigente de WORLD LOCATION-4, no introducido por esta propuesta.

**Decisión pendiente:**
- aceptar estos límites documentados; o
- agregar liveness de sesión en la DB (liberación al salir o heartbeat), que es un cambio mayor y con escrituras adicionales; o
- pasar `resume`/`tabId` al claim. Por sí solo no basta, porque la DB sigue sin saber si la sesión dueña está viva.

### 9.5 Recuperar un host activo no es recuperar el host al que enruta NGINX

**El límite.** C5 garantiza (objetivo) que **algún** proceso vivo vuelva a tener un host activo. El proceso no sabe a qué slot apunta NGINX: eso lo decide el agente.

- **Fuera de un deploy** hay un solo slot, así que el activo es el enrutado.
- **Durante un deploy** hay dos slots. Si promueve el que no está enrutado, el mundo tiene host activo y aun así las conexiones nuevas van al proceso desplazado, que responde 4503.
- **Convergencia:** ocurre cuando el agente detiene ese slot o cuando un candidato más nuevo activa.

**Señal posible: promoción bajo demanda.** Un proceso en standby solo promueve si recientemente **recibió y rechazó joins**, lo que demuestra que NGINX le envía tráfico. Sin jugadores intentando entrar no promueve nadie, y eso no tiene costo.

**Decisión pendiente:** adoptarla o no, y con qué ventana.

### 9.6 Condiciones y límites de la recuperación «en tiempo acotado»

**Cota objetivo, solo bajo todas estas condiciones:**
- (1) autoridad alcanzable;
- (2) al menos un proceso vivo que no se esté apagando y esté en standby;
- (3) ningún otro host `active` con lease vivo;
- (4) PM2 no reinicia ese proceso en bucle.

**Forma de la cota:** `t_sin_activo + período_de_sondeo + jitter + RTT(acquire) + RTT(activate_exclusive)`.
- `t_sin_activo` es 0 si el host anterior se detuvo explícitamente, o hasta el vencimiento de su lease si murió (≤ 15 s con los valores actuales), más el `GRACE` que se decida si dependiera de huérfanos (no es el caso de D2-A, que gana por orden de claves).

**No acotado:**
- con la autoridad caída;
- con un host activo **no enrutado** que sigue renovando (§9.5);
- con un agente que nunca detiene un slot;
- con deploys solapados que reinician procesos (D3);
- con un host particionado que revive (§9.3).

**Decisión pendiente:** período de sondeo y jitter, y si la promoción exige observarse dos veces seguidas.

### 9.7 Orden de rollback (realtime, Edge, SQL) y capacidades cacheadas

**Deploy:** SQL (migración) → Edge v6 (ops nuevas, conserva v5) → realtime v2.

**Rollback:** realtime v2 (o un kill switch, §abajo) → Edge v5 → SQL (DROP).

**Por qué el orden:**
- Con el SQL eliminado y Edge v6 en marcha, las ops nuevas fallarían con `500 authority_failed`, que el realtime no puede distinguir de un fallo transitorio.
- Con Edge v5, una op nueva responde `400 unknown_op` (FACT, `handler.ts:239-240`), que sí se distingue.

**Capacidades.** `supportsHost` (`presenceHosting.js`) solo mira si el **adaptador JS** tiene los métodos, no si la Edge desplegada los soporta. Para v2 la capacidad debe salir de la **autoridad**. Propuesta a revisar:
- una op de capacidades consultada al arrancar y cacheada por proceso;
- **invalidación:** cualquier `unknown_op` en una op v2 apaga la capacidad **para el resto del proceso**; ese claim se repite con v1 y el standby se desactiva;
- un `500` no apaga la capacidad: cuenta como fallo y se reintenta con backoff, como hoy.

**Riesgos de una capacidad cacheada:**
- Si Edge vuelve a v5 mientras un realtime v2 tiene la capacidad cacheada, cada proceso pierde como mucho una llamada por op hasta invalidarla.
- Si se borra el SQL antes que la Edge, el realtime ve `500` repetidos hasta el rollback de Edge. Por eso el orden es obligatorio.

**Kill switch.** Una variable `WORLD_PRESENCE_RECOVERY=off` (leída después de que CLOUD ENV-1 carga el entorno) desactiva v2 y el standby sin redeploy de código. Su cambio en Cloud requiere un reinicio controlado.

**Estado residual tras un rollback:** las filas tomadas por v2 quedan con un epoch y un dueño válidos para v1, sin migración inversa de datos. Los hosts creados por promociones quedan como filas `stopped` (se podan a mano, como las demás).

**Decisión pendiente:** la forma de la op de capacidades, la semántica del kill switch y si C1 queda bajo el mismo switch.

## 10. Orden de implementación (si se aprueba; cada paso con revisión y autorización propias)

1. Rama SQL: migración, rollback, grants check, PGlite y Postgres real (§9.1, §9.2).
2. Rama world-authority v6: ops nuevas, capacidades y tests.
3. Rama realtime: capacidad, C4, C5, kill switch.
4. Integración y emulación dirigida (shadow y `on` locales).
5. Hosted, con autorización aparte: migración y despliegue de world-authority.
6. Rama C1, solo antes de considerar `on`, junto con la decisión de CLOUD STARTUP-1 y de C2.

## 11. Límites residuales conocidos

- Comportamiento del agente (§3.2): cambio de NGINX por timeout, conexiones nuevas al candidato y D3.
- Autoridad caída: en `on` nadie admite ni guarda (4503). Es una limitación del modo.
- Partición frente a crash (§9.3) y alcance del resume entre procesos (§9.4).
- Host activo frente a host enrutado (§9.5).
- Generaciones gastadas por intentos de promoción perdidos (acotado por el sondeo de solo lectura).
- OPEN QUESTION heredada de CLOUD ENV-1: si Cloud inyecta `PORT`/`HEALTH_PORT`.
- OPEN QUESTION heredada de CLOUD ENV-1: diagnóstico de `.env.cloud` ausente o ilegible (hoy silencioso).
