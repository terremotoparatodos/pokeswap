# CLOUD JOIN-ORDER-1 — Orden de los intentos de conexión de una página

**Estado: propuesta con prototipos aislados, congelada para revisión.** No hay cambios de producto, migraciones reales, dependencias, PM2, flags, secretos, SQL hosted ni deploy. `WORLD_PRESENCE_RECOVERY` sigue apagado en todos los entornos. La regla de «misma página» de M0 **sigue sin autorizarse**: esta propuesta define el contrato que la haría segura, pero no la activa.

- **Rama:** `design/cloud-join-order-1`, creada desde `feat/cloud-readiness-3-0.3 @ 5ca9ccd`, que sigue congelada.
- **Convenciones:** **FACT** (código o prueba ejecutada aquí), **INFERENCE** (deducción), **OPEN QUESTION** (pregunta abierta).
- **Material en esta rama** (todo bajo `docs/design/cloud-join-order-1/`):
  - `repro/barriers.test.mjs` reproduce el defecto contra el árbol congelado.
  - `prototype/prototype.patch` es el prototipo realtime + cliente. No se aplica en ninguna rama: es solo un diff de referencia.
  - `prototype/claim_v3.sql` es el SQL prototipo. **No es una migración.**
  - Pruebas y controles: `prototype/joinOrder.test.mjs`, `prototype/mutants.mjs` y `prototype/pg/run.mjs`.
  - `evidence/*` guarda las salidas, sin rutas locales ni secretos.

## 1. Reproducción y causa

### 1.1 Contrato real del cliente (FACT, `5ca9ccd`)

- **`TAB_ID` existe por página, no por conexión.**
  - Es una variable de módulo de `colyseusPresence.ts`. Vale `crypto.randomUUID()` o, sin esa API, `tab-<base36>-<base36>`.
  - Todos los joins de una carga de página mandan el mismo `tabId`.
- **El cliente puede tener dos joins en vuelo a la vez.**
  - `WorldEntryController.renew()` abre un segundo join (con `resume`) mientras el primero sigue pendiente (`colyseusPresence.overlap.test.ts`).
  - La página hace `leave()` de la room abandonada solo cuando el servidor ya la admitió.
- **El servidor solo ve el usuario, el `sessionId` de cada socket y el orden de llegada.**
  - El orden de llegada no coincide con el orden del cliente: onAuth, matchmaking y la espera de activación del host introducen awaits arbitrarios.

### 1.2 Reproducción con barreras deterministas (FACT, `repro/barriers.test.mjs`, 4/4 contra `5ca9ccd`)

No hay sleeps: el orden se fuerza con promesas retenidas, y el parking del join viejo se observa con una barrera `reached` que se resuelve **dentro** de `whenActive()`.

| Caso | Forma | Resultado observado hoy |
|---|---|---|
| R1 | El join viejo (fresco) queda estacionado en `admit` esperando la activación del host. El nuevo (resume) entra y queda colocado. Se libera el viejo. | El socket vigente recibe **4409**, y el join abandonado se queda con el jugador en ese proceso. |
| R2 | El join viejo simplemente llega tarde a `onJoin`, sin ningún await dentro de la room. Se probó con modos off/shadow/on de M0. | **4409** al socket vigente en los tres modos. |
| R3 | Dos procesos con `HostLifecycle` reales. El join viejo llega a un host **más nuevo** (B). | Su claim tiene una clave `(generation, seq)` mayor y **toma la fila**. El siguiente guardado de A es stale, así que la sesión vigente queda cercada con **4409**. |
| R4 | La respuesta tardía del claim del join viejo, que todavía hidrata. | **Ya está protegida**: no publica el actor viejo. |

El test original `cloud-readiness-3/evidence/lateAbandonedJoin.test.mjs` sigue pasando sin cambios.

### 1.3 Causa

- **Dentro de un proceso:**
  - La admisión decide «quién es la conexión actual de este usuario» por orden de llegada.
  - Un join fresco del mismo usuario reemplaza al socket vivo, salvo que este sea de *otra* pestaña y el join sea un `resume` (`presenceHosting.admit`, rama `resume === true`).
  - Nada identifica qué join de la **misma** página es el más reciente.
- **Entre procesos:**
  - El claim ordena por clave de host `(generation, seq)`. Un host más nuevo gana siempre, aunque traiga el intento **más viejo** de la página.
  - La memoria de un proceso no puede corregirlo: no conoce los intentos que vio el otro proceso.

## 2. Alternativas comparadas

| | A1 — contador de intentos por página (**recomendada**) | A2 — regla solo en el servidor: «un join fresco nunca reemplaza un socket vivo de la misma pestaña» | A3 — serializar los joins en el cliente | A4 — cerrar la conexión vieja/actual para «limpiar» |
|---|---|---|---|---|
| R1/R2 en un proceso | Corrige | Corrige (FACT, `evidence/alternative-a2.txt`: el join viejo recibe 4410) | Reduce, pero no elimina (INFERENCE: un join ya enviado puede aterrizar tarde igual) | **Prohibida** por la consigna; además rompe la sesión vigente |
| Solapamiento resume + resume (dos `renew()`) | Corrige (el orden es por intento, no por tipo) | **No corrige**: ambos son `resume` del mismo tab | Reduce | — |
| R3 entre procesos | Corrige con claim v3 (§6) | **No corrige** (FACT: R3 sigue pasando con A2) | No corrige: el orden de llegada a dos hosts no lo controla el cliente | — |
| Protocolo / SQL | Campo `attempt`, códigos 4410/4422, columnas y función v3 | Ninguno | Solo cliente | — |
| Riesgo | Más superficie (SQL + Edge + cliente) | Mínimo; regla local sin dato del cliente | No sirve frente a un cliente viejo o modificado | — |

- **Descartadas como solución:**
  - Los timestamps del cliente: el reloj del usuario no es confiable y no da orden.
  - El `tabId` como credencial: solo ordena intentos del **mismo** usuario autenticado.
  - «Memoria del proceso como orden global».
- **Un cliente nuevo no puede arreglar un servidor viejo.** El servidor viejo ignora `attempt`.
- **A2 sirve como mitigación local rápida, no como contrato.** Ver la decisión D5.

## 3. Contrato recomendado (A1)

### 3.1 Definiciones

- **Página** = el `TAB_ID` actual, uno por carga de página.
  - Recargar o abrir otra pestaña crea una página nueva.
  - Cambiar de cuenta dentro de la misma página **no** crea una página nueva. Igual da lo mismo: el orden es por `(userId, página)`, así que otra cuenta empieza su propio orden.
- **Intento** = entero `1 … 2^31−1`, monotónico por página (`let lastAttempt` de módulo).
  - Se incrementa en **cada** join que abre la página: el primero, la reconexión automática, `renew()` y «Jugar acá».
  - **Nunca se reenvía:** un `(página, intento)` repetido es un duplicado, no un reintento. Reintentar = abrir un intento nuevo.
- **No es credencial.** El servidor lo compara solo dentro del mismo usuario autenticado. Falsificarlo solo puede perjudicar a ese usuario: por ejemplo, adelantar su propio contador o hacer que sus joins viejos se rechacen.

### 3.2 Garantía en un proceso (memoria)

- `JoinOrder` guarda el intento más alto **admitido** por `(userId, página)`, en un mapa LRU acotado.
- **En la cola síncrona de `admit`**, después de todos sus awaits:

| Intento recibido | Respuesta | Efecto |
|---|---|---|
| Menor que el máximo | **4410 `stale-attempt`** | El socket vivo **no** se toca |
| Igual al máximo | **4410 `duplicate-attempt`** | Igual |
| Mayor que el máximo | Admitido | Sube el máximo |

- Un rechazo no mueve el máximo ni consume nada (caso 8).
- **Revalidación** `stillLatest()` justo antes del reemplazo en `PresenceRoom.onJoin`. Hoy es defensa en profundidad: ningún await separa la cola de `admit` del reemplazo, y por eso el mutante `recheck-removed` sobrevive, como se esperaba. Protege frente a awaits futuros.
- **Intento inválido** (0, negativo, no entero, string, fuera de rango) → **4422 `invalid-attempt`**, definido y sin efectos.
- **Sin `attempt`** (cliente viejo) → comportamiento de hoy, contado como `legacy`.
- **Límite:** con más de `maxPages` páginas activas en el proceso, una entrada desalojada podría readmitir un intento viejo de esa página (INFERENCE). La DB (§3.3) lo sigue cubriendo entre procesos, pero no dentro de uno. Ver la decisión D3.

### 3.3 Garantía entre procesos (Postgres)

- La fila de `world_player_locations` guarda `owner_page`, `owner_attempt` y `owner_page_session`. Los dos primeros valen **solo** mientras `owner_page_session = owner_session`.
- Un claim legado (v1, keyed o v2) cambia `owner_session` sin escribir esas columnas, así que invalida la información de página sin ambigüedad.
- `world_location_claim_keyed_v3` = claim v2 **más una regla evaluada antes del orden de claves**. Si la información de página es válida y la página coincide:

| Intento del claim | Respuesta | Efecto |
|---|---|---|
| Menor que el del dueño | `stale_attempt` | Final, no escribe nada, sin importar las claves |
| Igual al del dueño | `duplicate_attempt` | Final. Excepción: misma clave = adopción |
| Mayor que el del dueño | Toma la fila | La página avanzó |
| Mayor, con dueño `draining` | `owner_draining` | Se conserva su flush final |

- Otra página, o información inválida → exactamente claim v2 (P1–P6 de READINESS-3: owner state y takeover).
- **El realtime trata `stale_attempt` y `duplicate_attempt` como finales**, igual que `superseded`:
  - un socket que hidrata se cierra con 4410 sin colocarse;
  - uno ya colocado se cierra en `on` y solo se cuenta en `shadow`.

### 3.4 Qué decide cada capa

- **Memoria:** corrige el orden dentro de un proceso, aunque no haya SQL.
- **DB:** es la **única** autoridad del orden global, porque la fila y su lock serializan.
- **Ninguna capa cierra la conexión vigente** para resolver un intento viejo. El intento viejo es el que falla.

### 3.5 Los 9 casos obligatorios → evidencia

| # | Caso | Dónde se prueba |
|---|---|---|
| 1 | El intento abandonado no expulsa ni mueve al vigente | `joinOrder.test.mjs` caso 1 (llega tarde, y estacionado en admisión con barrera `reached`) |
| 2 | Una respuesta tardía no publica un actor viejo | caso 2 y repro R4 |
| 3 | Un claim viejo no desplaza al claim más nuevo de la misma página | caso 3/4/5 (PGlite) y **P2/P3** (Postgres real) |
| 4 | Una operación vieja no guarda con la identidad vigente | caso 3/4/5, caso «4 reverse» y **P1** (el guardado viejo es stale) |
| 5 | No hay dos actores autoritativos por página | caso 3/4/5 y **P3/P4** (exactamente un dueño) |
| 6 | Un resume no toma otra pestaña viva | caso 6 (4409 al join, sea cual sea su intento) |
| 7 | «Jugar acá» sigue reemplazando explícitamente | caso 7 (siguiente intento + `takeover`) |
| 8 | Duplicados y reintentos no consumen intentos indefinidamente | caso 8 (el duplicado no mueve el máximo; LRU acotado con `maxPages = 3`) y **P4** |
| 9 | Inválido, fuera de rango o inconsistente falla definido | caso 9: 4422 para `0, -1, 1.5, '3', MAX+1, null`; el SQL rechaza página sin intento, intento sin página y valores fuera de rango |

## 4. Evidencia del prototipo y controles negativos

Todas las corridas son locales: Node, PGlite para la lógica y **Postgres 17.6 real** (`supabase/postgres 17.6.1.158`) para la concurrencia. PGlite **no** se usa como prueba de concurrencia.

| Prueba | Resultado |
|---|---|
| `repro/barriers.test.mjs` contra `5ca9ccd` | 4/4 (el defecto existe) |
| `prototype/joinOrder.test.mjs` contra el árbol prototipo | **10/10, tres corridas** |
| Test de cliente `joinAttempt.proto.test.ts` (en el patch) | 2/2, junto a `overlap` y `ownerUnreachable` (8 tests) |
| `prototype/mutants.mjs` (`evidence/realtime-mutants.txt`) | `admission-check-removed`, `duplicate-counted-as-new`, `stale-claim-not-final`, `invalid-attempt-accepted`: **DETECTED**. `recheck-removed`: **SURVIVED (esperado**, ver §3.2). Exit 0 |
| `prototype/pg/run.mjs`, 5 rondas, Postgres real (`evidence/claim-v3-postgres.{txt,json}`) | Prototipo **PASS**: P1–P6 y D 5/5, **0 deadlocks**. Mutantes: `no-same-page` DETECTED [P1–P4], `no-page-session` DETECTED [P5], `duplicate-takes` DETECTED [P4], `draining-ignored` DETECTED [P6]. Exit 0 |
| Alternativa A2 en copia aislada (`evidence/alternative-a2.txt`) | R1/R2 dejan de reproducirse (4410); **R3 sigue** |

**Escenarios en Postgres real.** El orden se fuerza con barreras de advisory lock inyectadas en memoria en las líneas `-- @hook` y observadas en `pg_stat_activity`.

| Escenario | Qué prueba |
|---|---|
| P1 | El intento viejo reclama primero en el host nuevo. El intento nuevo, con clave menor, toma la fila, y el guardado viejo es stale. |
| P2 | El nuevo primero; el viejo, con clave mayor, recibe `stale_attempt` y no escribe nada. |
| P3 | Concurrencia con la fila tomada y un segundo claim en espera del lock. Los dos órdenes terminan con el intento nuevo. |
| P4 | Duplicado simultáneo desde dos hosts: exactamente uno reclama. |
| P5 | Flota mixta: un claim legado invalida la información de página. |
| P6 | Un dueño `draining` hace esperar al intento nuevo. |
| D | Detección de deadlocks. |

**Criterio de los controles:**
- Un timeout, cancelación o fixture rota cuenta como **BLOCKED**, nunca como detección: `mutants.mjs` exige una aserción fallida, y `run.mjs` sale con 2.
- El mutante `stale-claim-not-final` se corrigió para esperar con límite y **afirmar** explícitamente, en vez de detectarse por timeout.

No se repitieron las baterías completas de READINESS-3. P5 y P6 cubren la convivencia con las reglas v2.

## 5. Archivos afectados (implementación futura)

| Capa | Archivo | Cambio |
|---|---|---|
| Realtime | `services/realtime/src/presence/joinOrder.js` (nuevo) | Modo, validación de `attempt`, `JoinOrder` (LRU, `observe`, `isLatest`, `stats`) |
| Realtime | `rooms/presenceHosting.js` | Validación y observación en la cola síncrona de `admit`; `stillLatest()` |
| Realtime | `rooms/PresenceRoom.js` | Revalidación tras `await hosting.admit`; construir `JoinOrder` con el modo del env |
| Realtime | `rooms/locationJoin.js` | Pasar página e intento a la sesión; finales `stale_attempt` / `duplicate_attempt` → 4410 |
| Realtime | `presence/locationJournal.js` | Pasar `{takeover, page, attempt}` al claim; respuestas finales |
| Realtime | `presence/recoveryCapability.js` | Enrutar a v3 si la capacidad lo anuncia, con fallback v1/v2 si no |
| Realtime | `world/persistence/playerData.js` | `locationClaimV3` en ambos adaptadores; lectura de las respuestas nuevas |
| Realtime | `protocol/closeCodes.js` | 4410 / 4422 en el protocolo (el prototipo los define en `joinOrder.js`) |
| Edge | `supabase/functions/world-authority/*` | Op `location_claim_v3` y anuncio en `capabilities`. **No prototipado** |
| SQL | Nueva migración | Columnas, función v3, grants solo a `service_role`, marcador de versión |
| Cliente | `src/features/wildlands/multiplayer/api/colyseusPresence.ts` | `attempt: ++lastAttempt` en cada join; tratar 4410 como «intento obsoleto, ignorar» (no es un error para el usuario) |
| Tests | Junto a cada archivo | Portar los casos 1–9, los mutantes y la batería de Postgres real |

Fuera de alcance: PM2, `ecosystem.config.js`, CLOUD STARTUP-1 y C1.

## 6. Cambios de SQL y protocolo estrictamente necesarios

1. **Columnas** en `world_player_locations`, todas nullables, sin backfill:
   - `owner_page text` con CHECK `^[A-Za-z0-9_-]{8,64}$`, compatible con el UUID y con el fallback `tab-…`;
   - `owner_attempt bigint` con CHECK `1..2^31−1`;
   - `owner_page_session uuid`.
2. **Función** `world_location_claim_keyed_v3(user, generation, seq, session, host, takeover, page, attempt)`:
   - página e intento van los dos o ninguno; si no, `invalid_attempt`;
   - `SECURITY INVOKER`;
   - `EXECUTE` revocado a `PUBLIC`, `anon` y `authenticated`, y concedido solo a `service_role`.
3. **Edge** `world-authority`: op `location_claim_v3` y su anuncio en `capabilities`. Si la función falta, `501 unsupported`, igual que las ops de recovery de v6.
4. **Protocolo cliente → realtime:** campo opcional `attempt` en las opciones de join.
5. **Protocolo realtime → cliente:** cierres **4410** `stale-attempt` / `duplicate-attempt` y **4422** `invalid-attempt`.
6. **Flag** `WORLD_JOIN_ORDER=off|shadow|on`, por defecto `off`.

Nada más: no cambian las claves `(generation, seq)`, ni los leases, ni el guardado CAS, ni las reglas v2.

## 7. Compatibilidad y rollback

| Combinación | Resultado |
|---|---|
| Cliente nuevo + realtime viejo | `attempt` se ignora; comportamiento de hoy (defecto incluido). Sin rotura. |
| Cliente viejo + realtime nuevo | Sin `attempt` → `legacy`, comportamiento de hoy. Sin rotura. |
| Realtime nuevo + autoridad vieja (sin v3) | La capacidad no anuncia v3, y se usa v2/v1 con la misma clave. Queda **solo la corrección en proceso**; R3 persiste. |
| Dos procesos en distinto orden, ambos v3 | Orden global por la fila (P1–P4). |
| Flota mixta (un proceso v3 y otro legado) | El claim legado invalida la información de página (P5). Desde ahí rige v2 hasta el próximo claim v3. Sin dos dueños; el orden de página se pierde transitoriamente. |
| `off` | Exactamente el comportamiento de hoy (verificado en el caso «modes»). |
| `shadow` | Admite como hoy y cuenta `wouldRefuse` y los finales de claim. Sirve para medir antes de `on`. |
| `on` | Aplica 4410/4422 y los finales de claim. |

**Rollback:**
- **Inmediato:** `WORLD_JOIN_ORDER=off` y reinicio del realtime. Ese reinicio lo autoriza el dueño, no este trabajo.
- **Más profundo:** quitar el op v3 de `capabilities`, para volver a v2 sin tocar datos.
- Las columnas nullables pueden quedar. Un claim legado las invalida solo, y no hace falta `DROP`.
- El cliente con `attempt` es inocuo frente a cualquier servidor.

## 8. Plan de implementación por bloques

Cada bloque va en commits propios, con sus tests y controles negativos.

| Bloque | Contenido | Condición de cierre |
|---|---|---|
| J1 — Cliente | `attempt` monotónico; 4410 tratado como «intento obsoleto» | Tests de solapamiento + casos 7 y 8 de cliente |
| J2 — Realtime en proceso | `JoinOrder`, admisión, revalidación, 4410/4422, flag off/shadow/on, métricas | Casos 1, 2, 6–9 + mutantes de admisión. Sin SQL. Desplegable solo, con la corrección en proceso |
| J3 — SQL | Migración con columnas + v3 + grants | Batería P1–P6/D en Postgres real, 5 rondas, 0 deadlocks; 4 mutantes SQL detectados; `invalid_attempt` |
| J4 — Edge | Op `location_claim_v3` + `capabilities`; 501 si falta la función | Tests del handler; v5/v6 sin cambios |
| J5 — Realtime entre procesos | Enrutamiento v3, finales de claim, fallback | Casos 3/4/5 + flota mixta + compatibilidad §7 |
| J6 — Validación local integrada | `shadow` en un entorno local dedicado; después `on` | Ninguno queda en `on` en entornos existentes sin decisión del dueño |

- **Orden de despliegue (INFERENCE):** SQL → Edge → realtime en `shadow` → cliente → `on`. Cada paso es compatible hacia atrás según §7.
- La regla de «misma página» de M0 se reconsidera recién después de J5, montada sobre este contrato.

## 9. Decisiones pendientes del dueño

| # | Decisión | Recomendación |
|---|---|---|
| D1 | Nombre del flag y modos | `WORLD_JOIN_ORDER=off\|shadow\|on`, por defecto `off` |
| D2 | Códigos de cierre | 4410 obsoleto/duplicado, 4422 inválido. FACT: hoy `closeCodes.js` solo define 4001, 4409 y 4503; sin colisión en realtime ni cliente |
| D3 | Límite LRU por proceso (`maxPages`) | Alrededor de 10 000; aceptar el borde de readmisión tras desalojo, que la DB cubre entre procesos |
| D4 | ¿Plegar v3 en la migración de recovery (`20261005120000`, sin publicar) o hacer una migración aparte? | Migración aparte, para que el rollback y la revisión queden separados |
| D5 | ¿Entregar A2 como mitigación rápida en proceso, antes de A1? | Opcional. Es mínimo y sin protocolo, pero no cubre resume+resume ni R3. Si se hace, se retira cuando J2 esté en `on` |
| D6 | ¿Serializar también los joins en el cliente (A3)? | No como corrección. Como mejora de UX, sí: menos rechazos 4410 visibles en logs |
| D7 | ¿4410 debe ser silencioso en el cliente o registrarse? | Silencioso para el usuario y contado en métricas |
| OPEN QUESTION | ¿Hay rutas de join fuera de `colyseusPresence.ts` (otras rooms o herramientas) que reutilicen `TAB_ID`? | Auditar antes de J1 |

## 10. Estado del entorno dejado por este trabajo

- **Worktree `pokeswap-joinorder1-proto`:** contiene el prototipo **sin commitear**, reproducible desde `prototype/prototype.patch`. No se integró.
- **Base `cr4_joinorder`:** queda en el contenedor local `supabase_db_wlocpg-orig`. Es dedicada; la base `postgres` del stack no se tocó.
- Los `node_modules` de los worktrees nuevos son junctions a los de int1. **No se debe correr `vite dev` ahí.**
- No se tocaron int1, el entorno oscuro, PM2, hosted, flags ni el trabajo de ecosistema de la secundaria.
